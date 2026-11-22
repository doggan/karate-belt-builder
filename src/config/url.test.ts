import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, MAX_TEXT_LENGTH, type BeltConfig } from './schema'
import { decodeConfig, encodeConfig } from './url'

const custom: BeltConfig = {
  color: 'brown',
  size: '4.5',
  width: 5,
  waist: 100,
  build: 'heavy',
  texts: [
    { text: '山田 太郎', tail: 'r', color: 'gin', weight: 5, font: 'brush' },
    { text: 'カラテ', tail: 'r', color: '1079', weight: 1, font: 'gothic' },
  ],
  logo: false,
  logoTail: 'l',
  chest: { show: true, text: '剛柔流', font: 'gothic' },
}

describe('url config', () => {
  it('round-trips a fully customized config', () => {
    expect(decodeConfig(encodeConfig(custom))).toEqual(custom)
  })

  it('round-trips the default config', () => {
    expect(decodeConfig(encodeConfig(DEFAULT_CONFIG))).toEqual(DEFAULT_CONFIG)
  })

  it('returns defaults for an empty query', () => {
    expect(decodeConfig('')).toEqual(DEFAULT_CONFIG)
  })

  it('treats an empty value as empty text, but a missing key as the default', () => {
    expect(decodeConfig('?t1=').texts[0].text).toBe('')
    expect(decodeConfig('?c=blue').texts[0].text).toBe(DEFAULT_CONFIG.texts[0].text)
  })

  it('falls back per field for invalid values', () => {
    const decoded = decodeConfig('?c=chartreuse&s=8&w=6&wa=-80&b=huge&t1s=x&t1w=9&t1f=comic&t1c=gold&lg=maybe&lgs=up&k=yes&kf=x')
    expect(decoded).toEqual(DEFAULT_CONFIG)
  })

  it('keeps valid fields when others are invalid', () => {
    const decoded = decodeConfig('?c=green&s=99&w=5')
    expect(decoded).toEqual({ ...DEFAULT_CONFIG, color: 'green', width: 5 })
  })

  it('decodes half sizes and the largest sizes', () => {
    expect(decodeConfig('?s=2.5').size).toBe('2.5')
    expect(decodeConfig('?s=7').size).toBe('7')
  })

  it('decodes show/hide flags', () => {
    expect(decodeConfig('?lg=0').logo).toBe(false)
    expect(decodeConfig('?k=1').chest.show).toBe(true)
  })

  it('caps text length in code points and strips control characters', () => {
    const long = '道'.repeat(MAX_TEXT_LENGTH + 10)
    expect(Array.from(decodeConfig(`?t1=${encodeURIComponent(long)}`).texts[0].text)).toHaveLength(MAX_TEXT_LENGTH)
    expect(decodeConfig(`?t1=${encodeURIComponent('空\u0000手')}`).texts[0].text).toBe('空手')
  })
})
