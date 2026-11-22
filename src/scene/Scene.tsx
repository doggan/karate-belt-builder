import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { useBeltStore } from '../store'
import { Belt } from './Belt'
import { Mannequin } from './Mannequin'
import { computeBeltLayout, WAIST_Y } from './beltLayout'
import { setSceneCanvas } from './canvasHandle'

export function Scene() {
  const config = useBeltStore((s) => s.config)
  const layout = useMemo(() => computeBeltLayout(config), [config])

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: [0.45, 1.2, 1.9], fov: 35, near: 0.05, far: 20 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ gl }) => setSceneCanvas(gl.domElement)}
    >
      <color attach="background" args={['#ebe8e2']} />

      <ambientLight intensity={0.25} />
      <directionalLight position={[1.5, 3, 2]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      {/* Local studio lighting — no network-loaded HDRI. */}
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2} position={[0, 3, 2]} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={1} position={[-3, 1.5, 0]} rotation-y={Math.PI / 2} scale={[3, 2, 1]} />
        <Lightformer form="rect" intensity={1} position={[3, 1.5, -1]} rotation-y={-Math.PI / 2} scale={[3, 2, 1]} />
      </Environment>

      <Mannequin body={layout.body} config={config} />
      <Belt layout={layout} config={config} />

      <ContactShadows position={[0, 0, 0]} scale={3} blur={2.5} opacity={0.45} far={1.5} />

      <OrbitControls
        target={[0, WAIST_Y, 0]}
        enablePan={false}
        enableDamping
        minDistance={0.35}
        maxDistance={3.5}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2 + 0.15}
      />
    </Canvas>
  )
}
