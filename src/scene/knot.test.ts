import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config/schema'
import { computeBeltLayout, WAIST_Y } from './beltLayout'
import { buildKnot, type KnotStrand } from './knot'
import { buildRibbon } from './ribbon'
import { tailFrames } from './tailShape'

const WAISTS = [60, 85, 120]

function knotFor(waist: number) {
  const layout = computeBeltLayout({ ...DEFAULT_CONFIG, waist })
  return { layout, knot: buildKnot(layout.outerWrap, layout.width, layout.thickness) }
}

const heading = (f: { across: THREE.Vector3; out: THREE.Vector3 }) => new THREE.Vector3().crossVectors(f.across, f.out)

describe('belt knot', () => {
  it('runs each strand as one unbroken strap', () => {
    for (const waist of WAISTS) {
      const { knot } = knotFor(waist)
      for (const strand of [knot.l, knot.r]) {
        const { frames } = strand
        for (let i = 0; i < frames.length; i++) {
          const f = frames[i]
          expect(f.across.length()).toBeCloseTo(1, 5)
          expect(f.out.length()).toBeCloseTo(1, 5)
          expect(f.across.dot(f.out)).toBeCloseTo(0, 5)
          if (i === 0) continue
          const step = f.p.clone().sub(frames[i - 1].p)
          expect(step.length()).toBeLessThan(0.006)
          // Each step carries on the way the strap is heading: no jumps, no doubling back.
          expect(step.normalize().dot(heading(f))).toBeGreaterThan(0.9)
        }
      }
    }
  })

  it('never crosses its own cross-rows, even where they slant through a fold', () => {
    const { layout, knot } = knotFor(85)
    for (const strand of [knot.l, knot.r]) {
      const { frames } = strand
      for (let i = 1; i < frames.length; i++) {
        const [a, b] = [frames[i - 1], frames[i]]
        for (const side of [1, -1]) {
          const edge = (f: typeof a) => {
            const reach = (side * (layout.width / 2) * (f.width ?? 1))
            return f.p.clone().addScaledVector(f.across, reach).addScaledVector(heading(f), reach * (f.shear ?? 0))
          }
          expect(edge(b).sub(edge(a)).dot(heading(a))).toBeGreaterThan(0)
        }
      }
    }
  })

  it('starts both tails level, facing the viewer, exactly where its strands end', () => {
    for (const waist of WAISTS) {
      const { knot } = knotFor(waist)
      expect(knot.l.root.p.y).toBeCloseTo(knot.r.root.p.y, 9)
      // ...one either side of the middle of the belt.
      expect(knot.l.root.p.x).toBeLessThan(0)
      expect(knot.r.root.p.x).toBeGreaterThan(0.015)
      for (const strand of [knot.l, knot.r]) {
        expect(strand.root.out.z).toBeGreaterThan(0.75) // leaning forward out of the knot, still facing the viewer
        expect(strand.root.across.x).toBeGreaterThan(0.5) // front face reads left to right
        expect(heading(strand.root).y).toBeLessThan(0) // heading down
        // The strand's last cross-section, once bent around the waist, is the tail's first.
        const last = strand.frames.length - 1
        const end = strand.frames[last]
        for (const reach of [-0.02, 0, 0.02]) {
          const p = end.p.clone().addScaledVector(end.across, reach)
          const n = end.out.clone()
          strand.warp(p, n, last)
          expect(p.distanceTo(strand.root.p.clone().addScaledVector(strand.root.across, reach))).toBeLessThan(1e-9)
          expect(n.distanceTo(strand.root.out)).toBeLessThan(1e-9)
        }
      }
    }
  })

  it('hangs equal-length tails to the same height', () => {
    for (const config of [DEFAULT_CONFIG, { ...DEFAULT_CONFIG, size: '00', waist: 120 }, { ...DEFAULT_CONFIG, size: '7', waist: 60 }] as const) {
      const layout = computeBeltLayout(config)
      const knot = buildKnot(layout.outerWrap, layout.width, layout.thickness)
      const tips = (['l', 'r'] as const).map((side) => {
        const frames = tailFrames(knot[side].root, side === 'l' ? -1 : 1, layout.tailLength, 32)
        let length = 0
        for (let i = 1; i < frames.length; i++) length += frames[i].p.distanceTo(frames[i - 1].p)
        expect(length).toBeCloseTo(layout.tailLength, 6)
        expect(frames[0].p.distanceTo(knot[side].root.p)).toBe(0)
        for (const f of frames) expect(f.out.z).toBeGreaterThan(0.5) // the embroidered face stays toward the viewer
        return frames[frames.length - 1].p
      })
      expect(tips[0].y).toBeCloseTo(tips[1].y, 9)
    }
  })

  it('stands proud of the wrap and sits centered on the belt', () => {
    const { layout, knot } = knotFor(85)
    const front = layout.outerWrap.b + layout.thickness / 2
    const box = new THREE.Box3()
    const p = new THREE.Vector3()
    const body = (strand: KnotStrand) => {
      const position = buildRibbon(strand.frames, { width: layout.width, thickness: layout.thickness, uLength: layout.width, warp: strand.warp }).getAttribute('position')
      // The knot's body: everything in front of the wrap (the strands end where the tails start).
      for (let i = 0; i < position.count; i++) {
        p.fromBufferAttribute(position, i)
        if (p.z > front) box.expandByPoint(p)
      }
    }
    body(knot.l)
    body(knot.r)
    // Four layers of belt at its thickest.
    expect(box.max.z - front).toBeGreaterThan(3.5 * layout.thickness)
    // As far above the belt's center line as below it, give or take a few millimeters.
    const beltY = WAIST_Y - 0.0015
    expect(Math.abs((box.max.y + box.min.y) / 2 - beltY)).toBeLessThan(0.1 * layout.width)
    expect(box.max.y - box.min.y).toBeLessThan(1.7 * layout.width)
  })

  it('builds fast enough to follow the waist slider', () => {
    const { layout } = knotFor(85)
    const opts = { width: layout.width, thickness: layout.thickness, uLength: layout.width, across: 6 }
    // Best of several runs, so other tests running alongside don't skew the timing.
    let best = Infinity
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      const knot = buildKnot({ a: layout.outerWrap.a + i * 1e-4, b: layout.outerWrap.b }, layout.width, layout.thickness)
      buildRibbon(knot.l.frames, { ...opts, warp: knot.l.warp })
      buildRibbon(knot.r.frames, { ...opts, warp: knot.r.warp })
      best = Math.min(best, performance.now() - start)
    }
    expect(best).toBeLessThan(5)
  })
})
