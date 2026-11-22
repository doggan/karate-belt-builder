import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config/schema'
import { BODY_SHAPES } from './bodyShape'
import { bodyEllipseForCircumference, computeBeltLayout, ellipseCircumference } from './beltLayout'

describe('belt layout', () => {
  it('builds a body ellipse with the requested circumference', () => {
    for (const { depthRatio } of Object.values(BODY_SHAPES)) {
      expect(ellipseCircumference(bodyEllipseForCircumference(0.9, depthRatio))).toBeCloseTo(0.9, 6)
    }
  })

  it('makes tails longer for bigger belts and shorter for bigger waists', () => {
    const base = computeBeltLayout(DEFAULT_CONFIG).tailLength
    expect(computeBeltLayout({ ...DEFAULT_CONFIG, size: '5' }).tailLength).toBeGreaterThan(base)
    expect(computeBeltLayout({ ...DEFAULT_CONFIG, waist: 100 }).tailLength).toBeLessThan(base)
  })

  it('gives realistic tails for the default config', () => {
    const tail = computeBeltLayout(DEFAULT_CONFIG).tailLength
    expect(tail).toBeGreaterThan(0.25)
    expect(tail).toBeLessThan(0.45)
  })

  it('never produces vanishing tails', () => {
    expect(computeBeltLayout({ ...DEFAULT_CONFIG, size: '00', waist: 120 }).tailLength).toBeGreaterThan(0.05)
  })

  it('keeps every build the same waist size but changes its shape', () => {
    const slim = computeBeltLayout({ ...DEFAULT_CONFIG, build: 'slim' })
    const heavy = computeBeltLayout({ ...DEFAULT_CONFIG, build: 'heavy' })
    expect(ellipseCircumference(slim.body)).toBeCloseTo(ellipseCircumference(heavy.body), 6)
    expect(heavy.body.b / heavy.body.a).toBeGreaterThan(slim.body.b / slim.body.a)
  })
})
