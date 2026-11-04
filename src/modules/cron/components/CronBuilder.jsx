import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { mdiRestore } from '@mdi/js'
import Button from '@core/components/Button'
import { Alert, Segmented } from '@core/components/ui'
import { cn } from '@core/utils'
import { assemble, parseCron, shiftDowToQuartz } from '../lib/cronEngine'
import { DOW_PT, FIELD_DEFS, FORMATS, MONTHS_PT } from '../lib/cronSpec'

const MODES = [
  { value: 'any', label: 'Qualquer' },
  { value: 'specific', label: 'Específico' },
  { value: 'range', label: 'Intervalo' },
  { value: 'list', label: 'Múltiplos' },
  { value: 'step', label: 'Incremento' },
]

const DEFAULTS = {
  second: { mode: 'specific', value: 0 },
  minute: { mode: 'specific', value: 0 },
  hour: { mode: 'specific', value: 8 },
  dom: { mode: 'any' },
  month: { mode: 'any' },
  dow: { mode: 'range', from: 1, to: 5 },
  year: { mode: 'any' },
}

const ANY_TEXT = {
  second: 'Executa em todos os segundos.',
  minute: 'Executa em todos os minutos.',
  hour: 'Executa em todas as horas.',
  dom: 'Executa em qualquer dia do mês.',
  month: 'Executa em todos os meses.',
  dow: 'Executa em qualquer dia da semana.',
  year: 'Executa em qualquer ano.',
}

const bounds = (key) => (key === 'dow' ? [0, 6] : key === 'year' ? [new Date().getFullYear(), new Date().getFullYear() + 15] : [FIELD_DEFS[key].min, FIELD_DEFS[key].max])
const nameOf = (key, v) => (key === 'month' ? MONTHS_PT[v - 1] : key === 'dow' ? DOW_PT[v] : String(v).padStart(key === 'year' ? 4 : 2, '0'))

/** Estado de um campo → texto canônico (dia da semana Unix 0-6). */
function fieldToText(key, st) {
  switch (st.mode) {
    case 'any':
      return '*'
    case 'specific':
      return String(st.value)
    case 'range':
      return `${st.from}-${st.to}`
    case 'list':
      return st.list?.length ? [...st.list].sort((a, b) => a - b).join(',') : '*'
    case 'step': {
      const base = st.start === '*' ? '*' : st.end !== undefined && st.end !== '' ? `${st.start}-${st.end}` : String(st.start)
      return `${base}/${st.step}`
    }
    case 'special':
      if (key === 'dom') return st.special === 'nW' ? `${st.value}W` : st.special
      return st.special === 'nth' ? `${st.value}#${st.nth}` : `${st.value}L`
    case 'custom':
      return st.raw || '*'
    default:
      return '*'
  }
}

/** Expressão (qualquer formato) → estado do construtor, a partir dos itens normalizados. */
export function stateFromExpression(expression, format) {
  const parsed = parseCron(expression, format)
  if (!parsed.ok) return null
  const out = {}
  for (const key of Object.keys(DEFAULTS)) {
    const f = parsed.fields[key]
    if (!f || f.any || f.question) {
      out[key] = { mode: 'any' }
      continue
    }
    const items = f.items
    const sp = items.find((i) => i.type === 'special')
    if (items.length === 1 && sp) {
      const t = sp.text
      if (key === 'dom') out[key] = /^\d+W$/.test(t) ? { mode: 'special', special: 'nW', value: Number(t.slice(0, -1)) } : { mode: 'special', special: t, value: 1 }
      else if (t.includes('#')) out[key] = { mode: 'special', special: 'nth', value: f.special.nth[0].dow, nth: f.special.nth[0].n }
      else out[key] = { mode: 'special', special: 'last', value: f.special.lastDow[0] }
      continue
    }
    const it = items[0]
    if (items.length === 1 && it.type === 'value') out[key] = { mode: 'specific', value: it.value }
    else if (items.length === 1 && it.type === 'range' && !(key === 'dow' && it.to < it.from)) out[key] = { mode: 'range', from: it.from, to: it.to }
    else if (items.length === 1 && it.type === 'range') out[key] = { mode: 'list', list: f.values } // ex.: "5-7" (sex→dom)
    else if (items.length === 1 && it.type === 'step') out[key] = { mode: 'step', start: it.from === null ? '*' : it.from, step: it.step }
    else if (items.length === 1 && it.type === 'rangeStep') out[key] = { mode: 'step', start: it.from, end: it.to, step: it.step }
    else if (items.every((x) => x.type === 'value')) out[key] = { mode: 'list', list: items.map((x) => x.value) }
    else out[key] = { mode: 'custom', raw: f.values.join(',') }
  }
  return out
}

/** Construtor visual: cada alteração atualiza a expressão em tempo real. */
export default function CronBuilder({ format, seed, onChange }) {
  const [state, setState] = useState(DEFAULTS)

  // carrega uma expressão vinda da biblioteca / linguagem natural
  useEffect(() => {
    if (!seed?.expression) return
    const s = stateFromExpression(seed.expression, seed.format ?? 'auto')
    if (s) setState(s)
  }, [seed])

  const spec = FORMATS[format]
  const keys = spec.fields
  const canonical = useMemo(() => Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, fieldToText(k, state[k])])), [state])
  const expression = useMemo(() => assemble(canonical, format), [canonical, format])

  useEffect(() => {
    onChange(expression)
  }, [expression, onChange])

  const update = (key, patch) => setState((s) => ({ ...s, [key]: { ...s[key], ...patch } }))
  const quartzConflict = format === 'quartz' && canonical.dom !== '*' && canonical.dow !== '*'

  return (
    <div className="cb">
      <div className="cb__head">
        <motion.code key={expression} className="cb__expr" initial={{ opacity: 0.4, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
          {expression.split(' ').map((part, i) => (
            <span key={i} className="cb__expr-part" style={{ '--part-color': `var(--depth-${i % 6})` }}>
              {part}
            </span>
          ))}
        </motion.code>
        <Button size="sm" variant="ghost" icon={mdiRestore} onClick={() => setState(DEFAULTS)}>
          Redefinir
        </Button>
      </div>

      {quartzConflict && (
        <Alert kind="warning" title="Quartz não aceita dia do mês e dia da semana juntos">
          O dia da semana tem prioridade e o dia do mês vira “?”. Defina um deles como “Qualquer”.
        </Alert>
      )}

      <div className="cb__fields">
        {keys.map((key, i) => (
          <FieldEditor
            key={key}
            index={i}
            fieldKey={key}
            state={state[key]}
            format={format}
            text={canonical[key]}
            onChange={(patch) => update(key, patch)}
          />
        ))}
      </div>
    </div>
  )
}

function FieldEditor({ fieldKey: key, index, state: st, format, text, onChange }) {
  const def = FIELD_DEFS[key]
  const [lo, hi] = bounds(key)
  const values = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  const specialAllowed = format === 'quartz' && (key === 'dom' || key === 'dow')
  const modes = [...MODES, ...(specialAllowed ? [{ value: 'special', label: 'Especial' }] : []), ...(st.mode === 'custom' ? [{ value: 'custom', label: 'Personalizado' }] : [])]
  const shownText = key === 'dow' && format === 'quartz' && text !== '*' ? shiftDowToQuartz(text) : text

  const valueSelect = (value, onSel, label) => (
    <select className="input select" value={value} onChange={(e) => onSel(Number(e.target.value))} aria-label={label}>
      {values.map((v) => (
        <option key={v} value={v}>
          {nameOf(key, v)}
        </option>
      ))}
    </select>
  )

  const setMode = (mode) => {
    const base = { mode }
    if (mode === 'specific') base.value = st.value ?? lo
    if (mode === 'range') Object.assign(base, { from: st.from ?? lo, to: st.to ?? Math.min(hi, lo + 4) })
    if (mode === 'list') base.list = st.list ?? [lo]
    if (mode === 'step') Object.assign(base, { start: '*', step: key === 'minute' || key === 'second' ? 15 : 2 })
    if (mode === 'special') Object.assign(base, key === 'dom' ? { special: 'L', value: 15 } : { special: 'nth', value: 1, nth: 1 })
    onChange(base)
  }

  return (
    <motion.fieldset className="cb__field" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
      <legend className="cb__legend">
        <span className="cb__legend-dot" style={{ background: `var(--depth-${index % 6})` }} />
        {def.label}
        <code className="cb__field-text">{shownText}</code>
      </legend>
      <Segmented size="sm" value={st.mode} onChange={setMode} options={modes} ariaLabel={`Modo de ${def.label}`} layoutId={`cb-${key}`} />
      <div className="cb__controls">
        {st.mode === 'any' && <span className="muted">{ANY_TEXT[key]}</span>}
        {st.mode === 'specific' && valueSelect(st.value, (v) => onChange({ value: v }), `${def.label} específico`)}
        {st.mode === 'range' && (
          <>
            de {valueSelect(st.from, (v) => onChange({ from: v, to: Math.max(v, st.to) }), 'Início')} até {valueSelect(st.to, (v) => onChange({ to: v, from: Math.min(v, st.from) }), 'Fim')}
          </>
        )}
        {st.mode === 'list' && (
          <div className={cn('cb__chips', values.length > 31 && 'cb__chips--dense')} role="group" aria-label={`Valores de ${def.label}`}>
            {values.map((v) => {
              const on = st.list?.includes(v)
              return (
                <button
                  key={v}
                  type="button"
                  className={cn('cb__chip', on && 'is-on')}
                  aria-pressed={on}
                  onClick={() => onChange({ list: on ? st.list.filter((x) => x !== v) : [...(st.list ?? []), v] })}
                >
                  {key === 'month' ? MONTHS_PT[v - 1].slice(0, 3) : key === 'dow' ? DOW_PT[v].slice(0, 3) : v}
                </button>
              )
            })}
          </div>
        )}
        {st.mode === 'step' && (
          <>
            a cada
            <input
              type="number"
              className="input cb__num"
              min={1}
              max={hi}
              value={st.step}
              onChange={(e) => onChange({ step: Math.max(1, Math.min(hi, Number(e.target.value) || 1)) })}
              aria-label="Incremento"
            />
            {def.unitPlural}, começando em
            <select className="input select" value={st.start} onChange={(e) => onChange({ start: e.target.value === '*' ? '*' : Number(e.target.value) })} aria-label="Início">
              <option value="*">{nameOf(key, lo)} (início do ciclo)</option>
              {values.map((v) => (
                <option key={v} value={v}>
                  {nameOf(key, v)}
                </option>
              ))}
            </select>
            {st.start !== '*' && (
              <>
                até
                <select className="input select" value={st.end ?? ''} onChange={(e) => onChange({ end: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="Fim">
                  <option value="">fim do ciclo</option>
                  {values
                    .filter((v) => v > st.start)
                    .map((v) => (
                      <option key={v} value={v}>
                        {nameOf(key, v)}
                      </option>
                    ))}
                </select>
              </>
            )}
          </>
        )}
        {st.mode === 'special' && key === 'dom' && (
          <>
            <select className="input select" value={st.special} onChange={(e) => onChange({ special: e.target.value })} aria-label="Regra especial">
              <option value="L">Último dia do mês (L)</option>
              <option value="LW">Último dia útil do mês (LW)</option>
              <option value="nW">Dia útil mais próximo de… (nW)</option>
            </select>
            {st.special === 'nW' && valueSelect(st.value, (v) => onChange({ value: v }), 'Dia base')}
          </>
        )}
        {st.mode === 'special' && key === 'dow' && (
          <>
            <select className="input select" value={st.special} onChange={(e) => onChange({ special: e.target.value })} aria-label="Regra especial">
              <option value="nth">N-ésimo dia da semana do mês (#)</option>
              <option value="last">Último dia da semana do mês (L)</option>
            </select>
            {st.special === 'nth' && (
              <select className="input select" value={st.nth} onChange={(e) => onChange({ nth: Number(e.target.value) })} aria-label="Ocorrência">
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}ª
                  </option>
                ))}
              </select>
            )}
            {valueSelect(st.value, (v) => onChange({ value: v }), 'Dia da semana')}
          </>
        )}
        {st.mode === 'custom' && (
          <input className="input mono" value={st.raw} onChange={(e) => onChange({ raw: e.target.value })} aria-label="Valor personalizado" />
        )}
      </div>
    </motion.fieldset>
  )
}
