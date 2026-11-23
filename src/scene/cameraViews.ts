import * as THREE from 'three'
import type { BeltConfig } from '../config/schema'
import type { FocusTarget } from '../uiStore'
import { BELT_FRONT_DROP, computeBeltLayout, WAIST_Y } from './beltLayout'
import { tailEndLayout } from './embroidery'

/** Where the camera sits and what it looks at. */
export interface CameraPose {
  position: THREE.Vector3
  target: THREE.Vector3
}

const pose = (position: [number, number, number], target: [number, number, number]): CameraPose => ({
  position: new THREE.Vector3(...position),
  target: new THREE.Vector3(...target),
})

/** The whole gi, head to foot (it stands ~1.6 m tall), fits the 35° field of view from here (m). */
const FULL_BODY_DISTANCE = 3.2
const BODY_CENTER: [number, number, number] = [0, 0.85, 0]
/** Seen from `degrees` round from the front (positive = toward the viewer's right), level with the chest. */
const around = (degrees: number, distance: number, target: [number, number, number]) => {
  const a = THREE.MathUtils.degToRad(degrees)
  return pose([distance * Math.sin(a), target[1] + 0.15, distance * Math.cos(a)], target)
}

/** Views from the view bar. The model faces +Z; +X is the viewer's right. */
export const VIEW_POSES = {
  /** On load, and "Default": from the front, turned a little so the belt reads in 3D. */
  start: around(25, 2.9, [0, 0.92, 0]),
  front: around(0, FULL_BODY_DISTANCE, BODY_CENTER),
  side: around(90, FULL_BODY_DISTANCE, BODY_CENTER),
  back: around(180, FULL_BODY_DISTANCE, BODY_CENTER),
  knot: pose([0.18, WAIST_Y + 0.06 - BELT_FRONT_DROP, 0.95], [0, WAIST_Y - 0.06 - BELT_FRONT_DROP, 0.15]),
} satisfies Record<string, CameraPose>

export type ViewId = keyof typeof VIEW_POSES

export const VIEW_BUTTONS: ReadonlyArray<{ id: ViewId; label: string }> = [
  { id: 'start', label: 'Default' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'back', label: 'Back' },
  { id: 'knot', label: 'Knot' },
]

/** Close-ups for the part being edited in the panel. */
const TAIL_X = 0.07
const tailPose = (side: -1 | 1) =>
  pose([side * 0.2, WAIST_Y - 0.04 - BELT_FRONT_DROP, 0.95], [side * TAIL_X, WAIST_Y - 0.14 - BELT_FRONT_DROP, 0.17])

const FOCUS_POSES: Record<Exclude<FocusTarget, 'label' | 'stripes'>, CameraPose> = {
  l: tailPose(-1),
  r: tailPose(1),
  chest: pose([0.3, WAIST_Y + 0.36, 0.95], [0.115, WAIST_Y + 0.27, 0.14]),
  hem: pose([-0.26, WAIST_Y - 0.1, 0.95], [-0.06, WAIST_Y - 0.19, 0.15]),
}

/**
 * Close-up of the stripes, down by the end of their tail. Roughly where the hanging tail
 * puts them: it leans out ~19° from plumb below the knot.
 */
function stripesPose(config: BeltConfig): CameraPose {
  const { width, tailLength } = computeBeltLayout(config)
  const { tail, count } = config.stripes
  const bands = tailEndLayout(width, config.logo && config.logoTail === tail, Math.max(1, count)).stripes
  const fromKnot = tailLength - (bands[0].near + bands[bands.length - 1].far) / 2
  const side = tail === 'l' ? -1 : 1
  const target: [number, number, number] = [side * (0.035 + 0.33 * fromKnot), WAIST_Y - BELT_FRONT_DROP - 0.02 - 0.95 * fromKnot, 0.2]
  return pose([target[0] + side * 0.12, target[1] + 0.08, 0.9], target)
}

/** The brand label is sewn on one of the tails, so it uses that tail's close-up. */
export function focusPose(target: FocusTarget, config: BeltConfig): CameraPose {
  if (target === 'stripes') return stripesPose(config)
  return FOCUS_POSES[target === 'label' ? config.logoTail : target]
}
