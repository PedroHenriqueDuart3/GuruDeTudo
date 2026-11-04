import {
  mdiAnvil,
  mdiCodeBraces,
  mdiCogOutline,
  mdiCubeOutline,
  mdiDatabaseOutline,
  mdiTimerCogOutline,
  mdiViewDashboardOutline,
  mdiXml,
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
  {
    id: 'cron',
    path: '/cron',
    title: 'Cron Manager',
    short: 'CRON',
    icon: mdiTimerCogOutline,
    accent: 'cyan',
    tagline: 'Biblioteca, linguagem natural e construtor visual de CRON.',
    features: ['5, 6 e 7 campos', 'Próximas execuções', 'Timezone', 'Explicação animada'],
  },
  {
    id: 'xml',
    path: '/xml',
    title: 'XML Visualizer',
    short: 'XML',
    icon: mdiXml,
    accent: 'violet',
    tagline: 'Tags neon pareadas, hierarquia visível e árvore navegável.',
    features: ['Pares de tags destacados', 'Guias de hierarquia', 'Árvore estrutural', 'Virtualização'],
  },
  {
    id: 'db',
    path: '/db-diagram',
    title: 'Database Diagram',
    short: 'SQL',
    icon: mdiDatabaseOutline,
    accent: 'neon',
    tagline: 'Transforme CREATE TABLE em diagramas ER interativos.',
    features: ['Parser SQL com AST', 'PK / FK / UNIQUE', 'Layout automático', 'SVG · PNG · DBML'],
  },
  {
    id: 'sqlforge',
    path: '/sql-forge',
    title: 'SQL Forge',
    short: 'T-SQL',
    icon: mdiAnvil,
    accent: 'violet',
    tagline: 'Procedures, views e scripts T-SQL reescritos no padrão do Pedro.',
    features: ['Rio de palavras-chave', 'Vírgula à esquerda', '"=" alinhados', 'Checklist do padrão'],
  },
  {
    id: 'modelgen',
    path: '/models',
    title: 'Model Generator',
    short: 'MODELS',
    icon: mdiCubeOutline,
    accent: 'cyan',
    tagline: 'Tabelas, procedures e JSON viram classes em C#, Java, Kotlin, Python, TypeScript e Go, ou o design do JSON.',
    features: ['6 linguagens + JSON', 'EF Core · JPA · Pydantic · Zod · GORM', 'SQL → JSON de exemplo e JSON Schema', 'Resultado de procedure tipado'],
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
