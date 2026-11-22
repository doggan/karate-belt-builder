import {
  BELT_COLORS,
  BELT_SIZES,
  BELT_WIDTHS,
  DEFAULT_CONFIG,
  WAIST_SIZES,
  type BeltColorId,
  type BeltConfig,
  type BeltSizeId,
  type BeltWidthCm,
  type WaistCm,
} from './schema'

/**
 * URL format, version 1:
 *   ?v=1&c=<colorId>&s=<size>&w=<widthCm>&wa=<waistCm>
 *
 * Decoding is lenient: every field is validated on its own and falls back to the
 * default, so an old, hand-edited, or truncated link still renders something sensible.
 */
export const URL_VERSION = 1

const KEYS = {
  version: 'v',
  color: 'c',
  size: 's',
  width: 'w',
  waist: 'wa',
} as const

export function encodeConfig(config: BeltConfig): string {
  const params = new URLSearchParams()
  params.set(KEYS.version, String(URL_VERSION))
  params.set(KEYS.color, config.color)
  params.set(KEYS.size, String(config.size))
  params.set(KEYS.width, String(config.width))
  params.set(KEYS.waist, String(config.waist))
  return params.toString()
}

export function decodeConfig(search: string): BeltConfig {
  const params = new URLSearchParams(search)
  return {
    color: pick(params.get(KEYS.color), BELT_COLORS.map((c) => c.id), DEFAULT_CONFIG.color) as BeltColorId,
    size: pickInt(params.get(KEYS.size), BELT_SIZES.map((s) => s.id), DEFAULT_CONFIG.size) as BeltSizeId,
    width: pickInt(params.get(KEYS.width), BELT_WIDTHS, DEFAULT_CONFIG.width) as BeltWidthCm,
    waist: pickInt(params.get(KEYS.waist), WAIST_SIZES, DEFAULT_CONFIG.waist) as WaistCm,
  }
}

function pick<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

function pickInt<T extends number>(raw: string | null, allowed: readonly T[], fallback: T): T {
  if (raw === null || !/^\d+$/.test(raw)) return fallback
  const n = Number(raw)
  return (allowed as readonly number[]).includes(n) ? (n as T) : fallback
}
