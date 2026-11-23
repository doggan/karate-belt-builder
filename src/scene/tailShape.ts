import * as THREE from 'three'
import type { Frame } from './ribbon'

const deg = THREE.MathUtils.degToRad

/** How far each tail leans out sideways from vertical: where it leaves the knot, and far down it. */
const SPLAY_ROOT = deg(34)
const SPLAY_HANG = deg(20)
/** Distance over which the splay relaxes from one to the other (m). */
const SPLAY_RELAX = 0.12
/** Forward lean, so the tails clear the jacket. */
const LEAN = deg(3.5)
/** A tail that leaves the knot bunched (see `Frame.width`) is back to full width this far down (m). */
const WIDEN = 0.06

const FORWARD = new THREE.Vector3(0, 0, 1)

/**
 * Heading of a resting tail `s` meters from the knot. Both tails use this same shape,
 * mirrored (`side`: -1 = viewer's left), so equal-length tails that start level end level.
 */
function tailHeading(side: 1 | -1, s: number, target: THREE.Vector3): THREE.Vector3 {
  const splay = SPLAY_HANG + (SPLAY_ROOT - SPLAY_HANG) * Math.exp(-s / SPLAY_RELAX)
  return target.set(side * Math.sin(splay) * Math.cos(LEAN), -Math.cos(splay) * Math.cos(LEAN), Math.sin(LEAN))
}

/** A frame at `p` heading along `heading` with its front face turned toward the viewer (+Z). */
function facingFrame(p: THREE.Vector3, heading: THREE.Vector3): Frame {
  const out = FORWARD.clone().addScaledVector(heading, -FORWARD.dot(heading)).normalize()
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
    p.addScaledVector(tailHeading(side, (i - 0.5) * ds, heading), ds)
    const frame = facingFrame(p, tailHeading(side, i * ds, heading))
    frame.width = rootWidth + (1 - rootWidth) * THREE.MathUtils.smoothstep(i * ds, 0, WIDEN)
    frames.push(frame)
  }
  return frames
}
