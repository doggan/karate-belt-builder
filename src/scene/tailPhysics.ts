import * as THREE from 'three'
import type { Frame } from './ribbon'

/**
 * Lightweight cloth for a belt tail: a chain of particles (Verlet integration) that
 * springs back toward its styled resting shape.
 *
 * A belt is a stiff, flat strap: it can flex out of its own plane (toward/away from
 * the jacket, which reads as the tip lifting and settling) but it cannot bend sideways
 * across its width. So every particle's motion is restricted to the plane of the
 * tail's length and face normal, and forces act only along the face normal. The
 * breeze moves the whole tail as one (no ripples travelling down it). An external
 * push (e.g. from the camera turning) can be fed in each frame via `advance`.
 */
const STEP = 1 / 120
const MAX_STEPS = 6
const DAMPING = 0.965
const ITERATIONS = 6
/** Spring strength toward the rest shape (1/s²): stiff at the knot, softer at the tip. */
const K_ROOT = 260
const K_TIP = 32
/** Breeze acceleration at the tip (m/s²), along the face normal. */
const BREEZE = 0.5
/** Tails may lift away from the jacket freely but only this far back into it (m). */
const BACK_LIMIT = 0.002

export class TailSim {
  private rest: THREE.Vector3[] = []
  private out: THREE.Vector3[] = []
  private across: THREE.Vector3[] = []
  private pos: THREE.Vector3[] = []
  private prev: THREE.Vector3[] = []
  private seg: number[] = []
  private accumulator = 0
  private time = 0
  private readonly phase: number

  constructor(rest: Frame[], phase = 0) {
    this.phase = phase
    this.reset(rest)
  }

  reset(rest: Frame[]) {
    this.rest = rest.map((f) => f.p.clone())
    this.out = rest.map((f) => f.out.clone())
    this.across = rest.map((f) => f.across.clone())
    this.pos = rest.map((f) => f.p.clone())
    this.prev = rest.map((f) => f.p.clone())
    this.seg = rest.map((f, i) => (i === 0 ? 0 : f.p.distanceTo(rest[i - 1].p)))
  }

  /** Lift the tail away from the jacket: `speed` (m/s) at the tip, less toward the knot. */
  nudge(speed: number) {
    const n = this.pos.length
    for (let i = 1; i < n; i++) {
      const s = i / (n - 1)
      this.prev[i].addScaledVector(this.out[i], -speed * s * s * STEP)
    }
  }

  /** Advance by real elapsed time (fixed substeps, so behavior doesn't depend on frame rate). */
  advance(delta: number, breeze: boolean, push = 0) {
    this.accumulator = Math.min(this.accumulator + delta, STEP * MAX_STEPS)
    while (this.accumulator >= STEP) {
      this.step(breeze, push)
      this.accumulator -= STEP
      this.time += STEP
    }
  }

  points(): THREE.Vector3[] {
    return this.pos
  }

  /** `push`: extra acceleration at the tip along the face normal (m/s²). */
  private step(breeze: boolean, push: number) {
    const n = this.pos.length
    const acc = new THREE.Vector3()
    const vel = new THREE.Vector3()
    const t = this.time
    const gust = breeze ? Math.sin(t * 0.9 + this.phase) + 0.4 * Math.sin(t * 2.1 + this.phase * 1.7) : 0

    for (let i = 1; i < n; i++) {
      const s = i / (n - 1)
      const p = this.pos[i]
      const k = K_ROOT + (K_TIP - K_ROOT) * Math.sqrt(s)
      acc.copy(this.rest[i]).sub(p).multiplyScalar(k)
      acc.addScaledVector(this.out[i], (BREEZE * gust + push) * s * s)
      vel.copy(p).sub(this.prev[i]).multiplyScalar(DAMPING)
      this.prev[i].copy(p)
      p.add(vel).addScaledVector(acc, STEP * STEP)
    }
    this.lockSideways()

    // Keep segment lengths (the belt doesn't stretch); the knot end stays pinned.
    this.pos[0].copy(this.rest[0])
    const d = new THREE.Vector3()
    for (let it = 0; it < ITERATIONS; it++) {
      for (let i = 1; i < n; i++) {
        d.copy(this.pos[i]).sub(this.pos[i - 1])
        const len = d.length() || 1
        this.pos[i].copy(this.pos[i - 1]).addScaledVector(d, this.seg[i] / len)
      }
    }
    this.lockSideways()

    // Don't pass through the jacket behind the tail.
    const off = new THREE.Vector3()
    for (let i = 1; i < n; i++) {
      off.copy(this.pos[i]).sub(this.rest[i])
      const into = off.dot(this.out[i])
      if (into < -BACK_LIMIT) this.pos[i].addScaledVector(this.out[i], -BACK_LIMIT - into)
    }
  }

  /** Remove any displacement across the belt's width: a flat strap can't bend sideways. */
  private lockSideways() {
    const off = new THREE.Vector3()
    for (let i = 1; i < this.pos.length; i++) {
      off.copy(this.pos[i]).sub(this.rest[i])
      this.pos[i].addScaledVector(this.across[i], -off.dot(this.across[i]))
    }
  }
}
