import * as THREE from 'three'

/** Stitch rows across the 4 cm belt (Shureido-style belts have ~10). */
export const STITCH_ROWS = 10

const TILE = 512
/** Stitches per tile; a tile is one belt-width long, so ~3.3 mm per stitch at 4 cm. */
const STITCHES_PER_TILE = 12
const NORMAL_STRENGTH = 3

export interface StitchTextures {
  /** Grayscale albedo multiplier: darker in the stitch grooves, lighter thread. */
  map: THREE.DataTexture
  normalMap: THREE.DataTexture
  /** Packed occlusion (red, for `aoMap`) and roughness (green, for `roughnessMap`). */
  orm: THREE.DataTexture
}

/** How far the occlusion bake looks for higher surroundings (px), and how strongly they shade. */
const AO_RADIUS = 10
const AO_STRENGTH = 2.4
/** Part of the occlusion also baked into the color, so the grooves read under direct light too. */
const AO_IN_ALBEDO = 0.45
/** Twill weave of the cotton: diagonal ribs about 0.6 mm apart at 4 cm per tile. */
const TWILL_PERIOD_PX = 8
const TWILL_HEIGHT = 0.035
/** Roughness of the cotton face and of the slightly glossier stitching thread. */
const ROUGH_COTTON = 0.9
const ROUGH_THREAD = 0.66

/**
 * Procedurally generates a tileable stitch pattern: `rows` lines of running stitch
 * along the length of the belt, with the fabric puffing up slightly between rows
 * (the quilted look of a real belt). The tile covers one belt width × one belt width;
 * u runs along the belt, v across it.
 *
 * From one height field it bakes: color shading, a normal map, ambient occlusion (the
 * grooves and the fabric right beside the thread sit in shadow) and roughness (the thread
 * is a little glossier than the cotton, so the stitches catch the light as you orbit).
 * All of it is computed once at startup; nothing extra runs per frame.
 */
export function createStitchTextures(rows: number): StitchTextures {
  const height = new Float32Array(TILE * TILE)
  const shade = new Float32Array(TILE * TILE)
  const rough = new Float32Array(TILE * TILE)
  const rowPx = TILE / rows
  const threadHalfWidth = Math.max(1.2, rowPx * 0.06)

  for (let j = 0; j < TILE; j++) {
    // Rows sit at the middle of each band; t ∈ [0,1) within a band, row line at 0.5.
    const band = Math.floor((j + 0.5) / rowPx)
    const t = ((j + 0.5) / rowPx) % 1
    const fromRowPx = Math.abs(t - 0.5) * rowPx
    const puff = Math.pow(Math.min(1, Math.abs(t - 0.5) * 2), 0.55)
    for (let i = 0; i < TILE; i++) {
      const k = j * TILE + i
      const stitchPos = ((i + 0.5) / TILE) * STITCHES_PER_TILE
      const stitch = Math.floor(stitchPos)
      // Each stitch is slightly different, like real machine stitching pulled through cloth.
      const jitter = hash(stitch * 7 + 3, band * 13 + 1)
      const stitchLen = 0.74 + 0.08 * jitter
      const stitchPhase = stitchPos % 1
      const onThread = fromRowPx < threadHalfWidth && stitchPhase < stitchLen
      // Cotton: diagonal twill ribs plus fine fiber noise.
      const twill = Math.sin(((i + j) / TWILL_PERIOD_PX) * 2 * Math.PI) * 0.5 + 0.5
      const fiber = (hash(i, j) - 0.5) * 0.04
      let h = 0.65 * puff + TWILL_HEIGHT * twill + fiber
      let s = 0.8 + 0.2 * puff + 0.04 * (twill - 0.5) + fiber
      let r = ROUGH_COTTON + 0.05 * (hash(j, i) - 0.5)
      if (onThread) {
        // Rounded thread profile sitting in the groove.
        const across = 1 - fromRowPx / threadHalfWidth
        const along = Math.sin((stitchPhase / stitchLen) * Math.PI)
        h = 0.22 + (0.13 + 0.03 * jitter) * Math.sqrt(across) * along
        s = 0.87 + 0.04 * jitter
        r = ROUGH_THREAD + 0.12 * (1 - along)
      }
      height[k] = h
      shade[k] = s
      rough[k] = r
    }
  }

  const at = (i: number, j: number) => height[((j + TILE) % TILE) * TILE + ((i + TILE) % TILE)]
  const occlusion = bakeOcclusion(height)

  const normalData = new Uint8Array(TILE * TILE * 4)
  const mapData = new Uint8Array(TILE * TILE * 4)
  const ormData = new Uint8Array(TILE * TILE * 4)
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      // DataTexture row j ↔ v increasing; column i ↔ u increasing (OpenGL convention).
      const dhdu = (at(i + 1, j) - at(i - 1, j)) / 2
      const dhdv = (at(i, j + 1) - at(i, j - 1)) / 2
      const n = new THREE.Vector3(-dhdu * NORMAL_STRENGTH, -dhdv * NORMAL_STRENGTH, 1).normalize()
      const p = j * TILE + i
      const k = p * 4
      normalData[k] = (n.x * 0.5 + 0.5) * 255
      normalData[k + 1] = (n.y * 0.5 + 0.5) * 255
      normalData[k + 2] = (n.z * 0.5 + 0.5) * 255
      normalData[k + 3] = 255
      const ao = occlusion[p]
      const g = Math.round(clamp01(shade[p] * (1 - AO_IN_ALBEDO * (1 - ao))) * 255)
      mapData[k] = mapData[k + 1] = mapData[k + 2] = g
      mapData[k + 3] = 255
      ormData[k] = Math.round(ao * 255)
      ormData[k + 1] = Math.round(clamp01(rough[p]) * 255)
      ormData[k + 2] = 0
      ormData[k + 3] = 255
    }
  }

  const make = (data: Uint8Array, colorSpace: THREE.ColorSpace) => {
    const tex = new THREE.DataTexture(data, TILE, TILE, THREE.RGBAFormat)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
    tex.anisotropy = 8
    tex.colorSpace = colorSpace
    tex.needsUpdate = true
    return tex
  }

  return {
    map: make(mapData, THREE.SRGBColorSpace),
    normalMap: make(normalData, THREE.NoColorSpace),
    orm: make(ormData, THREE.NoColorSpace),
  }
}

/**
 * Ambient occlusion from a height field: for each texel, look outward in 8 directions and
 * find how steeply the surroundings rise above it (the horizon angle). Deep grooves and
 * the cloth tucked beside the thread see less sky and come out darker. 1 = fully open.
 */
function bakeOcclusion(height: Float32Array): Float32Array {
  const out = new Float32Array(TILE * TILE)
  const mask = TILE - 1 // TILE is a power of two, so wrapping is a bitwise and
  // Heights are in "tile units" where 1 ≈ the puff of a row; scale to px so slopes are meaningful.
  const heightPx = TILE / STITCH_ROWS / 6
  // Precomputed sample offsets and 1/distance for 8 directions × a few steps.
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
  ]
  const samples = dirs.map(([dx, dy]) => {
    const steps: { ox: number; oy: number; k: number }[] = []
    for (let d = 2; d <= AO_RADIUS; d += 2) steps.push({ ox: Math.round(dx * d), oy: Math.round(dy * d), k: heightPx / d })
    return steps
  })
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      const h0 = height[j * TILE + i]
      let blocked = 0
      for (const steps of samples) {
        let maxSlope = 0
        for (const { ox, oy, k } of steps) {
          const slope = (height[((j + oy) & mask) * TILE + ((i + ox) & mask)] - h0) * k
          if (slope > maxSlope) maxSlope = slope
        }
        // sin(atan(x)) without the trig.
        blocked += maxSlope / Math.sqrt(1 + maxSlope * maxSlope)
      }
      out[j * TILE + i] = clamp01(1 - (AO_STRENGTH * blocked) / dirs.length)
    }
  }
  return out
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
