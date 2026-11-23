import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BELT_COLORS,
  BELT_SIZES,
  MAX_STRIPES,
  STRIPE_COLORS,
  CHEST_SIZES_MM,
  CHAR_WIDTHS,
  TAIL_SIDES,
  beltColor,
  beltSize,
  stripeColor,
  tailIndex,
  WAIST_MAX_CM,
  WAIST_MIN_CM,
  type BeltSizeId,
  type ChestSizeMm,
  type TailSide,
  type TextWeight,
} from '../config/schema'
import { computeBeltLayout } from '../scene/beltLayout'
import { downloadScreenshot, focusCamera, focusWithoutCamera } from '../scene/canvasHandle'
import { useBeltStore } from '../store'
import { useUiStore, type FocusTarget } from '../uiStore'
import { Field, Section, Segmented, Swatches, ThreadSelect, Toggle, useFlash } from './controls'

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

  const textSummary = TAIL_SIDES.map((side) => ({ side, text: config.texts[tailIndex(side)].text.trim() }))
    .filter((t) => t.text)
    .map((t) => `${t.text} (${tailName(t.side)})`)
    .join(' · ')

  return (
    <aside className="panel" aria-label="Belt options">
      <header className="panel-header">
        <h1>Belt Builder</h1>
        <p className="muted">
          <span className="hint-mouse">Drag to rotate · scroll to zoom · right-drag or shift-drag to pan · click any part to edit it</span>
          <span className="hint-touch">Drag to rotate · pinch to zoom · two fingers to pan · tap any part to edit it</span>
        </p>
      </header>

      <Section
        id="belt"
        title="Belt"
        summary={[
          beltColor(config.color).label,
          config.stripes.count ? `${config.stripes.count} ${stripeColor(config.stripes.color).label.toLowerCase()} stripe${config.stripes.count > 1 ? 's' : ''}` : '',
          `size ${beltSize(config.size).label}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      >
        <Field label="Color">
          <Swatches options={BELT_COLORS} value={config.color} onChange={(color) => update({ color })} />
        </Field>
        <FocusGroup target="stripes" title="Stripes">
          <Field label={`Number of stripes · ${config.stripes.count}`} htmlFor="stripe-count">
            <input
              id="stripe-count"
              type="range"
              min={0}
              max={MAX_STRIPES}
              step={1}
              value={config.stripes.count}
              onChange={(e) => update({ stripes: { ...config.stripes, count: Number(e.target.value) } })}
            />
          </Field>
          {config.stripes.count > 0 && (
            <>
              <Field label="Stripe color">
                <Swatches
                  small
                  options={STRIPE_COLORS}
                  value={config.stripes.color}
                  onChange={(color) => update({ stripes: { ...config.stripes, color } })}
                />
              </Field>
              <Segmented
                label="Stripe tail"
                options={TAIL_OPTIONS}
                value={config.stripes.tail}
                onChange={(tail) => update({ stripes: { ...config.stripes, tail } })}
              />
            </>
          )}
        </FocusGroup>
        <Field label="Size" htmlFor="belt-size" hint={`Tails hang about ${tailCm} cm`}>
          <select id="belt-size" value={config.size} onChange={(e) => update({ size: e.target.value as BeltSizeId })}>
            {BELT_SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                Size {s.label} · {s.cm} cm
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section id="embroidery" title="Belt embroidery" summary={[textSummary, config.logo ? 'label' : ''].filter(Boolean).join(' · ') || 'None'}>
        <EmbroideryControls />
        <FocusGroup target="label" title="Brand label">
          <Toggle label="Show brand label" checked={config.logo} onChange={(logo) => update({ logo })} />
          {config.logo && (
            <Segmented label="Label tail" options={TAIL_OPTIONS} value={config.logoTail} onChange={(logoTail) => update({ logoTail })} />
          )}
        </FocusGroup>
      </Section>

      <Section
        id="gi"
        title="Gi embroidery"
        summary={
          [config.chest.show && config.chest.text.trim() ? `chest ${config.chest.text.trim()}` : '', config.hem.show ? `hem ${config.hem.text.trim()}`.trim() : '']
            .filter(Boolean)
            .join(' · ') || 'None'
        }
      >
        <FocusGroup target="chest" title="Chest kanji">
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
              <Field
                label={`Size · ${(config.chest.size / 10).toFixed(1)} cm per character`}
                htmlFor="chest-size"
                hint="Black thread, brush style, reading top to bottom."
              >
                <input
                  id="chest-size"
                  type="range"
                  min={CHEST_SIZES_MM[0]}
                  max={CHEST_SIZES_MM[CHEST_SIZES_MM.length - 1]}
                  step={CHEST_SIZES_MM[1] - CHEST_SIZES_MM[0]}
                  value={config.chest.size}
                  onChange={(e) => update({ chest: { ...config.chest, size: Number(e.target.value) as ChestSizeMm } })}
                />
              </Field>
            </>
          )}
        </FocusGroup>

        <FocusGroup target="hem" title="Hem embroidery">
          <Toggle
            label="Embroider at the bottom of the jacket front"
            checked={config.hem.show}
            onChange={(show) => update({ hem: { ...config.hem, show } })}
          />
          {config.hem.show && (
            <>
              <input
                type="text"
                lang="ja"
                aria-label="Hem embroidery text"
                placeholder="山田"
                value={config.hem.text}
                onChange={(e) => update({ hem: { ...config.hem, text: e.target.value } })}
              />
              <p className="muted">Black thread, written up the front edge where the jacket closes, slanted with the collar, just above the hem.</p>
              <Toggle
                label="Include brand label"
                checked={config.hem.label}
                onChange={(label) => update({ hem: { ...config.hem, label } })}
              />
            </>
          )}
        </FocusGroup>
      </Section>

      <Section id="body" title="Body" summary={`${config.waist} cm waist`}>
        <Field label={`Waist (over jacket) · ${config.waist} cm`} htmlFor="waist">
          <input
            id="waist"
            type="range"
            min={WAIST_MIN_CM}
            max={WAIST_MAX_CM}
            step={1}
            value={config.waist}
            onChange={(e) => update({ waist: Number(e.target.value) })}
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
        <p className="credit">
          <span>
            Built by{' '}
            <a href="https://shy.am/" target="_blank" rel="noopener noreferrer">
              Shyam Guthikonda
            </a>{' '}
            in 2026
          </span>
          <a
            className="credit-github"
            href="https://github.com/doggan/karate-belt-builder"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Source code on GitHub"
            title="Source code on GitHub"
          >
            <GitHubIcon />
          </a>
        </p>
      </div>

    </aside>
  )
}

/** GitHub's mark, inline so it needs no extra request. */
function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

/**
 * One group per tail. Clicking a tail in the 3D view flashes its group, and puts the
 * cursor in its text box if it's still empty (mouse only — on touch it would pop the keyboard up).
 */
function EmbroideryControls() {
  const pulse = useUiStore((s) => s.pulse)
  const [target, setTarget] = useState<TailSide | null>(null)
  const inputs = useRef<Partial<Record<TailSide, HTMLInputElement | null>>>({})

  useEffect(() => {
    const { open, focusTarget } = useUiStore.getState()
    const tail = focusTarget === 'l' || focusTarget === 'r' ? focusTarget : null
    if (!pulse || open !== 'embroidery' || !tail) return setTarget(null)
    setTarget(tail)
    const empty = !useBeltStore.getState().config.texts[tailIndex(tail)].text.trim()
    if (empty && window.matchMedia('(pointer: fine)').matches) focusWithoutCamera(inputs.current[tail])
  }, [pulse])

  return (
    <>
      {TAIL_SIDES.map((side) => (
        <TailTextControls
          key={side}
          side={side}
          pulse={pulse}
          targeted={target === side}
          inputRef={(el) => (inputs.current[side] = el)}
        />
      ))}
    </>
  )
}

interface TailTextControlsProps {
  side: TailSide
  pulse: number
  targeted: boolean
  inputRef: (el: HTMLInputElement | null) => void
}

function TailTextControls({ side, pulse, targeted, inputRef }: TailTextControlsProps) {
  const index = tailIndex(side)
  const t = useBeltStore((s) => s.config.texts[index])
  const updateText = useBeltStore((s) => s.updateText)
  const flash = useFlash(`${pulse}-${targeted}`, targeted)
  const title = side === 'l' ? 'Left tail' : 'Right tail'
  const id = `tail-${side}`
  const set = (patch: Parameters<typeof updateText>[1]) => updateText(index, patch)

  return (
    <fieldset className={flash ? 'text-group flash' : 'text-group'} {...cameraFocus(side)}>
      <legend>{title}</legend>
      <input
        ref={inputRef}
        id={id}
        type="text"
        lang="ja"
        aria-label={`${title} text`}
        placeholder={side === 'l' ? '空手道' : 'カラテ'}
        value={t.text}
        onChange={(e) => set({ text: e.target.value })}
      />
      {t.text.trim() && (
        <>
          <Field label="Thread" htmlFor={`${id}-thread`}>
            <ThreadSelect id={`${id}-thread`} value={t.color} onChange={(color) => set({ color })} />
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
            <Field label="Characters">
              <Segmented
                label={`${title} character width`}
                options={CHAR_WIDTHS.map((c) => ({ value: c.id, label: c.id === 'full' ? 'Full' : 'Half' }))}
                value={t.charWidth}
                onChange={(charWidth) => set({ charWidth })}
              />
            </Field>
          </div>
        </>
      )}
    </fieldset>
  )
}

/**
 * Editing a group (focusing or pressing any control in it) glides the camera to that part.
 * Pointer-down covers browsers that don't focus buttons on click (Safari).
 */
const cameraFocus = (target: FocusTarget) => ({
  onFocus: () => focusCamera(target),
  onPointerDown: () => focusCamera(target),
})

/** A titled group inside a section that flashes when a click in the 3D view points at it. */
function FocusGroup({ target, title, children }: { target: FocusTarget; title: string; children: ReactNode }) {
  const pulse = useUiStore((s) => s.pulse)
  const targeted = useUiStore((s) => s.focusTarget === target)
  const flash = useFlash(pulse, targeted && pulse > 0)
  return (
    <fieldset className={flash ? 'text-group flash' : 'text-group'} {...cameraFocus(target)}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}
