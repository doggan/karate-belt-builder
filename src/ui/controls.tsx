import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { THREAD_COLORS, threadColor, type ThreadColorId } from '../config/schema'
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

/**
 * Compact thread-color picker: a button showing the current swatch and catalog code,
 * opening a scrollable list of every color with its code. (A native <select> can't
 * show color swatches.)
 */
export function ThreadSelect({ id, value, onChange }: { id: string; value: ThreadColorId; onChange: (id: ThreadColorId) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const current = threadColor(value)

  useEffect(() => {
    if (!open) return
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    selected?.focus({ preventScroll: true })
    selected?.scrollIntoView({ block: 'nearest' })
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const choose = (color: ThreadColorId) => {
    onChange(color)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const options = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    const i = options.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = options[Math.min(options.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      next?.focus()
      next?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const color = options[i]?.dataset.color as ThreadColorId | undefined
      if (color) choose(color)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className="thread-select" ref={rootRef}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className="thread-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className="thread-dot" style={{ background: current.hex }} />
        <span className="thread-code">{current.label}</span>
        <span className="thread-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul ref={listRef} role="listbox" aria-labelledby={id} className="thread-select-list" onKeyDown={onListKeyDown}>
          {THREAD_COLORS.map((c) => (
            <li
              key={c.id}
              role="option"
              tabIndex={-1}
              aria-selected={c.id === value}
              data-color={c.id}
              onClick={() => choose(c.id)}
            >
              <span className="thread-dot" style={{ background: c.hex }} />
              <span className="thread-code">{c.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface TextInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  id?: string
  lang?: string
  'aria-label': string
  ref?: Ref<HTMLInputElement>
}

/** A text box with an × that clears it (shown once there's something to clear). */
export function TextInput({ value, onChange, ref, ...rest }: TextInputProps) {
  const own = useRef<HTMLInputElement | null>(null)
  const setRef = (el: HTMLInputElement | null) => {
    own.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }
  return (
    <div className="text-input">
      <input ref={setRef} type="text" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
      {value && (
        <button
          type="button"
          className="text-clear"
          aria-label={`Clear ${rest['aria-label'].toLowerCase()}`}
          title="Clear"
          onClick={() => {
            onChange('')
            own.current?.focus()
          }}
        >
          <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  )
}
