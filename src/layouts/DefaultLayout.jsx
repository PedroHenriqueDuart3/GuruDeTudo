import { Suspense, useCallback, useEffect, useState } from 'react'
import { useLocation, useOutlet } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ProgressBar } from '@core/components/ui'
import { useHotkey, useMediaQuery } from '@core/hooks'
import { getNavByPath } from '@/navigation'
import { useActivity } from '@/stores/activity'
import { useSettings } from '@/stores/settings'
import CommandPalette from './components/CommandPalette'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import './layout.css'

/** Mantém o outlet "congelado" durante a animação de saída da rota anterior. */
function AnimatedOutlet() {
  const outlet = useOutlet()
  const [frozen] = useState(outlet)
  return frozen
}

/**
 * Layout padrão (equivale ao DefaultLayoutWithVerticalNav.vue):
 * sidebar + navbar + área de conteúdo com transição entre módulos.
 */
export default function DefaultLayout() {
  const location = useLocation()
  const collapsed = useSettings((s) => s.sidebarCollapsed)
  const setSettings = useSettings((s) => s.set)
  const visit = useActivity((s) => s.visit)
  // Mesmo ponto de quebra do ReservaSalas (md + 16 ≈ 976px) para virar overlay
  const overlay = useMediaQuery('(max-width: 976px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const nav = getNavByPath(location.pathname)
    if (nav && !['dashboard', 'settings'].includes(nav.id)) visit(nav.id)
    document.title = nav && nav.id !== 'dashboard' ? `${nav.title} · DevTools Workspace` : 'DevTools Workspace'
  }, [location.pathname, visit])

  useHotkey('mod+k', useCallback(() => setPaletteOpen((o) => !o), []))

  return (
    <div className={`app-shell ${collapsed && !overlay ? 'is-collapsed' : ''} ${overlay ? 'is-overlay' : ''}`}>
      <a href="#main" className="skip-link">
        Pular para o conteúdo
      </a>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setSettings({ sidebarCollapsed: !collapsed })}
        overlay={overlay}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      <div className="app-main">
        <Navbar showMenu={overlay} onMenu={() => setDrawerOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
        <main id="main" className="app-content" tabIndex={-1}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              className="route-view"
              initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, filter: 'blur(3px)' }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <Suspense
                fallback={
                  <div className="route-loading">
                    <ProgressBar indeterminate label="Carregando módulo" />
                  </div>
                }
              >
                <AnimatedOutlet />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
