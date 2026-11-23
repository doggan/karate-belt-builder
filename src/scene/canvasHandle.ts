import { useBeltStore } from '../store'
import type { FocusTarget } from '../uiStore'
import { focusPose, VIEW_POSES, type CameraPose, type ViewId } from './cameraViews'

/** The WebGL canvas, exposed so UI outside the R3F tree can take screenshots. */
let sceneCanvas: HTMLCanvasElement | null = null

export function setSceneCanvas(canvas: HTMLCanvasElement) {
  sceneCanvas = canvas
}

export function downloadScreenshot(filename: string) {
  if (!sceneCanvas) return
  sceneCanvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}

type Flight = (pose: CameraPose) => void

let flight: Flight | null = null
/** The panel group the camera last flew to, so moving between its inputs doesn't re-fly. */
let lastFocus: FocusTarget | null = null
let skipFocus = false

/** Registered by the camera controls inside the canvas. */
export function setCameraFlight(fn: Flight | null) {
  flight = fn
}

/** Glide to one of the whole-body views (or the starting framing). */
export function flyToView(id: ViewId) {
  lastFocus = null
  flight?.(VIEW_POSES[id])
}

/** Glide to a close-up of the part being edited in the panel (once per group, not per input). */
export function focusCamera(target: FocusTarget) {
  if (skipFocus || target === lastFocus) return
  lastFocus = target
  flight?.(focusPose(target, useBeltStore.getState().config))
}

/** Focus a panel input without moving the camera (e.g. after the part was clicked in the 3D view). */
export function focusWithoutCamera(el: HTMLElement | null | undefined) {
  skipFocus = true
  try {
    el?.focus({ preventScroll: true })
  } finally {
    skipFocus = false
  }
}
