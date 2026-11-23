import { flyToView } from './scene/canvasHandle'
import { VIEW_BUTTONS } from './scene/cameraViews'
import { Scene } from './scene/Scene'
import { ControlPanel } from './ui/ControlPanel'
import { LoadingOverlay } from './ui/LoadingOverlay'
import { SceneErrorBoundary } from './ui/SceneErrorBoundary'
import { ViewActions } from './ui/ViewActions'

export default function App() {
  return (
    <div className="app">
      <main className="viewport">
        <SceneErrorBoundary>
          <Scene />
        </SceneErrorBoundary>
        <LoadingOverlay />
        <nav className="view-bar" aria-label="Camera views">
          <span className="view-bar-icon" title="Camera views" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </span>
          {VIEW_BUTTONS.map((v) => (
            <button key={v.id} type="button" onClick={() => flyToView(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        <ViewActions />
      </main>
      <ControlPanel />
    </div>
  )
}
