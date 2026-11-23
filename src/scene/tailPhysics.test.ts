import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config/schema'
import { computeBeltLayout } from './beltLayout'
import { buildKnot } from './knot'
import { TailSim } from './tailPhysics'
import { tailFrames } from './tailShape'

function restTail(side: 'l' | 'r') {
  const layout = computeBeltLayout(DEFAULT_CONFIG)
  const knot = buildKnot(layout.outerWrap, layout.width, layout.thickness)
  return tailFrames(knot[side].root, side === 'l' ? -1 : 1, layout.tailLength, 32)
}

describe('tail physics', () => {
  it('moves a pushed tail only toward and away from the jacket, never sideways', () => {
    for (const side of ['l', 'r'] as const) {
      const rest = restTail(side)
      const sim = new TailSim(rest, 0)
      sim.nudge(0.35)
      let lifted = 0
      for (let step = 0; step < 240; step++) {
        sim.advance(1 / 60, true, step < 30 ? 1.2 : 0)
        const points = sim.points()
        for (let i = 0; i < rest.length; i++) {
          const offset = points[i].clone().sub(rest[i].p)
          expect(Math.abs(offset.dot(rest[i].across))).toBeLessThan(1e-6)
          expect(offset.length()).toBeLessThan(0.15)
          lifted = Math.max(lifted, offset.dot(rest[i].out))
        }
      }
      expect(lifted).toBeGreaterThan(0.005) // it did swing out
    }
  })

  it('stays joined to the knot and keeps its length, shape and facing while it moves', () => {
    const rest = restTail('r')
    const sim = new TailSim(rest, 1)
    sim.nudge(0.35)
    for (let step = 0; step < 90; step++) sim.advance(1 / 60, true)
    const frames = sim.frames()
    expect(frames[0].p.distanceTo(rest[0].p)).toBe(0)
    expect(frames[0].out.distanceTo(rest[0].out)).toBe(0)
    let length = 0
    let restLength = 0
    for (let i = 1; i < frames.length; i++) {
      length += frames[i].p.distanceTo(frames[i - 1].p)
      restLength += rest[i].p.distanceTo(rest[i - 1].p)
      expect(frames[i].across.dot(frames[i].out)).toBeCloseTo(0, 6)
      expect(frames[i].out.z).toBeGreaterThan(0.3) // embroidered face still toward the viewer
      expect(frames[i].width).toBe(rest[i].width)
      expect(frames[i].cup).toBe(rest[i].cup)
    }
    expect(length).toBeCloseTo(restLength, 3)
  })

  it('settles back to its resting shape', () => {
    const rest = restTail('l')
    const sim = new TailSim(rest, 0)
    sim.nudge(0.35)
    for (let step = 0; step < 900; step++) sim.advance(1 / 60, false)
    const points = sim.points()
    for (let i = 0; i < rest.length; i++) expect(points[i].distanceTo(rest[i].p)).toBeLessThan(0.002)
  })
})
