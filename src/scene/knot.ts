import * as THREE from 'three'
import { WAIST_Y, type BeltLayout } from './beltLayout'
import { buildRibbon, curveFrames } from './ribbon'

/**
 * A karate square knot, built from belt strips so it shares the belt's stitching.
 * Seen from the front:
 *
 *            ╭──╮╲            ← a near-vertical loop wraps around the crossing strands,
 *   ━━━━━━━━━│  │━╲━━━━━━━      its top leaning slightly left
 *   ━━━━━━━━╱│  │━━╲━━━━━━
 *          ╱ ╰──╯   ╲         ← the right tail leaves from the loop's upper right, the left
 *         ╱           ╲          tail from its lower left; both cross the wrap and splay out
 */
export interface KnotGeometry {
  loop: THREE.BufferGeometry
  core: THREE.BufferGeometry
  /** Where each tail leaves the knot (viewer's left / right). */
  tailStart: { l: THREE.Vector3; r: THREE.Vector3 }
}

const SEGMENTS = 28
/** Lean of the front loop (positive = top tipped toward the viewer's left). */
const LOOP_TILT = THREE.MathUtils.degToRad(13)

export function buildKnot(layout: BeltLayout): KnotGeometry {
  const { width: w, thickness: t, outerWrap } = layout
  /** Front surface of the wrap at the center front. */
  const z0 = outerWrap.b + t / 2

  // Core: the horizontal crossing the loop is wrapped around (shows at the loop's sides).
  const corePoints: THREE.Vector3[] = []
  for (let i = 0; i <= SEGMENTS; i++) {
    const s = i / SEGMENTS - 0.5
    const x = s * 1.25 * w
    corePoints.push(new THREE.Vector3(x, WAIST_Y, z0 + 1.2 * t - Math.pow(Math.abs(2 * s), 3) * 1.0 * t))
  }
  const core = buildRibbon(curveFrames(corePoints, new THREE.Vector3(0, 1, 0)), w * 0.9, t, false, w)

  // Front loop: an arc over the top, down the front and back under the bottom, then tilted.
  const ay = 0.72 * w // half-height of the loop
  const az = 0.25 * w // how far it curls back at top and bottom (kept shallow so the tails stay behind it)
  const zFront = z0 + 4.2 * t
  const zc = zFront - az
  const sweep = THREE.MathUtils.degToRad(118)
  const cos = Math.cos(LOOP_TILT)
  const sin = Math.sin(LOOP_TILT)
  const loopPoints: THREE.Vector3[] = []
  for (let i = 0; i <= SEGMENTS; i++) {
    const phi = sweep - (2 * sweep * i) / SEGMENTS // top → bottom
    const sy = Math.sign(Math.sin(phi)) * Math.pow(Math.abs(Math.sin(phi)), 0.75)
    const cz = Math.sign(Math.cos(phi)) * Math.pow(Math.abs(Math.cos(phi)), 0.6)
    const y = ay * sy
    loopPoints.push(new THREE.Vector3(-y * sin, WAIST_Y + y * cos, zc + az * cz))
  }
  const loopAcross = new THREE.Vector3(cos, sin, 0)
  const loop = buildRibbon(curveFrames(loopPoints, loopAcross), w * 0.95, t, false, w)

  // Tails start under the loop's bottom edge, behind it, so each visibly comes out from
  // beneath the knot. Same height, mirrored: equal-length tails end level.
  const tailY = WAIST_Y - 0.74 * w // just above the loop's bottom edge
  const tailZ = z0 + 1.1 * t // behind the loop's lower curl
  return {
    loop,
    core,
    tailStart: {
      l: new THREE.Vector3(-0.12 * w, tailY, tailZ),
      r: new THREE.Vector3(0.12 * w, tailY, tailZ),
    },
  }
}
