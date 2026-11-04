import { useRef } from 'react'
import { Link } from 'react-router'
import { motion, useMotionValue, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { mdiArrowRight, mdiCheckCircleOutline } from '@mdi/js'
import Icon from '@core/components/Icon'
import Button from '@core/components/Button'

/**
 * Seção "scrollytelling": a cena fica fixa (sticky) enquanto o usuário rola,
 * e o progresso do scroll (0 → 1) dirige a animação da cena.
 * Com redução de movimento, a cena aparece direto no estado final, sem sticky.
 */
export default function ScrollSection({ tool, index, Scene, accent = 'neon' }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const still = useMotionValue(1)
  const progress = reduce ? still : scrollYProgress
  const textOpacity = useTransform(progress, [0, 0.12], [0.35, 1])
  const textY = useTransform(progress, [0, 0.15], [30, 0])
  const barScale = useTransform(progress, [0, 1], [0, 1])
  const reverse = index % 2 === 1

  return (
    <section ref={ref} className={`ss ${reduce ? 'ss--static' : ''}`} aria-labelledby={`ss-${tool.id}`} style={{ '--accent': `var(--c-${accent})`, '--accent-rgb': `var(--c-${accent}-rgb)` }}>
      <div className={`ss__sticky ${reverse ? 'ss__sticky--reverse' : ''}`}>
        <motion.div className="ss__text" style={reduce ? undefined : { opacity: textOpacity, y: textY }}>
          <span className="ss__index mono">
            0{index + 1} <span className="ss__index-line" /> módulo
          </span>
          <h2 id={`ss-${tool.id}`}>{tool.title}</h2>
          <p>{tool.tagline}</p>
          <ul className="ss__features">
            {tool.features.map((f) => (
              <li key={f}>
                <Icon path={mdiCheckCircleOutline} size={16} />
                {f}
              </li>
            ))}
          </ul>
          <Link to={tool.path}>
            <Button appendIcon={mdiArrowRight}>Abrir {tool.title}</Button>
          </Link>
          {!reduce && (
            <div className="ss__progress" aria-hidden>
              <motion.span style={{ scaleX: barScale }} />
            </div>
          )}
        </motion.div>
        <div className="ss__stage" aria-hidden>
          <Scene progress={progress} />
        </div>
      </div>
    </section>
  )
}
