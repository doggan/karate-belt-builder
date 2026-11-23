import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useBeltStore } from '../store'
import { Belt } from './Belt'
import { DogiModel } from './DogiModel'
import { computeBeltLayout } from './beltLayout'
import { setCameraFlight, setSceneCanvas } from './canvasHandle'
import { VIEW_POSES, type CameraPose } from './cameraViews'
import { useUiStore } from '../uiStore'

const START = VIEW_POSES.start
/** How long a glide to a preset view takes (s). */
const FLIGHT_SECONDS = 0.9
/** How far the view can be panned from the model (m), so it can't get lost off-screen. */
const PAN_BOUNDS = new THREE.Box3(new THREE.Vector3(-0.7, 0.1, -0.5), new THREE.Vector3(0.7, 1.8, 0.5))

export function Scene() {
  const config = useBeltStore((s) => s.config)
  const layout = useMemo(() => computeBeltLayout(config), [config])

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: START.position.toArray(), fov: 35, near: 0.05, far: 20 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ gl }) => setSceneCanvas(gl.domElement)}
    >
      <color attach="background" args={['#ebe8e2']} />

      <ambientLight intensity={0.25} />
      <directionalLight
        position={[1.5, 3, 2]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* Local studio lighting — no network-loaded HDRI. */}
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2} position={[0, 3, 2]} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={1} position={[-3, 1.5, 0]} rotation-y={Math.PI / 2} scale={[3, 2, 1]} />
        <Lightformer form="rect" intensity={1} position={[3, 1.5, -1]} rotation-y={-Math.PI / 2} scale={[3, 2, 1]} />
      </Environment>

      {/* The belt waits for the gi too, so everything appears together once loaded. */}
      <Suspense fallback={null}>
        <DogiModel layout={layout} config={config} />
        <Belt layout={layout} config={config} />
        <SceneReady />
      </Suspense>

      <ContactShadows position={[0, 0, 0]} scale={3} blur={2.5} opacity={0.45} far={1.5} />

      <CameraControls />
    </Canvas>
  )
}

/** Mounts only once everything in its Suspense boundary has loaded; tells the UI to drop the loader. */
function SceneReady() {
  useEffect(() => useUiStore.getState().setSceneReady(), [])
  return null
}

interface Flight {
  from: CameraPose
  to: CameraPose
  elapsed: number
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** The camera's offset from its target, as a sphere around it. */
const sphericalOf = (p: CameraPose) => new THREE.Spherical().setFromVector3(p.position.clone().sub(p.target))

/**
 * Orbit (left drag / one finger), zoom (wheel / pinch) and pan (right drag, shift+drag,
 * or two fingers). Panning is kept within PAN_BOUNDS. The view bar and the panel can ask
 * for a glide to a preset pose; grabbing the view cancels it.
 */
function CameraControls() {
  const ref = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const flight = useRef<Flight | null>(null)

  useEffect(() => {
    const controls = ref.current
    if (!controls) return
    const clampPan = () => {
      const clamped = controls.target.clone().clamp(PAN_BOUNDS.min, PAN_BOUNDS.max)
      const delta = clamped.sub(controls.target)
      if (delta.lengthSq() === 0) return
      controls.target.add(delta)
      camera.position.add(delta)
    }
    const cancelFlight = () => (flight.current = null)
    controls.addEventListener('change', clampPan)
    controls.addEventListener('start', cancelFlight)
    setCameraFlight((to) => {
      const from = { position: camera.position.clone(), target: controls.target.clone() }
      if (from.position.distanceTo(to.position) < 1e-3 && from.target.distanceTo(to.target) < 1e-3) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        flight.current = null
        camera.position.copy(to.position)
        controls.target.copy(to.target)
        controls.update()
        return
      }
      flight.current = { from, to, elapsed: 0 }
    })
    return () => {
      controls.removeEventListener('change', clampPan)
      controls.removeEventListener('start', cancelFlight)
      setCameraFlight(null)
    }
  }, [camera])

  // Glide around the subject rather than straight through it: the target moves in a line
  // while the camera swings around it (shortest way round), so front → back passes the side.
  useFrame((_, delta) => {
    const f = flight.current
    const controls = ref.current
    if (!f || !controls) return
    f.elapsed += delta
    const t = easeInOutCubic(Math.min(1, f.elapsed / FLIGHT_SECONDS))
    const a = sphericalOf(f.from)
    const b = sphericalOf(f.to)
    let dTheta = b.theta - a.theta
    if (dTheta > Math.PI) dTheta -= 2 * Math.PI
    if (dTheta < -Math.PI) dTheta += 2 * Math.PI
    const s = new THREE.Spherical(
      THREE.MathUtils.lerp(a.radius, b.radius, t),
      THREE.MathUtils.lerp(a.phi, b.phi, t),
      a.theta + dTheta * t,
    )
    controls.target.lerpVectors(f.from.target, f.to.target, t)
    camera.position.setFromSpherical(s).add(controls.target)
    controls.update()
    if (t >= 1) flight.current = null
  })

  return (
    <OrbitControls
      ref={ref}
      makeDefault
      target={START.target.toArray()}
      enablePan
      screenSpacePanning
      enableDamping
      minDistance={0.35}
      maxDistance={3.5}
      minPolarAngle={0.2}
      maxPolarAngle={Math.PI / 2 + 0.15}
    />
  )
}
