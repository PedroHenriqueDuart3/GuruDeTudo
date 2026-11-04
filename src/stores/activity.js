import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_HISTORY = 60

/**
 * Histórico local de atividades, ferramentas recentes e favoritas.
 * Só registra ações reais executadas pelo usuário (nada é pré-populado).
 * O conteúdo dos arquivos nunca é salvo — apenas metadados (ex.: tamanho).
 */
export const useActivity = create(
  persist(
    (set, get) => ({
      history: [], // { id, tool, action, detail, at }
      recent: [], // [{ tool, at }]
      favorites: ['json', 'cron'],

      log(tool, action, detail = '') {
        const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, tool, action, detail, at: Date.now() }
        set((s) => ({ history: [entry, ...s.history].slice(0, MAX_HISTORY) }))
      },

      visit(tool) {
        set((s) => ({
          recent: [{ tool, at: Date.now() }, ...s.recent.filter((r) => r.tool !== tool)].slice(0, 6),
        }))
      },

      toggleFavorite(tool) {
        const favs = get().favorites
        set({ favorites: favs.includes(tool) ? favs.filter((f) => f !== tool) : [...favs, tool] })
      },

      clearHistory: () => set({ history: [], recent: [] }),
      clearFavorites: () => set({ favorites: [] }),
    }),
    { name: 'dtw-activity', version: 1 },
  ),
)
