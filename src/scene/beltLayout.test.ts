import { describe, expect, it } from 'vitest'
import { REFERENCE_BELT } from '../config/reference'
import { DEFAULT_CONFIG } from '../config/schema'
import { BELT_FRONT_DROP, beltDropAt, bodyEllipseForCircumference, computeBeltLayout, ellipseCircumference, MODEL_WAIST } from './beltLayout'

describe('belt layout', () => {
  it('builds a body ellipse with the requested circumference', () => {
    for (const ratio of [0.6, 0.74, 0.9]) {
      expect(ellipseCircumference(bodyEllipseForCircumference(0.9, ratio))).toBeCloseTo(0.9, 6)
    }
  })

  it('reproduces the measured reference belt (size 6 on a 92 cm waist → 35 cm tails)', () => {
    const r = REFERENCE_BELT
    const { tailLength } = computeBeltLayout({ ...DEFAULT_CONFIG, waist: r.waistCm, size: r.beltSizeId })
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

  it('runs level across the back and sides and dips in a U to the knot at the front', () => {
    const a = computeBeltLayout(DEFAULT_CONFIG).outerWrap.a
    for (const angle of [Math.PI / 2, 2, Math.PI, -2, -Math.PI / 2, 4, 1.5 * Math.PI]) expect(beltDropAt(angle, a)).toBeCloseTo(0, 9)
    expect(beltDropAt(0, a)).toBeCloseTo(BELT_FRONT_DROP, 9)
    // Symmetric, and deepening steadily from each side to the front.
    let prev = 0
    for (let angle = Math.PI / 2; angle >= 0; angle -= 0.01) {
      const drop = beltDropAt(angle, a)
      expect(drop).toBeCloseTo(beltDropAt(-angle, a), 12)
      // ...however the angle is written (the wraps run it from 0 to 2π).
      expect(drop).toBeCloseTo(beltDropAt(2 * Math.PI - angle, a), 12)
      expect(drop).toBeGreaterThanOrEqual(prev)
      prev = drop
    }
  })
})
