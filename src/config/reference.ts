/**
 * Real-world reference measurements. The 3D layout is calibrated against these, and
 * `beltLayout.test.ts` checks that the app reproduces them. See "Reference dimensions"
 * in PLAN.md. Add new measurements here (with the date and source) as they come in.
 */

/** A size 6 Shureido belt tied on a ~92 cm waist, measured in person (2026-11-22). */
export const REFERENCE_BELT = {
  waistCm: 92,
  beltSizeId: '6',
  /** Belt width (cm). Assumed: the standard 4 cm Shureido width. */
  widthCm: 4,
  /** Hanging length of each tail, from the knot to the tip (cm). */
  tailCm: 35,
} as const

/** The brand label sewn on a tail, measured on the same belt. */
export const REFERENCE_LABEL = {
  /** Length along the tail (cm). */
  lengthCm: 6.5,
  /** Gap between the label and the tip of the tail (cm). */
  fromTipCm: 0.5,
} as const
