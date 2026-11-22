import type { ReactNode } from 'react'

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>{title}</summary>
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
