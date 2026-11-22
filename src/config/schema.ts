/**
 * The belt configuration model. Everything rendered is derived from a BeltConfig,
 * and a BeltConfig round-trips through the URL (see ./url.ts).
 *
 * Preset ids are stable short strings used directly in shared links:
 * never rename an id once shipped — add a new one instead.
 */

export interface BeltColorPreset {
  id: string
  label: string
  hex: string
}

export const BELT_COLORS = [
  { id: 'white', label: 'White', hex: '#f3f1ea' },
  { id: 'yellow', label: 'Yellow', hex: '#f0c419' },
  { id: 'orange', label: 'Orange', hex: '#e46f1b' },
  { id: 'red', label: 'Red', hex: '#b3202a' },
  { id: 'green', label: 'Green', hex: '#2c7a3a' },
  { id: 'blue', label: 'Blue', hex: '#1f4d9e' },
  { id: 'purple', label: 'Purple', hex: '#5a2d84' },
  { id: 'brown', label: 'Brown', hex: '#5a3520' },
  { id: 'black', label: 'Black', hex: '#151515' },
] as const satisfies readonly BeltColorPreset[]

export type BeltColorId = (typeof BELT_COLORS)[number]['id']

/** Belt sizes → overall length. Approximate; varies by maker. */
export const BELT_SIZES = [
  { id: 0, cm: 200 },
  { id: 1, cm: 220 },
  { id: 2, cm: 240 },
  { id: 3, cm: 260 },
  { id: 4, cm: 280 },
  { id: 5, cm: 300 },
  { id: 6, cm: 320 },
  { id: 7, cm: 340 },
  { id: 8, cm: 360 },
] as const

export type BeltSizeId = (typeof BELT_SIZES)[number]['id']

export const BELT_WIDTHS = [4, 5] as const
export type BeltWidthCm = (typeof BELT_WIDTHS)[number]

/** Waist circumference over the jacket, in cm. */
export const WAIST_SIZES = [60, 70, 80, 90, 100, 110] as const
export type WaistCm = (typeof WAIST_SIZES)[number]

export interface BeltConfig {
  color: BeltColorId
  size: BeltSizeId
  width: BeltWidthCm
  waist: WaistCm
}

export const DEFAULT_CONFIG: BeltConfig = {
  color: 'black',
  size: 3,
  width: 4,
  waist: 80,
}

export function beltColor(id: BeltColorId): BeltColorPreset {
  return BELT_COLORS.find((c) => c.id === id) ?? BELT_COLORS[0]
}

export function beltSizeCm(id: BeltSizeId): number {
  return (BELT_SIZES.find((s) => s.id === id) ?? BELT_SIZES[3]).cm
}
