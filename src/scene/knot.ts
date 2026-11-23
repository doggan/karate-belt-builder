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
 *       ╱▔▔▔▔▔▔╲╭────╮       flap: comes up from behind the wraps, folds over their top
 *   ━━━╱ flap  ╱│    │━━━          edge and runs down to the right, under the band
 *   ━━╱╲      ╱ │band│━━━    band: also comes over the wraps' top edge, then bellies out
 *     ╱  ╲━━━━━━│    │             over the flap and rolls under below the wraps, so it
 *    ╱   ╱      ╰────╯╲            sits centered on the belt with the flap passing through
 *   ╱   ╱              ╲
 *
 * The flap strand carries on under the band and out at its lower right as the right
 * tail. The band strand, having rolled under, goes up behind the flap, folds over once
 * more out of sight and comes out from under the flap and the band as the left tail.
 *
 * What matters is how the knot reads from the front: compact, centered on the belt, the
 * tails leaving it symmetrically. The runs hidden inside it are only there to keep each
 * strand in one piece; they are squeezed narrow and do not try to be a faithful tying.
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

/** The flap's heading as seen from the front, below horizontal. */
const FLAP = deg(40)
/** How far the band leans from upright (its lower end toward the flap's side). */
const BAND_LEAN = deg(10)

// Layers, as heights of each pass's center line above the wrap's front surface, in belt
// thicknesses. Stacked like the real thing: the knot stands four layers proud of the wrap.
const LAYER = { underFlap: 0.5, back: 1.5, flap: 2.5 }
/** Both strands start by running up the back of both wraps, against the jacket. */
const BEHIND = -2.65

// Cloth bunches where the knot grips it. Widths are fractions of the belt's width.
const BAND_WIDTH = 0.8
/** The flap strand, from where it rounds the wraps' top edge to where its tail starts. */
const FLAP_WIDTH = 0.72
/** Runs hidden inside the knot, squeezed so they stay out of sight. */
const HIDDEN_WIDTH = 0.5

// Placement, in belt widths from the middle of the belt's front. The knot is centered on
// the belt: the band reaches as far above the wrap's center line as below it, and the
// tails leave the knot at the same height, one either side of it.
/** Center line of the band (the flap fills the space to its left). */
const BAND_X = 0.35
/** How far the band reaches below the wrap's center line (as far as it reaches above). */
const BAND_REACH = 0.69
/** A point the flap's center line passes through under the band: the middle of the band. */
const FLAP_THROUGH = { x: 0.5, y: -0.2 }
/** Where the right tail starts. (The left one starts where the band strand's hidden run leads.) */
const ROOT_X_RIGHT = 0.78
/**
 * Height at which both tails start: still just under the knot's edge, so the turn from
 * lying flat in the knot to heading out of it is hidden and only the tail's arc shows.
 */
const ROOT_Y = -0.35
/** How far forward each tail starts, in belt thicknesses. */
const ROOT_Z = { l: 1.1, r: 3.3 }
/** Samples along the free run from the knot to each tail root. */
const EXIT_STEPS = 20

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
  const settle = { angle: deg(20), radius: 6 * t }
  const overFront = { angle: Math.PI - overBack.angle - settle.angle, radius: 1.3 * t }
  const frontZ = 0.55 * t // where it comes off the top edge: lying on the wrap
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

  // Place it: the bends hug the wraps' top edge, and the center line (a straight diagonal
  // seen from the front) passes under the middle of the band.
  const offTopY = 0.495 * w + path.frames[offTop].p.y - path.frames[backTop].p.y
  path.anchor(offTop, new THREE.Vector3(FLAP_THROUGH.x * w - (offTopY - FLAP_THROUGH.y * w) / Math.tan(FLAP), offTopY, frontZ))
  // From here, still out of sight under the band, it curves out toward the tail root.

  // It stays bunched all the way out of the knot; the tail then spreads back to full
  // width gradually as it hangs (see `tailFrames`), so there is no visible step. Under
  // the band, where it turns out toward the tail, it is squeezed a little tighter still.
  const frames = path.frames
  const dist = arcLengths(frames)
  const squeezeFrom = dist.findIndex((d) => d >= dist[path.mark] - 0.3 * w)
  taper(frames, 0, squeezeFrom, FLAP_WIDTH, FLAP_WIDTH)
  taper(frames, squeezeFrom, path.mark, FLAP_WIDTH, HIDDEN_WIDTH)
  return finish(path, bend, 1, new THREE.Vector3(ROOT_X_RIGHT * w, ROOT_Y * w, ROOT_Z.r * t), FLAP_WIDTH)
}

/** The band strand: up behind the wraps, over their top edge, down around the flap, under the bottom roll, out to the left tail. */
function bandStrand(w: number, t: number, bend: Bend): KnotStrand {
  // The left tail's hidden run under the flap already heads the way the tail will hang.
  const underFlap = tailRootFrame(new THREE.Vector3(), -1)
  const tailward = new THREE.Vector3().crossVectors(underFlap.across, underFlap.out).setZ(0).normalize()

  // Seen from the side: up the back of the wraps, over their top edge like the flap, then
  // leaning forward to clear the flap, bellying out over it, and easing back in to a roll
  // that tucks under below the wraps.
  const overBack = { angle: deg(75), radius: 1.2 * t }
  const lean = deg(28)
  const overFront = { angle: Math.PI - overBack.angle - lean, radius: 1.3 * t }
  const tuck = deg(4) // how far the band leans back in toward the wrap below its belly
  const belly = { angle: lean + tuck, radius: 5 * t }
  const frontZ = 1.6 * t // where it comes off the top edge, already clear of the flap
  const top =
    (frontZ - BEHIND * t - overBack.radius * (1 - Math.cos(overBack.angle)) - overFront.radius * (Math.cos(overBack.angle) + Math.cos(lean))) /
    Math.sin(overBack.angle)

  // All these folds are about the wrap's own direction; the band's lean carries it
  // sideways as it goes around them.
  const rise = Math.cos(BAND_LEAN) // strap length → distance around these folds
  const path = new StrandPath(new THREE.Vector3(), new THREE.Vector3(-Math.sin(BAND_LEAN), Math.cos(BAND_LEAN), 0), new THREE.Vector3(0, 0, -1), X)
  path.flat(0.5 * w)
  const backTop = path.mark
  path.fold(X, -1, overBack.radius, overBack.angle)
  path.flat(top / rise)
  path.fold(X, -1, overFront.radius, overFront.angle)
  path.anchor(backTop, new THREE.Vector3(0, 0.495 * w, BEHIND * t))
  path.flat((6.5 * t) / rise) // far enough out that the tails can start their arc underneath it
  path.fold(X, -1, belly.radius, belly.angle)
  const front = path.mark
  // The roll's size and the run down to it follow from where the band must end up: as
  // far below the wrap's center line as its top is above, and back on the layer behind the flap.
  const here = path.position
  const rollRadius =
    (here.z - LAYER.back * t - Math.tan(tuck) * (here.y + BAND_REACH * w)) / (1 + Math.cos(tuck) - Math.tan(tuck) * (1 - Math.sin(tuck)))
  path.flat((here.y + BAND_REACH * w - rollRadius * (1 - Math.sin(tuck))) / Math.cos(tuck) / rise)
  path.fold(X, -1, rollRadius, Math.PI - tuck)
  const rolled = path.mark
  // Slide it sideways so its front crosses the wrap's center line at BAND_X.
  const belt = path.frames[front].p
  path.anchor(front, new THREE.Vector3(BAND_X * w - belt.y * Math.tan(BAND_LEAN), belt.y, belt.z))
  // Up behind the flap, bunched so it stays out of sight, to a fold that turns it back
  // down toward the left tail.
  path.flat(0.1 * w)
  const bunched = path.mark
  path.flat(0.36 * w, path.shearFor(path.axisTo(tailward)))
  path.fold(path.axisTo(tailward), 1, ((LAYER.back - LAYER.underFlap) * t) / 2)
  const turned = path.mark
  // Back to full width before it shows.
  path.flat(0.12 * w, path.slant * 0.75)
  const widened = path.mark

  taper(path.frames, 0, rolled, BAND_WIDTH, BAND_WIDTH)
  taper(path.frames, rolled, bunched, BAND_WIDTH, HIDDEN_WIDTH)
  taper(path.frames, bunched, turned, HIDDEN_WIDTH, HIDDEN_WIDTH)
  taper(path.frames, turned, widened, HIDDEN_WIDTH, 1)

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
