import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Decal } from '@react-three/drei'
import { CHEST_THREAD_HEX, type BeltConfig } from '../config/schema'
import { useUiStore } from '../uiStore'
import { hoverCursor, noRaycast, pick, pickSection } from './picking'
import { WAIST_Y, type Ellipse } from './beltLayout'
import { BODY_SHAPES, profileRadiusAt, type BodyShape } from './bodyShape'
import { drawChestArt } from './embroidery'
import { loadGlyphs, useFontsVersion } from './fonts'

const DOGI_WHITE = '#f6f5f0'
const SKIN = '#cfc8bd'
/** Width of one embroidered chest character (m), and where the column starts. */
const CHEST_CHAR_SIZE = 0.05
const CHEST_TOP_Y = WAIST_Y + 0.38

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
    <group name="mannequin" {...hoverCursor} onClick={pickSection('body')}>
      <mesh
        geometry={jacket}
        castShadow
        receiveShadow
        onClick={pick((e) => {
          // Front of the upper jacket → chest kanji; anywhere else → body shape.
          const chest = e.point.z > 0 && e.point.y > WAIST_Y + 0.15
          useUiStore.getState().focusPart(chest ? 'chest' : 'body')
        })}
      >
        <meshStandardMaterial color={DOGI_WHITE} roughness={0.95} />
        <ChestKanji key={jacket.uuid} a={a} shape={shape} config={config} />
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

interface ChestKanjiProps {
  a: number
  shape: BodyShape
  config: BeltConfig
}

/** Kanji embroidered on the wearer's left chest (the viewer's right, +x), reading top to bottom. */
function ChestKanji({ a, shape, config }: ChestKanjiProps) {
  const fontsVersion = useFontsVersion()
  const { show, text, font } = config.chest

  useEffect(() => {
    if (show) void loadGlyphs(font, text)
  }, [show, font, text])

  const art = useMemo(
    () => (show && text.trim() ? drawChestArt(text, CHEST_THREAD_HEX, font) : null),
    [show, text, font, fontsVersion],
  )
  useEffect(() => () => art?.dispose(), [art])

  const placement = useMemo(() => {
    if (!art) return null
    const height = CHEST_CHAR_SIZE * art.aspect
    const y = CHEST_TOP_Y - height / 2
    // Point on the elliptical jacket surface at that height; face the decal along its normal.
    const r = a * profileRadiusAt(shape.profile, y - WAIST_Y)
    const k = shape.depthRatio
    const x = r * 0.45
    const z = r * k * Math.sqrt(1 - (x / r) ** 2)
    const normal = new THREE.Vector3(x / (r * r), 0, z / (r * k) ** 2).normalize()
    return {
      position: [x, y, z] as [number, number, number],
      rotation: [0, Math.atan2(normal.x, normal.z), 0] as [number, number, number],
      scale: [CHEST_CHAR_SIZE, height, 0.1] as [number, number, number],
    }
  }, [art, a, shape])

  if (!art || !placement) return null
  return (
    <Decal position={placement.position} rotation={placement.rotation} scale={placement.scale} raycast={noRaycast}>
      <meshStandardMaterial
        map={art.map}
        bumpMap={art.bumpMap}
        bumpScale={2}
        transparent
        alphaTest={0.5}
        roughness={0.5}
        polygonOffset
        polygonOffsetFactor={-4}
        depthWrite={false}
      />
    </Decal>
  )
}
