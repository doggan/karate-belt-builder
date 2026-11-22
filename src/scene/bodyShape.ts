import type { BuildId } from '../config/schema'

export interface BodyShape {
  /** Depth/width ratio of the waist cross-section (rounder = heavier). */
  depthRatio: number
  /**
   * Jacket silhouette as [radius multiplier of the waist half-width, height above the waist (m)].
   * Must be 1.0 across roughly ±0.08 m so the belt sits on the surface.
   */
  profile: Array<[number, number]>
  /** Profile multiplier at the shoulders (for arm placement). */
  shoulder: number
  /** Profile multiplier at chest height (for the patch). */
  chest: number
}

const CHEST_Y = 0.3

function profile(hip: number, belly: number, chest: number, shoulder: number): Array<[number, number]> {
  return [
    [0, -0.3],
    [hip, -0.3],
    [hip + 0.01, -0.27],
    [(hip + 1) / 2, -0.17],
    [1.0, -0.08],
    [1.0, 0.08],
    [belly, 0.17],
    [chest, CHEST_Y],
    [shoulder, 0.4],
    [shoulder, 0.45],
    [shoulder * 0.85, 0.5],
    [0.55, 0.53],
    [0.36, 0.55],
    [0.34, 0.62],
    [0, 0.62],
  ]
}

/**
 * Body shapes keep the same waist circumference (the waist control) and change
 * proportions around it: a slim build is a flat, V-shaped torso; a heavy build
 * is round at the waist with chest and hips close to the waist width.
 */
export const BODY_SHAPES: Record<BuildId, BodyShape> = {
  slim: { depthRatio: 0.62, profile: profile(1.1, 1.1, 1.36, 1.46), shoulder: 1.46, chest: 1.36 },
  average: { depthRatio: 0.72, profile: profile(1.06, 1.06, 1.2, 1.3), shoulder: 1.3, chest: 1.2 },
  heavy: { depthRatio: 0.9, profile: profile(1.02, 0.99, 1.04, 1.12), shoulder: 1.12, chest: 1.04 },
}

/** Profile radius multiplier at height `y` above the waist (linear between profile points). */
export function profileRadiusAt(profile: Array<[number, number]>, y: number): number {
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1]
    const [r1, y1] = profile[i]
    if (y >= y0 && y <= y1 && y1 > y0) return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0)
  }
  return 1
}
