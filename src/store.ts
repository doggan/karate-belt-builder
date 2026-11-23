import { create } from 'zustand'
import { DEFAULT_CONFIG, type BeltConfig, type TailText } from './config/schema'
import { decodeConfig, encodeConfig } from './config/url'

interface BeltStore {
  config: BeltConfig
  update: (patch: Partial<BeltConfig>) => void
  updateText: (index: 0 | 1, patch: Partial<TailText>) => void
  reset: () => void
}

export const useBeltStore = create<BeltStore>((set) => ({
  config: decodeConfig(window.location.search),
  update: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
  updateText: (index, patch) =>
    set((s) => {
      const texts = [...s.config.texts] as BeltConfig['texts']
      texts[index] = { ...texts[index], ...patch }
      return { config: { ...s.config, texts } }
    }),
  reset: () => set({ config: DEFAULT_CONFIG }),
}))

/** Keep the address bar equal to the current config, so it is always the share link. */
export function syncConfigToUrl(): () => void {
  return useBeltStore.subscribe((state, prev) => {
    if (state.config === prev.config) return
    // Relative to the current address ("?…"), so whatever path the page was opened at is
    // kept as is. (Prefixing the pathname breaks on a path like "//", which would read as
    // another host and make the browser refuse the change.) Never let this get in the way
    // of editing: a failed sync just leaves the old address.
    try {
      window.history.replaceState(null, '', `?${encodeConfig(state.config)}${window.location.hash}`)
    } catch (err) {
      console.warn('Could not update the share link in the address bar', err)
    }
  })
}
