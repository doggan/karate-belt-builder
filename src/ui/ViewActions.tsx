import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref } from 'react'
import { downloadScreenshot } from '../scene/canvasHandle'
import { useBeltStore } from '../store'

/**
 * Bottom-right of the 3D view: what you do with a finished design. Share and download
 * stay in sight; the rarely needed extras (About, Reset all) sit behind a "more" menu.
 */
export function ViewActions() {
  const color = useBeltStore((s) => s.config.color)
  const reset = useBeltStore((s) => s.reset)
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const aboutRef = useRef<HTMLDialogElement>(null)

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
    <>
      <div className="view-actions">
        <button type="button" className="view-share" onClick={copyLink} aria-live="polite">
          {copied ? <CheckIcon /> : <LinkIcon />}
          <span>{copied ? 'Link copied' : 'Share'}</span>
        </button>
        <button
          type="button"
          className="view-icon"
          onClick={() => downloadScreenshot(`karate-belt-${color}.png`)}
          aria-label="Download PNG"
          title="Download PNG"
        >
          <DownloadIcon />
        </button>
        <MoreMenu
          open={menuOpen}
          setOpen={setMenuOpen}
          items={[
            { label: 'About', onSelect: () => aboutRef.current?.showModal() },
            { label: 'Reset all', onSelect: reset },
          ]}
        />
      </div>
      <AboutDialog ref={aboutRef} />
    </>
  )
}

interface MenuItem {
  label: string
  onSelect: () => void
}

/** "⋯" button with a small menu above it. Closes on a pick, Escape, or a click elsewhere. */
function MoreMenu({ open, setOpen, items }: { open: boolean; setOpen: (open: boolean) => void; items: MenuItem[] }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /** Up/down arrows move between items. */
  const onListKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const all = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const i = all.indexOf(document.activeElement as HTMLElement)
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus()
  }

  return (
    <div className="view-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="view-icon"
        aria-label="More"
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon />
      </button>
      {open && (
        <ul ref={listRef} className="view-menu-list" role="menu" onKeyDown={onListKeyDown}>
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** What this is and who made it. A native modal dialog: Escape and the close button dismiss it. */
function AboutDialog({ ref }: { ref: Ref<HTMLDialogElement> }) {
  return (
    <dialog
      ref={ref}
      className="about"
      aria-labelledby="about-title"
      // A click on the backdrop lands on the <dialog> itself.
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
    >
      <form method="dialog" className="about-body">
        <h2 id="about-title">Belt Builder</h2>
        <p>
          Design a karate belt in 3D: pick its color, size and stripes, add embroidery to the tails and the gi, and share
          the result as a link.
        </p>
        <p className="muted">
          Built by{' '}
          <a href="https://shy.am/" target="_blank" rel="noopener noreferrer">
            Shyam Guthikonda
          </a>{' '}
          in 2026
        </p>
        <p className="about-links">
          <a href="https://github.com/doggan/karate-belt-builder" target="_blank" rel="noopener noreferrer">
            <GitHubIcon />
            Source code on GitHub
          </a>
        </p>
        <button type="submit" className="about-close" autoFocus>
          Close
        </button>
      </form>
    </dialog>
  )
}

const iconProps = { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function LinkIcon() {
  return (
    <svg {...iconProps} width={16} height={16}>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg {...iconProps} width={16} height={16}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
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
