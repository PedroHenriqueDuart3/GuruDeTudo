import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'

export const DEFAULT_SETTINGS = {
  theme: 'dark', // dark | light | system
  motion: 'system', // system | reduced | full
  editorFontSize: 13,
  indent: 2,
  wrapLines: false,
  cronFormat: 'unix', // unix | seconds | quartz
  timezone: systemTz,
  sidebarCollapsed: false,
  sqlDialect: 'sqlserver',
}

/** Configurações do usuário — persistidas no localStorage (somente no navegador). */
export const useSettings = create(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    { name: 'dtw-settings', version: 1 },
  ),
)

export function resolveTheme(theme) {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}
