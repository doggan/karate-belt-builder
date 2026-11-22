import { Scene } from './scene/Scene'
import { ControlPanel } from './ui/ControlPanel'

export default function App() {
  return (
    <div className="app">
      <main className="viewport">
        <Scene />
      </main>
      <ControlPanel />
    </div>
  )
}
