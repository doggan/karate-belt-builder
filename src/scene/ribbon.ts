import * as THREE from 'three'
import { beltDropAt } from './beltLayout'

/**
 * One cross-section sample along a belt strip.
 *  - p:      center of the strip
 *  - across: unit vector along the belt's width
 *  - out:    unit vector along the belt's thickness, pointing out of the front face
 *
 * The strip runs along `across × out`. Optional extras shape the cross-section:
 *  - shear:  slant of the cross-row along the strip, as a tangent (0 = straight across).
 *            Used where the strap is folded about a slanted line (see `StrandPath`).
 *  - width:  fraction of the full belt width (cloth bunched inside the knot).
 *  - cup:    curvature across the width (1/m); positive curls the edges toward `out`.
 */
export interface Frame {
  p: THREE.Vector3
  across: THREE.Vector3
  out: THREE.Vector3
  shear?: number
  width?: number
  cup?: number
}

/** Material group indices on ribbon geometry. */
export const RIBBON_GROUP = { faces: 0, edges: 1 } as const

export interface RibbonOptions {
  width: number
  thickness: number
  /** Length of one texture tile along the strip (m). */
  uLength: number
  /** Joins the last frame back to the first (the wraps around the waist). */
  closed?: boolean
  /** Distance along the strip at the first frame (m), so u can line up with another strip. */
  uStart?: number
  /** Quads across each face. More lets the faces follow `cup` and `warp`. */
  across?: number
  /** Adjusts every vertex (position and normal) in place, e.g. to bend the strip around the waist. */
  warp?: (position: THREE.Vector3, normal: THREE.Vector3, frameIndex: number) => void
}

/** Segments around each rounded edge. */
const EDGE_SEGMENTS = 3
/** How far each edge bulges sideways, as a fraction of half the thickness. */
const EDGE_BULGE = 0.9

interface Layout {
  rings: number
  across: number
  ringSize: number
  closed: boolean
}

function layoutFor(frames: Frame[], opts: RibbonOptions): Layout {
  const across = opts.across ?? 1
  return {
    rings: frames.length + (opts.closed ? 1 : 0), // closed strips repeat the first frame for a clean UV seam
    across,
    ringSize: 2 * (across + 1) + 2 * (EDGE_SEGMENTS + 1),
    closed: !!opts.closed,
  }
}

/** Distinct points on a cross-section outline (each face shares its end points with the edges). */
const outlineSize = (l: Layout) => l.ringSize - 4
const vertexCount = (l: Layout) => l.rings * l.ringSize + (l.closed ? 0 : 2 * outlineSize(l))

/**
 * Builds a belt strip swept along `frames`: two stitched faces joined by rounded edges.
 *
 * UVs are physical: u = distance along the strip / `uLength`, v ∈ [0,1] across the
 * width (v = 1 on the `across` side) — so a tiling texture whose tile is `uLength` long
 * (the stitch pattern) looks identical on every piece of the belt. For closed strips
 * `uLength` is nudged so a whole number of tiles fits and the seam is invisible.
 *
 * Front and back faces are material group 0 (stitched); edges and end caps are group 1.
 */
export function buildRibbon(frames: Frame[], opts: RibbonOptions): THREE.BufferGeometry {
  const l = layoutFor(frames, opts)
  const count = vertexCount(l)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))

  const { across: K, ringSize: V, rings } = l
  const E = EDGE_SEGMENTS
  const front = 0
  const back = K + 1
  const right = 2 * (K + 1) // the `across` side
  const left = right + E + 1
  const faces: number[] = []
  const edges: number[] = []
  for (let r = 0; r < rings - 1; r++) {
    const a = r * V
    const b = a + V
    for (let j = 0; j < K; j++) {
      faces.push(a + front + j, b + front + j, a + front + j + 1, a + front + j + 1, b + front + j, b + front + j + 1)
      faces.push(a + back + j, a + back + j + 1, b + back + j, a + back + j + 1, b + back + j + 1, b + back + j)
    }
    for (let k = 0; k < E; k++) {
      edges.push(a + right + k, b + right + k, a + right + k + 1, a + right + k + 1, b + right + k, b + right + k + 1)
      edges.push(a + left + k, a + left + k + 1, b + left + k, a + left + k + 1, b + left + k + 1, b + left + k)
    }
  }
  if (!l.closed) {
    // End caps: a fan around the cross-section outline.
    const loop = outlineSize(l)
    const startCap = rings * V
    const endCap = startCap + loop
    for (let i = 1; i < loop - 1; i++) {
      edges.push(startCap, startCap + i, startCap + i + 1)
      edges.push(endCap, endCap + i + 1, endCap + i)
    }
  }
  geometry.setIndex([...faces, ...edges])
  geometry.addGroup(0, faces.length, RIBBON_GROUP.faces)
  geometry.addGroup(faces.length, edges.length, RIBBON_GROUP.edges)

  updateRibbon(geometry, frames, opts)
  return geometry
}

const _dir = new THREE.Vector3()
const _row = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _nrm = new THREE.Vector3()

/** Re-pose a strip built by `buildRibbon` with the same number of frames and the same options. */
export function updateRibbon(geometry: THREE.BufferGeometry, frames: Frame[], opts: RibbonOptions) {
  const l = layoutFor(frames, opts)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  const n = frames.length
  const { across: K, ringSize: V, rings } = l
  const E = EDGE_SEGMENTS
  const ht = opts.thickness / 2

  let total = 0
  for (let i = 1; i < n; i++) total += frames[i].p.distanceTo(frames[i - 1].p)
  if (l.closed) total += frames[0].p.distanceTo(frames[n - 1].p)
  const tile = l.closed ? total / Math.max(1, Math.round(total / opts.uLength)) : opts.uLength

  let index = 0
  let frameIndex = 0
  const put = (f: Frame, a: number, o: number, na: number, no: number, u: number, v: number) => {
    // a: offset along the cross-row, o: along `out`; (na, no): the normal in those terms.
    _pos.copy(f.p).addScaledVector(_row, a).addScaledVector(f.out, o)
    _nrm.copy(f.across).multiplyScalar(na).addScaledVector(f.out, no).normalize()
    opts.warp?.(_pos, _nrm, frameIndex)
    position.setXYZ(index, _pos.x, _pos.y, _pos.z)
    normal.setXYZ(index, _nrm.x, _nrm.y, _nrm.z)
    uv.setXY(index, u, v)
    index++
  }

  let dist = opts.uStart ?? 0
  for (let r = 0; r < rings; r++) {
    frameIndex = r % n
    const f = frames[frameIndex]
    if (r > 0) dist += r < n ? f.p.distanceTo(frames[r - 1].p) : frames[0].p.distanceTo(frames[n - 1].p)
    const shear = f.shear ?? 0
    const cup = f.cup ?? 0
    const hw = (opts.width / 2) * (f.width ?? 1)
    const bulge = Math.min(EDGE_BULGE * ht, hw / 2)
    const hf = hw - bulge // half-width of the flat faces; the rounded edges take the rest
    _dir.crossVectors(f.across, f.out)
    _row.copy(f.across).addScaledVector(_dir, shear)

    for (const side of [1, -1]) {
      for (let j = 0; j <= K; j++) {
        const a = -hf + (2 * hf * j) / K
        put(f, a, (cup * a * a) / 2 + side * ht, -side * cup * a, side, (dist + a * shear) / tile, j / K)
      }
    }
    for (const side of [1, -1]) {
      for (let k = 0; k <= E; k++) {
        const psi = (Math.PI * k) / E
        const a = side * (hf + bulge * Math.sin(psi))
        const lift = cup * hf * (Math.abs(a) - hf / 2) // carry the cup's slope on past the face
        put(f, a, lift + ht * Math.cos(psi), (side * Math.sin(psi)) / bulge, Math.cos(psi) / ht, (dist + a * shear) / tile, side > 0 ? 1 : 0)
      }
    }
  }

  if (!l.closed) {
    // Caps reuse the outline of the first and last rings, with a flat normal.
    const outline: number[] = []
    for (let j = 0; j <= K; j++) outline.push(j)
    for (let k = 1; k < E; k++) outline.push(2 * (K + 1) + k)
    for (let j = K; j >= 0; j--) outline.push(K + 1 + j)
    for (let k = E - 1; k >= 1; k--) outline.push(2 * (K + 1) + E + 1 + k)
    for (const [ring, sign] of [[0, -1], [rings - 1, 1]] as const) {
      const f = frames[ring]
      _dir.crossVectors(f.across, f.out).multiplyScalar(sign)
      _nrm.copy(_dir)
      opts.warp?.(_pos.copy(f.p), _nrm, ring)
      for (const o of outline) {
        const from = ring * V + o
        position.setXYZ(index, position.getX(from), position.getY(from), position.getZ(from))
        normal.setXYZ(index, _nrm.x, _nrm.y, _nrm.z)
        uv.setXY(index, uv.getX(from), uv.getY(from))
        index++
      }
    }
  }

  position.needsUpdate = true
  normal.needsUpdate = true
  uv.needsUpdate = true
  geometry.computeBoundingSphere()
}

export interface FaceStripOptions {
  width: number
  /** Height above the strip's centerline, along `out` (m). */
  offset: number
  /** Quads across the width. */
  across?: number
}

/**
 * A single face that floats `offset` in front of a strip's centerline — the surface
 * embroidery (text, labels) is drawn on. It follows the strip's width and cup.
 *
 * UVs map the whole strip onto one image: u = 0 → 1 from the viewer's left edge to
 * the right edge, v = 1 at the first frame (the knot) → 0 at the last (the tail end).
 * With a CanvasTexture (flipY), canvas x runs across the belt and canvas y runs down
 * the tail, so characters drawn upright on the canvas read upright on a hanging tail.
 */
export function buildFaceStrip(frames: Frame[], opts: FaceStripOptions): THREE.BufferGeometry {
  const K = opts.across ?? 1
  const n = frames.length
  const count = n * (K + 1)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
  const indices: number[] = []
  for (let r = 0; r < n - 1; r++) {
    for (let j = 0; j < K; j++) {
      const a = r * (K + 1) + j
      const b = a + K + 1
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  geometry.setIndex(indices)
  updateFaceStrip(geometry, frames, opts)
  return geometry
}

/** Re-pose a face strip built by `buildFaceStrip` with the same number of frames and the same options. */
export function updateFaceStrip(geometry: THREE.BufferGeometry, frames: Frame[], opts: FaceStripOptions) {
  const K = opts.across ?? 1
  const n = frames.length
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  let total = 0
  for (let i = 1; i < n; i++) total += frames[i].p.distanceTo(frames[i - 1].p)
  let dist = 0
  let index = 0
  for (let r = 0; r < n; r++) {
    const f = frames[r]
    if (r > 0) dist += f.p.distanceTo(frames[r - 1].p)
    const cup = f.cup ?? 0
    const hw = (opts.width / 2) * (f.width ?? 1)
    for (let j = 0; j <= K; j++) {
      const a = -hw + (2 * hw * j) / K
      _pos.copy(f.p).addScaledVector(f.across, a).addScaledVector(f.out, (cup * a * a) / 2 + opts.offset)
      _nrm.copy(f.out).addScaledVector(f.across, -cup * a).normalize()
      position.setXYZ(index, _pos.x, _pos.y, _pos.z)
      normal.setXYZ(index, _nrm.x, _nrm.y, _nrm.z)
      uv.setXY(index, j / K, 1 - dist / total)
      index++
    }
  }
  position.needsUpdate = true
  normal.needsUpdate = true
  uv.needsUpdate = true
  geometry.computeBoundingSphere()
}

/**
 * Frames around a wrap of the belt: an ellipse seen from above (θ = 0 is the front, +Z),
 * at height y at the back and sides and dipping toward the front (`beltDropAt`). The
 * belt's width stays square to its run, so where it slopes it leans with it.
 */
export function wrapFrames(a: number, b: number, y: number, segments: number): Frame[] {
  const frames: Frame[] = []
  const heading = new THREE.Vector3()
  const dt = 1e-4
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    const slope = (beltDropAt(t + dt, a) - beltDropAt(t - dt, a)) / (2 * dt)
    const out = new THREE.Vector3(b * Math.sin(t), 0, a * Math.cos(t)).normalize()
    heading.set(a * Math.cos(t), -slope, -b * Math.sin(t)).normalize()
    frames.push({
      p: new THREE.Vector3(a * Math.sin(t), y - beltDropAt(t, a), b * Math.cos(t)),
      across: new THREE.Vector3().crossVectors(out, heading).normalize(),
      out,
    })
  }
  return frames
}
