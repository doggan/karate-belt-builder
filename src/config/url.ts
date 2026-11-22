import {
  BELT_COLORS,
  BELT_SIZES,
  BELT_WIDTHS,
  BUILDS,
  DEFAULT_CONFIG,
  FONTS,
  MAX_TEXT_LENGTH,
  TAIL_SIDES,
  TEXT_WEIGHTS,
  THREAD_COLORS,
  WAIST_SIZES,
  type BeltConfig,
  type TailText,
} from './schema'

/**
 * URL format, version 1 (all keys optional; missing or invalid → default):
 *
 *   v     schema version
 *   c     belt color id          s   belt size id (e.g. 3, 3.5)
 *   w     belt width (cm)        wa  waist (cm)        b   build id
 *   t1    text 1                 t1s tail (l|r)  t1c thread color  t1w weight 1–5  t1f font id
 *   t2…   text 2 (same keys)
 *   lg    brand label shown (1|0)   lgs label tail (l|r)
 *   k     chest kanji shown (1|0)   kt  text   kf font id
 *
 * Every field is validated on its own, so an old, hand-edited or truncated link
 * still renders something sensible. Keys present with an empty value (e.g. `t1=`)
 * mean "empty", which is different from a missing key ("default").
 */
export const URL_VERSION = 1

const ids = <T extends { id: string }>(list: readonly T[]): T['id'][] => list.map((x) => x.id)

export function encodeConfig(config: BeltConfig): string {
  const p = new URLSearchParams()
  p.set('v', String(URL_VERSION))
  p.set('c', config.color)
  p.set('s', config.size)
  p.set('w', String(config.width))
  p.set('wa', String(config.waist))
  p.set('b', config.build)
  config.texts.forEach((t, i) => {
    const k = `t${i + 1}`
    p.set(k, t.text)
    p.set(`${k}s`, t.tail)
    p.set(`${k}c`, t.color)
    p.set(`${k}w`, String(t.weight))
    p.set(`${k}f`, t.font)
  })
  p.set('lg', config.logo ? '1' : '0')
  p.set('lgs', config.logoTail)
  p.set('k', config.chest.show ? '1' : '0')
  p.set('kt', config.chest.text)
  p.set('kf', config.chest.font)
  return p.toString()
}

export function decodeConfig(search: string): BeltConfig {
  const p = new URLSearchParams(search)
  const d = DEFAULT_CONFIG
  return {
    color: oneOf(p.get('c'), ids(BELT_COLORS), d.color),
    size: oneOf(p.get('s'), ids(BELT_SIZES), d.size),
    width: intOneOf(p.get('w'), BELT_WIDTHS, d.width),
    waist: intOneOf(p.get('wa'), WAIST_SIZES, d.waist),
    build: oneOf(p.get('b'), ids(BUILDS), d.build),
    texts: [decodeText(p, 1, d.texts[0]), decodeText(p, 2, d.texts[1])],
    logo: bool(p.get('lg'), d.logo),
    logoTail: oneOf(p.get('lgs'), TAIL_SIDES, d.logoTail),
    chest: {
      show: bool(p.get('k'), d.chest.show),
      text: text(p.get('kt'), d.chest.text),
      font: oneOf(p.get('kf'), ids(FONTS), d.chest.font),
    },
  }
}

function decodeText(p: URLSearchParams, n: number, fallback: TailText): TailText {
  const k = `t${n}`
  return {
    text: text(p.get(k), fallback.text),
    tail: oneOf(p.get(`${k}s`), TAIL_SIDES, fallback.tail),
    color: oneOf(p.get(`${k}c`), ids(THREAD_COLORS), fallback.color),
    weight: intOneOf(p.get(`${k}w`), TEXT_WEIGHTS, fallback.weight),
    font: oneOf(p.get(`${k}f`), ids(FONTS), fallback.font),
  }
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

function intOneOf<T extends number>(raw: string | null, allowed: readonly T[], fallback: T): T {
  if (raw === null || !/^\d+$/.test(raw)) return fallback
  const n = Number(raw)
  return (allowed as readonly number[]).includes(n) ? (n as T) : fallback
}

function bool(raw: string | null, fallback: boolean): boolean {
  return raw === '1' ? true : raw === '0' ? false : fallback
}

function text(raw: string | null, fallback: string): string {
  if (raw === null) return fallback
  // Strip control characters; cap length (counted in code points, so kanji count as one).
  return Array.from(raw.replace(/\p{Cc}/gu, '').trim()).slice(0, MAX_TEXT_LENGTH).join('')
}
