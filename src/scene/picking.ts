import type { ThreeEvent } from '@react-three/fiber'
import type { TailSide } from '../config/schema'
import { useUiStore, type SectionId } from '../uiStore'

/** A press that moves more than this many pixels is a camera drag, not a click. */
const CLICK_TOLERANCE_PX = 5

/** Click handler for a part of the model; ignores drags and stops propagation to parts behind it. */
export function pick(handler: (e: ThreeEvent<MouseEvent>) => void) {
  return (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > CLICK_TOLERANCE_PX) return
    handler(e)
  }
}

/** Shorthand: clicking this part opens a panel section. */
export function pickSection(id: SectionId, tail?: TailSide) {
  return pick(() => useUiStore.getState().focusPart(id, tail))
}

/** Pointer cursor while hovering clickable parts. */
export const hoverCursor = {
  onPointerOver: (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    document.body.style.cursor = 'pointer'
  },
  onPointerOut: () => {
    document.body.style.cursor = ''
  },
}

/** For overlays (embroidery, decals) that should let clicks through to the part underneath. */
export const noRaycast = () => null
