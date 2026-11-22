/**
 * The belt configuration model. Everything rendered is derived from a BeltConfig,
 * and a BeltConfig round-trips through the URL (see ./url.ts).
 *
 * Preset ids are stable short strings used directly in shared links:
 * never rename an id once shipped — add a new one instead.
 */

// ── Belt ────────────────────────────────────────────────────────────────────

export const BELT_COLORS = [
  { id: 'white', label: 'White', hex: '#f3f1ea' },
  { id: 'yellow', label: 'Yellow', hex: '#f0c419' },
  { id: 'green', label: 'Green', hex: '#2c7a3a' },
  { id: 'brown', label: 'Brown', hex: '#5a3520' },
  { id: 'black', label: 'Black', hex: '#151515' },
] as const

export type BeltColorId = (typeof BELT_COLORS)[number]['id']

/**
 * Official Shureido obi sizes and lengths. `heightCm` is Shureido's recommended
 * wearer height (published only up to size 6).
 */
export const BELT_SIZES = [
  { id: '00', label: '00', heightCm: 110, cm: 190 },
  { id: '0', label: '0', heightCm: 120, cm: 200 },
  { id: '1', label: '1', heightCm: 130, cm: 210 },
  { id: '1.5', label: '1½', heightCm: 140, cm: 220 },
  { id: '2', label: '2', heightCm: 150, cm: 230 },
  { id: '2.5', label: '2½', heightCm: 155, cm: 240 },
  { id: '3', label: '3', heightCm: 160, cm: 250 },
  { id: '3.5', label: '3½', heightCm: 165, cm: 260 },
  { id: '4', label: '4', heightCm: 170, cm: 270 },
  { id: '4.5', label: '4½', heightCm: 175, cm: 280 },
  { id: '5', label: '5', heightCm: 180, cm: 290 },
  { id: '5.5', label: '5½', heightCm: 185, cm: 300 },
  { id: '6', label: '6', heightCm: 190, cm: 310 },
  { id: '6.5', label: '6½', heightCm: null, cm: 320 },
  { id: '7', label: '7', heightCm: null, cm: 330 },
] as const

export type BeltSizeId = (typeof BELT_SIZES)[number]['id']

export const BELT_WIDTHS = [4, 5] as const
export type BeltWidthCm = (typeof BELT_WIDTHS)[number]

// ── Body ────────────────────────────────────────────────────────────────────

/** Waist circumference over the jacket, in cm. */
export const WAIST_SIZES = [60, 70, 80, 90, 100, 110, 120] as const
export type WaistCm = (typeof WAIST_SIZES)[number]

export const BUILDS = [
  { id: 'slim', label: 'Slim' },
  { id: 'average', label: 'Average' },
  { id: 'heavy', label: 'Heavy' },
] as const
export type BuildId = (typeof BUILDS)[number]['id']

// ── Embroidery ──────────────────────────────────────────────────────────────

/**
 * Official Shureido embroidery thread colors, by catalog number (白 = white, 銀 = silver).
 * Hex values were sampled from Shureido's swatch photo, so they are approximate.
 */
export const THREAD_COLORS = [
  { id: 'shiro', label: '白 White', hex: '#ecf3f7' },
  { id: 'gin', label: '銀 Silver', hex: '#d9d6d4' },
  { id: '68', label: '68', hex: '#f7ebf2' },
  { id: '69', label: '69', hex: '#ede8f0' },
  { id: '72', label: '72', hex: '#cdcddc' },
  { id: '10', label: '10', hex: '#c25765' },
  { id: '8', label: '8', hex: '#de6b64' },
  { id: '114', label: '114', hex: '#e6a0c0' },
  { id: '44', label: '44', hex: '#d86d52' },
  { id: '43', label: '43', hex: '#e09f6f' },
  { id: '180', label: '180', hex: '#e3ca84' },
  { id: '2', label: '2', hex: '#e4ce86' },
  { id: '1', label: '1', hex: '#dcccb2' },
  { id: '39', label: '39', hex: '#e5e19d' },
  { id: '436', label: '436', hex: '#d0b678' },
  { id: '53', label: '53', hex: '#9dc173' },
  { id: '83', label: '83', hex: '#d3baac' },
  { id: '854', label: '854', hex: '#e8e5ea' },
  { id: '856', label: '856', hex: '#ad8ebc' },
  { id: '314', label: '314', hex: '#8a6ca7' },
  { id: '387', label: '387', hex: '#9372ac' },
  { id: '182', label: '182', hex: '#53a08e' },
  { id: '816', label: '816', hex: '#639578' },
  { id: '1079', label: '1079', hex: '#41796e' },
  { id: '202', label: '202', hex: '#80bfd6' },
  { id: '244', label: '244', hex: '#529ec8' },
  { id: '27', label: '27', hex: '#4972b2' },
  { id: '28', label: '28', hex: '#4762a3' },
  { id: '137', label: '137', hex: '#3f507d' },
] as const
export type ThreadColorId = (typeof THREAD_COLORS)[number]['id']

export const FONTS = [
  { id: 'mincho', label: 'Mincho (serif)', family: 'Noto Serif JP' },
  { id: 'gothic', label: 'Gothic (sans)', family: 'Noto Sans JP' },
  { id: 'brush', label: 'Brush', family: 'Yuji Syuku' },
] as const
export type FontId = (typeof FONTS)[number]['id']

/** Stroke weight of embroidered text, 1 (thin) … 5 (heavy). */
export const TEXT_WEIGHTS = [1, 2, 3, 4, 5] as const
export type TextWeight = (typeof TEXT_WEIGHTS)[number]

/** Tails as seen from the front: 'l' is the viewer's left. */
export type TailSide = 'l' | 'r'
export const TAIL_SIDES: readonly TailSide[] = ['l', 'r']

export interface TailText {
  text: string
  tail: TailSide
  color: ThreadColorId
  weight: TextWeight
  font: FontId
}

/** Hard cap so a hand-crafted link can't make an absurd texture; not a UX limit. */
export const MAX_TEXT_LENGTH = 40

/** A generic (fictional) brand label, black and red, sewn near the end of a tail. */
export const BRAND_LABEL = { mark: '武', name: 'BUDŌ', black: '#141414', red: '#c0262e' } as const

/** Chest embroidery: black kanji stitched directly on the jacket, reading vertically. */
export const CHEST_THREAD_HEX = '#141414'
export interface ChestKanji {
  show: boolean
  text: string
  font: FontId
}

// ── Config ──────────────────────────────────────────────────────────────────

export interface BeltConfig {
  color: BeltColorId
  size: BeltSizeId
  width: BeltWidthCm
  waist: WaistCm
  build: BuildId
  texts: [TailText, TailText]
  logo: boolean
  logoTail: TailSide
  chest: ChestKanji
}

export const DEFAULT_CONFIG: BeltConfig = {
  color: 'black',
  size: '3',
  width: 4,
  waist: 80,
  build: 'average',
  texts: [
    { text: '空手道', tail: 'l', color: '436', weight: 3, font: 'mincho' },
    { text: '', tail: 'r', color: '436', weight: 3, font: 'mincho' },
  ],
  logo: true,
  logoTail: 'r',
  chest: { show: false, text: '空手道', font: 'mincho' },
}

// ── Lookups ─────────────────────────────────────────────────────────────────

const byId = <T extends { id: string }>(list: readonly T[], id: string): T => list.find((x) => x.id === id) ?? list[0]

export const beltColor = (id: BeltColorId) => byId(BELT_COLORS, id)
export const beltSize = (id: BeltSizeId) => byId(BELT_SIZES, id)
export const threadColor = (id: ThreadColorId) => byId(THREAD_COLORS, id)
export const font = (id: FontId) => byId(FONTS, id)
