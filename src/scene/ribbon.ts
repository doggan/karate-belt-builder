import * as THREE from 'three'

/**
 * One cross-section sample along a belt strip.
 *  - p:      center of the strip
 *  - across: unit vector along the belt's width
 *  - out:    unit vector along the belt's thickness, pointing out of the front face
 */
export interface Frame {
  p: THREE.Vector3
  across: THREE.Vector3
  out: THREE.Vector3
}

/** Material group indices on ribbon geometry. */
export const RIBBON_GROUP = { faces: 0, edges: 1 } as const

function cumulativeLengths(frames: Frame[]): number[] {
  const dist = [0]
  for (let i = 1; i < frames.length; i++) dist[i] = dist[i - 1] + frames[i].p.distanceTo(frames[i - 1].p)
  return dist
}

class MeshBuilder {
  positions: number[] = []
  normals: number[] = []
  uvs: number[] = []
  indices: number[] = []

  vertex(pos: THREE.Vector3, normal: THREE.Vector3, u: number, v: number): number {
    this.positions.push(pos.x, pos.y, pos.z)
    this.normals.push(normal.x, normal.y, normal.z)
    this.uvs.push(u, v)
    return this.positions.length / 3 - 1
  }

  /** Push a triangle, flipping it if its winding disagrees with the intended normal. */
  tri(i0: number, i1: number, i2: number, expected: THREE.Vector3) {
    const v = (i: number) => new THREE.Vector3(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2])
    const a = v(i0)
    const faceNormal = v(i1).sub(a).cross(v(i2).sub(a))
    if (faceNormal.dot(expected) < 0) this.indices.push(i0, i2, i1)
    else this.indices.push(i0, i1, i2)
  }

  build(geometry = new THREE.BufferGeometry()): THREE.BufferGeometry {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    geometry.setIndex(this.indices)
    geometry.computeBoundingSphere()
    return geometry
  }
}

/**
 * Builds a rectangular-section strip swept along `frames`.
 *
 * UVs are physical: u = distance along the strip / `uLength`, v ∈ [0,1] across the
 * width — so a tiling texture whose tile is `uLength` long (the stitch pattern)
 * looks identical on every piece of the belt. For closed strips `uLength` is nudged
 * so a whole number of tiles fits and the seam is invisible.
 *
 * Front and back faces are material group 0 (stitched); edges and caps are group 1.
 */
export function buildRibbon(
  frames: Frame[],
  width: number,
  thickness: number,
  closed: boolean,
  uLength: number,
): THREE.BufferGeometry {
  const n = frames.length
  const hw = width / 2
  const ht = thickness / 2
  const dist = cumulativeLengths(frames)
  const total = dist[n - 1] + (closed ? frames[0].p.distanceTo(frames[n - 1].p) : 0)
  const tile = closed ? total / Math.max(1, Math.round(total / uLength)) : uLength

  const mb = new MeshBuilder()
  const geometry = new THREE.BufferGeometry()
  const corner = (f: Frame, sa: number, so: number) =>
    f.p.clone().addScaledVector(f.across, sa * hw).addScaledVector(f.out, so * ht)

  // Each long face: corner A and corner B as (across, out) signs, plus its normal.
  const faces: Array<{ a: [number, number]; b: [number, number]; normal: (f: Frame) => THREE.Vector3; group: number }> = [
    { a: [1, 1], b: [-1, 1], normal: (f) => f.out.clone(), group: RIBBON_GROUP.faces },
    { a: [-1, 1], b: [-1, -1], normal: (f) => f.across.clone().negate(), group: RIBBON_GROUP.edges },
    { a: [-1, -1], b: [1, -1], normal: (f) => f.out.clone().negate(), group: RIBBON_GROUP.faces },
    { a: [1, -1], b: [1, 1], normal: (f) => f.across.clone(), group: RIBBON_GROUP.edges },
  ]

  const rings = closed ? n + 1 : n // closed strips repeat the first frame for a clean UV seam
  for (const face of faces) {
    const start = mb.indices.length
    const base = mb.positions.length / 3
    for (let r = 0; r < rings; r++) {
      const f = frames[r % n]
      const u = (r < n ? dist[r] : total) / tile
      const normal = face.normal(f)
      mb.vertex(corner(f, ...face.a), normal, u, 1)
      mb.vertex(corner(f, ...face.b), normal, u, 0)
    }
    for (let r = 0; r < rings - 1; r++) {
      const i0 = base + r * 2
      const expected = face.normal(frames[r % n])
      mb.tri(i0, i0 + 1, i0 + 2, expected)
      mb.tri(i0 + 1, i0 + 3, i0 + 2, expected)
    }
    geometry.addGroup(start, mb.indices.length - start, face.group)
  }

  if (!closed) {
    const start = mb.indices.length
    const cap = (f: Frame, normal: THREE.Vector3) => {
      const ids = ([[1, 1], [-1, 1], [-1, -1], [1, -1]] as const).map(([sa, so]) => mb.vertex(corner(f, sa, so), normal, 0, 0))
      mb.tri(ids[0], ids[1], ids[2], normal)
      mb.tri(ids[0], ids[2], ids[3], normal)
    }
    cap(frames[0], frames[0].p.clone().sub(frames[1].p).normalize())
    cap(frames[n - 1], frames[n - 1].p.clone().sub(frames[n - 2].p).normalize())
    geometry.addGroup(start, mb.indices.length - start, RIBBON_GROUP.edges)
  }

  return mb.build(geometry)
}

/**
 * A single flat face that floats `offset` in front of a strip's front face — the
 * surface embroidery (text, labels) is drawn on.
 *
 * UVs map the whole strip onto one image: u = 0 → 1 from the viewer's left edge to
 * the right edge, v = 1 at the first frame (the knot) → 0 at the last (the tail end).
 * With a CanvasTexture (flipY), canvas x runs across the belt and canvas y runs down
 * the tail, so characters drawn upright on the canvas read upright on a hanging tail.
 */
export function buildFaceStrip(frames: Frame[], width: number, offset: number): THREE.BufferGeometry {
  const n = frames.length
  const hw = width / 2
  const dist = cumulativeLengths(frames)
  const total = dist[n - 1]
  const mb = new MeshBuilder()
  for (let r = 0; r < n; r++) {
    const f = frames[r]
    const center = f.p.clone().addScaledVector(f.out, offset)
    const v = 1 - dist[r] / total
    mb.vertex(center.clone().addScaledVector(f.across, hw), f.out, 1, v)
    mb.vertex(center.clone().addScaledVector(f.across, -hw), f.out, 0, v)
  }
  for (let r = 0; r < n - 1; r++) {
    const i0 = r * 2
    mb.tri(i0, i0 + 1, i0 + 2, frames[r].out)
    mb.tri(i0 + 1, i0 + 3, i0 + 2, frames[r].out)
  }
  return mb.build()
}

/** Frames around a horizontal ellipse at height y; θ = 0 is the front (+Z). */
export function ellipseFrames(a: number, b: number, y: number, segments: number): Frame[] {
  const frames: Frame[] = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    frames.push({
      p: new THREE.Vector3(a * Math.sin(t), y, b * Math.cos(t)),
      across: new THREE.Vector3(0, 1, 0),
      out: new THREE.Vector3(b * Math.sin(t), 0, a * Math.cos(t)).normalize(),
    })
  }
  return frames
}

/**
 * Frames for a hanging tail: starts at `start`, splays sideways by `angle`
 * (radians from vertical, `side` = ±1) and relaxes toward vertical as it hangs.
 * `across` points to the viewer's right, so the front face reads left-to-right.
 */
export function tailFrames(start: THREE.Vector3, side: 1 | -1, length: number, angle: number, segments: number): Frame[] {
  const frames: Frame[] = []
  const forward = new THREE.Vector3(0, 0, 1)
  const p = start.clone()
  const ds = length / segments
  for (let i = 0; i <= segments; i++) {
    const s = i / segments
    const a = angle * (1 - 0.35 * s)
    const dir = new THREE.Vector3(side * Math.sin(a), -Math.cos(a), 0.06).normalize()
    if (i > 0) p.addScaledVector(dir, ds)
    const out = forward.clone().addScaledVector(dir, -forward.dot(dir)).normalize()
    const across = new THREE.Vector3().crossVectors(out, dir).normalize()
    frames.push({ p: p.clone(), across, out })
  }
  return frames
}
