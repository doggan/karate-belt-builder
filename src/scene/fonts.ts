import { useSyncExternalStore } from 'react'
import { font, type FontId } from '../config/schema'

/**
 * Japanese web fonts are served by Google Fonts in unicode-range slices (see
 * index.html), so only the glyphs actually typed get downloaded. Canvas drawing
 * doesn't wait for fonts, so we load the needed glyphs explicitly and bump a
 * version number whenever any font finishes loading; canvases redraw on change.
 */

const CSS_WEIGHT: Record<FontId, number> = { mincho: 700, gothic: 700, brush: 400 }
const FALLBACK: Record<FontId, string> = { mincho: 'serif', gothic: 'sans-serif', brush: 'serif' }

export function canvasFont(id: FontId, px: number): string {
  return `${CSS_WEIGHT[id]} ${Math.round(px)}px "${font(id).family}", ${FALLBACK[id]}`
}

let version = 0
const listeners = new Set<() => void>()
const bump = () => {
  version++
  listeners.forEach((l) => l())
}

if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener('loadingdone', bump)
}

/** Load the glyphs for `text` in font `id`. Resolves (never rejects) when done. */
export async function loadGlyphs(id: FontId, text: string): Promise<void> {
  if (!text || typeof document === 'undefined' || !document.fonts) return
  try {
    const faces = await document.fonts.load(canvasFont(id, 64), text)
    if (faces.length) bump()
  } catch {
    // Offline or blocked: canvases fall back to the system font.
  }
}

/** A number that changes whenever a web font finishes loading. */
export function useFontsVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
  )
}
