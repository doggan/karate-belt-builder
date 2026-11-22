#!/usr/bin/env node
/**
 * One-off preparation of the dogi model:
 *
 *   node scripts/prepare-model.mjs [in.glb] [out.glb]
 *   (defaults: assets/models/dogi-source.glb → assets/models/dogi-prepared.glb)
 *
 * The source (an AI-generated model) is a single fused mesh with a black belt baked
 * into its geometry and textures. This script:
 *   1. Finds the baked belt: the connected region of dark-textured triangles grown
 *      from the clean band at the back of the waist.
 *   2. Deletes the hanging tails (free flaps below the wrap). The wrap and knot are
 *      flattened onto the jacket surface and repainted as plain jacket fabric, keeping
 *      the surface continuous — the baked belt is wider than a real one, so deleting
 *      it would leave gaps around the app's belt.
 *   3. Re-orients and scales it into app space: faces +Z, meters, belt center at y = WAIST_Y.
 *   4. Measures the waist cross-section and writes src/scene/dogiModel.json so the
 *      generated belt wraps the jacket snugly.
 *
 * Then `npm run model:optimize` simplifies/compresses the result into public/models/dogi.glb.
 */
import { writeFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { prune } from '@gltf-transform/functions'
import sharp from 'sharp'

const [input = 'assets/models/dogi-source.glb', output = 'assets/models/dogi-prepared.glb'] = process.argv.slice(2)

const WAIST_Y = 1.0
/** Hem-of-pants to belt-center height in app space (m); sets the overall scale. */
const HEM_TO_WAIST = 0.97
/** Texels darker than this (0–255 luminance) count as belt. The gi texture is ~150–180. */
const DARK = 70
/** Grow the belt region by this many triangle rings to catch its anti-aliased edges. */
const GROW_RINGS = 3
/** Paint this many pixels past each belt triangle's edges in UV space. */
const PAINT_DILATE_PX = 2.5

const io = new NodeIO()
const doc = await io.read(input)
const meshes = doc.getRoot().listMeshes()
if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) throw new Error('Expected exactly one mesh primitive')
const prim = meshes[0].listPrimitives()[0]
const material = prim.getMaterial()
const pos = prim.getAttribute('POSITION')
const nrm = prim.getAttribute('NORMAL')
const P = pos.getArray()
const N = nrm.getArray()
const UV = prim.getAttribute('TEXCOORD_0').getArray()
const idx = prim.getIndices()
const I = idx.getArray()
const triCount = I.length / 3
const vertCount = P.length / 3

// ── Textures ────────────────────────────────────────────────────────────────
async function decode(texture) {
  const { data, info } = await sharp(Buffer.from(texture.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height, texture }
}
const base = await decode(material.getBaseColorTexture())
const normalMap = material.getNormalTexture() ? await decode(material.getNormalTexture()) : null
const mr = material.getMetallicRoughnessTexture() ? await decode(material.getMetallicRoughnessTexture()) : null

const texel = (img, u, v) => {
  const x = Math.min(img.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.w)))
  const y = Math.min(img.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.h)))
  return (y * img.w + x) * 3
}
const lum = (u, v) => {
  const k = texel(base, u, v)
  return 0.299 * base.data[k] + 0.587 * base.data[k + 1] + 0.114 * base.data[k + 2]
}
const triLum = (t) => {
  let s = 0
  for (let j = 0; j < 3; j++) {
    const v = I[t * 3 + j]
    s += lum(UV[v * 2], UV[v * 2 + 1])
  }
  return s / 3
}
const centroid = (t, axis) => (P[I[t * 3] * 3 + axis] + P[I[t * 3 + 1] * 3 + axis] + P[I[t * 3 + 2] * 3 + axis]) / 3

// ── Bounds (source: +X front, Y up, Z across the shoulders) ─────────────────
let minY = Infinity
let maxY = -Infinity
for (let v = 0; v < vertCount; v++) {
  minY = Math.min(minY, P[v * 3 + 1])
  maxY = Math.max(maxY, P[v * 3 + 1])
}
const H = maxY - minY
const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.max(0, Math.floor(p * arr.length)))]

// ── 1. Locate the belt band from the back of the waist ──────────────────────
// Histogram dark triangles at the back (x < 0) near the middle of the body; the belt is the peak.
const BINS = 200
const hist = new Array(BINS).fill(0)
const binOf = (y) => Math.min(BINS - 1, Math.max(0, Math.floor(((y - minY) / H) * BINS)))
for (let t = 0; t < triCount; t++) {
  const y = centroid(t, 1)
  if (y < minY + 0.3 * H || y > minY + 0.8 * H || centroid(t, 0) > 0 || Math.abs(centroid(t, 2)) > 0.15 * H) continue
  if (triLum(t) < DARK) hist[binOf(y)]++
}
const peak = hist.indexOf(Math.max(...hist))
let lo = peak
let hi = peak
while (lo > 0 && hist[lo - 1] > hist[peak] * 0.05) lo--
while (hi < BINS - 1 && hist[hi + 1] > hist[peak] * 0.05) hi++
const beltLo = minY + (lo / BINS) * H
const beltHi = minY + ((hi + 1) / BINS) * H
const beltY = (beltLo + beltHi) / 2

// ── 2. Flood-fill the connected dark region (wrap + knot + tails) ───────────
// Connectivity by *position*: the mesh splits vertices along UV seams, so index
// adjacency alone would stop the fill at every seam.
const posKey = new Map()
const weldId = new Int32Array(vertCount)
for (let v = 0; v < vertCount; v++) {
  const key = `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)}`
  let id = posKey.get(key)
  if (id === undefined) posKey.set(key, (id = posKey.size))
  weldId[v] = id
}
const vertTris = Array.from({ length: posKey.size }, () => [])
for (let t = 0; t < triCount; t++) for (let j = 0; j < 3; j++) vertTris[weldId[I[t * 3 + j]]].push(t)

const dark = new Uint8Array(triCount)
for (let t = 0; t < triCount; t++) {
  const y = centroid(t, 1)
  if (y > beltLo - 0.13 * H && y < beltHi + 0.02 * H && triLum(t) < DARK) dark[t] = 1
}
const inBelt = new Uint8Array(triCount)
const queue = []
for (let t = 0; t < triCount; t++) {
  const y = centroid(t, 1)
  if (dark[t] && y >= beltLo && y <= beltHi && centroid(t, 0) < 0) {
    inBelt[t] = 1
    queue.push(t)
  }
}
const neighbors = function* (t) {
  for (let j = 0; j < 3; j++) for (const n of vertTris[weldId[I[t * 3 + j]]]) if (n !== t) yield n
}
while (queue.length) {
  const t = queue.pop()
  for (const n of neighbors(t)) {
    if (!inBelt[n] && dark[n]) {
      inBelt[n] = 1
      queue.push(n)
    }
  }
}
// Grow a few rings to catch the anti-aliased edge texels.
let frontier = []
for (let t = 0; t < triCount; t++) if (inBelt[t]) frontier.push(t)
for (let r = 0; r < GROW_RINGS; r++) {
  const next = []
  for (const t of frontier) for (const n of neighbors(t)) if (!inBelt[n] && triLum(n) < 140) {
    inBelt[n] = 1
    next.push(n)
  }
  frontier = next
}

// Hanging tails: belt triangles clearly below the wrap band → delete. The rest → repaint.
const TAIL_BELOW = beltLo - 0.004 * H
const remove = new Uint8Array(triCount)
let removedCount = 0
let paintedCount = 0
for (let t = 0; t < triCount; t++) {
  if (!inBelt[t]) continue
  if (centroid(t, 1) < TAIL_BELOW && centroid(t, 0) > 0) {
    remove[t] = 1
    removedCount++
  } else paintedCount++
}

// The tails' outline on the jacket skirt (where they were fused to it) keeps dark,
// anti-aliased texels. Grow out from the deleted tails and repaint those too.
const TAIL_FRINGE_RINGS = 5
let fringe = []
for (let t = 0; t < triCount; t++) if (remove[t]) fringe.push(t)
let fringePainted = 0
for (let r = 0; r < TAIL_FRINGE_RINGS; r++) {
  const next = []
  for (const t of fringe) for (const n of neighbors(t)) if (!inBelt[n] && !remove[n] && triLum(n) < 150) {
    inBelt[n] = 1 // painted, not removed
    fringePainted++
    next.push(n)
  }
  fringe = next
}

// ── 3a. Flatten the wrap + knot onto the jacket surface ─────────────────────
// For each angle around the body, snap belt vertices to the radius of the jacket just
// above/below the belt: a smooth band, with no ridge poking out around the app's thinner belt.
const ANGLE_BINS = 72
const angleBin = (x, z) => Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * ANGLE_BINS) % ANGLE_BINS
const beltVerts = new Set()
for (let t = 0; t < triCount; t++) {
  if (!inBelt[t] || remove[t] || Math.abs(centroid(t, 1) - beltY) > (beltHi - beltLo)) continue
  for (let j = 0; j < 3; j++) beltVerts.add(I[t * 3 + j])
}
const rimRadii = Array.from({ length: ANGLE_BINS }, () => [])
const beltH = beltHi - beltLo
for (let v = 0; v < vertCount; v++) {
  if (beltVerts.has(v)) continue
  const dy = Math.abs(P[v * 3 + 1] - beltY)
  if (dy < beltH * 0.6 || dy > beltH * 1.6 || Math.abs(P[v * 3 + 2]) > 0.2 * H) continue
  const x = P[v * 3]
  const z = P[v * 3 + 2]
  rimRadii[angleBin(x, z)].push(Math.hypot(x, z))
}
const rim = rimRadii.map((r) => (r.length ? pct(r, 0.5) : null))
let flattened = 0
for (const v of beltVerts) {
  const x = P[v * 3]
  const z = P[v * 3 + 2]
  const target = rim[angleBin(x, z)]
  const r = Math.hypot(x, z)
  if (target === null || r === 0) continue // snap in *and* out: a smooth band, no sculpted folds
  P[v * 3] = (x / r) * target
  P[v * 3 + 2] = (z / r) * target
  flattened++
}

// ── 3b. Repaint the wrap + knot as jacket fabric ────────────────────────────
// Fabric color: median of jacket texels just above and below the belt.
function medianColor(img) {
  const samples = [[], [], []]
  for (let t = 0; t < triCount; t += 7) {
    if (inBelt[t]) continue
    const y = centroid(t, 1)
    if (Math.abs(y - beltY) > (beltHi - beltLo) * 2.5 || Math.abs(y - beltY) < (beltHi - beltLo)) continue
    const v = I[t * 3]
    const k = texel(img, UV[v * 2], UV[v * 2 + 1])
    for (let c = 0; c < 3; c++) samples[c].push(img.data[k + c])
  }
  return samples.map((s) => pct(s, 0.5))
}
function paintTriangles(img, color) {
  const { data, w, h } = img
  for (let t = 0; t < triCount; t++) {
    if (!inBelt[t] || remove[t]) continue
    const pts = [0, 1, 2].map((j) => {
      const v = I[t * 3 + j]
      return [(UV[v * 2] - Math.floor(UV[v * 2])) * w, (UV[v * 2 + 1] - Math.floor(UV[v * 2 + 1])) * h]
    })
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - PAINT_DILATE_PX))
    const x1 = Math.min(w - 1, Math.ceil(Math.max(...xs) + PAINT_DILATE_PX))
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - PAINT_DILATE_PX))
    const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys) + PAINT_DILATE_PX))
    if (x1 - x0 > w / 2 || y1 - y0 > h / 2) continue // UV seam wrap-around; skip
    // Signed distance to each edge (positive inside for CCW; handle either winding).
    const area = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1])
    const sign = area >= 0 ? 1 : -1
    const edges = [0, 1, 2].map((e) => {
      const [ax, ay] = pts[e]
      const [bx, by] = pts[(e + 1) % 3]
      const len = Math.hypot(bx - ax, by - ay) || 1
      return [ax, ay, (bx - ax) / len, (by - ay) / len]
    })
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let inside = true
        for (const [ax, ay, dx, dy] of edges) {
          const d = sign * (dx * (y + 0.5 - ay) - dy * (x + 0.5 - ax))
          if (d < -PAINT_DILATE_PX) {
            inside = false
            break
          }
        }
        if (!inside) continue
        const k = (y * w + x) * 3
        data[k] = color[0]
        data[k + 1] = color[1]
        data[k + 2] = color[2]
      }
    }
  }
}
async function encodeInto(img) {
  const mime = img.texture.getMimeType()
  const s = sharp(img.data, { raw: { width: img.w, height: img.h, channels: 3 } })
  const buf = mime === 'image/png' ? await s.png().toBuffer() : await s.jpeg({ quality: 92 }).toBuffer()
  img.texture.setImage(new Uint8Array(buf))
}
const fabric = medianColor(base)
paintTriangles(base, fabric)
await encodeInto(base)
if (normalMap) {
  paintTriangles(normalMap, [128, 128, 255])
  await encodeInto(normalMap)
}
if (mr) {
  paintTriangles(mr, medianColor(mr))
  await encodeInto(mr)
}

// ── 4. Measure the waist cross-section (source units) ───────────────────────
// Jacket vertices in and around the belt band, excluding the sleeves (large |z|) and the knot (front centre).
const xs = []
const zs = []
const band = (beltHi - beltLo) * 1.5
for (let v = 0; v < vertCount; v++) {
  const y = P[v * 3 + 1]
  const z = P[v * 3 + 2]
  if (Math.abs(y - beltY) > band || Math.abs(z) > 0.2 * H) continue
  zs.push(z)
  if (Math.abs(z) > 0.04 * H) xs.push(P[v * 3]) // depth measured off-centre to skip the knot bulge
}
const front = pct(xs, 0.995)
const back = pct(xs, 0.005)
const right = pct(zs, 0.995)
const left = pct(zs, 0.005)

// ── 5. Transform into app space ─────────────────────────────────────────────
// Rotate −90° about Y (+X front → +Z front), scale to meters, belt centre → (0, WAIST_Y, 0).
const scale = HEM_TO_WAIST / (beltY - minY)
const cx = (front + back) / 2
const cz = (right + left) / 2
for (let v = 0; v < vertCount; v++) {
  const x = P[v * 3] - cx
  const y = P[v * 3 + 1] - beltY
  const z = P[v * 3 + 2] - cz
  P[v * 3] = -z * scale
  P[v * 3 + 1] = y * scale + WAIST_Y
  P[v * 3 + 2] = x * scale
  const nx = N[v * 3]
  const nz = N[v * 3 + 2]
  N[v * 3] = -nz
  N[v * 3 + 2] = nx
}
pos.setArray(P)
nrm.setArray(N)

const kept = []
for (let t = 0; t < triCount; t++) if (!remove[t]) kept.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2])
idx.setArray(new Uint32Array(kept))
await doc.transform(prune())
await io.write(output, doc)

const meta = {
  note: 'Generated by scripts/prepare-model.mjs — do not edit by hand.',
  waistY: WAIST_Y,
  /** Waist cross-section half-axes where the baked belt sat (m, app space). */
  waist: { a: ((right - left) / 2) * scale, b: ((front - back) / 2) * scale },
  /** Width of the (repainted) baked belt band (m). The app's belt should cover most of it. */
  bakedBeltWidth: (beltHi - beltLo) * scale,
  minY: (minY - beltY) * scale + WAIST_Y,
  maxY: (maxY - beltY) * scale + WAIST_Y,
}
writeFileSync('src/scene/dogiModel.json', JSON.stringify(meta, null, 2) + '\n')
console.log(`belt band y ∈ [${beltLo.toFixed(3)}, ${beltHi.toFixed(3)}] (source units)`)
console.log(`belt triangles: ${removedCount} deleted (tails), ${paintedCount} repainted (wrap/knot); ${fringePainted} tail-fringe repainted; ${flattened} vertices flattened; fabric rgb ${fabric}`)
console.log(JSON.stringify(meta, null, 2))
