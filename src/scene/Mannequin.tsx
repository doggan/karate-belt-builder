import { useMemo } from 'react'
import * as THREE from 'three'
import { BODY_DEPTH_RATIO, WAIST_Y, type Ellipse } from './beltLayout'

const DOGI_WHITE = '#f6f5f0'
const SKIN = '#cfc8bd'

/**
 * Jacket silhouette as (radius multiplier of waist half-width, height above waist).
 * Placeholder only — a real dogi model replaces this in phase 3.
 */
const JACKET_PROFILE: Array<[number, number]> = [
  [0, -0.3],
  [1.06, -0.3],
  [1.07, -0.27],
  [1.04, -0.18],
  [1.0, -0.08],
  [1.0, 0.08],
  [1.06, 0.18],
  [1.2, 0.3],
  [1.3, 0.4],
  [1.3, 0.45],
  [1.1, 0.5],
  [0.55, 0.53],
  [0.36, 0.55],
  [0.34, 0.62],
  [0, 0.62],
]

export function Mannequin({ body }: { body: Ellipse }) {
  const { a } = body

  const jacket = useMemo(() => {
    const points = JACKET_PROFILE.map(([r, y]) => new THREE.Vector2(r * a, WAIST_Y + y))
    return new THREE.LatheGeometry(points, 64)
  }, [a])

  const shoulderX = a * 1.3 + 0.035
  const shoulderY = WAIST_Y + 0.4
  const armLength = 0.5
  const armTilt = THREE.MathUtils.degToRad(12)

  return (
    <group name="mannequin">
      <mesh geometry={jacket} scale={[1, 1, BODY_DEPTH_RATIO]} castShadow receiveShadow>
        <meshStandardMaterial color={DOGI_WHITE} roughness={0.95} />
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
          <cylinderGeometry args={[a * 0.48, a * 0.55, WAIST_Y - 0.2, 32]} />
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
