import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/**
 * Catches a failure in the 3D view (most often WebGL being unavailable or blocked, e.g. by a
 * browser's privacy settings) so it doesn't take the whole page down with it: the options
 * panel keeps working, and the view explains what happened instead of going blank.
 */
export class SceneErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('3D view failed:', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const webgl = /webgl|context/i.test(error.message)
    return (
      <div className="scene-error" role="alert">
        <p className="scene-error-title">The 3D view couldn't start</p>
        <p>
          {webgl
            ? 'Your browser didn’t allow WebGL, which the 3D view needs. If you use Brave, try turning Shields off for this site (or allowing fingerprinting), or make sure hardware acceleration is on, then reload.'
            : 'Something went wrong while drawing the belt. Reloading the page may help.'}
        </p>
        <p className="scene-error-detail">{error.message}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
