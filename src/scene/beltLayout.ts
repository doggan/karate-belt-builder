import { beltSize, type BeltConfig } from '../config/schema'
import { BODY_SHAPES } from './bodyShape'

/** Height of the belt center line above the floor (m). */
export const WAIST_Y = 1.0
/** Belt thickness (m). */
export const BELT_THICKNESS = 0.004
/** Rough belt length consumed by a square knot, per unit of belt width. */
const KNOT_LENGTH_PER_WIDTH = 5.5
/** Never let tails vanish completely, even for an undersized belt. */
const MIN_TAIL_LENGTH = 0.06
/** Gap between the jacket surface and the inner belt layer (m). */
const JACKET_CLEARANCE = 0.002

export interface Ellipse {
  a: number // half-width (x)
  b: number // half-depth (z)
}

export interface BeltLayout {
  body: Ellipse
  depthRatio: number
  innerWrap: Ellipse
  outerWrap: Ellipse
  width: number
  thickness: number
  beltLength: number
  tailLength: number
  knot: { width: number; height: number; depth: number; z: number }
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

export function computeBeltLayout(config: BeltConfig): BeltLayout {
  const width = config.width / 100
  const thickness = BELT_THICKNESS
  const { depthRatio } = BODY_SHAPES[config.build]
  const body = bodyEllipseForCircumference(config.waist / 100, depthRatio)

  const innerWrap = grow(body, JACKET_CLEARANCE + thickness / 2)
  const outerWrap = grow(innerWrap, thickness + 0.0005)

  const beltLength = beltSize(config.size).cm / 100
  const wrapLength = ellipseCircumference(innerWrap) + ellipseCircumference(outerWrap)
  const knotLength = KNOT_LENGTH_PER_WIDTH * width
  const tailLength = Math.max(MIN_TAIL_LENGTH, (beltLength - wrapLength - knotLength) / 2)

  const knotDepth = thickness * 4
  return {
    body,
    depthRatio,
    innerWrap,
    outerWrap,
    width,
    thickness,
    beltLength,
    tailLength,
    knot: {
      width: width * 1.5,
      height: width * 1.1,
      depth: knotDepth,
      z: outerWrap.b + thickness / 2 + knotDepth / 2 - thickness,
    },
  }
}
