import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Decal } from '@react-three/drei'
import { patchStyle, type BeltConfig } from '../config/schema'
import { WAIST_Y, type Ellipse } from './beltLayout'
import { BODY_SHAPES, CHEST_HEIGHT } from './bodyShape'
import { drawPatchArt } from './embroidery'
import { loadGlyphs, useFontsVersion } from './fonts'

const DOGI_WHITE = '#f6f5f0'
const SKIN = '#cfc8bd'
const PATCH_SIZE = 0.09

interface MannequinProps {
  body: Ellipse
  config: BeltConfig
}

/** Placeholder body — a real dogi model replaces this in phase 3. */
export function Mannequin({ body, config }: MannequinProps) {
  const { a } = body
  const shape = BODY_SHAPES[config.build]

  const jacket = useMemo(() => {
    const points = shape.profile.map(([r, y]) => new THREE.Vector2(r * a, WAIST_Y + y))
    const geometry = new THREE.LatheGeometry(points, 96)
    // Bake the elliptical cross-section into the geometry (not a mesh scale) so the
    // chest patch decal projects without distortion.
    geometry.scale(1, 1, shape.depthRatio)
    return geometry
  }, [a, shape])
  useEffect(() => () => jacket.dispose(), [jacket])

  const shoulderX = a * shape.shoulder + 0.035
  const shoulderY = WAIST_Y + 0.4
  const armLength = 0.5
  const armTilt = THREE.MathUtils.degToRad(12)
  const legRadius = a * (config.build === 'heavy' ? 0.52 : 0.48)

  return (
    <group name="mannequin">
      <mesh geometry={jacket} castShadow receiveShadow>
        <meshStandardMaterial color={DOGI_WHITE} roughness={0.95} />
        <ChestPatch key={jacket.uuid} a={a} chest={shape.chest} depthRatio={shape.depthRatio} config={config} />
      </mesh>

      {/* Arms (sleeves) */}
      {([-1, 1] as const).map((side) => (
        <mesh
          key={side}
          position={[side * (shoulderX + Math.sin(armTilt) * armLength * 0.5), shoulderY - Math.cos(armTilt) * armLength * 0.5, 0]}
          rotation={[0, 0, side * armTilt]}
          castShadow
        >
          <capsuleGeometry args={[0.052, armLength, 8, 24]} />
          <meshStandardMaterial color={DOGI_WHITE} roughness={0.95} />
        </mesh>
      ))}

      {/* Legs (pants) */}
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={[side * a * 0.5, (WAIST_Y - 0.2) / 2, 0]} castShadow>
          <cylinderGeometry args={[legRadius, legRadius * 1.12, WAIST_Y - 0.2, 32]} />
          <meshStandardMaterial color={DOGI_WHITE} roughness={0.95} />
        </mesh>
      ))}

      {/* Head */}
      <mesh position={[0, WAIST_Y + 0.72, 0]} castShadow>
        <sphereGeometry args={[0.1, 32, 24]} />
        <meshStandardMaterial color={SKIN} roughness={0.6} />
      </mesh>
    </group>
  )
}

interface ChestPatchProps {
  a: number
  chest: number
  depthRatio: number
  config: BeltConfig
}

/** Embroidered patch on the wearer's left chest (the viewer's right, +x). */
function ChestPatch({ a, chest, depthRatio, config }: ChestPatchProps) {
  const fontsVersion = useFontsVersion()
  const style = patchStyle(config.patch)
  const text = config.patchText

  useEffect(() => {
    void loadGlyphs('mincho', text)
  }, [text])

  const art = useMemo(
    () => (style.id === 'none' ? null : drawPatchArt(style, text)),
    [style.id, text, fontsVersion],
  )
  useEffect(() => () => art?.dispose(), [art])

  const placement = useMemo(() => {
    // Point on the elliptical chest surface, then face the decal along the surface normal.
    const r = a * chest
    const x = r * 0.48
    const z = r * depthRatio * Math.sqrt(1 - (x / r) ** 2)
    const normal = new THREE.Vector3(x / (r * r), 0, z / (r * depthRatio) ** 2).normalize()
    return {
      position: [x, WAIST_Y + CHEST_HEIGHT, z] as [number, number, number],
      rotation: [0, Math.atan2(normal.x, normal.z), 0] as [number, number, number],
    }
  }, [a, chest, depthRatio])

  if (!art) return null
  return (
    <Decal position={placement.position} rotation={placement.rotation} scale={[PATCH_SIZE, PATCH_SIZE, 0.08]}>
      <meshStandardMaterial
        map={art.map}
        bumpMap={art.bumpMap}
        bumpScale={2}
        transparent
        alphaTest={0.1}
        roughness={0.6}
        polygonOffset
        polygonOffsetFactor={-4}
        depthWrite={false}
      />
    </Decal>
  )
}
