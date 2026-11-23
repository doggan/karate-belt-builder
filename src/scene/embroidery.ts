import * as THREE from 'three'
import { BRAND_LABEL, EMBROIDERY_FONT, GI_THREAD_HEX, STRIPE_GAP_CM, STRIPE_WIDTH_CM, threadColor, type FontId, type TailText, type TextWeight } from '../config/schema'
import { REFERENCE_LABEL } from '../config/reference'
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

/** Brand label placement on a tail: gap from the tail end (m), and label length as a multiple of belt width. */
export const LABEL_END_MARGIN = REFERENCE_LABEL.fromTipCm / 100
export const LABEL_LENGTH = REFERENCE_LABEL.lengthCm / 100
/** Label width as a fraction of the belt width, and its length/width for a 4 cm belt (for the hem label). */
const LABEL_WIDTH_FRACTION = 0.84
const LABEL_ASPECT = LABEL_LENGTH / (0.04 * LABEL_WIDTH_FRACTION)

/** Stripes start this far from the tip (m), or this far past the brand label when it's on the same tail. */
const STRIPES_FROM_TIP = 0.01
const STRIPES_PAST_LABEL = 0.015

/** Where things go at the end of a tail, as distances from its tip (m). */
export interface TailEndLayout {
  /** Each stripe's span: `near` the tip to `far` from it. */
  stripes: Array<{ near: number; far: number }>
  /** Embroidered text starts this far from the tip and runs toward the knot. */
  textFromTip: number
}

/**
 * Layout from the tail end upward: margin, brand label (if on this tail), stripes (if on
 * this tail), then the text.
 */
export function tailEndLayout(width: number, logo: boolean, stripes: number): TailEndLayout {
  const labelTop = LABEL_END_MARGIN + LABEL_LENGTH
  const gap = width * 0.35 // between the label or stripes and the text
  const w = STRIPE_WIDTH_CM / 100
  const pitch = w + STRIPE_GAP_CM / 100
  const first = logo ? labelTop + STRIPES_PAST_LABEL : STRIPES_FROM_TIP
  const bands = Array.from({ length: stripes }, (_, i) => ({ near: first + i * pitch, far: first + i * pitch + w }))
  const textFromTip = bands.length ? bands[bands.length - 1].far + gap : logo ? labelTop + gap : LABEL_END_MARGIN
  return { stripes: bands, textFromTip }
}

/** Pixels per meter of belt. */
const PPM = 5000
const MAX_CANVAS = 4096

/** Glyphs that turn 90° in vertical (tategaki) writing. */
const ROTATE_IN_VERTICAL = new Set(['ー', '－', '—', '―', '〜', '～', '…', '‥', '（', '）', '(', ')', '「', '」', '-', '='])

/** Half-width characters take this fraction of a full character's length along the tail. */
const HALF_WIDTH_SQUEEZE = 0.55

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
  squeeze = 1,
) {
  chars.forEach((ch, i) => {
    const y = top + (i + 0.5) * pitch
    ctx.save()
    ctx.translate(x, y)
    if (squeeze !== 1) ctx.scale(1, squeeze) // half-width: shorter along the column, same width
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
 * Art for one tail, laid out by `tailEndLayout` (the stripes themselves are part of the
 * belt's material, not drawn here). The first text sits nearest the knot, reading top to bottom.
 * Text is never clamped: if it doesn't fit it simply continues up the tail.
 */
export function drawTailArt(opts: {
  tailLength: number
  width: number
  texts: TailText[]
  logo: boolean
  /** Stripes on this tail, which the text has to clear. */
  stripes: number
  /** The belt's stitching thread color, for the label's border. */
  stitchHex: string
}): EmbroideryArt {
  const ppm = Math.min(PPM, MAX_CANVAS / opts.tailLength)
  const W = opts.width * ppm
  const H = opts.tailLength * ppm
  const { color, height, cc, hc } = canvasPair(W, H)
  const texts = opts.texts.filter((t) => t.text.trim())
  const empty = texts.length === 0 && !opts.logo

  if (opts.logo) {
    const lw = W * LABEL_WIDTH_FRACTION
    const lh = LABEL_LENGTH * ppm
    const lx = (W - lw) / 2
    const ly = H - (LABEL_END_MARGIN + LABEL_LENGTH) * ppm
    drawLabel(cc, lx, ly, lw, lh, false, opts.stitchHex)
    drawLabel(hc, lx, ly, lw, lh, true, opts.stitchHex)
  }

  let cursor = H - tailEndLayout(opts.width, opts.logo, opts.stripes).textFromTip * ppm // bottom of the free space, moving up

  const px = W * 0.7
  for (const t of [...texts].reverse()) {
    const squeeze = t.charWidth === 'half' ? HALF_WIDTH_SQUEEZE : 1
    const pitch = px * 1.05 * squeeze
    const chars = Array.from(t.text.trim())
    const top = cursor - chars.length * pitch
    const strokeWidth = px * STROKE_BY_WEIGHT[t.weight]
    for (const [ctx, isHeight] of [
      [cc, false],
      [hc, true],
    ] as const) {
      ctx.font = canvasFont(EMBROIDERY_FONT, px)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.lineWidth = strokeWidth
      const fill = isHeight ? '#fff' : threadColor(t.color).hex
      ctx.fillStyle = fill
      ctx.strokeStyle = fill
      if (isHeight) ctx.filter = `blur(${Math.max(1, px * 0.02)}px)`
      drawVerticalText(ctx, chars, W / 2, top, pitch, strokeWidth, squeeze)
      ctx.filter = 'none'
    }
    cursor = top - W * 0.5
  }

  satinSheen(cc, color.width, color.height, Math.max(2, px * 0.03))
  return toArt(color, height, empty)
}

/**
 * Generic woven brand label: black base edged with a running stitch (`stitchHex`: the
 * belt's own stitching thread on a tail, white on the jacket), a red mark, the red name,
 * and small white "MADE IN JAPAN" along the bottom.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  isHeight: boolean,
  stitchHex: string,
) {
  const { black, red, mark, name, origin } = BRAND_LABEL
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Black woven base.
  ctx.fillStyle = isHeight ? '#777' : black
  roundRect(ctx, x, y, w, h, w * 0.06)
  ctx.fill()
  // Running-stitch border just inside the edge (raised thread in the height map).
  const inset = w * 0.075
  ctx.strokeStyle = isHeight ? '#fff' : stitchHex
  ctx.lineWidth = w * 0.022
  ctx.lineCap = 'round'
  ctx.setLineDash([w * 0.045, w * 0.03])
  roundRect(ctx, x + inset, y + inset, w - 2 * inset, h - 2 * inset, w * 0.04)
  ctx.stroke()
  ctx.setLineDash([])
  // Red mark.
  ctx.fillStyle = isHeight ? '#fff' : red
  ctx.font = canvasFont('mincho', Math.min(w * 0.58, h * 0.36))
  ctx.fillText(mark, x + w / 2, y + h * 0.37)
  // Red name.
  ctx.font = canvasFont('gothic', w * 0.17)
  ctx.fillText(name, x + w / 2, y + h * 0.68, w * 0.74)
  // Small white origin line.
  ctx.fillStyle = isHeight ? '#bbb' : '#cfcac0'
  ctx.font = canvasFont('gothic', w * 0.075)
  ctx.fillText(origin, x + w / 2, y + h * 0.83, w * 0.74)
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

export interface HemArt extends EmbroideryArt {
  /** Height / width of the art, for sizing the decal. */
  aspect: number
}

/**
 * Hem embroidery: brush-font text in one vertical column (top to bottom), with the
 * brand label below it if requested — written up the jacket's front edge from the hem.
 * Drawn on a transparent canvas for a decal.
 */
export function drawHemArt(text: string, colorHex: string, withLabel: boolean): HemArt {
  const chars = Array.from(text.trim())
  const W = 256
  const px = 210
  const pitch = px * 1.06
  const labelW = W * 0.9
  const labelH = labelW * LABEL_ASPECT
  const gap = chars.length && withLabel ? W * 0.3 : 0
  const textH = chars.length * pitch
  const H = Math.max(1, textH + gap + (withLabel ? labelH : 0) + W * 0.1)
  const { color, height, cc, hc } = canvasPair(W, H)
  const y0 = W * 0.05

  for (const [ctx, isHeight] of [
    [cc, false],
    [hc, true],
  ] as const) {
    ctx.font = canvasFont(EMBROIDERY_FONT, px)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = px * STROKE_BY_WEIGHT[3]
    ctx.fillStyle = isHeight ? '#fff' : colorHex
    ctx.strokeStyle = ctx.fillStyle
    if (isHeight) ctx.filter = 'blur(3px)'
    drawVerticalText(ctx, chars, W / 2, y0, pitch, ctx.lineWidth)
    ctx.filter = 'none'
  }
  satinSheen(cc, color.width, color.height, 5)
  // The label is woven, not satin-stitched: draw it after the sheen.
  if (withLabel) {
    const lx = (W - labelW) / 2
    const ly = y0 + textH + gap
    drawLabel(cc, lx, ly, labelW, labelH, false, GI_THREAD_HEX)
    drawLabel(hc, lx, ly, labelW, labelH, true, GI_THREAD_HEX)
  }
  return { ...toArt(color, height, chars.length === 0 && !withLabel), aspect: H / W }
}
