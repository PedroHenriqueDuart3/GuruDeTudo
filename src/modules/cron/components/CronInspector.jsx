import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiContentCopy, mdiPause, mdiPlay, mdiTimerSandComplete } from '@mdi/js'
import Button, { IconButton } from '@core/components/Button'
import Icon from '@core/components/Icon'
import { useToast } from '@core/components/Toast'
import { Alert, Tag } from '@core/components/ui'
import { useInterval } from '@core/hooks'
import { cn, copyToClipboard } from '@core/utils'
import { useActivity } from '@/stores/activity'
import { DOW_PT_SHORT, FORMATS, MONTHS_PT_SHORT } from '../lib/cronSpec'
import { formatRun, relativeTime } from '../useCronAnalysis'

/**
 * Painel de inspeção: a expressão campo a campo (com destaque animado em sequência),
 * descrição em linguagem natural, validação, próximas execuções e linha do tempo.
 */
export default function CronInspector({ analysis, tz, title = 'Expressão', compact = false }) {
  const { parsed, description, fields, runs } = analysis
  const toast = useToast()
  const log = useActivity((s) => s.log)
  const reduce = useReducedMotion()
  const [active, setActive] = useState(0)
  const [playing, setPlaying] = useState(!reduce)
  const errorKeys = new Set(parsed.errors.map((e) => e.key).filter(Boolean))

  // reinicia a explicação quando a expressão muda
  useEffect(() => setActive(0), [parsed.expression])
  useInterval(() => setActive((a) => (fields.length ? (a + 1) % fields.length : 0)), playing && fields.length > 1 ? 2200 : null)

  const copy = async () => {
    try {
      await copyToClipboard(parsed.expression)
      toast.success('Expressão copiada', { description: parsed.expression })
      log('cron', 'Expressão copiada', parsed.expression)
    } catch (e) {
      toast.error('Não foi possível copiar', { description: e.message })
    }
  }

  const current = fields[active]
  const withSeconds = parsed.format && parsed.format !== 'unix'

  return (
    <section className={cn('ci', compact && 'ci--compact')} aria-label="Inspeção da expressão CRON">
      <header className="ci__head">
        <span className="ci__title">{title}</span>
        {parsed.format && <Tag variant="info">{FORMATS[parsed.format].label}</Tag>}
        {parsed.macro && <Tag variant="violet">{parsed.macro}</Tag>}
        <span className="grow" />
        {parsed.ok ? (
          <Tag variant="success" icon={mdiCheckCircleOutline}>
            válida
          </Tag>
        ) : (
          <Tag variant="error" icon={mdiAlertCircleOutline}>
            inválida
          </Tag>
        )}
        <Button size="sm" icon={mdiContentCopy} onClick={copy} disabled={!parsed.expression}>
          Copiar
        </Button>
      </header>

      {/* Campos da expressão */}
      <div className="ci__expr" role="tablist" aria-label="Campos da expressão">
        {(fields.length ? fields : parsed.parts.map((raw, index) => ({ raw, index, label: '?', key: index }))).map((f, i) => (
          <motion.button
            key={`${parsed.expression}-${i}`}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={cn('ci__chip', i === active && 'is-active', errorKeys.has(f.key) && 'is-error', f.any && 'is-any')}
            onClick={() => {
              setActive(i)
              setPlaying(false)
            }}
            initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ delay: i * 0.07, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="ci__chip-raw mono">{f.raw}</span>
            <span className="ci__chip-label">{f.label}</span>
            {i === active && <motion.span layoutId="ci-underline" className="ci__chip-bar" transition={{ type: 'spring', stiffness: 480, damping: 36 }} />}
          </motion.button>
        ))}
        {fields.length > 1 && (
          <IconButton size="sm" icon={playing ? mdiPause : mdiPlay} label={playing ? 'Pausar explicação' : 'Reproduzir explicação'} onClick={() => setPlaying((p) => !p)} />
        )}
      </div>

      {/* Erros de validação */}
      {!parsed.ok && (
        <div className="ci__errors">
          {parsed.errors.map((e, i) => (
            <Alert key={i} kind="error" title={e.key ? `Campo ${e.index + 1} — ${fields.find((f) => f.key === e.key)?.label ?? ''}` : 'Expressão inválida'}>
              {e.message}
            </Alert>
          ))}
        </div>
      )}

      {/* Explicação do campo ativo */}
      {current && parsed.ok && (
        <AnimatePresence mode="wait">
          <motion.div
            key={`${parsed.expression}-${current.key}`}
            className="ci__detail"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25 }}
          >
            <div className="ci__detail-head">
              <span className="ci__detail-raw mono">{current.raw}</span>
              <div>
                <div className="ci__detail-label">
                  {current.label} <span className="subtle">· campo {current.index + 1} · intervalo {current.range}</span>
                </div>
                <div className="ci__detail-meaning">{current.meaning}</div>
              </div>
            </div>
            {!compact && <TickRuler field={current} />}
          </motion.div>
        </AnimatePresence>
      )}

      {parsed.ok && (
        <motion.p key={description} className="ci__desc" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          {description}
        </motion.p>
      )}

      {parsed.warnings.map((w, i) => (
        <Alert key={i} kind="warning">
          {w}
        </Alert>
      ))}

      {parsed.ok && (
        <>
          {!compact && <RunTimeline runs={runs} tz={tz} />}
          <div className="ci__runs">
            <div className="ci__runs-head">
              <Icon path={mdiTimerSandComplete} size={16} />
              Próximas execuções <span className="subtle">· {tz}</span>
              <span className="grow" />
              <LiveClock tz={tz} next={runs[0]} withSeconds={withSeconds} />
            </div>
            {runs.length ? (
              <ol className="ci__run-list">
                {runs.slice(0, compact ? 3 : 8).map((r, i) => (
                  <motion.li key={r.getTime()} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
                    <span className="ci__run-dot" />
                    <span className="mono">{formatRun(r, tz, withSeconds)}</span>
                    <span className="subtle">{relativeTime(r)}</span>
                  </motion.li>
                ))}
              </ol>
            ) : (
              <p className="muted">Nenhuma execução encontrada nos próximos anos — a combinação de campos nunca ocorre.</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/** Régua com todos os valores possíveis do campo; os valores ativos acendem em neon. */
function TickRuler({ field }) {
  const { key, min, max } = field
  const active = new Set(field.values)
  const count = max - min + 1
  const label = (v) => (key === 'month' ? MONTHS_PT_SHORT[v - 1] : key === 'dow' ? DOW_PT_SHORT[v] : v)
  const showLabel = (v) => count <= 12 || v % (count > 31 ? 5 : 1) === 0 || (count === 31 && [1, 10, 20, 31].includes(v))
  if (key === 'year') return null
  return (
    <div className={cn('ci__ruler', count <= 12 && 'ci__ruler--wide')} aria-hidden>
      {Array.from({ length: count }, (_, i) => min + i).map((v, i) => (
        <span
          key={v}
          className={cn('ci__tick', active.has(v) && 'is-on', field.special && 'is-special')}
          style={{ animationDelay: `${i * 12}ms` }}
          title={String(label(v))}
        >
          {count <= 31 || showLabel(v) ? <span className="ci__tick-label">{count > 31 && !showLabel(v) ? '' : label(v)}</span> : null}
        </span>
      ))}
    </div>
  )
}

/** Linha do tempo: cada execução é uma partícula posicionada no tempo a partir de agora. */
function RunTimeline({ runs, tz }) {
  if (runs.length < 2) return null
  const now = Date.now()
  const end = runs[runs.length - 1].getTime()
  const span = end - now || 1
  return (
    <div className="ci__timeline" aria-hidden>
      <span className="ci__timeline-now">agora</span>
      <div className="ci__timeline-track">
        <span className="ci__timeline-pulse" />
        {runs.map((r, i) => (
          <span
            key={r.getTime()}
            className="ci__particle"
            style={{ left: `${((r.getTime() - now) / span) * 100}%`, animationDelay: `${i * 90}ms` }}
            title={formatRun(r, tz, false)}
          />
        ))}
      </div>
      <span className="ci__timeline-end">{formatRun(runs[runs.length - 1], tz, false).split(',').slice(0, 2).join(',')}</span>
    </div>
  )
}

function LiveClock({ tz, next, withSeconds }) {
  const [now, setNow] = useState(() => new Date())
  useInterval(() => setNow(new Date()), 1000)
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)
  let countdown = ''
  if (next) {
    let s = Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000))
    const d = Math.floor(s / 86400)
    s -= d * 86400
    const h = Math.floor(s / 3600)
    s -= h * 3600
    const m = Math.floor(s / 60)
    s -= m * 60
    countdown = `${d ? `${d}d ` : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${withSeconds || !d ? `:${String(s).padStart(2, '0')}` : ''}`
  }
  return (
    <span className="ci__clock mono" title="Hora atual no fuso configurado e contagem regressiva para a próxima execução">
      <span className="ci__clock-now">{time}</span>
      {next && <span className="ci__clock-next">próxima em {countdown}</span>}
    </span>
  )
}
