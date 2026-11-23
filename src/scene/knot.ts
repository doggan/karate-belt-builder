import * as THREE from 'three'
import { WAIST_Y, type Ellipse } from './beltLayout'
import type { Frame, RibbonOptions } from './ribbon'
import { StrandPath, arcLengths } from './strand'
import { tailRootFrame } from './tailShape'

/**
 * A karate square knot, modelled as the two ends of the belt: each is one continuous
 * strand that leaves the wrap, runs through the knot and comes out as a tail. Seen
 * from the front (compare docs/knot-reference.jpg):
 *
 *        ╱▔▔▔▔▔▔▔╲▁          flap: comes up from behind the wraps, folds over their top
 *   ━━━━╱  flap  ╱ ╲╲━━━━          edge and runs down to the right, under the band
 *   ━━━╱╲       ╱band╲━━━    band: the wrap's outer layer, folded down along a diagonal
 *      ╱  ╲━━━━╱│    │             crease in front of the flap, then rolled under and
 *     ╱   ╱     ╰────╯╲            back up behind it
 *    ╱   ╱              ╲
 *
 * The flap strand carries on under the band and out at its lower right as the right
 * tail. The band strand, having gone up behind the flap, folds over once more out of
 * sight and comes out from under the flap as the left tail.
 *
 * The knot is laid out flat in "knot space" (x along the wrap toward the viewer's
 * right, y up from the wrap's center line, z out from the wrap's front surface) and
 * then bent around the waist, so it hugs the wrap at every waist size.
 */
export interface KnotStrand {
  /** Frames in knot space, from where the strand leaves the wrap to where its tail starts. */
  frames: Frame[]
  /** Bends knot-space vertices around the waist; pass to `buildRibbon`. */
  warp: NonNullable<RibbonOptions['warp']>
  /** Where the tail starts, in world space: the strand's last frame once bent. */
  root: Frame
  /** Length of the strand (m). */
  length: number
}

export interface Knot {
  l: KnotStrand
  r: KnotStrand
}

const deg = THREE.MathUtils.degToRad
const X = new THREE.Vector3(1, 0, 0)

// Angles of the knot as seen from the front.
/** The band's diagonal crease, below horizontal. 45° turns the sideways wrap into a vertical band. */
const CREASE = deg(45)
/** The flap's heading, below horizontal. */
const FLAP = deg(41)
/** Tilt of the roll at the band's lower end (its right end sits higher). */
const ROLL_TILT = deg(16)
/** Heading of the left tail's hidden run under the flap, from vertical. */
const UNDER_FLAP = deg(36)

// Layers, as heights of each pass's center line above the wrap's front surface, in belt
// thicknesses. Stacked like the real thing: the knot stands four layers proud of the wrap.
const LAYER = { lead: 0.5, underFlap: 0.5, back: 1.65, flap: 2.8, band: 3.95 }
/** The band strand starts out sunk inside the wrap it peels away from. */
const SUNK = -0.55
/** The flap strand's run up the back of both wraps, against the jacket. */
const BEHIND = -2.65

/** Where each tail starts: below the knot, level with each other (belt widths / thicknesses). */
const ROOT_Y = -1.1
const ROOT_X_RIGHT = 1.2
const ROOT_Z = { l: 1.4, r: 2.8 }
/** Width of the flap where it rounds the wraps' top edge, as a fraction of the belt's. */
const FLAP_WIDTH = 0.75
/** The right tail squeezes out through the band's loop, so it starts bunched. */
const ROOT_WIDTH_RIGHT = 0.5
/** Samples along the free run from the knot to each tail root. */
const EXIT_STEPS = 14

/**
 * Maps knot space onto the waist: x becomes distance around the wrap's center line
 * (an ellipse), z distance out from its front surface.
 */
function waistBend(wrap: Ellipse, thickness: number) {
  const { a, b } = wrap
  const SAMPLES = 48
  const MAX_ANGLE = 1.4
  const arc = new Float64Array(SAMPLES + 1)
  for (let i = 1; i <= SAMPLES; i++) {
    const mid = (MAX_ANGLE * (i - 0.5)) / SAMPLES
    arc[i] = arc[i - 1] + (Math.hypot(a * Math.cos(mid), b * Math.sin(mid)) * MAX_ANGLE) / SAMPLES
  }
  /** Angle around the ellipse (0 = front) at distance x along it. */
  const angleAt = (x: number) => {
    const s = Math.min(Math.abs(x), arc[SAMPLES])
    let i = Math.min(SAMPLES - 1, Math.floor((s / arc[SAMPLES]) * SAMPLES))
    while (i > 0 && arc[i] > s) i--
    while (i < SAMPLES - 1 && arc[i + 1] < s) i++
    return (Math.sign(x) * MAX_ANGLE * (i + (s - arc[i]) / (arc[i + 1] - arc[i]))) / SAMPLES
  }
  /** How far the wrap's outward normal has turned from straight ahead at distance x. */
  const yawAt = (x: number) => {
    const angle = angleAt(x)
    return Math.atan2(b * Math.sin(angle), a * Math.cos(angle))
  }
  const turn = (v: THREE.Vector3, yaw: number) => {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    return v.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)
  }
  const point = (v: THREE.Vector3) => {
    const angle = angleAt(v.x)
    const yaw = Math.atan2(b * Math.sin(angle), a * Math.cos(angle))
    const reach = thickness / 2 + v.z
    return v.set(a * Math.sin(angle) + Math.sin(yaw) * reach, WAIST_Y - 0.0015 + v.y, b * Math.cos(angle) + Math.cos(yaw) * reach)
  }
  return { point, yawAt, turn }
}

type Bend = ReturnType<typeof waistBend>

/** Linear ramp of `Frame.width` between two frames of a strand, by distance along it. */
function taper(frames: Frame[], from: number, to: number, widthFrom: number, widthTo: number) {
  const dist = arcLengths(frames)
  const span = dist[to] - dist[from] || 1
  for (let i = from; i <= to; i++) frames[i].width = widthFrom + ((widthTo - widthFrom) * (dist[i] - dist[from])) / span
}

/**
 * Ends a strand on its tail root and prepares it for meshing. The root is a fixed
 * world-space frame facing the viewer, so the last stretch eases from following the
 * waist's curve to that frame.
 */
function finish(path: StrandPath, bend: Bend, side: 1 | -1, rootKnot: THREE.Vector3, rootWidth: number): KnotStrand {
  const yaw = bend.yawAt(rootKnot.x)
  const root = tailRootFrame(bend.point(rootKnot.clone()), side, rootWidth)
  const exitFrom = path.mark
  const widthFrom = path.frames[exitFrom].width ?? 1
  path.connect({ p: rootKnot, across: bend.turn(root.across.clone(), -yaw), out: bend.turn(root.out.clone(), -yaw) }, EXIT_STEPS)
  const frames = path.frames
  const last = frames.length - 1
  taper(frames, exitFrom, last, widthFrom, rootWidth)

  // Up to `exitFrom` every vertex is bent around the waist. From there to the root the
  // bend gives way to moving each cross-section rigidly, which leaves the last one flat:
  // exactly the tail's first cross-section.
  const centers = frames.map((f) => bend.point(f.p.clone()))
  const yaws = frames.map((f) => bend.yawAt(f.p.x))
  const rigid = new THREE.Vector3()
  const rigidNormal = new THREE.Vector3()
  const warp: KnotStrand['warp'] = (position, normal, i) => {
    const k = i <= exitFrom ? 0 : THREE.MathUtils.smoothstep(i, exitFrom, last)
    if (k > 0) {
      bend.turn(rigid.copy(position).sub(frames[i].p), yaws[i]).add(centers[i])
      bend.turn(rigidNormal.copy(normal), yaws[i])
    }
    bend.turn(normal, bend.yawAt(position.x))
    bend.point(position)
    if (k > 0) {
      position.lerp(rigid, k)
      normal.lerp(rigidNormal, k).normalize()
    }
  }
  return { frames, warp, root, length: arcLengths(frames)[last] }
}

/** The flap strand: up behind the wraps, over their top edge, down across the front, out to the right tail. */
function flapStrand(w: number, t: number, bend: Bend): KnotStrand {
  // Seen from the side the strap goes up the back of the wraps, rounds their top edge in
  // two bends with a short run between, and comes down the front leaning forward as it
  // climbs onto the layers beneath the band. All these folds are about the wrap's own
  // direction, so the strap's diagonal heading carries it sideways the whole time.
  const overBack = { angle: deg(75), radius: 1.2 * t }
  const overFront = { angle: deg(95), radius: 1.3 * t }
  const settle = { angle: deg(10), radius: 6 * t }
  const frontZ = 1.6 * t // where it comes off the top edge, clear of the band's lead-in
  const rise = Math.sin(FLAP) // strap length → distance around these folds
  const top =
    (frontZ - BEHIND * t - overBack.radius * (1 - Math.cos(overBack.angle)) - overFront.radius * (Math.cos(overBack.angle) + Math.cos(settle.angle))) /
    Math.sin(overBack.angle)
  const climb = (LAYER.flap * t - frontZ - settle.radius * (1 - Math.cos(settle.angle))) / Math.sin(settle.angle)

  const path = new StrandPath(new THREE.Vector3(), new THREE.Vector3(Math.cos(FLAP), Math.sin(FLAP), 0), new THREE.Vector3(0, 0, -1), X)
  path.flat(0.7 * w)
  const backTop = path.mark
  path.fold(X, -1, overBack.radius, overBack.angle)
  path.flat(top / rise)
  path.fold(X, -1, overFront.radius, overFront.angle)
  const offTop = path.mark
  path.flat(climb / rise)
  path.fold(X, -1, settle.radius, settle.angle)
  path.flat(0.95 * w, 0)

  // Place it: the bends hug the wraps' top edge, and the center line (a straight diagonal
  // seen from the front) is aimed at the band's lower right corner.
  const aim = new THREE.Vector2(1.0 * w, -0.89 * w)
  const offTopY = 0.495 * w + path.frames[offTop].p.y - path.frames[backTop].p.y
  path.anchor(offTop, new THREE.Vector3(aim.x - (offTopY - aim.y) / Math.tan(FLAP), offTopY, frontZ))

  // The cloth is cinched where it rounds the wraps, and bunches further as it is pulled
  // through the band's loop.
  taper(path.frames, 0, offTop, FLAP_WIDTH, FLAP_WIDTH)
  taper(path.frames, offTop, path.mark, FLAP_WIDTH, ROOT_WIDTH_RIGHT)
  return finish(path, bend, 1, new THREE.Vector3(ROOT_X_RIGHT * w, ROOT_Y * w, ROOT_Z.r * t), ROOT_WIDTH_RIGHT)
}

/** The band strand: out of the wrap, folded down over the flap, rolled under, up the back, out to the left tail. */
function bandStrand(w: number, t: number, bend: Bend): KnotStrand {
  const crease = new THREE.Vector3(Math.cos(CREASE), -Math.sin(CREASE), 0)
  const roll = new THREE.Vector3(Math.cos(ROLL_TILT), Math.sin(ROLL_TILT), 0)
  const underFlap = new THREE.Vector3(-Math.sin(UNDER_FLAP), -Math.cos(UNDER_FLAP), 0)

  // Lift out of the wrap's surface along the line of the crease.
  const lift = { angle: deg(40), radius: 0 }
  lift.radius = ((LAYER.lead - SUNK) * t) / (2 * (1 - Math.cos(lift.angle)))

  const path = new StrandPath(new THREE.Vector3(0, 0, SUNK * t), X, new THREE.Vector3(0, 0, -1), crease)
  path.fold(crease, -1, lift.radius, lift.angle)
  path.fold(crease, 1, lift.radius, lift.angle)
  const creaseStart = path.mark
  // The diagonal fold: forward and down, around the flap and the layers behind it.
  path.fold(crease, -1, ((LAYER.band - LAYER.lead) * t) / 2)
  // The band, then the roll under its lower end.
  path.flat(0.7 * w, path.shearFor(roll))
  path.fold(roll, -1, ((LAYER.band - LAYER.back) * t) / 2)
  const rolled = path.mark
  // Up behind the flap, bunched so it stays out of sight, to a fold that turns it back down.
  path.flat(0.3 * w)
  const bunched = path.mark
  path.flat(0.98 * w, path.shearFor(path.axisTo(underFlap)))
  path.fold(path.axisTo(underFlap), 1, ((LAYER.back - LAYER.underFlap) * t) / 2)
  const turned = path.mark
  // Back to full width before it shows; the rows straighten over the whole run.
  path.flat(0.12 * w, path.slant * (0.33 / 0.45))
  const widened = path.mark
  path.flat(0.33 * w, 0)

  // Place it by where the crease begins.
  const creaseTop = -0.27 * w // x where the crease meets the lead-in's upper edge
  const leadY = 0.05 * w // the lead-in rides slightly high, pulled up by the knot
  path.anchor(creaseStart, new THREE.Vector3(creaseTop + (0.5 * w) / Math.tan(CREASE), leadY, LAYER.lead * t))

  taper(path.frames, rolled, bunched, 1, 0.55)
  taper(path.frames, bunched, turned, 0.55, 0.55)
  taper(path.frames, turned, widened, 0.55, 1)

  // The tail root lies straight on from the hidden run, so the strap leaves the knot without a kink.
  const end = path.position
  const heading = path.heading
  const rootX = end.x + ((ROOT_Y * w - end.y) * heading.x) / heading.y
  return finish(path, bend, -1, new THREE.Vector3(rootX, ROOT_Y * w, ROOT_Z.l * t), 1)
}

/** Both strands of the knot for a belt whose outer wrap follows `wrap`. */
export function buildKnot(wrap: Ellipse, width: number, thickness: number): Knot {
  const bend = waistBend(wrap, thickness)
  return { l: bandStrand(width, thickness, bend), r: flapStrand(width, thickness, bend) }
}
