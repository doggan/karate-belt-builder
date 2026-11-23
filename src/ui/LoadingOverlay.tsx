import { useEffect, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { useUiStore } from '../uiStore'

/** How long the overlay takes to fade out once the scene is ready (ms); matches the CSS. */
const FADE_MS = 400

/** Covers the 3D view with a progress bar until the gi model has downloaded and the scene shows. */
export function LoadingOverlay() {
  const ready = useUiStore((s) => s.sceneReady)
  const { progress } = useProgress()
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!ready) return
    const id = window.setTimeout(() => setGone(true), FADE_MS)
    return () => window.clearTimeout(id)
  }, [ready])

  if (gone) return null
  const pct = ready ? 100 : Math.round(progress)
  return (
    <div className={ready ? 'loading-overlay done' : 'loading-overlay'} role="status" aria-live="polite">
      <div className="loading-card">
        <span>{ready ? 'Ready' : 'Loading…'}</span>
        <div className="loading-bar" aria-hidden="true">
          {/* Scaled, not resized: a transform animates off the main thread, so the bar keeps up
              with the number even while loading blocks it (a width transition stalls). */}
          <div className="loading-fill" style={{ transform: `scaleX(${Math.max(pct, 4) / 100})` }} />
        </div>
        <span className="loading-pct">{pct}%</span>
      </div>
    </div>
  )
}
