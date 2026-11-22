import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { BRAND_LABEL, beltColor, type BeltConfig, type TailSide } from '../config/schema'
import { useUiStore } from '../uiStore'
import type { BeltLayout } from './beltLayout'
import { WAIST_Y } from './beltLayout'
import { drawTailArt, LABEL_END_MARGIN, LABEL_LENGTH_PER_WIDTH } from './embroidery'
import { loadGlyphs, useFontsVersion } from './fonts'
import { hoverCursor, noRaycast, pick, pickSection } from './picking'
import { buildFaceStrip, buildRibbon, ellipseFrames, tailFrames, type Frame } from './ribbon'
import { createStitchTextures, stitchRowsForWidth } from './stitching'

const WRAP_SEGMENTS = 160
const TAIL_SEGMENTS = 48
const TAIL_SPLAY = THREE.MathUtils.degToRad(18)
/** Embroidery floats this far above the belt face (m). */
const EMBROIDERY_OFFSET = 0.0004

interface BeltProps {
  layout: BeltLayout
  config: BeltConfig
}

export function Belt({ layout, config }: BeltProps) {
  const { width, thickness, innerWrap, outerWrap, knot, tailLength } = layout

  const tails = useMemo(() => {
    const startY = WAIST_Y - knot.height * 0.3
    const startZ = knot.z + knot.depth * 0.2
    const frames = (side: 1 | -1) =>
      tailFrames(new THREE.Vector3(side * knot.width * 0.2, startY, startZ), side, tailLength, TAIL_SPLAY, TAIL_SEGMENTS)
    return { l: frames(-1), r: frames(1) }
  }, [knot, tailLength])

  const geometries = useMemo(() => {
    const ribbon = (frames: Frame[], closed: boolean) => buildRibbon(frames, width, thickness, closed, width)
    return {
      inner: ribbon(ellipseFrames(innerWrap.a, innerWrap.b, WAIST_Y, WRAP_SEGMENTS), true),
      // The second wrap sits a hair lower, like a real double-wrapped belt.
      outer: ribbon(ellipseFrames(outerWrap.a, outerWrap.b, WAIST_Y - 0.0015, WRAP_SEGMENTS), true),
      l: ribbon(tails.l, false),
      r: ribbon(tails.r, false),
      lFace: buildFaceStrip(tails.l, width, thickness / 2 + EMBROIDERY_OFFSET),
      rFace: buildFaceStrip(tails.r, width, thickness / 2 + EMBROIDERY_OFFSET),
    }
  }, [width, thickness, innerWrap, outerWrap, tails])
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries])

  const stitches = useMemo(() => createStitchTextures(stitchRowsForWidth(config.width)), [config.width])
  useEffect(
    () => () => {
      stitches.map.dispose()
      stitches.normalMap.dispose()
    },
    [stitches],
  )

  const materials = useMemo(() => {
    const faces = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0 })
    const edges = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 })
    return { faces, edges, ribbon: [faces, edges] }
  }, [])
  useEffect(
    () => () => {
      materials.faces.dispose()
      materials.edges.dispose()
    },
    [materials],
  )

  const hex = beltColor(config.color).hex
  materials.faces.color.set(hex)
  materials.edges.color.set(hex).multiplyScalar(0.85)
  if (materials.faces.map !== stitches.map) {
    materials.faces.map = stitches.map
    materials.faces.normalMap = stitches.normalMap
    materials.faces.normalScale.set(1, 1)
    materials.faces.needsUpdate = true
  }

  /** Tail click: the brand label opens its section; anywhere else opens that tail's embroidery. */
  const onTailClick = (side: TailSide) =>
    pick((e: ThreeEvent<MouseEvent>) => {
      // Tail UVs are physical: u × belt width = distance from the knot.
      const fromEnd = tailLength - (e.uv?.x ?? 0) * width
      const labelTop = LABEL_END_MARGIN + LABEL_LENGTH_PER_WIDTH * width + 0.005
      const onLabel = config.logo && config.logoTail === side && fromEnd <= labelTop
      useUiStore.getState().focusPart(onLabel ? 'label' : 'embroidery', side)
    })

  return (
    <group name="belt" {...hoverCursor}>
      <mesh geometry={geometries.inner} material={materials.ribbon} castShadow onClick={pickSection('belt')} />
      <mesh geometry={geometries.outer} material={materials.ribbon} castShadow onClick={pickSection('belt')} />
      <mesh geometry={geometries.l} material={materials.ribbon} castShadow onClick={onTailClick('l')} />
      <mesh geometry={geometries.r} material={materials.ribbon} castShadow onClick={onTailClick('r')} />
      <TailEmbroidery side="l" geometry={geometries.lFace} layout={layout} config={config} />
      <TailEmbroidery side="r" geometry={geometries.rFace} layout={layout} config={config} />
      {/* Placeholder knot — replaced by a modeled square knot in phase 3. */}
      <RoundedBox
        args={[knot.width, knot.height, knot.depth]}
        radius={Math.min(knot.depth / 2 - 0.0005, 0.006)}
        smoothness={4}
        position={[0, WAIST_Y, knot.z]}
        material={materials.faces}
        castShadow
        onClick={pickSection('belt')}
      />
    </group>
  )
}

interface TailEmbroideryProps {
  side: TailSide
  geometry: THREE.BufferGeometry
  layout: BeltLayout
  config: BeltConfig
}

function TailEmbroidery({ side, geometry, layout, config }: TailEmbroideryProps) {
  const fontsVersion = useFontsVersion()
  const texts = config.texts.filter((t) => t.tail === side && t.text.trim())
  const logo = config.logo && side === config.logoTail
  const textsKey = JSON.stringify(texts)

  useEffect(() => {
    texts.forEach((t) => void loadGlyphs(t.font, t.text))
    if (logo) {
      void loadGlyphs('mincho', BRAND_LABEL.mark)
      void loadGlyphs('gothic', BRAND_LABEL.name)
    }
  }, [textsKey, logo])

  const art = useMemo(
    () => drawTailArt({ tailLength: layout.tailLength, width: layout.width, texts, logo }),
    [layout.tailLength, layout.width, textsKey, logo, fontsVersion],
  )
  useEffect(() => () => art.dispose(), [art])

  if (art.empty) return null
  return (
    <mesh geometry={geometry} raycast={noRaycast}>
      <meshStandardMaterial
        map={art.map}
        bumpMap={art.bumpMap}
        bumpScale={2}
        alphaTest={0.5}
        alphaToCoverage
        roughness={0.45}
        metalness={0.05}
      />
    </mesh>
  )
}
