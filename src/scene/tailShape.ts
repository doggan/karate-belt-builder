import * as THREE from 'three'
import type { Frame } from './ribbon'

const deg = THREE.MathUtils.degToRad

// Seen from the front: how far each tail leans out sideways from vertical.
/** Where it leaves the knot. */
const SPLAY_ROOT = deg(34)
/** Once it is hanging freely. */
const SPLAY_HANG = deg(19)
/** Distance over which it relaxes from one to the other (m). */
const SPLAY_RELAX = 0.07

// Seen from the side: how far each tail leans forward, away from the jacket.
/** Where it leaves the knot, pushed out by the knot's bulk. */
const PITCH_ROOT = deg(22)
/** Once it is hanging: nearly plumb, with just enough lean to clear the jacket. */
const PITCH_HANG = deg(2.5)
/** Distance over which it arcs over from one to the other (m). */
const PITCH_RELAX = 0.06

// Softness: a thick cotton belt is never quite flat.
/** Curvature across the width (1/m), edges curling back toward the jacket: stronger where the knot pinches it. */
const CUP_HANG = 5
const CUP_ROOT = 16
const CUP_RELAX = 0.05
const CUP_ONSET = 0.025
/** Each tail turns slightly about its own length by the time it reaches its tip. */
const TWIST_AT_TIP = deg(5)
/** A tail that leaves the knot bunched (see `Frame.width`) is back to full width this far down (m). */
const WIDEN = 0.16

const FORWARD = new THREE.Vector3(0, 0, 1)

/**
 * Heading of a resting tail `s` meters from the knot: forward out of the knot, arcing
 * over, then hanging. Both tails use this same shape, mirrored (`side`: -1 = viewer's
 * left), so equal-length tails that start level end level.
 */
function tailHeading(side: 1 | -1, s: number, target: THREE.Vector3): THREE.Vector3 {
  const splay = SPLAY_HANG + (SPLAY_ROOT - SPLAY_HANG) * Math.exp(-s / SPLAY_RELAX)
  const pitch = PITCH_HANG + (PITCH_ROOT - PITCH_HANG) * Math.exp(-s / PITCH_RELAX)
  return target.set(side * Math.sin(splay) * Math.cos(pitch), -Math.cos(splay) * Math.cos(pitch), Math.sin(pitch))
}

/** A frame at `p` heading along `heading` with its front face turned toward the viewer (+Z), then rolled by `twist`. */
function facingFrame(p: THREE.Vector3, heading: THREE.Vector3, twist = 0): Frame {
  const out = FORWARD.clone().addScaledVector(heading, -FORWARD.dot(heading)).normalize()
  if (twist) out.applyAxisAngle(heading, twist)
  // `across` points to the viewer's right, so the front face reads left-to-right.
  return { p: p.clone(), across: new THREE.Vector3().crossVectors(out, heading).normalize(), out }
}

/** The frame a tail starts from at `p`; the knot's strands end on exactly this frame. */
export function tailRootFrame(p: THREE.Vector3, side: 1 | -1, width = 1): Frame {
  return { ...facingFrame(p, tailHeading(side, 0, new THREE.Vector3())), width }
}

/**
 * Resting shape of a hanging tail, from `root` (a `tailRootFrame`) to its tip `length`
 * further on. The first frame is `root` itself, so the tail continues its strand seamlessly.
 */
export function tailFrames(root: Frame, side: 1 | -1, length: number, segments: number): Frame[] {
  const frames: Frame[] = [{ ...root, p: root.p.clone(), across: root.across.clone(), out: root.out.clone() }]
  const heading = new THREE.Vector3()
  const p = root.p.clone()
  const ds = length / segments
  const rootWidth = root.width ?? 1
  for (let i = 1; i <= segments; i++) {
    const s = i * ds
    p.addScaledVector(tailHeading(side, s - ds / 2, heading), ds)
    const along = s / length
    const frame = facingFrame(p, tailHeading(side, s, heading), side * TWIST_AT_TIP * along * along)
    frame.width = rootWidth + (1 - rootWidth) * THREE.MathUtils.smoothstep(s, 0, WIDEN)
    // (Flat at the very start, where it meets the knot's strand.)
    frame.cup = -(CUP_HANG + (CUP_ROOT - CUP_HANG) * Math.exp(-s / CUP_RELAX)) * THREE.MathUtils.smoothstep(s, 0, CUP_ONSET)
    frames.push(frame)
  }
  return frames
}
