import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUiStore, type SectionId } from '../uiStore'

/** How long a section or field stays highlighted after a click in the 3D view (ms). */
export const FLASH_MS = 1000

/** Briefly true whenever `trigger` changes (and `when` holds). */
export function useFlash(trigger: unknown, when: boolean): boolean {
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!when) return
    setFlash(true)
    const t = window.setTimeout(() => setFlash(false), FLASH_MS)
    return () => window.clearTimeout(t)
  }, [trigger])
  return flash
}

/**
 * Accordion section: only one is open at a time (see uiStore). When collapsed it shows
 * a one-line summary of its current values. Clicking the matching part of the 3D model
 * opens it, scrolls it into view and flashes it.
 */
export function Section({ id, title, summary, children }: { id: SectionId; title: string; summary?: string; children: ReactNode }) {
  const open = useUiStore((s) => s.open === id)
  const pulse = useUiStore((s) => s.pulse)
  const ref = useRef<HTMLDetailsElement>(null)
  const targeted = pulse > 0 && open
  const flash = useFlash(pulse, targeted)

  useEffect(() => {
    if (targeted) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [pulse])

  return (
    <details ref={ref} className={flash ? 'section flash' : 'section'} open={open}>
      <summary
        onClick={(e) => {
          e.preventDefault()
          useUiStore.getState().setOpen(open ? null : id)
        }}
      >
        <span className="section-title">{title}</span>
        {!open && summary && <span className="section-summary">{summary}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  )
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      {htmlFor ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      {children}
      {hint && <p className="muted">{hint}</p>}
    </div>
  )
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Swatches<T extends string>({
  options,
  value,
  onChange,
  small,
}: {
  options: ReadonlyArray<{ id: T; label: string; hex: string }>
  value: T
  onChange: (value: T) => void
  small?: boolean
}) {
  return (
    <div className={small ? 'swatches small' : 'swatches'}>
      {options.map((c) => (
        <button
          key={c.id}
          type="button"
          className="swatch"
          style={{ background: c.hex }}
          aria-label={c.label}
          aria-pressed={value === c.id}
          title={c.label}
          onClick={() => onChange(c.id)}
        />
      ))}
    </div>
  )
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
