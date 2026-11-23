import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Decal, useGLTF } from '@react-three/drei'
import { BRAND_LABEL, BLACK_THREAD_HEX, EMBROIDERY_FONT, type BeltConfig } from '../config/schema'
import { useUiStore } from '../uiStore'
import { beltDropAt, WAIST_Y, type BeltLayout, type Ellipse } from './beltLayout'
import { drawChestArt, drawHemArt } from './embroidery'
import { loadGlyphs, useFontsVersion } from './fonts'
import { hoverCursor, noRaycast, pick } from './picking'

/** Prepared by scripts/prepare-model.mjs: faces +Z, meters, belt line at WAIST_Y, baked belt removed. */
const MODEL_URL = '/models/dogi.glb'
/** How far above/below the belt the waist reshaping fades out (m); shoulders and hems stay natural. */
const RESHAPE_FALLOFF = 0.32
/**
 * The belt cinches the jacket in: within this distance of the belt's center line (m) the
 * jacket is drawn in to the belt's body ellipse, fading out over CINCH_FADE beyond it.
 * Jacket within CINCH_FREE of that ellipse (as a fraction of its size) is left alone.
 */
const CINCH_HALF = 0.035
const CINCH_FADE = 0.05
const CINCH_FREE = 0.97
/** Where the chest kanji column starts, and its offset from center (m). */
const CHEST_TOP_Y = WAIST_Y + 0.38
const CHEST_X = 0.115
/**
 * Hem embroidery: a vertical column on the front edge of the overlapping panel (where the
 * jacket closes), starting just above the hem. Character width, gap above the hem, the
 * x used to find the hem, and how far in from the panel's edge the column sits (m).
 */
const HEM_CHAR_SIZE = 0.024
const HEM_ABOVE_SEAM = 0.025
const HEM_PROBE_X = 0.12
const HEM_EDGE_INSET = 0.008
/** The column sits on the viewer's left of the closing edge, toward that side's outer edge (-1 = -x). */
const HEM_SIDE = -1
/**
 * The column is slanted to follow the collar line. Negative = top leans toward the viewer's
 * right, which matches this model's closure.
 */
const HEM_TILT = THREE.MathUtils.degToRad(-17)

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
  const { a: bodyA, b: bodyB } = layout.body
  const geometry = useMemo(() => reshapeWaist(base, sx, sz, { a: bodyA, b: bodyB }), [base, sx, sz, bodyA, bodyB])
  useEffect(() => () => geometry.dispose(), [geometry])
  // The hem and the closing edge are found once on the unreshaped model (each takes ~100
  // raycasts against the full mesh, far too slow to redo while the waist slider drags), then
  // the edge's x is carried through the waist reshape analytically.
  const hemY = useMemo(() => findJacketHem(base, HEM_PROBE_X), [base])
  const basePlacket = useMemo(() => findPlacketEdge(base, hemY + 0.06), [base, hemY])
  const placket = useMemo(
    () => ({ ...basePlacket, x: basePlacket.x * waistScaleAt(hemY + 0.06, sx) }),
    [basePlacket, hemY, sx],
  )

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
          const hem = front && e.point.y > hemY - 0.01 && e.point.y < hemY + 0.22 && Math.abs(e.point.x - placket.x) < 0.1
          if (chest || hem) useUiStore.getState().focusPart('gi', chest ? 'chest' : 'hem')
          else useUiStore.getState().focusPart('body')
        })}
      >
        <ChestKanji geometry={geometry} config={config} />
        <HemEmbroideryDecal geometry={geometry} hemY={hemY} placket={placket} config={config} />
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
/** Horizontal scale the waist reshape applies at height y, for a waist-line scale s. */
function waistScaleAt(y: number, s: number): number {
  const d = (y - WAIST_Y) / RESHAPE_FALLOFF
  return 1 + (s - 1) * Math.exp(-d * d)
}

function reshapeWaist(base: THREE.BufferGeometry, sx: number, sz: number, body: Ellipse): THREE.BufferGeometry {
  const g = base.clone()
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute | undefined
  const p = pos.array as Float32Array
  const n = nrm?.array as Float32Array | undefined
  for (let i = 0; i < pos.count; i++) {
    const j = i * 3
    const kx = waistScaleAt(p[j + 1], sx)
    const kz = waistScaleAt(p[j + 1], sz)
    p[j] *= kx
    p[j + 2] *= kz
    cinch(p, j, body)
    if (n) {
      // Normals transform by the inverse scale (ignoring the falloff's gradient — a small error).
      const nx = n[j] / kx
      const ny = n[j + 1]
      const nz = n[j + 2] / kz
      const len = Math.hypot(nx, ny, nz) || 1
      n[j] = nx / len
      n[j + 1] = ny / len
      n[j + 2] = nz / len
    }
  }
  pos.needsUpdate = true
  if (nrm) nrm.needsUpdate = true
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

/**
 * Draw the jacket in under the belt. Around the waist the belt runs at its own height
 * (level at the back and sides, dipping to the knot: `beltDropAt`). Fabric bulging past the
 * body ellipse there is squeezed smoothly onto it (never past it, keeping the gi's outer and
 * inner surfaces in order); the squeeze fades out above and below the belt. Arms hanging by
 * the sides are far outside the ellipse and are left alone.
 */
function cinch(p: Float32Array, j: number, { a, b }: Ellipse) {
  const x = p[j]
  const z = p[j + 2]
  const r = Math.hypot(x / a, z / b)
  if (r <= CINCH_FREE || r > 1.6) return
  const h = p[j + 1] - (WAIST_Y - beltDropAt(Math.atan2(x / a, z / b), a)) // height above the belt's center line
  const along = 1 - THREE.MathUtils.smoothstep(Math.abs(h), CINCH_HALF, CINCH_HALF + CINCH_FADE)
  const nearBody = 1 - THREE.MathUtils.smoothstep(r, 1.3, 1.6)
  const w = along * nearBody
  if (w <= 0) return
  const room = 1 - CINCH_FREE
  const squeezed = CINCH_FREE + room * Math.tanh((r - CINCH_FREE) / room)
  const k = 1 + w * (squeezed / r - 1)
  p[j] = x * k
  p[j + 2] = z * k
}

/** First hit on the jacket surface from a ray shot from the front (−Z) at (x, y). */
function frontHit(geometry: THREE.BufferGeometry, x: number, y: number): THREE.Intersection | undefined {
  return new THREE.Raycaster(new THREE.Vector3(x, y, 2), new THREE.Vector3(0, 0, -1)).intersectObject(
    new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
  )[0]
}

/**
 * The front edge of the overlapping panel at height y: scanning across the front, it is the
 * biggest step in depth (the top panel sits in front of the one underneath). `outer` is the
 * direction (±1 in x) of the top panel, i.e. the side the embroidery goes on.
 */
function findPlacketEdge(geometry: THREE.BufferGeometry, y: number): { x: number; outer: 1 | -1 } {
  let best = { x: 0, outer: 1 as 1 | -1, step: 0 }
  let prev: { x: number; z: number } | null = null
  for (let x = -0.12; x <= 0.12; x += 0.003) {
    const hit = frontHit(geometry, x, y)
    if (!hit) continue
    if (prev) {
      const dz = hit.point.z - prev.z
      if (Math.abs(dz) > best.step) best = { x: (x + prev.x) / 2, outer: dz > 0 ? 1 : -1, step: Math.abs(dz) }
    }
    prev = { x, z: hit.point.z }
  }
  return { x: best.x, outer: best.outer }
}

/**
 * The part of the jacket a decal can touch: just the triangles within reach of its box.
 * Projecting a decal clips every triangle of its target mesh, so doing it against the full
 * 100k-triangle gi took ~90 ms per decal, every step of the waist slider.
 */
function cropAround(
  geometry: THREE.BufferGeometry,
  center: [number, number, number],
  scale: [number, number, number],
): { current: THREE.Mesh } {
  const reach = Math.hypot(...scale) / 2 + 0.03
  const r2 = reach * reach
  const pos = geometry.getAttribute('position').array as Float32Array
  const nrm = geometry.getAttribute('normal').array as Float32Array
  const index = geometry.index?.array
  const triCount = index ? index.length / 3 : pos.length / 9
  const [cx, cy, cz] = center
  const near = (v: number) => {
    const dx = pos[v * 3] - cx
    const dy = pos[v * 3 + 1] - cy
    const dz = pos[v * 3 + 2] - cz
    return dx * dx + dy * dy + dz * dz < r2
  }
  const outPos: number[] = []
  const outNrm: number[] = []
  for (let t = 0; t < triCount; t++) {
    const a = index ? index[t * 3] : t * 3
    const b = index ? index[t * 3 + 1] : t * 3 + 1
    const c = index ? index[t * 3 + 2] : t * 3 + 2
    if (!near(a) && !near(b) && !near(c)) continue
    for (const v of [a, b, c]) {
      outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
      outNrm.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2])
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(outNrm, 3))
  return { current: new THREE.Mesh(g) }
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

/** Black brush-font column up the front edge of the overlapping panel, just above the hem, optional brand label. */
function HemEmbroideryDecal({
  geometry,
  hemY,
  placket,
  config,
}: {
  geometry: THREE.BufferGeometry
  hemY: number
  placket: { x: number; outer: 1 | -1 }
  config: BeltConfig
}) {
  const fontsVersion = useFontsVersion()
  const { show, text, label } = config.hem

  useEffect(() => {
    if (!show) return
    void loadGlyphs(EMBROIDERY_FONT, text)
    if (label) {
      void loadGlyphs('mincho', BRAND_LABEL.mark)
      void loadGlyphs('gothic', BRAND_LABEL.name + BRAND_LABEL.origin)
    }
  }, [show, text, label])

  const art = useMemo(
    () => (show && (text.trim() || label) ? drawHemArt(text, BLACK_THREAD_HEX, label) : null),
    [show, text, label, fontsVersion],
  )
  useEffect(() => () => art?.dispose(), [art])

  const placement = useMemo(() => {
    if (!art) return null
    const height = HEM_CHAR_SIZE * art.aspect
    const x = placket.x + HEM_SIDE * (HEM_EDGE_INSET + HEM_CHAR_SIZE / 2)
    const y = hemY + HEM_ABOVE_SEAM + height / 2
    const hit = frontHit(geometry, x, y)
    if (!hit) return null
    const p = decalAt(hit, [HEM_CHAR_SIZE, height, 0.1])
    // Roll about the surface normal (Euler XYZ: the in-plane roll applies before the yaw).
    p.rotation[2] = HEM_TILT
    return { ...p, target: cropAround(geometry, p.position, p.scale) }
  }, [art, geometry, hemY, placket])
  useEffect(() => () => placement?.target.current.geometry.dispose(), [placement])

  if (!art || !placement) return null
  return (
    <Decal mesh={placement.target} position={placement.position} rotation={placement.rotation} scale={placement.scale} raycast={noRaycast}>
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
    const hit = frontHit(geometry, CHEST_X, y)
    if (!hit) return null
    const p = decalAt(hit, [charSize, height, 0.1])
    return { ...p, target: cropAround(geometry, p.position, p.scale) }
  }, [art, geometry, charSize])
  useEffect(() => () => placement?.target.current.geometry.dispose(), [placement])

  if (!art || !placement) return null
  return (
    <Decal mesh={placement.target} position={placement.position} rotation={placement.rotation} scale={placement.scale} raycast={noRaycast}>
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
