import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type BeltConfig } from './schema'
import { decodeConfig, encodeConfig } from './url'

describe('url config', () => {
  it('round-trips a config', () => {
    const config: BeltConfig = { color: 'brown', size: 6, width: 5, waist: 100 }
    expect(decodeConfig(encodeConfig(config))).toEqual(config)
  })

  it('round-trips the default config', () => {
    expect(decodeConfig(encodeConfig(DEFAULT_CONFIG))).toEqual(DEFAULT_CONFIG)
  })

  it('produces a short, readable query string', () => {
    expect(encodeConfig({ color: 'black', size: 3, width: 4, waist: 80 })).toBe('v=1&c=black&s=3&w=4&wa=80')
  })

  it('returns defaults for an empty query', () => {
    expect(decodeConfig('')).toEqual(DEFAULT_CONFIG)
  })

  it('falls back per field for invalid values', () => {
    const decoded = decodeConfig('?c=chartreuse&s=3.5&w=6&wa=-80')
    expect(decoded).toEqual(DEFAULT_CONFIG)
  })

  it('keeps valid fields when others are invalid', () => {
    const decoded = decodeConfig('?c=blue&s=99&w=5')
    expect(decoded).toEqual({ ...DEFAULT_CONFIG, color: 'blue', width: 5 })
  })
})
