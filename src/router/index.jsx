import { lazy } from 'react'
import { createBrowserRouter } from 'react-router'
import DefaultLayout from '@layouts/DefaultLayout'
import NotFound from '@/pages/NotFound'

// Cada módulo é carregado sob demanda (code splitting): o dashboard abre rápido
// e o CodeMirror / D3 só são baixados quando a ferramenta é aberta.
const Dashboard = lazy(() => import('@modules/dashboard/DashboardPage'))
const Settings = lazy(() => import('@modules/settings/SettingsPage'))

export const router = createBrowserRouter([
  {
    path: '/',
    element: <DefaultLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
