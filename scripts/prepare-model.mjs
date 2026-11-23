#!/usr/bin/env node
/**
 * One-off preparation of the dogi model:
 *
 *   node scripts/prepare-model.mjs [in.glb] [out.glb]
 *   (defaults: assets/models/dogi-source.glb → assets/models/dogi-prepared.glb)
 *
 * The source (an AI-generated model) is a single closed, watertight mesh: the gi is a thin
 * solid shell (outer + inner surface) with a black belt baked into its geometry and
 * textures. The belt's wrap, knot and hanging tails are relief fused into the jacket's outer
 * surface; there is no jacket surface underneath them, so deleting them leaves holes. This
 * script rebuilds that area as plain jacket instead:
 *   1. Finds the baked belt: the connected dark-textured region grown from the back of the
 *      waist, widened over the belt's leftover relief (its raised edges, the tails' side
 *      walls) on the jacket's outside, plus any clean islands it encloses. The result is a
 *      topological annulus around the waist that dips down the skirt front where the tails
 *      hung. A few pinholes through the scanned shell that open inside it are closed.
 *   2. Rebuilds the jacket surface there. Seen from the body axis, the clean jacket around
 *      the region is a height field r(θ, y); the hole is filled on a (θ, y) grid with a
 *      smooth tension spline that meets the rim. The region's vertices keep their own
 *      (θ, y) (untangled where the belt's folds and overlaps fold over in that view) and go
 *      onto the new surface; the fabric just outside the rim is eased into it. No triangles
 *      are deleted, so the shell stays closed.
 *   3. Recomputes normals over the rebuilt area and repaints its textures with colors carried
 *      smoothly in from the fabric around it (also filling the texture gutters, so no dark
 *      belt texels bleed in at lower mip levels).
 *   4. Re-orients and scales it into app space: faces +Z, meters, belt center at y = WAIST_Y.
 *   5. Measures the waist cross-section and writes src/scene/dogiModel.json so the
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
/** Rebuilt-surface grid: cells around the body, and cell height (source units). */
const GRID_THETA = 720
const GRID_DY = 0.001
/**
 * Region growth, in source units (1 ≈ 1.58 m): margin above/below the belt band, margin round
 * the tails, how far below the outermost surface still counts as the jacket's outside, and
 * the along-the-mesh reach that counts as "around the belt".
 */
const BAND_MARGIN = 0.01
const EDGE_MARGIN = 0.009
const OUTER_TOL = 0.0015
const NEAR = 0.08
/** Around the band, triangles facing more inward than this (cosine to the outward radial) are pockets, not jacket. */
const FACING_MIN = -0.3
/** Width of the blend zone outside the rebuilt region (source units). */
const BLEND = 0.012
/** How far the smooth fill may stray from the no-overshoot (harmonic) fill (source units). */
const OVERSHOOT = 0.004
/** Tension-spline length scale for the hole fill (source units). */
const TENSION_LENGTH = 0.005
/** Texture repaint: always paint this far past a rebuilt triangle (px); fill empty gutter texels up to GUTTER_PX. */
const PAINT_DILATE_PX = 1
const GUTTER_PX = 8

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
let I = idx.getArray()
let triCount = I.length / 3
const vertCount = P.length / 3

// ── Textures ────────────────────────────────────────────────────────────────
async function decode(texture) {
  const { data, info } = await sharp(Buffer.from(texture.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height, texture }
}
const base = await decode(material.getBaseColorTexture())
const normalMap = material.getNormalTexture() ? await decode(material.getNormalTexture()) : null
const mr = material.getMetallicRoughnessTexture() ? await decode(material.getMetallicRoughnessTexture()) : null
const images = [base, normalMap, mr].filter(Boolean)

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

// ── Welded topology ─────────────────────────────────────────────────────────
// The mesh splits vertices along UV seams; weld them by position so connectivity (and
// moved positions) carry across seams.
const posKey = new Map()
const weldId = new Int32Array(vertCount)
for (let v = 0; v < vertCount; v++) {
  const key = `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)}`
  let id = posKey.get(key)
  if (id === undefined) posKey.set(key, (id = posKey.size))
  weldId[v] = id
}
const W = posKey.size
posKey.clear()
const WP = new Float64Array(W * 3)
for (let v = 0; v < vertCount; v++) for (let c = 0; c < 3; c++) WP[weldId[v] * 3 + c] = P[v * 3 + c]
/** CSR lists: triangles around each welded vertex, and its neighbours (each edge appears twice on a closed manifold — uniform weights either way). */
function csr(count, fill) {
  const start = new Int32Array(count + 1)
  fill((a) => start[a + 1]++)
  for (let i = 0; i < count; i++) start[i + 1] += start[i]
  const items = new Int32Array(start[count])
  const cursor = start.slice(0, count)
  fill((a, b) => (items[cursor[a]++] = b))
  return { start, items }
}
let T, vtris, vnbrs
function buildTopology() {
  T = new Int32Array(triCount * 3)
  for (let i = 0; i < T.length; i++) T[i] = weldId[I[i]]
  vtris = csr(W, (add) => {
    for (let t = 0; t < triCount; t++) for (let j = 0; j < 3; j++) add(T[t * 3 + j], t)
  })
  vnbrs = csr(W, (add) => {
    for (let t = 0; t < triCount; t++)
      for (let j = 0; j < 3; j++) {
        add(T[t * 3 + j], T[t * 3 + ((j + 1) % 3)])
        add(T[t * 3 + ((j + 1) % 3)], T[t * 3 + j])
      }
  })
}
buildTopology()
/** Triangles sharing an edge with t. */
const edgeNeighbors = (t) => {
  const out = []
  for (let j = 0; j < 3; j++) {
    const a = T[t * 3 + j]
    const b = T[t * 3 + ((j + 1) % 3)]
    for (let k = vtris.start[a]; k < vtris.start[a + 1]; k++) {
      const n = vtris.items[k]
      if (n !== t && (T[n * 3] === b || T[n * 3 + 1] === b || T[n * 3 + 2] === b)) out.push(n)
    }
  }
  return out
}
/** Triangles sharing a vertex with t. */
const vertexNeighbors = function* (t) {
  for (let j = 0; j < 3; j++) {
    const a = T[t * 3 + j]
    for (let k = vtris.start[a]; k < vtris.start[a + 1]; k++) if (vtris.items[k] !== t) yield vtris.items[k]
  }
}

// ── 1a. Locate the belt band from the back of the waist ─────────────────────
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

// ── 1b. Flood-fill the connected dark region (wrap + knot + tails) ──────────
const dark = new Uint8Array(triCount)
for (let t = 0; t < triCount; t++) {
  const y = centroid(t, 1)
  if (y > beltLo - 0.13 * H && y < beltHi + 0.02 * H && triLum(t) < DARK) dark[t] = 1
}
let inBelt = new Uint8Array(triCount)
const queue = []
for (let t = 0; t < triCount; t++) {
  const y = centroid(t, 1)
  if (dark[t] && y >= beltLo && y <= beltHi && centroid(t, 0) < 0) {
    inBelt[t] = 1
    queue.push(t)
  }
}
while (queue.length) {
  const t = queue.pop()
  for (const n of vertexNeighbors(t)) {
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
  for (const t of frontier)
    for (const n of vertexNeighbors(t))
      if (!inBelt[n] && triLum(n) < 140) {
        inBelt[n] = 1
        next.push(n)
      }
  frontier = next
}
// Then one plain ring all round, so the rebuilt surface's rim sits on clean, undented fabric.
frontier = []
for (let t = 0; t < triCount; t++) if (inBelt[t]) for (const n of vertexNeighbors(t)) if (!inBelt[n]) frontier.push(n)
for (const t of frontier) inBelt[t] = 1

// ── 1c. Fill the clean islands the region encloses ──────────────────────────
// Everything outside the region except its one big connected remainder (the rest of the
// gi) is a small enclosed island, e.g. a light patch on the knot. Fold those in, so the
// region is a clean annulus with just an upper and a lower rim.
function fillIslands() {
  const comp = new Int32Array(triCount).fill(-1)
  const sizes = []
  for (let t = 0; t < triCount; t++) {
    if (inBelt[t] || comp[t] >= 0) continue
    const c = sizes.length
    let size = 0
    const stack = [t]
    comp[t] = c
    while (stack.length) {
      const u = stack.pop()
      size++
      for (const n of edgeNeighbors(u))
        if (!inBelt[n] && comp[n] < 0) {
          comp[n] = c
          stack.push(n)
        }
    }
    sizes.push(size)
  }
  const main = sizes.indexOf(Math.max(...sizes))
  for (let t = 0; t < triCount; t++) if (!inBelt[t] && comp[t] !== main) inBelt[t] = 1
}
fillIslands()

// ── 1d. Body axis, distance from the region, and the jacket's outside ───────
const regionVertMask = () => {
  const m = new Uint8Array(W)
  for (let t = 0; t < triCount; t++) if (inBelt[t]) for (let j = 0; j < 3; j++) m[T[t * 3 + j]] = 1
  return m
}
let axX = 0
let axZ = 0
{
  const m = regionVertMask()
  const xs = []
  const zs = []
  for (let v = 0; v < W; v++)
    if (m[v]) {
      xs.push(WP[v * 3])
      zs.push(WP[v * 3 + 2])
    }
  axX = (pct(xs, 0.01) + pct(xs, 0.99)) / 2
  axZ = (pct(zs, 0.01) + pct(zs, 0.99)) / 2
}
const thetaOf = (x, z) => Math.atan2(z - axZ, x - axX)
const radiusOf = (v) => Math.hypot(WP[v * 3] - axX, WP[v * 3 + 2] - axZ)

// Geodesic (along-the-mesh) distance from the belt region, out to NEAR. Only fabric this
// close counts as "the jacket around the belt": it keeps the sleeves (which hang next to
// the waist but connect to it only via the shoulders) out of everything below.
/** Geodesic distance (along mesh edges) from the vertices in `sources`, out to `maxD`. */
function geodesicFrom(sources, maxD) {
  const out = new Float64Array(W).fill(Infinity)
  const heap = [] // [d, v] binary min-heap
  const push = (d, v) => {
    heap.push([d, v])
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  for (let v = 0; v < W; v++)
    if (sources[v]) {
      out[v] = 0
      push(0, v)
    }
  while (heap.length) {
    const [d, v] = pop()
    if (d > out[v] || d > maxD) continue
    for (let q = vnbrs.start[v]; q < vnbrs.start[v + 1]; q++) {
      const u = vnbrs.items[q]
      const nd = d + Math.hypot(WP[u * 3] - WP[v * 3], WP[u * 3 + 1] - WP[v * 3 + 1], WP[u * 3 + 2] - WP[v * 3 + 2])
      if (nd < out[u]) {
        out[u] = nd
        push(nd, u)
      }
    }
  }
  return out
}
const dist = geodesicFrom(regionVertMask(), NEAR)
const triDist = (t) => Math.max(dist[T[t * 3]], dist[T[t * 3 + 1]], dist[T[t * 3 + 2]])

// (θ, y) grid over the band and the skirt front, for the jacket's outside as a height field.
let regionLoY = Infinity
let regionHiY = -Infinity
for (let t = 0; t < triCount; t++)
  if (inBelt[t]) {
    regionLoY = Math.min(regionLoY, centroid(t, 1))
    regionHiY = Math.max(regionHiY, centroid(t, 1))
  }
const GY0 = Math.min(regionLoY, beltLo - BAND_MARGIN) - 0.012
const NY = Math.ceil((Math.max(regionHiY, beltHi + BAND_MARGIN) + 0.012 - GY0) / GRID_DY) + 1
const NT = GRID_THETA
const DTH = (2 * Math.PI) / NT
const cellOf = (theta, y) => {
  const i = ((Math.round((theta + Math.PI) / DTH) % NT) + NT) % NT
  const j = Math.round((y - GY0) / GRID_DY)
  return j < 0 || j >= NY ? -1 : j * NT + i
}
/** Visit sample points over triangle t (dense enough to touch every grid cell it covers) as (theta, y, r). */
function sampleTriangle(t, visit) {
  const a = T[t * 3]
  const b = T[t * 3 + 1]
  const c = T[t * 3 + 2]
  const th = [a, b, c].map((v) => thetaOf(WP[v * 3], WP[v * 3 + 2]))
  // Unwrap around the ±π seam at the back.
  for (let k = 1; k < 3; k++) {
    if (th[k] - th[0] > Math.PI) th[k] -= 2 * Math.PI
    if (th[k] - th[0] < -Math.PI) th[k] += 2 * Math.PI
  }
  const ys = [a, b, c].map((v) => WP[v * 3 + 1])
  const rs = [a, b, c].map(radiusOf)
  const span = Math.max((Math.max(...th) - Math.min(...th)) / DTH, (Math.max(...ys) - Math.min(...ys)) / GRID_DY)
  const n = Math.min(64, Math.max(1, Math.ceil(span * 2)))
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n - i; j++) {
      const u = i / n
      const w = j / n
      const s = 1 - u - w
      visit(s * th[0] + u * th[1] + w * th[2], s * ys[0] + u * ys[1] + w * ys[2], s * rs[0] + u * rs[1] + w * rs[2])
    }
}
const inGrid = (t) => {
  const y = centroid(t, 1)
  return y > GY0 - 0.005 && y < GY0 + NY * GRID_DY + 0.005 && triDist(t) <= NEAR
}
/** Outermost radius per cell over nearby triangles (optionally only those passing `keep`). */
function outerRadius(keep) {
  const g = new Float64Array(NT * NY).fill(-Infinity)
  for (let t = 0; t < triCount; t++) {
    if (!inGrid(t) || !keep(t)) continue
    sampleTriangle(t, (th, y, r) => {
      const c = cellOf(th, y)
      if (c >= 0 && r > g[c]) g[c] = r
    })
  }
  return g
}

// ── 1e. Grow the region over the belt's leftover relief ─────────────────────
// The belt's geometry reaches past its dark texture: a raised edge (a ~5 mm step) along
// the band's top and bottom, and the side walls of the tails on the skirt. Take in the
// jacket's outside (not the shell's inner surface) across the whole band plus a margin, and
// a margin all round the tails, so the rebuilt surface starts on undisturbed fabric.
{
  // "Outside" means within OUTER_TOL of the outermost surface at that (θ, y). Around the
  // band, measured against everything and facing outward: the belt stood off the jacket at
  // the sides, and the tunnel floor under it must stay out (it would make a handle). On the
  // skirt below, measured against clean fabric only: the tails stood ~2 cm proud, and the
  // fabric under their overhanging edges, and their light undersides, belong in.
  const outerAll = outerRadius(() => true)
  const outerClean = outerRadius((t) => !inBelt[t])
  const inBand = (y) => y >= beltLo - BAND_MARGIN && y <= beltHi + BAND_MARGIN
  const isOuter = (t) => {
    const y = centroid(t, 1)
    const c = cellOf(thetaOf(centroid(t, 0), centroid(t, 2)), y)
    if (c < 0) return false
    const r = Math.hypot(centroid(t, 0) - axX, centroid(t, 2) - axZ)
    if (!inBand(y)) return r >= outerClean[c] - OUTER_TOL
    if (r < outerAll[c] - OUTER_TOL) return false
    const n = faceNormal(t)
    return (n[0] * (centroid(t, 0) - axX) + n[2] * (centroid(t, 2) - axZ)) / (Math.hypot(...n) * r || 1) > FACING_MIN
  }
  const candidate = (t) => !inBelt[t] && inGrid(t) && (inBand(centroid(t, 1)) || triDist(t) <= EDGE_MARGIN) && isOuter(t)
  const stack = []
  for (let t = 0; t < triCount; t++) if (inBelt[t]) stack.push(t)
  let grown = 0
  while (stack.length) {
    const t = stack.pop()
    for (const n of edgeNeighbors(t))
      if (candidate(n)) {
        inBelt[n] = 1
        grown++
        stack.push(n)
      }
  }
  // Smooth the outline: take in any triangle with two or more edges on the region (notches).
  for (let pass = 0; pass < 3; pass++)
    for (let t = 0; t < triCount; t++) {
      if (inBelt[t] || !inGrid(t)) continue
      if (edgeNeighbors(t).filter((n) => inBelt[n]).length >= 2) inBelt[t] = 1
    }
  fillIslands()
  console.log(`region grown by ${grown} triangles over the belt's relief`)
}

// ── 1f. Close the scan's pinholes through the jacket wall ───────────────────
// The scan has a few small holes through the shell (outer surface → inner surface) along
// the old belt's edges. Each shows up as an extra small rim inside the region. Collapse
// each such rim to a single vertex, so the rebuilt surface passes over it unbroken (the
// hole's tube becomes a hidden cone inside the wall).
const apexes = []
{
  const loops = boundaryLoops().sort((a, b) => b.length - a.length)
  const remap = new Int32Array(W).map((_, i) => i)
  for (const loop of loops.slice(2)) {
    for (const v of loop) remap[v] = loop[0]
    apexes.push(loop[0])
  }
  if (apexes.length) {
    for (let v = 0; v < vertCount; v++) weldId[v] = remap[weldId[v]]
    for (let v = 0; v < vertCount; v++) for (let c = 0; c < 3; c++) P[v * 3 + c] = WP[weldId[v] * 3 + c]
    const keepI = []
    const keepBelt = []
    for (let t = 0; t < triCount; t++) {
      const [a, b, c] = [0, 1, 2].map((j) => weldId[I[t * 3 + j]])
      if (a === b || b === c || a === c) continue // collapsed onto the apex
      keepI.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2])
      keepBelt.push(inBelt[t])
    }
    I = Uint32Array.from(keepI)
    triCount = I.length / 3
    inBelt = Uint8Array.from(keepBelt)
    buildTopology()
  }
  console.log(`closed ${apexes.length} pinholes (${loops.slice(2).map((l) => l.length).join(', ') || 'none'} rim vertices)`)
}
/** Boundary loops of the region, as lists of welded vertex ids. */
function boundaryLoops() {
  const count = new Map()
  for (let t = 0; t < triCount; t++) {
    if (!inBelt[t]) continue
    for (let j = 0; j < 3; j++) {
      const a = T[t * 3 + j]
      const b = T[t * 3 + ((j + 1) % 3)]
      const k = a < b ? a * W + b : b * W + a
      count.set(k, (count.get(k) || 0) + 1)
    }
  }
  const adj = new Map()
  for (const [k, c] of count) {
    if (c !== 1) continue
    const a = Math.floor(k / W)
    const b = k % W
    for (const [p, q] of [[a, b], [b, a]]) {
      if (!adj.has(p)) adj.set(p, [])
      adj.get(p).push(q)
    }
  }
  const seen = new Set()
  const loops = []
  for (const v of adj.keys()) {
    if (seen.has(v)) continue
    const loop = []
    const st = [v]
    seen.add(v)
    while (st.length) {
      const u = st.pop()
      loop.push(u)
      for (const w of adj.get(u)) if (!seen.has(w)) (seen.add(w), st.push(w))
    }
    loops.push(loop)
  }
  return loops
}

// Region vertices: rim (shared with clean fabric; fixed) and interior (rebuilt).
const regionTris = []
for (let t = 0; t < triCount; t++) if (inBelt[t]) regionTris.push(t)
const VERT_NONE = 0
const VERT_RIM = 1
const VERT_FREE = 2
/** A hidden pinhole-cone vertex moved under the new surface. */
const VERT_TUCKED = 3
const vstate = new Uint8Array(W)
for (const t of regionTris) for (let j = 0; j < 3; j++) vstate[T[t * 3 + j]] = VERT_FREE
for (let t = 0; t < triCount; t++) if (!inBelt[t]) for (let j = 0; j < 3; j++) if (vstate[T[t * 3 + j]]) vstate[T[t * 3 + j]] = VERT_RIM
for (const v of apexes) vstate[v] = VERT_FREE
const freeVerts = []
const rimVerts = []
for (let v = 0; v < W; v++) {
  if (vstate[v] === VERT_FREE) freeVerts.push(v)
  else if (vstate[v] === VERT_RIM) rimVerts.push(v)
}
{
  // Sanity: the region should be an annulus (Euler characteristic 0, two rims).
  const edges = new Set()
  for (const t of regionTris)
    for (let j = 0; j < 3; j++) {
      const a = T[t * 3 + j]
      const b = T[t * 3 + ((j + 1) % 3)]
      edges.add(a < b ? a * W + b : b * W + a)
    }
  const chi = freeVerts.length + rimVerts.length - edges.size + regionTris.length
  if (chi !== 0) console.warn(`warning: belt region Euler characteristic ${chi} (expected 0, an annulus)`)
}

// ── 2a. The clean jacket around the region as a height field r(θ, y) ────────
const gridR = outerRadius((t) => !inBelt[t])
const holeMask = new Uint8Array(NT * NY)
for (const t of regionTris)
  sampleTriangle(t, (th, y) => {
    const c = cellOf(th, y)
    if (c >= 0) holeMask[c] = 1
  })
// ── 2b. Fill the hole with a smooth (biharmonic) surface ────────────────────
// Unknowns: cells the belt covered, or with no clean data. Minimise the squared discrete
// Laplacian over the grid, which blends smoothly (matching slope, not just height) into
// the clean fabric around it.
/** Fill the unknown cells of grid g (hole cells, or cells with no data) in place. */
function fillHole(gridR, holeMask, order = 2) {
  const unknown = new Uint8Array(NT * NY)
  for (let c = 0; c < NT * NY; c++) if (holeMask[c] || gridR[c] === -Infinity) unknown[c] = 1
  for (let i = 0; i < NT; i++) {
    // The outer rows must be known (they are clean jacket above/below the band); copy inward if not.
    for (const j of [0, 1, NY - 2, NY - 1]) {
      const c = j * NT + i
      if (!unknown[c]) continue
      let k = 1
      while (k < NT / 2 && unknown[j * NT + ((i + k) % NT)] && unknown[j * NT + ((i - k + NT) % NT)]) k++
      const src = !unknown[j * NT + ((i + k) % NT)] ? j * NT + ((i + k) % NT) : j * NT + ((i - k + NT) % NT)
      gridR[c] = gridR[src]
      unknown[c] = 0
    }
  }
  // Initial guess: linear in y between the nearest known cells above and below.
  for (let i = 0; i < NT; i++) {
    for (let j = 0; j < NY; j++) {
      const c = j * NT + i
      if (!unknown[c]) continue
      let jl = j
      while (jl > 0 && unknown[jl * NT + i]) jl--
      let jh = j
      while (jh < NY - 1 && unknown[jh * NT + i]) jh++
      const rl = gridR[jl * NT + i]
      const rh = gridR[jh * NT + i]
      gridR[c] = jh === jl ? rl : rl + ((rh - rl) * (j - jl)) / (jh - jl)
    }
  }
  {
    const r0 = pct(rimVerts.map((v) => Math.hypot(WP[v * 3] - axX, WP[v * 3 + 2] - axZ)), 0.5)
    const ax = 1 / (r0 * DTH) ** 2
    const ay = 1 / GRID_DY ** 2
    const lap = (f, out) => {
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NT; i++) {
          const c = j * NT + i
          if (j === 0 || j === NY - 1) {
            out[c] = 0
            continue
          }
          const e = j * NT + ((i + 1) % NT)
          const w = j * NT + ((i - 1 + NT) % NT)
          out[c] = ax * (f[e] + f[w] - 2 * f[c]) + ay * (f[c + NT] + f[c - NT] - 2 * f[c])
        }
    }
    const tmp = new Float64Array(NT * NY)
    const tmp2 = new Float64Array(NT * NY)
    // Solve only near the hole; empty cells farther out (no vertex lands there) keep their initial guess.
    const solve = new Uint8Array(NT * NY)
    for (let c = 0; c < NT * NY; c++) {
      if (!holeMask[c]) continue
      const i = c % NT
      const j = Math.floor(c / NT)
      for (let dj = -4; dj <= 4; dj++)
        for (let di = -4; di <= 4; di++) {
          const jj = j + dj
          if (jj < 1 || jj > NY - 2) continue
          const cc = jj * NT + ((i + di + NT) % NT)
          if (unknown[cc]) solve[cc] = 1
        }
    }
    const ids = []
    for (let c = 0; c < NT * NY; c++) if (solve[c]) ids.push(c)
    // A = Lᵀ L restricted to unknowns (L is symmetric here); b = −A·(known part).
    // order 2: tension spline, A = LᵀL − τ²L (slope-continuous at the rim, membrane-like
    // over distances beyond 1/τ, so no bulge over a big hole); order 1: harmonic, A = −L.
    const tau2 = 1 / TENSION_LENGTH ** 2
    const applyFull = (f, out) => {
      lap(f, tmp)
      if (order === 2) {
        lap(tmp, tmp2)
        for (let k = 0; k < ids.length; k++) out[k] = tmp2[ids[k]] - tau2 * tmp[ids[k]]
      } else for (let k = 0; k < ids.length; k++) out[k] = -tmp[ids[k]]
    }
    const field = new Float64Array(NT * NY)
    const x = Float64Array.from(ids, (c) => gridR[c])
    const b = new Float64Array(ids.length)
    for (let c = 0; c < NT * NY; c++) field[c] = solve[c] ? 0 : gridR[c]
    applyFull(field, b)
    for (let k = 0; k < b.length; k++) b[k] = -b[k]
    const op = (vec, out) => {
      field.fill(0)
      for (let k = 0; k < ids.length; k++) field[ids[k]] = vec[k]
      applyFull(field, out)
    }
    const iters = conjugateGradient(op, b, x, 20000, 1e-8)
    for (let k = 0; k < ids.length; k++) gridR[ids[k]] = x[k]
    return `${ids.length} grid cells, ${iters} CG iterations`
  }
}
const cleanR = gridR.slice()
const cleanHole = holeMask.slice()
let solveInput = cleanR
console.log(`hole surface: ${fillHole(gridR, holeMask)}`)
// The rim is fixed, so the new surface must not pass under it: where the jacket's front
// edge (a ~5 mm step) enters the region, the smooth fill would leave the rim standing
// proud, ending in a dark slot. Pin those rim points and solve again. (Rim points *below*
// the surface are lifted onto it by the blend further down instead.)
{
  const pinned = new Float64Array(NT * NY).fill(-Infinity)
  let count = 0
  for (const v of rimVerts) {
    const th = thetaOf(WP[v * 3], WP[v * 3 + 2])
    const y = WP[v * 3 + 1]
    const r = radiusOf(v)
    const c = cellOf(th, y)
    if (c < 0 || r <= sampleGrid(gridR, th, y) + 0.0005) continue
    pinned[c] = Math.max(pinned[c], r)
    count++
  }
  if (count) {
    gridR.set(cleanR)
    holeMask.set(cleanHole)
    for (let c = 0; c < NT * NY; c++)
      if (pinned[c] > -Infinity) {
        holeMask[c] = 0
        gridR[c] = pinned[c]
      }
    solveInput = gridR.slice()
    console.log(`hole surface, ${count} proud rim points pinned: ${fillHole(gridR, holeMask)}`)
  }
  // Safety net: keep the fill within OVERSHOOT of the harmonic fill, which never overshoots
  // its boundary (a bulge would show in profile).
  const harmonic = solveInput.slice()
  const hHole = holeMask.slice()
  console.log(`harmonic reference: ${fillHole(harmonic, hHole, 1)}`)
  let clamped = 0
  let worst = 0
  for (let c = 0; c < NT * NY; c++) {
    if (!holeMask[c]) continue
    const d = gridR[c] - harmonic[c]
    worst = Math.max(worst, Math.abs(d))
    if (Math.abs(d) > OVERSHOOT) {
      gridR[c] = harmonic[c] + Math.sign(d) * OVERSHOOT
      clamped++
    }
  }
  console.log(`overshoot clamp: ${clamped} cells (worst ${(worst * 1000).toFixed(1)} source mm)`)
}
function sampleGrid(gridR, theta, y) {
  const fi = (theta + Math.PI) / DTH
  const fj = Math.min(NY - 1.001, Math.max(0, (y - GY0) / GRID_DY))
  const i0 = Math.floor(fi)
  const j0 = Math.floor(fj)
  const di = fi - i0
  const dj = fj - j0
  const at = (i, j) => gridR[j * NT + (((i % NT) + NT) % NT)]
  return (1 - dj) * ((1 - di) * at(i0, j0) + di * at(i0 + 1, j0)) + dj * ((1 - di) * at(i0, j0 + 1) + di * at(i0 + 1, j0 + 1))
}
const surfaceR = (theta, y) => sampleGrid(gridR, theta, y)

/** Solve A x = b for symmetric positive (semi)definite A given as op(vec, out); x is the initial guess, updated in place. */
function conjugateGradient(op, b, x, maxIter, tol) {
  const n = b.length
  const r = new Float64Array(n)
  const p = new Float64Array(n)
  const Ap = new Float64Array(n)
  op(x, Ap)
  let rr = 0
  let bb = 0
  for (let i = 0; i < n; i++) {
    r[i] = b[i] - Ap[i]
    p[i] = r[i]
    rr += r[i] * r[i]
    bb += b[i] * b[i]
  }
  const stop = tol * tol * Math.max(bb, 1e-30)
  let k = 0
  for (; k < maxIter && rr > stop; k++) {
    op(p, Ap)
    let pAp = 0
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i]
    if (pAp <= 0) break
    const alpha = rr / pAp
    let rr2 = 0
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i]
      r[i] -= alpha * Ap[i]
      rr2 += r[i] * r[i]
    }
    const beta = rr2 / rr
    rr = rr2
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i]
  }
  return k
}

/** Harmonic (uniform-weight Laplace) solve over the free vertices, rims fixed: each column of `values` (welded-vertex × dims) is solved in place. */
function harmonicSolve(values, dims, maxIter = 3000) {
  const slot = new Int32Array(W).fill(-1)
  freeVerts.forEach((v, k) => (slot[v] = k))
  const n = freeVerts.length
  const op = (vec, out) => {
    for (let k = 0; k < n; k++) {
      const v = freeVerts[k]
      let acc = 0
      for (let q = vnbrs.start[v]; q < vnbrs.start[v + 1]; q++) {
        const u = vnbrs.items[q]
        if (vstate[u] === VERT_NONE || vstate[u] === VERT_TUCKED) continue // an apex's hidden cone
        acc += vec[k]
        const m = slot[u]
        if (m >= 0) acc -= vec[m]
      }
      out[k] = acc
    }
  }
  for (let d = 0; d < dims; d++) {
    const b = new Float64Array(n)
    const x = new Float64Array(n)
    for (let k = 0; k < n; k++) {
      const v = freeVerts[k]
      x[k] = values[v * dims + d]
      for (let q = vnbrs.start[v]; q < vnbrs.start[v + 1]; q++) {
        const u = vnbrs.items[q]
        if (slot[u] < 0 && vstate[u] !== VERT_NONE && vstate[u] !== VERT_TUCKED) b[k] += values[u * dims + d]
      }
    }
    conjugateGradient(op, b, x, maxIter, 1e-9)
    for (let k = 0; k < n; k++) values[freeVerts[k] * dims + d] = x[k]
  }
}

// ── 2c. Re-lay the region's vertices over the hole and place them on the surface ─
// Each vertex keeps its own (θ, y) seen from the body axis, except where that view folds
// over (the belt's overhanging edges, the knot's layers, the tails' side walls): there the
// layout is untangled by local smoothing, growing the smoothed patch until no triangle is
// flipped. Then every vertex goes onto the rebuilt surface at its (θ, y).
let unfolded = 0
let stillFlipped = 0
{
  const pth = new Float64Array(W)
  const py = new Float64Array(W)
  for (const v of [...freeVerts, ...rimVerts]) {
    pth[v] = thetaOf(WP[v * 3], WP[v * 3 + 2])
    py[v] = WP[v * 3 + 1]
  }
  const wrap = (d) => (d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d)
  const area2 = (t) => {
    const [a, b, c] = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]]
    return wrap(pth[b] - pth[a]) * (py[c] - py[a]) - wrap(pth[c] - pth[a]) * (py[b] - py[a])
  }
  let total = 0
  for (const t of regionTris) total += area2(t)
  const sign = Math.sign(total)
  const flipped = () => regionTris.filter((t) => area2(t) * sign < 0)
  const usable = (u) => vstate[u] === VERT_FREE || vstate[u] === VERT_RIM
  let rings = 1
  let bad = flipped()
  const initial = bad.length
  for (let round = 0; round < 24 && bad.length; round++) {
    const zone = new Set()
    for (const t of bad) for (let j = 0; j < 3; j++) if (vstate[T[t * 3 + j]] === VERT_FREE) zone.add(T[t * 3 + j])
    let ring = [...zone]
    for (let k = 0; k < rings; k++) {
      const next = []
      for (const v of ring)
        for (let q = vnbrs.start[v]; q < vnbrs.start[v + 1]; q++) {
          const u = vnbrs.items[q]
          if (vstate[u] === VERT_FREE && !zone.has(u)) (zone.add(u), next.push(u))
        }
      ring = next
    }
    const list = [...zone]
    const nth = new Float64Array(list.length)
    const ny = new Float64Array(list.length)
    for (let it = 0; it < 30; it++) {
      list.forEach((v, k) => {
        let cs = 0
        let sn = 0
        let yy = 0
        let n = 0
        for (let q = vnbrs.start[v]; q < vnbrs.start[v + 1]; q++) {
          const u = vnbrs.items[q]
          if (!usable(u)) continue
          cs += Math.cos(pth[u])
          sn += Math.sin(pth[u])
          yy += py[u]
          n++
        }
        nth[k] = n ? Math.atan2(sn, cs) : pth[v]
        ny[k] = n ? yy / n : py[v]
      })
      list.forEach((v, k) => {
        pth[v] = nth[k]
        py[v] = ny[k]
      })
    }
    unfolded = Math.max(unfolded, list.length)
    bad = flipped()
    if (round % 2 === 1) rings++
  }
  stillFlipped = bad.length
  console.log(`layout: ${initial} folded triangles untangled (largest smoothed patch ${unfolded} vertices), ${stillFlipped} left`)
  for (const v of freeVerts) {
    const r = surfaceR(pth[v], py[v])
    WP[v * 3] = axX + r * Math.cos(pth[v])
    WP[v * 3 + 1] = py[v]
    WP[v * 3 + 2] = axZ + r * Math.sin(pth[v])
  }
}
// The closed pinholes' hidden cones must stay under the new surface: push any of their
// vertices that poke out to just inside it.
let tucked = 0
{
  const seen = new Set(apexes)
  let ring = [...apexes]
  for (let k = 0; k < 8 && ring.length; k++) {
    const next = []
    for (const v of ring)
      for (let q = vnbrs.start[v]; q < vnbrs.start[v + 1]; q++) {
        const u = vnbrs.items[q]
        if (seen.has(u) || vstate[u] !== VERT_NONE) continue
        seen.add(u)
        next.push(u)
        const th = thetaOf(WP[u * 3], WP[u * 3 + 2])
        const limit = surfaceR(th, WP[u * 3 + 1]) - 0.0015
        const r = radiusOf(u)
        if (r > limit) {
          WP[u * 3] = axX + ((WP[u * 3] - axX) * limit) / r
          WP[u * 3 + 2] = axZ + ((WP[u * 3 + 2] - axZ) * limit) / r
          vstate[u] = VERT_TUCKED
          tucked++
        }
      }
    ring = next
  }
}
// Where the rim itself overlaps in that view, a few triangles stay folded. They lie on
// the same smooth surface as their neighbours, so all that shows is their reversed
// normal: turn any region triangle that faces into the body to face out.
let rewound = 0
for (const t of regionTris) {
  const n = faceNormal(t)
  if (n[0] * (centroid3(t, 0) - axX) + n[2] * (centroid3(t, 2) - axZ) >= 0) continue
  ;[I[t * 3 + 1], I[t * 3 + 2]] = [I[t * 3 + 2], I[t * 3 + 1]]
  ;[T[t * 3 + 1], T[t * 3 + 2]] = [T[t * 3 + 2], T[t * 3 + 1]]
  rewound++
}
function faceNormal(t) {
  const a = T[t * 3] * 3
  const b = T[t * 3 + 1] * 3
  const c = T[t * 3 + 2] * 3
  const ux = WP[b] - WP[a]
  const uy = WP[b + 1] - WP[a + 1]
  const uz = WP[b + 2] - WP[a + 2]
  const vx = WP[c] - WP[a]
  const vy = WP[c + 1] - WP[a + 1]
  const vz = WP[c + 2] - WP[a + 2]
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx] // area-weighted
}
function centroid3(t, axis) {
  return (WP[T[t * 3] * 3 + axis] + WP[T[t * 3 + 1] * 3 + axis] + WP[T[t * 3 + 2] * 3 + axis]) / 3
}

// ── 2d. Blend the fabric just outside the rim into the new surface ──────────
// Pleat valleys and other dips that reach the rim would end in a dark slot against the
// smooth band. Within BLEND of the rim, ease outward-facing fabric up toward the rebuilt
// surface, fading out with distance, so the folds taper into it.
const blended = []
{
  const rimMask = new Uint8Array(W)
  for (const v of rimVerts) rimMask[v] = 1
  const d = geodesicFrom(rimMask, BLEND)
  for (let v = 0; v < W; v++) {
    if (d[v] >= BLEND || (vstate[v] !== VERT_NONE && vstate[v] !== VERT_RIM)) continue
    const y = WP[v * 3 + 1]
    if (y < GY0 || y > GY0 + (NY - 1) * GRID_DY) continue
    const r = radiusOf(v)
    const th = thetaOf(WP[v * 3], WP[v * 3 + 2])
    const lift = surfaceR(th, y) - r
    if (lift <= 0 || lift > BLEND) continue
    // Only the outside of the jacket: the source normal faces away from the body. (Rim
    // vertices always: they are shared with the rebuilt surface.)
    let nx = 0
    let nz = 0
    for (let q = vtris.start[v]; q < vtris.start[v + 1]; q++) {
      const n = faceNormal(vtris.items[q])
      nx += n[0]
      nz += n[2]
    }
    if (vstate[v] !== VERT_RIM && nx * (WP[v * 3] - axX) + nz * (WP[v * 3 + 2] - axZ) <= 0) continue
    const w = (1 - d[v] / BLEND) ** 2
    const nr = r + w * lift
    WP[v * 3] = axX + ((WP[v * 3] - axX) * nr) / r
    WP[v * 3 + 2] = axZ + ((WP[v * 3 + 2] - axZ) * nr) / r
    blended.push(v)
  }
}

// ── 2e. Write positions back; recompute normals over the rebuilt area ───────
// Normals are recomputed (area-weighted, across UV seams) for the region and one ring of
// clean fabric around it, whose faces share the moved vertices.
const renormal = new Uint8Array(W)
for (const v of freeVerts) renormal[v] = 1
for (const v of blended) {
  renormal[v] = 1
  for (let q = vnbrs.start[v]; q < vnbrs.start[v + 1]; q++) renormal[vnbrs.items[q]] = 1
}
const moved = new Uint8Array(W)
for (const v of blended) moved[v] = 1
for (const v of rimVerts) {
  renormal[v] = 1
  for (let q = vnbrs.start[v]; q < vnbrs.start[v + 1]; q++) renormal[vnbrs.items[q]] = 1
}
const WN = new Float64Array(W * 3)
for (let v = 0; v < W; v++) {
  if (!renormal[v]) continue
  for (let k = vtris.start[v]; k < vtris.start[v + 1]; k++) {
    if (vstate[v] === VERT_FREE && !inBelt[vtris.items[k]]) continue // apex: only the visible surface
    const n = faceNormal(vtris.items[k])
    WN[v * 3] += n[0]
    WN[v * 3 + 1] += n[1]
    WN[v * 3 + 2] += n[2]
  }
}
for (let v = 0; v < vertCount; v++) {
  const w = weldId[v]
  if (vstate[w] === VERT_FREE || vstate[w] === VERT_TUCKED || moved[w]) for (let c = 0; c < 3; c++) P[v * 3 + c] = WP[w * 3 + c]
  if (renormal[w]) {
    const l = Math.hypot(WN[w * 3], WN[w * 3 + 1], WN[w * 3 + 2]) || 1
    for (let c = 0; c < 3; c++) N[v * 3 + c] = WN[w * 3 + c] / l
  }
}

// ── 3. Repaint the region as jacket fabric ──────────────────────────────────
// Each rim vertex takes the color of the clean fabric next to it (median over its clean
// neighbouring triangles, skipping dark belt-edge texels); a harmonic solve carries those
// colors smoothly across the region. Texels are painted by interpolating vertex colors, so
// the patch blends into the fabric around it with no flat-color block or seam.
const CH = images.length * 3
const vcolor = new Float64Array(W * CH)
{
  const fixedColor = new Uint8Array(W)
  for (const v of rimVerts) {
    const samples = Array.from({ length: CH }, () => [])
    for (let k = vtris.start[v]; k < vtris.start[v + 1]; k++) {
      const t = vtris.items[k]
      if (inBelt[t]) continue
      // Sample a little inside the clean triangle, toward its far side (away from the belt edge).
      let u = 0
      let w = 0
      for (let j = 0; j < 3; j++) {
        const ov = I[t * 3 + j]
        const wgt = weldId[ov] === v ? 0.2 : 0.4
        u += wgt * UV[ov * 2]
        w += wgt * UV[ov * 2 + 1]
      }
      if (lum(u, w) < 120) continue
      images.forEach((img, m) => {
        const q = texel(img, u, w)
        for (let c = 0; c < 3; c++) samples[m * 3 + c].push(img.data[q + c])
      })
    }
    if (!samples[0].length) continue
    fixedColor[v] = 1
    for (let c = 0; c < CH; c++) vcolor[v * CH + c] = pct(samples[c], 0.5)
  }
  // Rims with no usable sample: borrow from the nearest sampled rim vertex along the rim.
  const fallback = Array.from({ length: CH }, (_, c) => pct(rimVerts.filter((v) => fixedColor[v]).map((v) => vcolor[v * CH + c]), 0.5))
  for (const v of rimVerts) if (!fixedColor[v]) for (let c = 0; c < CH; c++) vcolor[v * CH + c] = fallback[c]
  for (const v of freeVerts) for (let c = 0; c < CH; c++) vcolor[v * CH + c] = fallback[c]
  harmonicSolve(vcolor, CH)
}
function paintRegion(img, m) {
  const { data, w, h } = img
  const uvPx = (v) => [(UV[v * 2] - Math.floor(UV[v * 2])) * w, (UV[v * 2 + 1] - Math.floor(UV[v * 2 + 1])) * h]
  /** Rasterize triangle t: calls visit(pixelIndex, barycentrics, distanceOutside) within `dilate` px. */
  const raster = (t, dilate, visit) => {
    const pts = [0, 1, 2].map((j) => uvPx(I[t * 3 + j]))
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - dilate))
    const x1 = Math.min(w - 1, Math.ceil(Math.max(...xs) + dilate))
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - dilate))
    const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys) + dilate))
    if (x1 - x0 > w / 2 || y1 - y0 > h / 2) return // UV seam wrap-around; skip
    const [[ax, ay], [bx, by], [cx, cy]] = pts
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (Math.abs(area) < 1e-12) return
    const lens = [Math.hypot(cx - bx, cy - by), Math.hypot(ax - cx, ay - cy), Math.hypot(bx - ax, by - ay)]
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const l0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area
        const l1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area
        const l2 = 1 - l0 - l1
        // Distance outside the triangle in px: barycentric × the height over the opposite edge.
        const out = Math.max(0, (-l0 * Math.abs(area)) / lens[0], (-l1 * Math.abs(area)) / lens[1], (-l2 * Math.abs(area)) / lens[2])
        if (out > dilate) continue
        visit(y * w + x, [l0, l1, l2], out)
      }
  }
  // Texels the clean fabric uses: never painted over.
  const clean = new Uint8Array(w * h)
  for (let t = 0; t < triCount; t++) if (!inBelt[t]) raster(t, 0.5, (p) => (clean[p] = 1))
  const best = new Float32Array(w * h).fill(Infinity)
  for (const t of regionTris) {
    const vs = [0, 1, 2].map((j) => weldId[I[t * 3 + j]])
    raster(t, GUTTER_PX, (p, bary, out) => {
      if (out > PAINT_DILATE_PX && clean[p]) return // beyond the triangle: only fill unused gutter texels
      if (out >= best[p]) return
      best[p] = out
      // Clamp to the triangle for texels outside it.
      let [l0, l1, l2] = bary.map((l) => Math.max(0, l))
      const s = l0 + l1 + l2 || 1
      l0 /= s
      l1 /= s
      l2 /= s
      for (let c = 0; c < 3; c++) {
        const val = l0 * vcolor[vs[0] * CH + m * 3 + c] + l1 * vcolor[vs[1] * CH + m * 3 + c] + l2 * vcolor[vs[2] * CH + m * 3 + c]
        data[p * 3 + c] = Math.max(0, Math.min(255, Math.round(val)))
      }
    })
  }
}
async function encodeInto(img) {
  const mime = img.texture.getMimeType()
  const s = sharp(img.data, { raw: { width: img.w, height: img.h, channels: 3 } })
  const buf = mime === 'image/png' ? await s.png().toBuffer() : await s.jpeg({ quality: 92 }).toBuffer()
  img.texture.setImage(new Uint8Array(buf))
}
for (const [m, img] of images.entries()) {
  paintRegion(img, m)
  await encodeInto(img)
}

// ── 4. Measure the waist cross-section (source units) ───────────────────────
// The rebuilt surface across the app belt's width (4 cm), all the way round: its extremes
// front/back and left/right give the ellipse the generated belt wraps (with its own
// clearance for folds). The band is smooth fabric now, so no knot or relief to skip.
const BELT_HALF_WIDTH_M = 0.02
const xs = []
const zs = []
{
  const halfW = BELT_HALF_WIDTH_M / (HEM_TO_WAIST / (beltY - minY))
  for (let j = 0; j < NY; j++) {
    const y = GY0 + j * GRID_DY
    if (Math.abs(y - beltY) > halfW) continue
    for (let i = 0; i < NT; i++) {
      const th = -Math.PI + i * DTH
      const r = gridR[j * NT + i]
      xs.push(axX + r * Math.cos(th))
      zs.push(axZ + r * Math.sin(th))
    }
  }
}
const front = Math.max(...xs)
const back = Math.min(...xs)
const right = Math.max(...zs)
const left = Math.min(...zs)

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
idx.setArray(I)
await doc.transform(prune())
await io.write(output, doc)

const meta = {
  note: 'Generated by scripts/prepare-model.mjs — do not edit by hand.',
  waistY: WAIST_Y,
  /** Waist cross-section half-axes where the baked belt sat (m, app space). */
  waist: { a: ((right - left) / 2) * scale, b: ((front - back) / 2) * scale },
  /** Width of the baked belt band, now rebuilt as jacket (m). The app's belt should cover most of it. */
  bakedBeltWidth: (beltHi - beltLo) * scale,
  minY: (minY - beltY) * scale + WAIST_Y,
  maxY: (maxY - beltY) * scale + WAIST_Y,
}
writeFileSync('src/scene/dogiModel.json', JSON.stringify(meta, null, 2) + '\n')
console.log(`belt band y ∈ [${beltLo.toFixed(3)}, ${beltHi.toFixed(3)}] (source units)`)
console.log(
  `rebuilt region: ${regionTris.length} triangles, ${freeVerts.length} vertices moved, ${rimVerts.length} rim vertices; ${rewound} folded faces turned outward; ${tucked} pinhole vertices tucked under; ${blended.length} rim-side vertices blended`,
)
console.log(JSON.stringify(meta, null, 2))
