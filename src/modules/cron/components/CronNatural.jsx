import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { mdiCheck, mdiCommentQuestionOutline, mdiLightbulbOnOutline, mdiPencilOutline, mdiRobotOutline } from '@mdi/js'
import Button from '@core/components/Button'
import Icon from '@core/components/Icon'
import { Alert, Tag } from '@core/components/ui'
import { useDebouncedValue } from '@core/hooks'
import { cn } from '@core/utils'
import { FORMATS } from '../lib/cronSpec'
import { NATURAL_EXAMPLES, interpretNatural } from '../lib/natural'

/**
 * CRON por linguagem natural. A interpretação respeita o formato selecionado e,
 * diante de ambiguidade, pergunta antes de entregar a expressão definitiva.
 */
export default function CronNatural({ format, tz, onResult, onEdit }) {
  const [text, setText] = useState(NATURAL_EXAMPLES[0])
  const [answers, setAnswers] = useState({})
  const debounced = useDebouncedValue(text, 250)

  const result = useMemo(() => interpretNatural(debounced, { format, answers }), [debounced, format, answers])

  // repassa a expressão para o inspetor somente quando está definitiva
  const definitive = result.status === 'ok' ? result.expression : null
  useEffect(() => {
    onResult(definitive, result.format)
  }, [definitive, result.format, onResult])

  const setInput = (t) => {
    setText(t)
    setAnswers({})
  }

  return (
    <div className="cn">
      <label className="cn__label" htmlFor="cn-input">
        <Icon path={mdiRobotOutline} size={18} /> Descreva o agendamento em português
      </label>
      <div className="cn__input-wrap">
        <textarea
          id="cn-input"
          className="input cn__input"
          rows={2}
          value={text}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ex.: a cada 2 horas, de segunda a sexta"
        />
        <span className="cn__scan" aria-hidden />
      </div>
      <div className="cn__examples" aria-label="Exemplos">
        <Icon path={mdiLightbulbOnOutline} size={14} className="subtle" />
        {NATURAL_EXAMPLES.map((ex) => (
          <button key={ex} type="button" className={cn('cn__example', ex === text && 'is-active')} onClick={() => setInput(ex)}>
            {ex}
          </button>
        ))}
      </div>

      <div className="cn__context">
        <Tag variant="info">{FORMATS[result.format].label}</Tag>
        <Tag variant="neutral">{tz}</Tag>
        {result.format !== format && <Tag variant="warning">formato ajustado</Tag>}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={result.status + result.expression} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {result.status === 'unknown' && (
            <Alert kind="info" title="Não reconheci um agendamento nesse texto">
              Tente informar frequência e horário, por exemplo: “toda sexta às 18h” ou “a cada 10 minutos em dias úteis”.
            </Alert>
          )}

          {result.status === 'clarify' && (
            <div className="cn__clarify">
              <div className="cn__clarify-head">
                <Icon path={mdiCommentQuestionOutline} size={18} /> Preciso de um esclarecimento antes de gerar a expressão
              </div>
              {result.clarifications.map((c) => (
                <div key={c.id} className="cn__question">
                  <p>{c.question}</p>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    {c.options.map((o) => (
                      <Button key={String(o.value)} size="sm" variant="outlined" onClick={() => setAnswers((a) => ({ ...a, [c.id]: o.value }))}>
                        {o.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="subtle cn__provisional">
                Prévia provisória: <code>{result.expression}</code>
              </p>
            </div>
          )}

          {result.status === 'unsupported' && (
            <Alert kind="warning" title="Limitação do formato CRON">
              {result.warnings.join(' ')}
              {result.alternatives.length > 0 && (
                <span className="cn__alts">
                  {result.alternatives.map((a) => (
                    <code key={a.expression}>
                      {a.label}: {a.expression}
                    </code>
                  ))}
                </span>
              )}
            </Alert>
          )}

          {result.status === 'ok' && (
            <div className="cn__result">
              <div className="cn__result-expr">
                <Icon path={mdiCheck} size={18} className="cn__ok" />
                <code>{result.expression}</code>
                <span className="grow" />
                <Button size="sm" variant="ghost" icon={mdiPencilOutline} onClick={() => onEdit(result.expression, result.format)}>
                  Ajustar no construtor
                </Button>
              </div>
              {result.understood.length > 0 && (
                <div className="cn__understood">
                  <span className="subtle">Entendi:</span>
                  {result.understood.map((u, i) => (
                    <Tag key={i} variant="cyan" title={u.as}>
                      “{u.text}” → {u.as}
                    </Tag>
                  ))}
                </div>
              )}
              {result.notes.map((n, i) => (
                <Alert key={`n${i}`} kind="info">
                  {n}
                </Alert>
              ))}
              {result.warnings.map((w, i) => (
                <Alert key={`w${i}`} kind="warning">
                  {w}
                </Alert>
              ))}
              {result.alternatives.length > 0 && (
                <div className="cn__alts">
                  <span className="subtle">Expressões adicionais necessárias:</span>
                  {result.alternatives.map((a) => (
                    <code key={a.expression}>
                      {a.label}: {a.expression}
                    </code>
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
