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
export const RIBBON_GROUP = { front: 0, rest: 1 } as const

/**
 * Builds a rectangular-section strip swept along `frames`.
 *
 * The front face (the side facing `out`) is material group 0 with UVs
 * u ∈ [0,1] along the length and v ∈ [0,1] across the width — that is where
 * text/logo textures go later. Back, edges and end caps are group 1.
 */
export function buildRibbon(frames: Frame[], width: number, thickness: number, closed: boolean): THREE.BufferGeometry {
  const n = frames.length
  const hw = width / 2
  const ht = thickness / 2

  const dist = [0]
  for (let i = 1; i < n; i++) dist[i] = dist[i - 1] + frames[i].p.distanceTo(frames[i - 1].p)
  const total = dist[n - 1] + (closed ? frames[0].p.distanceTo(frames[n - 1].p) : 0)

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const geometry = new THREE.BufferGeometry()

  const tmp = new THREE.Vector3()
  const corner = (f: Frame, sa: number, so: number) =>
    tmp.copy(f.p).addScaledVector(f.across, sa * hw).addScaledVector(f.out, so * ht).clone()

  const pushVertex = (pos: THREE.Vector3, normal: THREE.Vector3, u: number, v: number) => {
    positions.push(pos.x, pos.y, pos.z)
    normals.push(normal.x, normal.y, normal.z)
    uvs.push(u, v)
    return positions.length / 3 - 1
  }

  /** Push a triangle, flipping it if its winding disagrees with the intended normal. */
  const pushTri = (i0: number, i1: number, i2: number, expected: THREE.Vector3) => {
    const v = (i: number) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    const a = v(i0)
    const faceNormal = v(i1).sub(a).cross(v(i2).sub(a))
    if (faceNormal.dot(expected) < 0) indices.push(i0, i2, i1)
    else indices.push(i0, i1, i2)
  }

  // Each long face: [corner A (across, out signs), corner B, normal(frame)]
  const faces: Array<{ a: [number, number]; b: [number, number]; normal: (f: Frame) => THREE.Vector3 }> = [
    { a: [1, 1], b: [-1, 1], normal: (f) => f.out.clone() },
    { a: [-1, 1], b: [-1, -1], normal: (f) => f.across.clone().negate() },
    { a: [-1, -1], b: [1, -1], normal: (f) => f.out.clone().negate() },
    { a: [1, -1], b: [1, 1], normal: (f) => f.across.clone() },
  ]

  const rings = closed ? n + 1 : n // closed strips repeat the first frame for a clean UV seam
  faces.forEach((face, faceIndex) => {
    const start = indices.length
    const base = positions.length / 3
    for (let r = 0; r < rings; r++) {
      const f = frames[r % n]
      const u = r < n ? dist[r] / total : 1
      const normal = face.normal(f)
      pushVertex(corner(f, ...face.a), normal, u, 1)
      pushVertex(corner(f, ...face.b), normal, u, 0)
    }
    for (let r = 0; r < rings - 1; r++) {
      const i0 = base + r * 2
      const expected = face.normal(frames[r % n])
      pushTri(i0, i0 + 1, i0 + 2, expected)
      pushTri(i0 + 1, i0 + 3, i0 + 2, expected)
    }
    geometry.addGroup(start, indices.length - start, faceIndex === 0 ? RIBBON_GROUP.front : RIBBON_GROUP.rest)
  })

  if (!closed) {
    const start = indices.length
    const cap = (f: Frame, normal: THREE.Vector3) => {
      const ids = ([[1, 1], [-1, 1], [-1, -1], [1, -1]] as const).map(([sa, so]) =>
        pushVertex(corner(f, sa, so), normal, 0, 0),
      )
      pushTri(ids[0], ids[1], ids[2], normal)
      pushTri(ids[0], ids[2], ids[3], normal)
    }
    cap(frames[0], frames[0].p.clone().sub(frames[1].p).normalize())
    cap(frames[n - 1], frames[n - 1].p.clone().sub(frames[n - 2].p).normalize())
    geometry.addGroup(start, indices.length - start, RIBBON_GROUP.rest)
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
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
