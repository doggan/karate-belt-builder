import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { BRAND_LABEL, EMBROIDERY_FONT, beltColor, tailIndex, type BeltConfig, type TailSide } from '../config/schema'
import { useUiStore } from '../uiStore'
import type { BeltLayout } from './beltLayout'
import { WAIST_Y } from './beltLayout'
import { drawTailArt, LABEL_END_MARGIN, LABEL_LENGTH } from './embroidery'
import { loadGlyphs, useFontsVersion } from './fonts'
import { buildKnot } from './knot'
import { hoverCursor, noRaycast, pick, pickSection } from './picking'
import { buildFaceStrip, buildRibbon, ellipseFrames, updateFaceStrip, updateRibbon, type RibbonOptions } from './ribbon'
import { createStitchTextures, STITCH_ROWS } from './stitching'
import { TailSim } from './tailPhysics'
import { tailFrames } from './tailShape'

const WRAP_SEGMENTS = 160
const TAIL_SEGMENTS = 32
/** Quads across the belt's faces where they need to curve (the knot around the waist, the tails' cup). */
const ACROSS_SEGMENTS = 6
/** Embroidery floats this far above the belt face (m). */
const EMBROIDERY_OFFSET = 0.0004
/** Lift given to a tail when it is clicked (m/s at the tip). */
const CLICK_NUDGE = 0.35

/** Camera motion → tail push: per rad/s of orbiting, per m/s of panning (m/s²), and a cap. */
const CAMERA_SPIN_PUSH = 0.9
const CAMERA_PAN_PUSH = 2.5
const CAMERA_PUSH_MAX = 1.6

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface BeltProps {
  layout: BeltLayout
  config: BeltConfig
}

export function Belt({ layout, config }: BeltProps) {
  const { width, thickness, innerWrap, outerWrap, tailLength } = layout

  // Each end of the belt is one strand: out of the wrap, through the knot, into its tail.
  // The knot part is fixed; the tail part is simulated, starting from the strand's last frame.
  const knot = useMemo(() => buildKnot({ a: outerWrap.a, b: outerWrap.b }, width, thickness), [outerWrap.a, outerWrap.b, width, thickness])

  // Resting (styled) shape of each tail; the physics springs back toward it.
  const rest = useMemo(
    () => ({
      l: tailFrames(knot.l.root, -1, tailLength, TAIL_SEGMENTS),
      r: tailFrames(knot.r.root, 1, tailLength, TAIL_SEGMENTS),
    }),
    [knot, tailLength],
  )
  const sims = useMemo(
    () => ({ l: new TailSim(rest.l, 0), r: new TailSim(rest.r, 2.1) }),
    [rest],
  )

  const strip = useMemo(
    () => ({
      belt: { width, thickness, uLength: width } satisfies RibbonOptions,
      tail: { width, thickness, uLength: width, across: ACROSS_SEGMENTS } satisfies RibbonOptions,
      face: { width, offset: thickness / 2 + EMBROIDERY_OFFSET, across: ACROSS_SEGMENTS },
    }),
    [width, thickness],
  )
  const geometries = useMemo(() => {
    // u = 0 where the tail starts, so the stitching runs unbroken from knot to tail.
    const strand = (s: typeof knot.l) => buildRibbon(s.frames, { ...strip.tail, warp: s.warp, uStart: -s.length })
    return {
      inner: buildRibbon(ellipseFrames(innerWrap.a, innerWrap.b, WAIST_Y, WRAP_SEGMENTS), { ...strip.belt, closed: true }),
      // The second wrap sits a hair lower, like a real double-wrapped belt.
      outer: buildRibbon(ellipseFrames(outerWrap.a, outerWrap.b, WAIST_Y - 0.0015, WRAP_SEGMENTS), { ...strip.belt, closed: true }),
      lKnot: strand(knot.l),
      rKnot: strand(knot.r),
      l: buildRibbon(rest.l, strip.tail),
      r: buildRibbon(rest.r, strip.tail),
      lFace: buildFaceStrip(rest.l, strip.face),
      rFace: buildFaceStrip(rest.r, strip.face),
    }
  }, [strip, innerWrap.a, innerWrap.b, outerWrap.a, outerWrap.b, knot, rest])
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries])

  // Tail cloth: step the simulation and re-pose the tail meshes every frame. Turning or
  // panning the camera pushes the tails as if the wearer moved: orbiting swings the two
  // tails in opposite directions, panning and tilting push both the same way.
  const breeze = useMemo(() => !prefersReducedMotion(), [])
  const cam = useRef<{ azimuth: number; polar: number; target: THREE.Vector3 } | null>(null)
  useFrame((state, delta) => {
    const controls = state.controls as unknown as { target?: THREE.Vector3 } | null
    const target = controls?.target ?? new THREE.Vector3(0, WAIST_Y, 0)
    const offset = state.camera.position.clone().sub(target)
    const azimuth = Math.atan2(offset.x, offset.z)
    const polar = Math.acos(THREE.MathUtils.clamp(offset.y / offset.length(), -1, 1))
    let spin = 0
    let sway = 0
    if (cam.current && delta > 0) {
      let dAz = azimuth - cam.current.azimuth
      if (dAz > Math.PI) dAz -= 2 * Math.PI
      if (dAz < -Math.PI) dAz += 2 * Math.PI
      spin = (dAz / delta) * CAMERA_SPIN_PUSH
      sway = (((polar - cam.current.polar) / delta) * CAMERA_SPIN_PUSH) + (target.distanceTo(cam.current.target) / delta) * CAMERA_PAN_PUSH
    }
    cam.current = { azimuth, polar, target: target.clone() }

    for (const side of ['l', 'r'] as const) {
      const sim = sims[side]
      const push = THREE.MathUtils.clamp((side === 'l' ? -spin : spin) + sway, -CAMERA_PUSH_MAX, CAMERA_PUSH_MAX)
      sim.advance(delta, breeze, push)
      const frames = sim.frames()
      updateRibbon(geometries[side], frames, strip.tail)
      updateFaceStrip(geometries[`${side}Face`], frames, strip.face)
    }
  })

  const stitches = useMemo(() => createStitchTextures(STITCH_ROWS), [])
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

  /** Tail click: lift the tail; the brand label opens its section, anywhere else that tail's embroidery. */
  const onTailClick = (side: TailSide) =>
    pick((e: ThreeEvent<MouseEvent>) => {
      sims[side].nudge(CLICK_NUDGE)
      // Tail UVs are physical: u × belt width = distance from the knot.
      const fromEnd = tailLength - (e.uv?.x ?? 0) * width
      const labelTop = LABEL_END_MARGIN + LABEL_LENGTH + 0.005
      const onLabel = config.logo && config.logoTail === side && fromEnd <= labelTop
      useUiStore.getState().focusPart('embroidery', onLabel ? 'label' : side)
    })

  return (
    <group name="belt" {...hoverCursor}>
      <mesh geometry={geometries.inner} material={materials.ribbon} castShadow onClick={pickSection('belt')} />
      <mesh geometry={geometries.outer} material={materials.ribbon} castShadow onClick={pickSection('belt')} />
      <mesh geometry={geometries.lKnot} material={materials.ribbon} castShadow onClick={pickSection('belt')} />
      <mesh geometry={geometries.rKnot} material={materials.ribbon} castShadow onClick={pickSection('belt')} />
      {/* Animated meshes: their bounds change every frame, so skip frustum culling. */}
      <mesh geometry={geometries.l} material={materials.ribbon} castShadow frustumCulled={false} onClick={onTailClick('l')} />
      <mesh geometry={geometries.r} material={materials.ribbon} castShadow frustumCulled={false} onClick={onTailClick('r')} />
      <TailEmbroidery side="l" geometry={geometries.lFace} layout={layout} config={config} />
      <TailEmbroidery side="r" geometry={geometries.rFace} layout={layout} config={config} />
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
  const texts = [config.texts[tailIndex(side)]].filter((t) => t.text.trim())
  const logo = config.logo && side === config.logoTail
  const textsKey = JSON.stringify(texts)

  useEffect(() => {
    texts.forEach((t) => void loadGlyphs(EMBROIDERY_FONT, t.text))
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
    <mesh geometry={geometry} raycast={noRaycast} frustumCulled={false}>
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
