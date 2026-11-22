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

let viewReset: (() => void) | null = null

export function setViewReset(fn: (() => void) | null) {
  viewReset = fn
}

/** Put the camera back to its starting position and framing. */
export function resetView() {
  viewReset?.()
}
