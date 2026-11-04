import { useEffect } from 'react'
import { RouterProvider } from 'react-router'
import { MotionConfig } from 'motion/react'
import { ToastProvider } from '@core/components/Toast'
import { resolveTheme, useSettings } from '@/stores/settings'
import { router } from '@/router'

/** Sincroniza tema e preferência de movimento com o <html> (CSS lê data-theme / data-motion). */
function useAppearance() {
  const theme = useSettings((s) => s.theme)
  const motion = useSettings((s) => s.motion)

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme)
    }
    apply()
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.motion = motion
  }, [motion])

  return motion
}

export default function App() {
  const motion = useAppearance()
  // "user" = segue prefers-reduced-motion do sistema; as outras opções forçam o comportamento
  const reducedMotion = motion === 'reduced' ? 'always' : motion === 'full' ? 'never' : 'user'

  return (
    <MotionConfig reducedMotion={reducedMotion}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </MotionConfig>
  )
}
