import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { mdiKeyboardReturn, mdiMagnify } from '@mdi/js'
import Icon from '@core/components/Icon'
import { cn } from '@core/utils'
import { NAV_ITEMS } from '@/navigation'

/** Navegação rápida por teclado (Ctrl+K): filtra módulos e navega com Enter. */
export default function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef(null)

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return NAV_ITEMS.filter((i) => !q || i.title.toLowerCase().includes(q) || i.tagline?.toLowerCase().includes(q))
  }, [query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const go = (item) => {
    if (!item) return
    navigate(item.path)
    onClose()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      go(items[index])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="palette-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Navegação rápida"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
          >
            <div className="palette__input">
              <Icon path={mdiMagnify} size={18} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setIndex(0)
                }}
                onKeyDown={onKeyDown}
                placeholder="Buscar módulo…"
                aria-label="Buscar módulo"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={items[index] ? `pal-${items[index].id}` : undefined}
              />
            </div>
            <ul className="palette__list" id="palette-list" role="listbox">
              {items.map((item, i) => (
                <li
                  key={item.id}
                  id={`pal-${item.id}`}
                  role="option"
                  aria-selected={i === index}
                  className={cn('palette__item', i === index && 'is-active')}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => go(item)}
                >
                  <Icon path={item.icon} size={18} />
                  <span className="grow">
                    <strong>{item.title}</strong>
                    {item.tagline && <span className="palette__desc">{item.tagline}</span>}
                  </span>
                  {i === index && <Icon path={mdiKeyboardReturn} size={16} className="subtle" />}
                </li>
              ))}
              {items.length === 0 && <li className="palette__empty">Nenhum módulo encontrado.</li>}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
