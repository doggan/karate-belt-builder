import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Decal, useGLTF } from '@react-three/drei'
import { BRAND_LABEL, BLACK_THREAD_HEX, EMBROIDERY_FONT, threadColor, type BeltConfig } from '../config/schema'
import { useUiStore } from '../uiStore'
import { WAIST_Y, type BeltLayout } from './beltLayout'
import { drawChestArt, drawHemArt } from './embroidery'
import { loadGlyphs, useFontsVersion } from './fonts'
import { hoverCursor, noRaycast, pick } from './picking'

/** Prepared by scripts/prepare-model.mjs: faces +Z, meters, belt line at WAIST_Y, baked belt removed. */
const MODEL_URL = '/models/dogi.glb'
/** How far above/below the belt the waist reshaping fades out (m); shoulders and hems stay natural. */
const RESHAPE_FALLOFF = 0.32
/** Where the chest kanji column starts, and its offset from center (m). */
const CHEST_TOP_Y = WAIST_Y + 0.38
const CHEST_X = 0.115
/**
 * Hem embroidery (wearer's left front, along the bottom seam): height of the embroidered
 * line, its distance above the hem, the x used to find the hem, and how far in from the
 * jacket's side edge the line ends (m). The line runs from near the side seam inward.
 */
const HEM_LINE_HEIGHT = 0.026
const HEM_ABOVE_SEAM = 0.028
const HEM_PROBE_X = 0.12
const HEM_SIDE_INSET = 0.015

useGLTF.preload(MODEL_URL)

interface DogiModelProps {
  layout: BeltLayout
  config: BeltConfig
}

export function DogiModel({ layout, config }: DogiModelProps) {
  const gltf = useGLTF(MODEL_URL)

  // The source mesh, de-quantized into plain float geometry in world space.
  const { base, material } = useMemo(() => {
    gltf.scene.updateMatrixWorld(true)
    let mesh: THREE.Mesh | undefined
    gltf.scene.traverse((o) => {
      if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh
    })
    if (!mesh) throw new Error('dogi.glb has no mesh')
    return { base: toWorldFloatGeometry(mesh), material: tuneFabric(mesh.material as THREE.MeshStandardMaterial) }
  }, [gltf])

  const { x: sx, z: sz } = layout.modelScale
  const geometry = useMemo(() => reshapeWaist(base, sx, sz), [base, sx, sz])
  useEffect(() => () => geometry.dispose(), [geometry])
  const hemY = useMemo(() => findJacketHem(geometry, HEM_PROBE_X), [geometry])

  return (
    <group name="dogi" {...hoverCursor}>
      <mesh
        geometry={geometry}
        material={material}
        castShadow
        receiveShadow
        onClick={pick((e) => {
          // Front of the upper jacket → chest kanji; front just above the hem → hem
          // embroidery; anywhere else → body.
          const front = e.point.z > 0
          const chest = front && e.point.y > WAIST_Y + 0.15
          const hem = front && Math.abs(e.point.y - (hemY + HEM_ABOVE_SEAM)) < 0.06
          useUiStore.getState().focusPart(chest ? 'chest' : hem ? 'hem' : 'body')
        })}
      >
        <ChestKanji key={geometry.uuid} geometry={geometry} config={config} />
        <HemEmbroideryDecal key={`hem-${geometry.uuid}`} geometry={geometry} hemY={hemY} config={config} />
      </mesh>
    </group>
  )
}

/**
 * The scan's textures are a mid gray with a strong weave normal map that shows up as
 * diagonal stripes under studio lighting. Brighten it to a white gi, soften the normal
 * map and keep it matte cotton.
 */
function tuneFabric(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  material.color.setScalar(1.45)
  material.normalScale.setScalar(0.25)
  material.roughness = 1
  material.metalness = 0
  material.envMapIntensity = 0.8
  return material
}

/** Copy a (possibly quantized) glTF mesh's geometry into float attributes, baked into world space. */
function toWorldFloatGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry
  const out = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv'] as const) {
    const attr = src.getAttribute(name)
    if (!attr) continue
    const arr = new Float32Array(attr.count * attr.itemSize)
    for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) arr[i * attr.itemSize + c] = attr.getComponent(i, c)
    out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize))
  }
  if (src.index) out.setIndex(src.index.clone())
  out.applyMatrix4(mesh.matrixWorld)
  return out
}

/**
 * Scale the model horizontally so its waist matches the chosen waist size and build.
 * The scale is full strength at the belt line and fades out above and below, so the
 * shoulders, sleeves and trouser legs keep their natural proportions.
 */
function reshapeWaist(base: THREE.BufferGeometry, sx: number, sz: number): THREE.BufferGeometry {
  const g = base.clone()
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute | undefined
  for (let i = 0; i < pos.count; i++) {
    const d = (pos.getY(i) - WAIST_Y) / RESHAPE_FALLOFF
    const w = Math.exp(-d * d)
    const kx = 1 + (sx - 1) * w
    const kz = 1 + (sz - 1) * w
    pos.setXYZ(i, pos.getX(i) * kx, pos.getY(i), pos.getZ(i) * kz)
    if (nrm) {
      // Normals transform by the inverse scale (ignoring the falloff's gradient — a small error).
      const n = new THREE.Vector3(nrm.getX(i) / kx, nrm.getY(i), nrm.getZ(i) / kz).normalize()
      nrm.setXYZ(i, n.x, n.y, n.z)
    }
  }
  pos.needsUpdate = true
  if (nrm) nrm.needsUpdate = true
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

/** First hit on the jacket surface from a ray shot from the front (−Z) at (x, y). */
function frontHit(geometry: THREE.BufferGeometry, x: number, y: number): THREE.Intersection | undefined {
  return new THREE.Raycaster(new THREE.Vector3(x, y, 2), new THREE.Vector3(0, 0, -1)).intersectObject(
    new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
  )[0]
}

/** x of the jacket's side edge (wearer's left, +x) at height y, just in front of the side seam. */
function jacketSideX(geometry: THREE.BufferGeometry, y: number): number {
  const hit = new THREE.Raycaster(new THREE.Vector3(2, y, 0.04), new THREE.Vector3(-1, 0, 0)).intersectObject(
    new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
  )[0]
  return hit ? hit.point.x : 0.2
}

/** Decal transform facing the surface at a hit point. */
function decalAt(hit: THREE.Intersection, scale: [number, number, number]) {
  const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 0, 1)
  if (normal.z < 0) normal.negate()
  return {
    position: hit.point.toArray() as [number, number, number],
    rotation: [0, Math.atan2(normal.x, normal.z), 0] as [number, number, number],
    scale,
  }
}

/**
 * Height of the jacket's bottom edge at horizontal position x: scanning down the front
 * through the band where a jacket can end, the hem is the biggest step back in the
 * surface (from the jacket skirt to the trousers behind it).
 */
function findJacketHem(geometry: THREE.BufferGeometry, x: number): number {
  let prevZ: number | null = null
  let bestDrop = 0
  let hemY = WAIST_Y - 0.25 // fallback: roughly where a jacket ends
  for (let y = WAIST_Y - 0.1; y > WAIST_Y - 0.42; y -= 0.003) {
    const hit = frontHit(geometry, x, y)
    if (!hit) continue
    if (prevZ !== null && prevZ - hit.point.z > bestDrop) {
      bestDrop = prevZ - hit.point.z
      hemY = y + 0.003
    }
    prevZ = hit.point.z
  }
  return hemY
}

/** Brush-font text along the jacket's bottom seam on the wearer's left front, optional brand label. */
function HemEmbroideryDecal({ geometry, hemY, config }: { geometry: THREE.BufferGeometry; hemY: number; config: BeltConfig }) {
  const fontsVersion = useFontsVersion()
  const { show, text, color, label } = config.hem

  useEffect(() => {
    if (!show) return
    void loadGlyphs(EMBROIDERY_FONT, text)
    if (label) {
      void loadGlyphs('mincho', BRAND_LABEL.mark)
      void loadGlyphs('gothic', BRAND_LABEL.name)
    }
  }, [show, text, label])

  const art = useMemo(
    () => (show && (text.trim() || label) ? drawHemArt(text, threadColor(color).hex, label) : null),
    [show, text, color, label, fontsVersion],
  )
  useEffect(() => () => art?.dispose(), [art])

  const placement = useMemo(() => {
    if (!art) return null
    const width = HEM_LINE_HEIGHT * art.aspect
    const y = hemY + HEM_ABOVE_SEAM
    const outerX = jacketSideX(geometry, y) - HEM_SIDE_INSET
    const centerX = Math.max(0.03, outerX - width / 2)
    const hit = frontHit(geometry, centerX, y)
    return hit ? decalAt(hit, [width, HEM_LINE_HEIGHT, 0.1]) : null
  }, [art, geometry, hemY])

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

/** Black kanji embroidered on the wearer's left chest (the viewer's right, +x), reading top to bottom. */
function ChestKanji({ geometry, config }: { geometry: THREE.BufferGeometry; config: BeltConfig }) {
  const fontsVersion = useFontsVersion()
  const { show, text, size } = config.chest
  const charSize = size / 1000

  useEffect(() => {
    if (show) void loadGlyphs(EMBROIDERY_FONT, text)
  }, [show, text])

  const art = useMemo(
    () => (show && text.trim() ? drawChestArt(text, BLACK_THREAD_HEX, EMBROIDERY_FONT) : null),
    [show, text, fontsVersion],
  )
  useEffect(() => () => art?.dispose(), [art])

  const placement = useMemo(() => {
    if (!art) return null
    const height = charSize * art.aspect
    const y = CHEST_TOP_Y - height / 2
    // Find the jacket surface by casting a ray at the chest from the front.
    const hit = new THREE.Raycaster(new THREE.Vector3(CHEST_X, y, 2), new THREE.Vector3(0, 0, -1)).intersectObject(
      new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
    )[0]
    if (!hit) return null
    const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 0, 1)
    if (normal.z < 0) normal.negate()
    return {
      position: hit.point.toArray() as [number, number, number],
      rotation: [0, Math.atan2(normal.x, normal.z), 0] as [number, number, number],
      scale: [charSize, height, 0.1] as [number, number, number],
    }
  }, [art, geometry, charSize])

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
