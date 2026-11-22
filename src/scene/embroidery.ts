import * as THREE from 'three'
import { BRAND_LABEL, threadColor, type FontId, type TailText, type TextWeight } from '../config/schema'
import { canvasFont } from './fonts'

/**
 * Embroidery is drawn on 2D canvases: a color canvas (with alpha — transparent
 * where there is no thread) and a matching grayscale height canvas used as a bump
 * map so the thread looks raised.
 */

export interface EmbroideryArt {
  map: THREE.CanvasTexture
  bumpMap: THREE.CanvasTexture
  empty: boolean
  dispose: () => void
}

/** Pixels per meter of belt. */
const PPM = 5000
const MAX_CANVAS = 4096

/** Glyphs that turn 90° in vertical (tategaki) writing. */
const ROTATE_IN_VERTICAL = new Set(['ー', '－', '—', '―', '〜', '～', '…', '‥', '（', '）', '(', ')', '「', '」', '-', '='])

const STROKE_BY_WEIGHT: Record<TextWeight, number> = { 1: 0, 2: 0.025, 3: 0.05, 4: 0.08, 5: 0.11 }

function canvasPair(w: number, h: number) {
  const make = () => {
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w))
    c.height = Math.max(1, Math.round(h))
    return c
  }
  const color = make()
  const height = make()
  const cc = color.getContext('2d')!
  const hc = height.getContext('2d')!
  hc.fillStyle = '#000'
  hc.fillRect(0, 0, height.width, height.height)
  return { color, height, cc, hc }
}

function toArt(color: HTMLCanvasElement, height: HTMLCanvasElement, empty: boolean): EmbroideryArt {
  const map = new THREE.CanvasTexture(color)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  const bumpMap = new THREE.CanvasTexture(height)
  bumpMap.anisotropy = 8
  return {
    map,
    bumpMap,
    empty,
    dispose: () => {
      map.dispose()
      bumpMap.dispose()
    },
  }
}

/** Fine diagonal satin-stitch sheen over everything already drawn. */
function satinSheen(ctx: CanvasRenderingContext2D, w: number, h: number, spacing: number) {
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'
  ctx.lineWidth = Math.max(1, spacing * 0.45)
  for (let d = -h, k = 0; d < w + h; d += spacing, k++) {
    ctx.strokeStyle = k % 2 ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.16)'
    ctx.beginPath()
    ctx.moveTo(d, 0)
    ctx.lineTo(d + h, h)
    ctx.stroke()
  }
  ctx.restore()
}

/** Draw `chars` stacked vertically, centered on x, starting at y = top. */
function drawVerticalText(
  ctx: CanvasRenderingContext2D,
  chars: string[],
  x: number,
  top: number,
  pitch: number,
  strokeWidth: number,
) {
  chars.forEach((ch, i) => {
    const y = top + (i + 0.5) * pitch
    ctx.save()
    ctx.translate(x, y)
    if (ROTATE_IN_VERTICAL.has(ch)) ctx.rotate(Math.PI / 2)
    if (strokeWidth > 0) ctx.strokeText(ch, 0, 0)
    ctx.fillText(ch, 0, 0)
    ctx.restore()
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/**
 * Art for one tail. Layout from the tail end upward: margin, brand label (if on this
 * tail), then the texts — the first text sits nearest the knot, reading top to bottom.
 * Text is never clamped: if it doesn't fit it simply continues up the tail.
 */
export function drawTailArt(opts: {
  tailLength: number
  width: number
  texts: TailText[]
  logo: boolean
}): EmbroideryArt {
  const ppm = Math.min(PPM, MAX_CANVAS / opts.tailLength)
  const W = opts.width * ppm
  const H = opts.tailLength * ppm
  const { color, height, cc, hc } = canvasPair(W, H)
  const texts = opts.texts.filter((t) => t.text.trim())
  const empty = texts.length === 0 && !opts.logo

  let cursor = H - 0.025 * ppm // bottom of the free space, moving up

  if (opts.logo) {
    const lw = W * 0.84
    const lh = W * 1.12
    const lx = (W - lw) / 2
    const ly = cursor - lh
    drawLabel(cc, lx, ly, lw, lh, false)
    drawLabel(hc, lx, ly, lw, lh, true)
    cursor = ly - W * 0.35
  }

  const px = W * 0.7
  const pitch = px * 1.05
  for (const t of [...texts].reverse()) {
    const chars = Array.from(t.text.trim())
    const top = cursor - chars.length * pitch
    const strokeWidth = px * STROKE_BY_WEIGHT[t.weight]
    for (const [ctx, isHeight] of [
      [cc, false],
      [hc, true],
    ] as const) {
      ctx.font = canvasFont(t.font, px)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.lineWidth = strokeWidth
      const fill = isHeight ? '#fff' : threadColor(t.color).hex
      ctx.fillStyle = fill
      ctx.strokeStyle = fill
      if (isHeight) ctx.filter = `blur(${Math.max(1, px * 0.02)}px)`
      drawVerticalText(ctx, chars, W / 2, top, pitch, strokeWidth)
      ctx.filter = 'none'
    }
    cursor = top - W * 0.5
  }

  satinSheen(cc, color.width, color.height, Math.max(2, px * 0.03))
  return toArt(color, height, empty)
}

/** Generic black-and-red woven brand label: red seal with a black mark, red name below. */
function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, isHeight: boolean) {
  const { black, red, mark, name } = BRAND_LABEL
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Black woven base with a red border.
  ctx.fillStyle = isHeight ? '#777' : black
  roundRect(ctx, x, y, w, h, w * 0.06)
  ctx.fill()
  ctx.strokeStyle = isHeight ? '#bbb' : red
  ctx.lineWidth = w * 0.035
  roundRect(ctx, x + w * 0.07, y + w * 0.07, w * 0.86, h - w * 0.14, w * 0.04)
  ctx.stroke()
  // Red seal with the mark knocked out in black.
  const seal = w * 0.5
  const sx = x + (w - seal) / 2
  const sy = y + h * 0.17
  ctx.fillStyle = isHeight ? '#fff' : red
  roundRect(ctx, sx, sy, seal, seal, seal * 0.08)
  ctx.fill()
  ctx.fillStyle = isHeight ? '#999' : black
  ctx.font = canvasFont('mincho', seal * 0.78)
  ctx.fillText(mark, x + w / 2, sy + seal / 2 + seal * 0.03)
  // Name.
  ctx.fillStyle = isHeight ? '#fff' : red
  ctx.font = canvasFont('gothic', w * 0.15)
  ctx.fillText(name, x + w / 2, y + h * 0.8, w * 0.78)
  ctx.restore()
}

export interface ChestArt extends EmbroideryArt {
  /** Height / width of the art, for sizing the decal. */
  aspect: number
}

/** Kanji embroidered straight onto the jacket, one column reading top to bottom. */
export function drawChestArt(text: string, colorHex: string, fontId: FontId): ChestArt {
  const chars = Array.from(text.trim())
  const px = 220
  const pitch = px * 1.08
  const W = 256
  const H = Math.max(1, chars.length) * pitch + (W - px)
  const { color, height, cc, hc } = canvasPair(W, H)
  for (const [ctx, isHeight] of [
    [cc, false],
    [hc, true],
  ] as const) {
    ctx.font = canvasFont(fontId, px)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = px * 0.05
    ctx.fillStyle = isHeight ? '#fff' : colorHex
    ctx.strokeStyle = ctx.fillStyle
    if (isHeight) ctx.filter = 'blur(3px)'
    drawVerticalText(ctx, chars, W / 2, (W - px) / 2, pitch, ctx.lineWidth)
    ctx.filter = 'none'
  }
  satinSheen(cc, W, H, 5)
  return { ...toArt(color, height, chars.length === 0), aspect: H / W }
}
