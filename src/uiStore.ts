import { create } from 'zustand'

/** Control panel sections; also the "parts" you can click in the 3D view. */
export type SectionId = 'belt' | 'embroidery' | 'gi' | 'body'

/** A specific group inside a section that a click in the 3D view points at. */
export type FocusTarget = 'l' | 'r' | 'label' | 'chest' | 'hem'

interface UiStore {
  /** The one open accordion section (null = all collapsed). */
  open: SectionId | null
  /** Bumped on every click in the 3D view, so the panel re-scrolls and flashes even for the same section. */
  pulse: number
  /** The group the last 3D click pointed at (e.g. a tail, the brand label, the chest kanji). */
  focusTarget: FocusTarget | null
  /** True once the gi model has loaded and the scene is showing. */
  sceneReady: boolean
  setOpen: (id: SectionId | null) => void
  focusPart: (id: SectionId, target?: FocusTarget) => void
  setSceneReady: () => void
}

export const useUiStore = create<UiStore>((set) => ({
  open: 'belt',
  pulse: 0,
  focusTarget: null,
  sceneReady: false,
  setOpen: (open) => set({ open, focusTarget: null }),
  focusPart: (open, target) => set((s) => ({ open, pulse: s.pulse + 1, focusTarget: target ?? null })),
  setSceneReady: () => set({ sceneReady: true }),
}))
