import { REFERENCE_BELT } from '../config/reference'
import { beltSize, type BeltConfig } from '../config/schema'
import dogi from './dogiModel.json'

/** Height of the belt center line above the floor (m). Matches the prepared dogi model. */
export const WAIST_Y = dogi.waistY
/** Belt thickness (m). */
export const BELT_THICKNESS = 0.004
/** Never let tails vanish completely, even for an undersized belt. */
const MIN_TAIL_LENGTH = 0.06
/** Gap between the jacket surface and the inner belt layer (m); covers folds the ellipse misses. */
const JACKET_CLEARANCE = 0.004

/** The dogi model's own waist cross-section where the belt sits (m). */
export const MODEL_WAIST = dogi.waist
const MODEL_DEPTH_RATIO = dogi.waist.b / dogi.waist.a


export interface Ellipse {
  a: number // half-width (x)
  b: number // half-depth (z)
}

export interface BeltLayout {
  body: Ellipse
  /** Horizontal scale to apply to the dogi model at the waist so it matches `body`. */
  modelScale: { x: number; z: number }
  innerWrap: Ellipse
  outerWrap: Ellipse
  width: number
  thickness: number
  beltLength: number
  tailLength: number
}

/** Ramanujan's approximation of an ellipse's perimeter. */
export function ellipseCircumference({ a, b }: Ellipse): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
}

/** Half-axes of a body ellipse with the given circumference and depth/width ratio. */
export function bodyEllipseForCircumference(circumference: number, depthRatio: number): Ellipse {
  const a = circumference / ellipseCircumference({ a: 1, b: depthRatio })
  return { a, b: a * depthRatio }
}

function grow(e: Ellipse, by: number): Ellipse {
  return { a: e.a + by, b: e.b + by }
}

/** The two wraps around the waist: centerlines of the inner and outer layer. */
function wrapsFor(waistCm: number) {
  const body = bodyEllipseForCircumference(waistCm / 100, MODEL_DEPTH_RATIO)
  const innerWrap = grow(body, JACKET_CLEARANCE + BELT_THICKNESS / 2)
  const outerWrap = grow(innerWrap, BELT_THICKNESS + 0.0005)
  return { body, innerWrap, outerWrap, length: ellipseCircumference(innerWrap) + ellipseCircumference(outerWrap) }
}

/**
 * Belt length taken up by the square knot, per unit of belt width — calibrated so the
 * reference belt (src/config/reference.ts) comes out with its measured tail length:
 * knot = belt length − both wraps − both tails.
 */
const KNOT_LENGTH_PER_WIDTH = (() => {
  const r = REFERENCE_BELT
  const knot = beltSize(r.beltSizeId).cm / 100 - wrapsFor(r.waistCm).length - (2 * r.tailCm) / 100
  return knot / (r.widthCm / 100)
})()

export function computeBeltLayout(config: BeltConfig): BeltLayout {
  const width = config.width / 100
  const thickness = BELT_THICKNESS
  const { body, innerWrap, outerWrap, length: wrapLength } = wrapsFor(config.waist)

  const beltLength = beltSize(config.size).cm / 100
  const knotLength = KNOT_LENGTH_PER_WIDTH * width
  const tailLength = Math.max(MIN_TAIL_LENGTH, (beltLength - wrapLength - knotLength) / 2)

  return {
    body,
    modelScale: { x: body.a / MODEL_WAIST.a, z: body.b / MODEL_WAIST.b },
    innerWrap,
    outerWrap,
    width,
    thickness,
    beltLength,
    tailLength,
  }
}
