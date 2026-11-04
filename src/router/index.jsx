import { lazy } from 'react'
import { createBrowserRouter } from 'react-router'
import DefaultLayout from '@layouts/DefaultLayout'
import NotFound from '@/pages/NotFound'

// Cada módulo é carregado sob demanda (code splitting): o dashboard abre rápido
// e o CodeMirror / D3 só são baixados quando a ferramenta é aberta.
const Dashboard = lazy(() => import('@modules/dashboard/DashboardPage'))
const JsonOrganizer = lazy(() => import('@modules/json/JsonOrganizerPage'))
const CronManager = lazy(() => import('@modules/cron/CronManagerPage'))
const XmlVisualizer = lazy(() => import('@modules/xml/XmlVisualizerPage'))
const DbDiagram = lazy(() => import('@modules/dbdiagram/DbDiagramPage'))
const SqlForge = lazy(() => import('@modules/sqlforge/SqlForgePage'))
const Settings = lazy(() => import('@modules/settings/SettingsPage'))

export const router = createBrowserRouter([
  {
    path: '/',
    element: <DefaultLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'json', element: <JsonOrganizer /> },
      { path: 'cron', element: <CronManager /> },
      { path: 'xml', element: <XmlVisualizer /> },
      { path: 'db-diagram', element: <DbDiagram /> },
      { path: 'sql-forge', element: <SqlForge /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
