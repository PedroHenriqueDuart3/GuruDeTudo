import { useMemo, useRef } from 'react'
import { Link } from 'react-router'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { mdiArrowDown, mdiConsoleLine } from '@mdi/js'
import Icon from '@core/components/Icon'
import Button from '@core/components/Button'
import { Kbd } from '@core/components/ui'
import { TOOLS } from '@/navigation'
import { useSettings } from '@/stores/settings'

/**
 * Entrada do workspace: um terminal "inicializa" o ambiente com informações REAIS do
 * navegador (núcleos para workers, fuso, tema), sobre um fundo de grade com profundidade.
 */
export default function Hero() {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const y1 = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 160])
  const y2 = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -90])
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, reduce ? 1 : 0])
  const { timezone, theme } = useSettings()

  const lines = useMemo(() => {
    const cores = navigator.hardwareConcurrency
    return [
      { p: '$', t: 'workspace init --local' },
      { ok: true, t: `${TOOLS.length} módulos carregados: ${TOOLS.map((t) => t.short).join(' · ')}` },
      { ok: true, t: `Web Workers disponíveis${cores ? ` · ${cores} núcleos lógicos` : ''}` },
      { ok: true, t: `fuso horário: ${timezone}` },
      { ok: true, t: `tema: ${theme === 'system' ? 'sistema' : theme === 'dark' ? 'escuro' : 'claro'} · movimento: ${reduce ? 'reduzido' : 'completo'}` },
      { ok: true, t: 'processamento 100% local — nenhum dado sai do navegador' },
      { p: '$', t: 'pronto', cursor: true },
    ]
  }, [timezone, theme, reduce])

  return (
    <section ref={ref} className="hero">
      <motion.div className="hero__bg grid-bg" style={{ y: y1 }} aria-hidden />
      <motion.div className="hero__orb hero__orb--a" style={{ y: y2 }} aria-hidden />
      <motion.div className="hero__orb hero__orb--b" style={{ y: y1 }} aria-hidden />

      <motion.div className="hero__content" style={{ opacity: fade }}>
        <motion.span className="hero__eyebrow mono" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <span className="hero__pulse" /> DevTools Workspace
        </motion.span>
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.08 }}>
          Ferramentas de desenvolvimento
          <br />
          <span className="hero__grad">em um só ambiente.</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.16 }}>
          JSON gigantes, expressões CRON, XML legível e diagramas a partir de SQL, com processamento local, desempenho para arquivos grandes e visualizações
          interativas.
        </motion.p>
        <motion.div className="hero__actions" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.24 }}>
          <Link to="/json">
            <Button>Começar pelo JSON Organizer</Button>
          </Link>
          <a href="#modulos" className="btn btn--ghost">
            <Icon path={mdiArrowDown} size={18} />
            <span className="btn__label">Explorar módulos</span>
          </a>
          <span className="hero__hint">
            ou pressione <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd>
          </span>
        </motion.div>
      </motion.div>

      <motion.div className="hero__terminal" initial={{ opacity: 0, y: 24, rotateX: 8 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}>
        <div className="hero__terminal-bar">
          <span />
          <span />
          <span />
          <Icon path={mdiConsoleLine} size={14} />
          <span className="mono">devtools ~ boot</span>
        </div>
        <div className="hero__terminal-body mono">
          {lines.map((l, i) => (
            <motion.div
              key={i}
              className="hero__line"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.45 + i * 0.22, duration: 0.3 }}
            >
              {l.p && <span className="hero__prompt">{l.p}</span>}
              {l.ok && <span className="hero__ok">✓</span>}
              <span>{l.t}</span>
              {l.cursor && <span className="hero__cursor" />}
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  )
}
