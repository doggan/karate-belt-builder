import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import type { BeltLayout } from './beltLayout'
import { WAIST_Y } from './beltLayout'
import { buildRibbon, ellipseFrames, tailFrames } from './ribbon'

const WRAP_SEGMENTS = 160
const TAIL_SEGMENTS = 40
const TAIL_SPLAY = THREE.MathUtils.degToRad(18)

interface BeltProps {
  layout: BeltLayout
  color: string
}

export function Belt({ layout, color }: BeltProps) {
  const { width, thickness, innerWrap, outerWrap, knot, tailLength } = layout

  const geometries = useMemo(() => {
    const inner = buildRibbon(ellipseFrames(innerWrap.a, innerWrap.b, WAIST_Y, WRAP_SEGMENTS), width, thickness, true)
    // The second wrap sits a hair lower, like a real double-wrapped belt.
    const outer = buildRibbon(
      ellipseFrames(outerWrap.a, outerWrap.b, WAIST_Y - 0.0015, WRAP_SEGMENTS),
      width,
      thickness,
      true,
    )
    const tailStartY = WAIST_Y - knot.height * 0.3
    const tailStartZ = knot.z + knot.depth * 0.2
    const tail = (side: 1 | -1) =>
      buildRibbon(
        tailFrames(new THREE.Vector3(side * knot.width * 0.2, tailStartY, tailStartZ), side, tailLength, TAIL_SPLAY, TAIL_SEGMENTS),
        width,
        thickness,
        false,
      )
    return { inner, outer, left: tail(-1), right: tail(1) }
  }, [width, thickness, innerWrap, outerWrap, knot, tailLength])

  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries])

  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0 }), [])
  useEffect(() => () => material.dispose(), [material])
  material.color.set(color)

  return (
    <group name="belt">
      <mesh geometry={geometries.inner} material={material} castShadow />
      <mesh geometry={geometries.outer} material={material} castShadow />
      <mesh geometry={geometries.left} material={material} castShadow />
      <mesh geometry={geometries.right} material={material} castShadow />
      {/* Placeholder knot — replaced by a modeled square knot in phase 3. */}
      <RoundedBox
        args={[knot.width, knot.height, knot.depth]}
        radius={Math.min(knot.depth / 2 - 0.0005, 0.006)}
        smoothness={4}
        position={[0, WAIST_Y, knot.z]}
        material={material}
        castShadow
      />
    </group>
  )
}
