import { create } from 'zustand'
import type { TailSide } from './config/schema'

/** Control panel sections; also the "parts" you can click in the 3D view. */
export type SectionId = 'belt' | 'embroidery' | 'label' | 'chest' | 'hem' | 'body'

interface UiStore {
  /** The one open accordion section (null = all collapsed). */
  open: SectionId | null
  /** Bumped on every click in the 3D view, so the panel re-scrolls and flashes even for the same section. */
  pulse: number
  /** Tail clicked in the 3D view, so the panel can point at that tail's text. */
  focusTail: TailSide | null
  setOpen: (id: SectionId | null) => void
  focusPart: (id: SectionId, tail?: TailSide) => void
}

export const useUiStore = create<UiStore>((set) => ({
  open: 'belt',
  pulse: 0,
  focusTail: null,
  setOpen: (open) => set({ open, focusTail: null }),
  focusPart: (open, tail) => set((s) => ({ open, pulse: s.pulse + 1, focusTail: tail ?? null })),
}))
