import {
  mdiCodeBraces,
  mdiCogOutline,
  mdiViewDashboardOutline,
} from '@mdi/js'

/**
 * Fonte única dos módulos: sidebar, dashboard, títulos e histórico leem daqui.
 * (Mesmo papel do src/navigation/vertical/index.js do ReservaSalas.)
 */
export const TOOLS = [
  {
    id: 'json',
    path: '/json',
    title: 'JSON Organizer',
    short: 'JSON',
    icon: mdiCodeBraces,
    accent: 'neon',
    tagline: 'Formate, valide, navegue e visualize JSONs gigantes.',
    features: ['Editor com validação', 'Tree / Graph / Stats / Charts', 'JSONPath', 'Web Worker'],
  },
]

export const NAV_ITEMS = [
  { id: 'dashboard', path: '/', title: 'Dashboard', icon: mdiViewDashboardOutline, section: 'Workspace' },
  ...TOOLS.map((t) => ({ ...t, section: 'Ferramentas' })),
  { id: 'settings', path: '/settings', title: 'Configurações', icon: mdiCogOutline, section: 'Sistema' },
]

export function getTool(id) {
  return NAV_ITEMS.find((t) => t.id === id)
}

export function getNavByPath(pathname) {
  if (pathname === '/') return NAV_ITEMS[0]
  return NAV_ITEMS.find((t) => t.path !== '/' && pathname.startsWith(t.path))
}
