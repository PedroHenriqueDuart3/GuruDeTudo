import { NavLink } from 'react-router'
import { motion } from 'motion/react'
import { mdiChevronLeft, mdiShieldLockOutline, mdiStar } from '@mdi/js'
import Icon from '@core/components/Icon'
import { cn } from '@core/utils'
import { NAV_ITEMS } from '@/navigation'
import { useActivity } from '@/stores/activity'
import Logo from './Logo'

/**
 * Sidebar vertical — mesma estrutura do VerticalNavLayout do ReservaSalas:
 * cabeçalho com logo, seções com título, link ativo destacado e botão circular
 * na borda para recolher. Em telas menores vira um drawer sobreposto.
 */
export default function Sidebar({ collapsed, onToggleCollapse, overlay, open, onClose }) {
  const favorites = useActivity((s) => s.favorites)
  const sections = NAV_ITEMS.reduce((acc, item) => {
    ;(acc[item.section] ??= []).push(item)
    return acc
  }, {})
  const isCollapsed = collapsed && !overlay

  return (
    <>
      {overlay && open && <div className="sidebar-scrim" onClick={onClose} aria-hidden />}
      <aside
        className={cn('sidebar', isCollapsed && 'is-collapsed', overlay && 'is-overlay', overlay && open && 'is-open')}
        aria-label="Navegação principal"
      >
        <div className="sidebar__header">
          <NavLink to="/" className="sidebar__brand" onClick={overlay ? onClose : undefined}>
            <Logo size={32} />
            {!isCollapsed && (
              <span className="sidebar__brand-text">
                <strong>GURU</strong>
                <span>DETUDO</span>
              </span>
            )}
          </NavLink>
          {!overlay && (
            <button
              type="button"
              className={cn('sidebar__collapse', collapsed && 'is-rotated')}
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
              title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            >
              <Icon path={mdiChevronLeft} size={18} />
            </button>
          )}
        </div>

        <nav className="sidebar__nav">
          {Object.entries(sections).map(([section, items]) => (
            <div key={section} className="sidebar__section">
              {isCollapsed ? <span className="sidebar__section-line" /> : <span className="sidebar__section-title">{section}</span>}
              {items.map((item) => (
                <NavLink
                  key={item.id}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) => cn('nav-link', isActive && 'is-active')}
                  title={isCollapsed ? item.title : undefined}
                  onClick={overlay ? onClose : undefined}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="nav-active"
                          className="nav-link__active"
                          transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                        />
                      )}
                      <Icon path={item.icon} size={20} className="nav-link__icon" />
                      {!isCollapsed && <span className="nav-link__label">{item.title}</span>}
                      {!isCollapsed && favorites.includes(item.id) && (
                        <Icon path={mdiStar} size={13} className="nav-link__fav" title="Favorita" />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <Icon path={mdiShieldLockOutline} size={18} />
          {!isCollapsed && (
            <span>
              Processamento <strong>100% local</strong>
              <br />
              <span className="subtle">seus dados não saem do navegador</span>
            </span>
          )}
        </div>
      </aside>
    </>
  )
}
