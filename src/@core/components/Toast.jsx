import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiClose, mdiInformationOutline } from '@mdi/js'
import Icon from './Icon'

/**
 * Sistema de toasts (feedback de ações). Equivalente ao Toast.vue/ApiErrorToast do ReservaSalas,
 * mas global via contexto: qualquer componente chama `toast.success('...')`.
 */
const ToastContext = createContext(null)

const ICONS = {
  success: mdiCheckCircleOutline,
  error: mdiAlertCircleOutline,
  info: mdiInformationOutline,
  warning: mdiAlertCircleOutline,
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const seq = useRef(0)

  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), [])

  const push = useCallback(
    (kind, message, { description, duration } = {}) => {
      const id = ++seq.current
      setItems((list) => [...list.slice(-3), { id, kind, message, description }])
      setTimeout(() => dismiss(id), duration ?? (kind === 'error' ? 6000 : 3200))
      return id
    },
    [dismiss],
  )

  const api = useMemo(
    () => ({
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m, o),
      info: (m, o) => push('info', m, o),
      warning: (m, o) => push('warning', m, o),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="region" aria-label="Notificações" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              className={`toast toast--${t.kind}`}
              role={t.kind === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <Icon path={ICONS[t.kind]} size={20} className="toast__icon" />
              <div className="grow">
                <div className="toast__title">{t.message}</div>
                {t.description && <div className="toast__desc">{t.description}</div>}
              </div>
              <button type="button" className="toast__close" aria-label="Fechar notificação" onClick={() => dismiss(t.id)}>
                <Icon path={mdiClose} size={16} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>')
  return ctx
}
