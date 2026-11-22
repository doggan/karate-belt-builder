import { useMemo, useState } from 'react'
import { BELT_COLORS, BELT_SIZES, BELT_WIDTHS, WAIST_SIZES, type BeltSizeId, type WaistCm } from '../config/schema'
import { computeBeltLayout } from '../scene/beltLayout'
import { downloadScreenshot } from '../scene/canvasHandle'
import { useBeltStore } from '../store'

export function ControlPanel() {
  const config = useBeltStore((s) => s.config)
  const update = useBeltStore((s) => s.update)
  const reset = useBeltStore((s) => s.reset)
  const tailCm = useMemo(() => Math.round(computeBeltLayout(config).tailLength * 100), [config])
  const [copied, setCopied] = useState(false)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copy this link:', window.location.href)
    }
  }

  return (
    <aside className="panel" aria-label="Belt options">
      <header className="panel-header">
        <h1>Belt Builder</h1>
        <p className="muted">Drag to rotate · scroll or pinch to zoom</p>
      </header>

      <section className="field">
        <h2>Color</h2>
        <div className="swatches">
          {BELT_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="swatch"
              style={{ background: c.hex }}
              aria-label={c.label}
              aria-pressed={config.color === c.id}
              title={c.label}
              onClick={() => update({ color: c.id })}
            />
          ))}
        </div>
      </section>

      <section className="field">
        <h2>Width</h2>
        <div className="segmented" role="group" aria-label="Belt width">
          {BELT_WIDTHS.map((w) => (
            <button key={w} type="button" aria-pressed={config.width === w} onClick={() => update({ width: w })}>
              {w} cm
            </button>
          ))}
        </div>
      </section>

      <section className="field">
        <label htmlFor="belt-size">
          <h2>Belt size</h2>
        </label>
        <select
          id="belt-size"
          value={config.size}
          onChange={(e) => update({ size: Number(e.target.value) as BeltSizeId })}
        >
          {BELT_SIZES.map((s) => (
            <option key={s.id} value={s.id}>
              Size {s.id} · {s.cm} cm
            </option>
          ))}
        </select>
      </section>

      <section className="field">
        <label htmlFor="waist">
          <h2>Waist (over jacket)</h2>
        </label>
        <select id="waist" value={config.waist} onChange={(e) => update({ waist: Number(e.target.value) as WaistCm })}>
          {WAIST_SIZES.map((w) => (
            <option key={w} value={w}>
              {w} cm
            </option>
          ))}
        </select>
        <p className="muted">Tails hang about {tailCm} cm</p>
      </section>

      <div className="actions">
        <button type="button" className="primary" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy share link'}
        </button>
        <button type="button" onClick={() => downloadScreenshot(`karate-belt-${config.color}.png`)}>
          Download PNG
        </button>
        <button type="button" className="ghost" onClick={reset}>
          Reset
        </button>
      </div>

      <p className="muted small">Colors on screen are approximate.</p>
    </aside>
  )
}
