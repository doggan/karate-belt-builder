import { flyToView, resetView } from './scene/canvasHandle'
import { VIEW_BUTTONS } from './scene/cameraViews'
import { Scene } from './scene/Scene'
import { ControlPanel } from './ui/ControlPanel'
import { LoadingOverlay } from './ui/LoadingOverlay'

export default function App() {
  return (
    <div className="app">
      <main className="viewport">
        <Scene />
        <LoadingOverlay />
        <nav className="view-bar" aria-label="Camera views">
          {VIEW_BUTTONS.map((v) => (
            <button key={v.id} type="button" onClick={() => flyToView(v.id)}>
              {v.label}
            </button>
          ))}
          <button type="button" className="view-reset" onClick={resetView} title="Reset view" aria-label="Reset view">
            ↺
          </button>
        </nav>
      </main>
      <ControlPanel />
    </div>
  )
}
