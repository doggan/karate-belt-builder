import * as THREE from 'three'

/** Stitch rows across the belt width (Shureido-style belts have ~10 at 4 cm). */
export function stitchRowsForWidth(widthCm: number): number {
  return widthCm >= 5 ? 12 : 10
}

const TILE = 512
/** Stitches per tile; a tile is one belt-width long, so ~3.3 mm per stitch at 4 cm. */
const STITCHES_PER_TILE = 12
const NORMAL_STRENGTH = 3

export interface StitchTextures {
  /** Grayscale albedo multiplier: darker in the stitch grooves, lighter thread. */
  map: THREE.DataTexture
  normalMap: THREE.DataTexture
}

/**
 * Procedurally generates a tileable stitch pattern: `rows` lines of running stitch
 * along the length of the belt, with the fabric puffing up slightly between rows
 * (the quilted look of a real belt). The tile covers one belt width × one belt width;
 * u runs along the belt, v across it.
 */
export function createStitchTextures(rows: number): StitchTextures {
  const height = new Float32Array(TILE * TILE)
  const shade = new Float32Array(TILE * TILE)
  const rowPx = TILE / rows
  const threadHalfWidth = Math.max(1.2, rowPx * 0.07)

  for (let j = 0; j < TILE; j++) {
    // Rows sit at the middle of each band; t ∈ [0,1) within a band, row line at 0.5.
    const t = ((j + 0.5) / rowPx) % 1
    const fromRowPx = Math.abs(t - 0.5) * rowPx
    const puff = Math.pow(Math.min(1, Math.abs(t - 0.5) * 2), 0.55)
    for (let i = 0; i < TILE; i++) {
      const k = j * TILE + i
      const stitchPhase = ((i + 0.5) / TILE) * STITCHES_PER_TILE % 1
      const onThread = fromRowPx < threadHalfWidth && stitchPhase < 0.78
      const weave = (hash(i, j) - 0.5) * 0.04 + Math.sin(i * 0.9) * Math.sin(j * 0.9) * 0.015
      let h = 0.65 * puff + weave
      let s = 0.8 + 0.2 * puff
      if (onThread) {
        // Rounded thread profile sitting in the groove.
        const across = 1 - fromRowPx / threadHalfWidth
        const along = Math.sin((stitchPhase / 0.78) * Math.PI)
        h = 0.18 + 0.22 * Math.sqrt(across) * along
        s = 0.95
      }
      height[k] = h
      shade[k] = s
    }
  }

  const normalData = new Uint8Array(TILE * TILE * 4)
  const mapData = new Uint8Array(TILE * TILE * 4)
  const at = (i: number, j: number) => height[((j + TILE) % TILE) * TILE + ((i + TILE) % TILE)]
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      // DataTexture row j ↔ v increasing; column i ↔ u increasing (OpenGL convention).
      const dhdu = (at(i + 1, j) - at(i - 1, j)) / 2
      const dhdv = (at(i, j + 1) - at(i, j - 1)) / 2
      const n = new THREE.Vector3(-dhdu * NORMAL_STRENGTH, -dhdv * NORMAL_STRENGTH, 1).normalize()
      const k = (j * TILE + i) * 4
      normalData[k] = (n.x * 0.5 + 0.5) * 255
      normalData[k + 1] = (n.y * 0.5 + 0.5) * 255
      normalData[k + 2] = (n.z * 0.5 + 0.5) * 255
      normalData[k + 3] = 255
      const g = Math.round(Math.min(1, shade[j * TILE + i]) * 255)
      mapData[k] = mapData[k + 1] = mapData[k + 2] = g
      mapData[k + 3] = 255
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

  return { map: make(mapData, THREE.SRGBColorSpace), normalMap: make(normalData, THREE.NoColorSpace) }
}

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
