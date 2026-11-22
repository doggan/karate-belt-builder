import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BELT_COLORS,
  BELT_SIZES,
  BELT_WIDTHS,
  BUILDS,
  FONTS,
  THREAD_COLORS,
  beltColor,
  beltSize,
  threadColor,
  WAIST_SIZES,
  type BeltSizeId,
  type FontId,
  type TailSide,
  type TextWeight,
  type ThreadColorId,
  type WaistCm,
} from '../config/schema'
import { computeBeltLayout } from '../scene/beltLayout'
import { downloadScreenshot } from '../scene/canvasHandle'
import { useBeltStore } from '../store'
import { useUiStore } from '../uiStore'
import { Field, Section, Segmented, Swatches, Toggle, useFlash } from './controls'

const TAIL_OPTIONS = [
  { value: 'l', label: 'Left tail' },
  { value: 'r', label: 'Right tail' },
] as const satisfies ReadonlyArray<{ value: TailSide; label: string }>

const tailName = (t: TailSide) => (t === 'l' ? 'left' : 'right')

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

  const textSummary = config.texts
    .filter((t) => t.text.trim())
    .map((t) => `${t.text.trim()} (${tailName(t.tail)})`)
    .join(' · ')

  return (
    <aside className="panel" aria-label="Belt options">
      <header className="panel-header">
        <h1>Belt Builder</h1>
        <p className="muted">Drag to rotate · scroll or pinch to zoom · click any part to edit it</p>
      </header>

      <Section
        id="belt"
        title="Belt"
        summary={`${beltColor(config.color).label} · ${config.width} cm · size ${beltSize(config.size).label}`}
      >
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
                Size {s.label} · {s.cm} cm{s.heightCm ? ` · ${s.heightCm} cm tall` : ''}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section id="embroidery" title="Tail embroidery" summary={textSummary || 'None'}>
        <EmbroideryControls />
      </Section>

      <Section id="label" title="Brand label" summary={config.logo ? `On ${tailName(config.logoTail)} tail` : 'Hidden'}>
        <Toggle label="Show brand label" checked={config.logo} onChange={(logo) => update({ logo })} />
        {config.logo && (
          <Segmented label="Label tail" options={TAIL_OPTIONS} value={config.logoTail} onChange={(logoTail) => update({ logoTail })} />
        )}
      </Section>

      <Section id="chest" title="Chest kanji" summary={config.chest.show ? config.chest.text || 'On' : 'Off'}>
        <Toggle
          label="Embroider kanji on the chest"
          checked={config.chest.show}
          onChange={(show) => update({ chest: { ...config.chest, show } })}
        />
        {config.chest.show && (
          <>
            <input
              type="text"
              lang="ja"
              aria-label="Chest kanji"
              placeholder="空手道"
              value={config.chest.text}
              onChange={(e) => update({ chest: { ...config.chest, text: e.target.value } })}
            />
            <Field label="Font" htmlFor="chest-font" hint="Embroidered in black, reading top to bottom.">
              <FontSelect id="chest-font" value={config.chest.font} onChange={(font) => update({ chest: { ...config.chest, font } })} />
            </Field>
          </>
        )}
      </Section>

      <Section
        id="body"
        title="Body"
        summary={`${config.waist} cm waist · ${BUILDS.find((b) => b.id === config.build)?.label}`}
      >
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

      <p className="muted small">Colors on screen are approximate. Thread colors are sampled from Shureido’s swatch photo.</p>
    </aside>
  )
}

/**
 * The two text slots. When a tail is clicked in the 3D view, the slot on that tail
 * flashes; if no slot is on that tail yet, a free slot is moved there and focused.
 */
function EmbroideryControls() {
  const pulse = useUiStore((s) => s.pulse)
  const [target, setTarget] = useState<0 | 1 | null>(null)
  const inputs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    const { open, focusTail } = useUiStore.getState()
    if (!pulse || open !== 'embroidery' || !focusTail) return
    const { config, updateText } = useBeltStore.getState()
    let index = config.texts.findIndex((t) => t.tail === focusTail && t.text.trim())
    if (index === -1) {
      index = config.texts.findIndex((t) => !t.text.trim())
      if (index !== -1) {
        updateText(index as 0 | 1, { tail: focusTail })
        // Only auto-focus with a mouse; on touch devices it would pop the keyboard up.
        if (window.matchMedia('(pointer: fine)').matches) inputs.current[index]?.focus({ preventScroll: true })
      }
    }
    setTarget(index === -1 ? null : (index as 0 | 1))
  }, [pulse])

  return (
    <>
      {([0, 1] as const).map((i) => (
        <TextControls key={i} index={i} pulse={pulse} targeted={target === i} inputRef={(el) => (inputs.current[i] = el)} />
      ))}
    </>
  )
}

interface TextControlsProps {
  index: 0 | 1
  pulse: number
  targeted: boolean
  inputRef: (el: HTMLInputElement | null) => void
}

function TextControls({ index, pulse, targeted, inputRef }: TextControlsProps) {
  const t = useBeltStore((s) => s.config.texts[index])
  const updateText = useBeltStore((s) => s.updateText)
  const flash = useFlash(`${pulse}-${targeted}`, targeted)
  const id = `text-${index + 1}`
  const set = (patch: Parameters<typeof updateText>[1]) => updateText(index, patch)

  return (
    <fieldset className={flash ? 'text-group flash' : 'text-group'}>
      <legend>Text {index + 1}</legend>
      <input
        ref={inputRef}
        id={id}
        type="text"
        lang="ja"
        aria-label={`Text ${index + 1}`}
        placeholder={index === 0 ? '空手道' : 'カラテ'}
        value={t.text}
        onChange={(e) => set({ text: e.target.value })}
      />
      <Segmented label={`Text ${index + 1} tail`} options={TAIL_OPTIONS} value={t.tail} onChange={(tail) => set({ tail })} />
      {t.text.trim() && (
        <>
          <ThreadPicker value={t.color} onChange={(color) => set({ color })} />
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
              <FontSelect id={`${id}-font`} value={t.font} onChange={(font) => set({ font })} />
            </Field>
          </div>
        </>
      )}
    </fieldset>
  )
}

function FontSelect({ id, value, onChange }: { id: string; value: FontId; onChange: (font: FontId) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as FontId)}>
      {FONTS.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label}
        </option>
      ))}
    </select>
  )
}

function ThreadPicker({ value, onChange }: { value: ThreadColorId; onChange: (id: ThreadColorId) => void }) {
  return (
    <Field label={`Thread · ${threadColor(value).label}`}>
      <Swatches small options={THREAD_COLORS} value={value} onChange={onChange} />
    </Field>
  )
}
