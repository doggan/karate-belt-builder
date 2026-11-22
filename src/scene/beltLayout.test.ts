import { describe, expect, it } from 'vitest'
import { REFERENCE_BELT } from '../config/reference'
import { DEFAULT_CONFIG } from '../config/schema'
import { bodyEllipseForCircumference, computeBeltLayout, ellipseCircumference, MODEL_WAIST } from './beltLayout'

describe('belt layout', () => {
  it('builds a body ellipse with the requested circumference', () => {
    for (const ratio of [0.6, 0.74, 0.9]) {
      expect(ellipseCircumference(bodyEllipseForCircumference(0.9, ratio))).toBeCloseTo(0.9, 6)
    }
  })

  it('reproduces the measured reference belt (size 6 on a 92 cm waist → 35 cm tails)', () => {
    const r = REFERENCE_BELT
    const { tailLength } = computeBeltLayout({ ...DEFAULT_CONFIG, waist: r.waistCm, size: r.beltSizeId, width: r.widthCm })
    expect(tailLength * 100).toBeCloseTo(r.tailCm, 1)
  })

  it('makes tails longer for bigger belts and shorter for bigger waists', () => {
    const base = computeBeltLayout(DEFAULT_CONFIG).tailLength
    expect(computeBeltLayout({ ...DEFAULT_CONFIG, size: '6' }).tailLength).toBeGreaterThan(base)
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

  it('keeps the model\'s own waist shape at every waist size', () => {
    const modelRatio = MODEL_WAIST.b / MODEL_WAIST.a
    for (const waist of [60, 90, 120] as const) {
      const { body } = computeBeltLayout({ ...DEFAULT_CONFIG, waist })
      expect(body.b / body.a).toBeCloseTo(modelRatio, 6)
      expect(ellipseCircumference(body)).toBeCloseTo(waist / 100, 6)
    }
  })
})
