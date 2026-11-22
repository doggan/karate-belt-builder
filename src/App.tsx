import { resetView } from './scene/canvasHandle'
import { Scene } from './scene/Scene'
import { ControlPanel } from './ui/ControlPanel'
import { LoadingOverlay } from './ui/LoadingOverlay'

export default function App() {
  return (
    <div className="app">
      <main className="viewport">
        <Scene />
        <LoadingOverlay />
        <button type="button" className="view-reset" onClick={resetView}>
          Reset view
        </button>
      </main>
      <ControlPanel />
    </div>
  )
}
