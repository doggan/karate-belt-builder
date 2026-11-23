import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useBeltStore } from '../store'
import { Belt } from './Belt'
import { DogiModel } from './DogiModel'
import { computeBeltLayout, WAIST_Y } from './beltLayout'
import { setSceneCanvas, setViewReset } from './canvasHandle'
import { useUiStore } from '../uiStore'

const CAMERA_START = new THREE.Vector3(0.55, 1.15, 2.5)
const TARGET_START = new THREE.Vector3(0, WAIST_Y, 0)
/** How far the view can be panned from the model (m), so it can't get lost off-screen. */
const PAN_BOUNDS = new THREE.Box3(new THREE.Vector3(-0.7, 0.1, -0.5), new THREE.Vector3(0.7, 1.8, 0.5))

export function Scene() {
  const config = useBeltStore((s) => s.config)
  const layout = useMemo(() => computeBeltLayout(config), [config])

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: CAMERA_START.toArray(), fov: 35, near: 0.05, far: 20 }}
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

/**
 * Orbit (left drag / one finger), zoom (wheel / pinch) and pan (right drag, shift+drag,
 * or two fingers). Panning is kept within PAN_BOUNDS, and "Reset view" restores the start.
 */
function CameraControls() {
  const ref = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)

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
    controls.addEventListener('change', clampPan)
    setViewReset(() => {
      camera.position.copy(CAMERA_START)
      controls.target.copy(TARGET_START)
      controls.update()
    })
    return () => {
      controls.removeEventListener('change', clampPan)
      setViewReset(null)
    }
  }, [camera])

  return (
    <OrbitControls
      ref={ref}
      makeDefault
      target={TARGET_START.toArray()}
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
