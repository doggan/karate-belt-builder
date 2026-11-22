import { useMemo, useState } from 'react'
import {
  BELT_COLORS,
  BELT_SIZES,
  BELT_WIDTHS,
  BUILDS,
  FONTS,
  LOGOS,
  PATCH_STYLES,
  THREAD_COLORS,
  WAIST_SIZES,
  type BeltSizeId,
  type FontId,
  type LogoId,
  type PatchStyleId,
  type TailSide,
  type TextWeight,
  type WaistCm,
} from '../config/schema'
import { computeBeltLayout } from '../scene/beltLayout'
import { downloadScreenshot } from '../scene/canvasHandle'
import { useBeltStore } from '../store'
import { Field, Section, Segmented, Swatches } from './controls'

const TAIL_OPTIONS = [
  { value: 'l', label: 'Left tail' },
  { value: 'r', label: 'Right tail' },
] as const satisfies ReadonlyArray<{ value: TailSide; label: string }>

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

      <Section title="Belt">
        <Field label="Color">
          <Swatches options={BELT_COLORS} value={config.color} onChange={(color) => update({ color })} />
        </Field>
        <Field label="Width">
          <Segmented
            label="Belt width"
            options={BELT_WIDTHS.map((w) => ({ value: w, label: `${w} cm` }))}
            value={config.width}
            onChange={(width) => update({ width })}
          />
        </Field>
        <Field label="Size" htmlFor="belt-size" hint={`Tails hang about ${tailCm} cm`}>
          <select id="belt-size" value={config.size} onChange={(e) => update({ size: e.target.value as BeltSizeId })}>
            {BELT_SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} · for {s.heightCm} cm tall · ~{s.cm} cm
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Embroidery">
        <TextControls index={0} />
        <TextControls index={1} />
      </Section>

      <Section title="Brand label">
        <Field label="Label" htmlFor="logo">
          <select id="logo" value={config.logo} onChange={(e) => update({ logo: e.target.value as LogoId })}>
            {LOGOS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        {config.logo !== 'none' && (
          <Segmented label="Label tail" options={TAIL_OPTIONS} value={config.logoTail} onChange={(logoTail) => update({ logoTail })} />
        )}
      </Section>

      <Section title="Chest patch">
        <Field label="Style" htmlFor="patch">
          <select id="patch" value={config.patch} onChange={(e) => update({ patch: e.target.value as PatchStyleId })}>
            {PATCH_STYLES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        {config.patch !== 'none' && (
          <Field label="Kanji" htmlFor="patch-text">
            <input
              id="patch-text"
              type="text"
              lang="ja"
              placeholder="空手"
              value={config.patchText}
              onChange={(e) => update({ patchText: e.target.value })}
            />
          </Field>
        )}
      </Section>

      <Section title="Body">
        <Field label="Waist (over jacket)" htmlFor="waist">
          <select id="waist" value={config.waist} onChange={(e) => update({ waist: Number(e.target.value) as WaistCm })}>
            {WAIST_SIZES.map((w) => (
              <option key={w} value={w}>
                {w} cm
              </option>
            ))}
          </select>
        </Field>
        <Field label="Build">
          <Segmented
            label="Build"
            options={BUILDS.map((b) => ({ value: b.id, label: b.label }))}
            value={config.build}
            onChange={(build) => update({ build })}
          />
        </Field>
      </Section>

      <div className="actions">
        <button type="button" className="primary" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy share link'}
        </button>
        <div className="actions-row">
          <button type="button" onClick={() => downloadScreenshot(`karate-belt-${config.color}.png`)}>
            Download PNG
          </button>
          <button type="button" className="ghost" onClick={reset}>
            Reset
          </button>
        </div>
      </div>

      <p className="muted small">Colors on screen are approximate. Belt lengths are estimates.</p>
    </aside>
  )
}

function TextControls({ index }: { index: 0 | 1 }) {
  const t = useBeltStore((s) => s.config.texts[index])
  const updateText = useBeltStore((s) => s.updateText)
  const id = `text-${index + 1}`
  const set = (patch: Parameters<typeof updateText>[1]) => updateText(index, patch)

  return (
    <fieldset className="text-group">
      <legend>Text {index + 1}</legend>
      <input
        id={id}
        type="text"
        lang="ja"
        aria-label={`Text ${index + 1}`}
        placeholder={index === 0 ? '空手道' : 'カラテ'}
        value={t.text}
        onChange={(e) => set({ text: e.target.value })}
      />
      {t.text.trim() && (
        <>
          <Segmented label={`Text ${index + 1} tail`} options={TAIL_OPTIONS} value={t.tail} onChange={(tail) => set({ tail })} />
          <Field label="Thread">
            <Swatches small options={THREAD_COLORS} value={t.color} onChange={(color) => set({ color })} />
          </Field>
          <div className="row">
            <Field label="Weight" htmlFor={`${id}-weight`}>
              <input
                id={`${id}-weight`}
                type="range"
                min={1}
                max={5}
                step={1}
                value={t.weight}
                onChange={(e) => set({ weight: Number(e.target.value) as TextWeight })}
              />
            </Field>
            <Field label="Font" htmlFor={`${id}-font`}>
              <select id={`${id}-font`} value={t.font} onChange={(e) => set({ font: e.target.value as FontId })}>
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </>
      )}
    </fieldset>
  )
}
