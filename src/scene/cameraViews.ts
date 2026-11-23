import * as THREE from 'three'
import type { FocusTarget } from '../uiStore'
import { BELT_FRONT_DROP, WAIST_Y } from './beltLayout'

/** Where the camera sits and what it looks at. */
export interface CameraPose {
  position: THREE.Vector3
  target: THREE.Vector3
}

const pose = (position: [number, number, number], target: [number, number, number]): CameraPose => ({
  position: new THREE.Vector3(...position),
  target: new THREE.Vector3(...target),
})

/** Whole-body views from the view bar. The model faces +Z; +X is the viewer's right. */
export const VIEW_POSES = {
  start: pose([0.55, 1.15, 2.5], [0, WAIST_Y, 0]),
  front: pose([0, 1.1, 2.55], [0, WAIST_Y, 0]),
  side: pose([2.55, 1.1, 0], [0, WAIST_Y, 0]),
  back: pose([0, 1.1, -2.55], [0, WAIST_Y, 0]),
  knot: pose([0.18, WAIST_Y + 0.06 - BELT_FRONT_DROP, 0.95], [0, WAIST_Y - 0.06 - BELT_FRONT_DROP, 0.15]),
} satisfies Record<string, CameraPose>

export type ViewId = Exclude<keyof typeof VIEW_POSES, 'start'>

export const VIEW_BUTTONS: ReadonlyArray<{ id: ViewId; label: string }> = [
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'back', label: 'Back' },
  { id: 'knot', label: 'Knot' },
]

/** Close-ups for the part being edited in the panel. */
const TAIL_X = 0.07
const tailPose = (side: -1 | 1) =>
  pose([side * 0.2, WAIST_Y - 0.04 - BELT_FRONT_DROP, 0.95], [side * TAIL_X, WAIST_Y - 0.14 - BELT_FRONT_DROP, 0.17])

const FOCUS_POSES: Record<Exclude<FocusTarget, 'label'>, CameraPose> = {
  l: tailPose(-1),
  r: tailPose(1),
  chest: pose([0.3, WAIST_Y + 0.36, 0.95], [0.115, WAIST_Y + 0.27, 0.14]),
  hem: pose([-0.26, WAIST_Y - 0.1, 0.95], [-0.06, WAIST_Y - 0.19, 0.15]),
}

/** The brand label is sewn on one of the tails, so it uses that tail's close-up. */
export function focusPose(target: FocusTarget, logoTail: 'l' | 'r'): CameraPose {
  return FOCUS_POSES[target === 'label' ? logoTail : target]
}
