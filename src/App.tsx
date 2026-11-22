import { resetView } from './scene/canvasHandle'
import { Scene } from './scene/Scene'
import { ControlPanel } from './ui/ControlPanel'

export default function App() {
  return (
    <div className="app">
      <main className="viewport">
        <Scene />
        <button type="button" className="view-reset" onClick={resetView}>
          Reset view
        </button>
      </main>
      <ControlPanel />
    </div>
  )
}
