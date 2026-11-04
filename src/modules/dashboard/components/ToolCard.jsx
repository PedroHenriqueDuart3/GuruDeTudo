import { useRef } from 'react'
import { useNavigate } from 'react-router'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { mdiArrowRight, mdiStar, mdiStarOutline } from '@mdi/js'
import { IconButton } from '@core/components/Button'
import Icon from '@core/components/Icon'
import { cn } from '@core/utils'
import { useActivity } from '@/stores/activity'

/** Card de ferramenta com inclinação sutil e brilho que segue o ponteiro. */
export default function ToolCard({ tool, index }) {
  const navigate = useNavigate()
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const favorites = useActivity((s) => s.favorites)
  const toggleFavorite = useActivity((s) => s.toggleFavorite)
  const isFav = favorites.includes(tool.id)

  const mx = useMotionValue(0.5)
  const my = useMotionValue(0.5)
  const rx = useSpring(useTransform(my, [0, 1], [4, -4]), { stiffness: 200, damping: 20 })
  const ry = useSpring(useTransform(mx, [0, 1], [-5, 5]), { stiffness: 200, damping: 20 })
  const glowX = useTransform(mx, (v) => `${v * 100}%`)
  const glowY = useTransform(my, (v) => `${v * 100}%`)

  const onMove = (e) => {
    if (reduce) return
    const r = ref.current.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width)
    my.set((e.clientY - r.top) / r.height)
  }

  return (
    <motion.article
      ref={ref}
      className={cn('tool-card', `tool-card--${tool.accent}`)}
      style={reduce ? undefined : { rotateX: rx, rotateY: ry, '--gx': glowX, '--gy': glowY }}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay: index * 0.07, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      onPointerMove={onMove}
      onPointerLeave={() => (mx.set(0.5), my.set(0.5))}
      onClick={() => navigate(tool.path)}
      tabIndex={0}
      role="link"
      aria-label={`Abrir ${tool.title}`}
      onKeyDown={(e) => e.key === 'Enter' && navigate(tool.path)}
    >
      <div className="tool-card__glow" aria-hidden />
      <header className="tool-card__head">
        <span className="tool-card__icon">
          <Icon path={tool.icon} size={24} />
        </span>
        <span className="tool-card__tag mono">{tool.short}</span>
        <span className="grow" />
        <IconButton
          size="sm"
          icon={isFav ? mdiStar : mdiStarOutline}
          label={isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          active={isFav}
          className="tool-card__fav"
          onClick={(e) => {
            e.stopPropagation()
            toggleFavorite(tool.id)
          }}
        />
      </header>
      <h3>{tool.title}</h3>
      <p>{tool.tagline}</p>
      <ul className="tool-card__features">
        {tool.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <span className="tool-card__open">
        Abrir <Icon path={mdiArrowRight} size={16} />
      </span>
    </motion.article>
  )
}
