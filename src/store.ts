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
    const url = `${window.location.pathname}?${encodeConfig(state.config)}${window.location.hash}`
    window.history.replaceState(null, '', url)
  })
}
