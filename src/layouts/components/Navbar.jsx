import { Link, useLocation } from 'react-router'
import { mdiChevronRight, mdiCogOutline, mdiMagnify, mdiMenu, mdiStar, mdiStarOutline, mdiWeatherNight, mdiWhiteBalanceSunny } from '@mdi/js'
import Icon from '@core/components/Icon'
import { IconButton } from '@core/components/Button'
import { Kbd } from '@core/components/ui'
import { getNavByPath } from '@/navigation'
import { resolveTheme, useSettings } from '@/stores/settings'
import { useActivity } from '@/stores/activity'

/** Header com identificação da plataforma, módulo ativo e ações globais. */
export default function Navbar({ showMenu, onMenu, onOpenPalette }) {
  const location = useLocation()
  const current = getNavByPath(location.pathname)
  const theme = useSettings((s) => s.theme)
  const setSettings = useSettings((s) => s.set)
  const favorites = useActivity((s) => s.favorites)
  const toggleFavorite = useActivity((s) => s.toggleFavorite)
  const isDark = resolveTheme(theme) === 'dark'
  const isTool = current && !['dashboard', 'settings'].includes(current.id)
  const isFav = isTool && favorites.includes(current.id)

  return (
    <header className="navbar">
      {showMenu && <IconButton icon={mdiMenu} label="Abrir menu" onClick={onMenu} />}

      <nav className="navbar__crumbs" aria-label="Trilha">
        <Link to="/" className="navbar__crumb-root">
          Workspace
        </Link>
        {current && current.id !== 'dashboard' && (
          <>
            <Icon path={mdiChevronRight} size={16} className="subtle" />
            <span className="navbar__crumb-current" aria-current="page">
              <Icon path={current.icon} size={16} />
              {current.title}
            </span>
          </>
        )}
        {isTool && (
          <IconButton
            size="sm"
            icon={isFav ? mdiStar : mdiStarOutline}
            label={isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
            active={isFav}
            onClick={() => toggleFavorite(current.id)}
          />
        )}
      </nav>

      <div className="grow" />

      <button type="button" className="navbar__search" onClick={onOpenPalette} aria-label="Abrir navegação rápida">
        <Icon path={mdiMagnify} size={16} />
        <span>Ir para ferramenta…</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <span className="navbar__status" title="Nenhum dado é enviado a servidores">
        <span className="navbar__status-dot" />
        Local
      </span>

      <IconButton
        icon={isDark ? mdiWhiteBalanceSunny : mdiWeatherNight}
        label={isDark ? 'Usar tema claro' : 'Usar tema escuro'}
        onClick={() => setSettings({ theme: isDark ? 'light' : 'dark' })}
      />
      <Link to="/settings" className="icon-btn" aria-label="Configurações" title="Configurações">
        <Icon path={mdiCogOutline} size={20} />
      </Link>
    </header>
  )
}
