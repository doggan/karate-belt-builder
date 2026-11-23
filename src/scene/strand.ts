import * as THREE from 'three'
import type { Frame } from './ribbon'

/** Longest step between samples on a straight stretch (m). */
const FLAT_STEP = 0.004
/** Largest rotation between samples in a fold (rad). */
const FOLD_STEP = THREE.MathUtils.degToRad(12)

/**
 * Lays out one belt strand as a strap of cloth would actually run: straight stretches
 * joined by folds, each fold a wrap around a cylinder whose axis lies in the plane of
 * the strap. Because a fold only ever bends the strap about a line in its own plane,
 * the result is developable (the strap never stretches or bends sideways), and because
 * every piece starts where the last one ended, the strand is continuous by construction.
 *
 * A fold's axis need not run straight across the strap. Folding about a slanted axis is
 * what turns a strap heading one way into a strap heading another (the diagonal crease
 * of a knot). The strap then winds around the fold as a helix, and the straight lines on
 * its surface run parallel to the axis rather than straight across. `shear` records that
 * slant so the mesh can lay its cross-rows along those lines (see `Frame.shear`).
 */
export class StrandPath {
  readonly frames: Frame[] = []
  private readonly p: THREE.Vector3
  private readonly dir: THREE.Vector3
  private readonly across = new THREE.Vector3()
  private readonly out: THREE.Vector3
  private shear = 0

  /**
   * `dir`: heading; `out`: the strap's front-face normal (must be perpendicular to `dir`).
   * `firstFold`: axis of the fold the path opens with, if it starts already slanted for it.
   */
  constructor(p: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3, firstFold?: THREE.Vector3) {
    this.p = p.clone()
    this.dir = dir.clone().normalize()
    this.out = out.clone().normalize()
    this.across.crossVectors(this.out, this.dir).normalize()
    if (firstFold) this.shear = this.shearFor(firstFold)
    this.push()
  }

  get position(): THREE.Vector3 {
    return this.p.clone()
  }

  get heading(): THREE.Vector3 {
    return this.dir.clone()
  }

  /** Current slant of the cross-rows (see `Frame.shear`). */
  get slant(): number {
    return this.shear
  }

  /** Index of the most recent frame (to refer back to a point on the path). */
  get mark(): number {
    return this.frames.length - 1
  }

  private push() {
    this.frames.push({ p: this.p.clone(), across: this.across.clone(), out: this.out.clone(), shear: this.shear })
  }

  /** The fold axis in the strap's plane closest to `axis`, pointing along +across. */
  private planarAxis(axis: THREE.Vector3): THREE.Vector3 {
    const a = axis.clone().addScaledVector(this.out, -axis.dot(this.out)).normalize()
    return a.dot(this.across) < 0 ? a.negate() : a
  }

  /** The `shear` a fold about `axis` needs; pass it to the `flat` that leads into the fold. */
  shearFor(axis: THREE.Vector3): number {
    const a = this.planarAxis(axis)
    return a.dot(this.dir) / a.dot(this.across)
  }

  /** The axis of the fold that turns the strap to head along `target`. */
  axisTo(target: THREE.Vector3): THREE.Vector3 {
    const sum = this.dir.clone().add(target.clone().normalize())
    return sum.lengthSq() < 1e-8 ? this.across.clone() : this.planarAxis(sum)
  }

  /** A straight stretch. `shear` is the value to reach by its end (rows fan gradually). */
  flat(length: number, shear = this.shear): this {
    const steps = Math.max(1, Math.ceil(length / FLAT_STEP))
    const from = this.shear
    for (let i = 1; i <= steps; i++) {
      this.p.addScaledVector(this.dir, length / steps)
      this.shear = from + ((shear - from) * i) / steps
      this.push()
    }
    return this
  }

  /**
   * Fold about `axis` (made to lie in the strap's plane), wrapping a cylinder of
   * centerline radius `radius`. `side` = +1 curls the strap toward its front face
   * (`out`), -1 toward its back. `angle` = how far around the cylinder (π = folded flat
   * back on itself).
   */
  fold(axis: THREE.Vector3, side: 1 | -1, radius: number, angle = Math.PI): this {
    const a = this.planarAxis(axis)
    const along = a.dot(this.dir) // how fast the strap slides along the axis
    const around = a.dot(this.across) // how fast it goes around it
    this.shear = along / around
    const length = (angle * radius) / around
    const steps = Math.max(2, Math.ceil(angle / FOLD_STEP), Math.ceil(length / FLAT_STEP))
    const center = this.p.clone().addScaledVector(this.out, side * radius)
    const arm = this.p.clone().sub(center)
    const start = { dir: this.dir.clone(), across: this.across.clone(), out: this.out.clone() }
    const q = new THREE.Quaternion()
    for (let i = 1; i <= steps; i++) {
      const f = i / steps
      // Right-handed rotation about +across turns `dir` toward -out, hence the sign.
      q.setFromAxisAngle(a, -side * angle * f)
      this.p.copy(arm).applyQuaternion(q).add(center).addScaledVector(a, along * length * f)
      this.dir.copy(start.dir).applyQuaternion(q)
      this.across.copy(start.across).applyQuaternion(q)
      this.out.copy(start.out).applyQuaternion(q)
      this.push()
    }
    return this
  }

  /** Move the whole path so that frame `index` sits at `target`. */
  anchor(index: number, target: THREE.Vector3): this {
    const shift = target.clone().sub(this.frames[index].p)
    for (const f of this.frames) f.p.add(shift)
    this.p.add(shift)
    return this
  }

  /**
   * Finish with a smooth run from the current end to `target` (position and frame),
   * for the stretch where the strap leaves the knot and is free to curve. Any slant
   * left in the cross-rows straightens out along the way.
   */
  connect(target: Frame, steps: number): this {
    const shear0 = this.shear
    const p0 = this.p.clone()
    const d0 = this.dir.clone()
    const a0 = this.across.clone()
    const d1 = new THREE.Vector3().crossVectors(target.across, target.out).normalize()
    const reach = p0.distanceTo(target.p)
    const m0 = d0.clone().multiplyScalar(reach)
    const m1 = d1.clone().multiplyScalar(reach)
    for (let i = 1; i <= steps; i++) {
      const s = i / steps
      const s2 = s * s
      const s3 = s2 * s
      // Cubic Hermite position and its derivative.
      this.p
        .copy(p0)
        .multiplyScalar(2 * s3 - 3 * s2 + 1)
        .addScaledVector(m0, s3 - 2 * s2 + s)
        .addScaledVector(target.p, -2 * s3 + 3 * s2)
        .addScaledVector(m1, s3 - s2)
      this.dir
        .copy(p0)
        .multiplyScalar(6 * s2 - 6 * s)
        .addScaledVector(m0, 3 * s2 - 4 * s + 1)
        .addScaledVector(target.p, -6 * s2 + 6 * s)
        .addScaledVector(m1, 3 * s2 - 2 * s)
        .normalize()
      const blend = s2 * (3 - 2 * s)
      this.across.copy(a0).lerp(target.across, blend)
      this.across.addScaledVector(this.dir, -this.across.dot(this.dir)).normalize()
      this.out.crossVectors(this.dir, this.across).normalize()
      this.push()
    }
    // Straighten the rows evenly by distance (the samples are not evenly spaced).
    const first = this.frames.length - steps - 1
    const dist = arcLengths(this.frames.slice(first))
    for (let i = 0; i <= steps; i++) this.frames[first + i].shear = shear0 * (1 - dist[i] / dist[steps])
    this.shear = 0
    // Land exactly on the target so whatever continues from it shares this frame.
    const last = this.frames[this.frames.length - 1]
    last.p.copy(target.p)
    last.across.copy(target.across)
    last.out.copy(target.out)
    return this
  }
}

/** Distance along a strand from its first frame to each frame. */
export function arcLengths(frames: Frame[]): number[] {
  const dist = [0]
  for (let i = 1; i < frames.length; i++) dist[i] = dist[i - 1] + frames[i].p.distanceTo(frames[i - 1].p)
  return dist
}
