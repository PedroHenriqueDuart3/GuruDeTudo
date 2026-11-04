import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { mdiContentCopy, mdiMagnify, mdiPencilOutline } from '@mdi/js'
import { IconButton } from '@core/components/Button'
import { useToast } from '@core/components/Toast'
import { Segmented, Tag, TextField } from '@core/components/ui'
import { cn, copyToClipboard } from '@core/utils'
import { useActivity } from '@/stores/activity'
import { assemble } from '../lib/cronEngine'
import { PRESET_CATEGORIES, PRESETS } from '../presets'
import { analyzeCron, formatRun } from '../useCronAnalysis'

/** Biblioteca de CRONs prontas, convertidas para o formato selecionado. */
export default function CronLibrary({ format, tz, selected, onSelect, onEdit }) {
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const toast = useToast()
  const log = useActivity((s) => s.log)

  const items = useMemo(
    () =>
      PRESETS.map((p) => {
        const expression = assemble(p.c, format)
        return { ...p, expression, analysis: analyzeCron(expression, format, tz, 3) }
      }),
    [format, tz],
  )

  const q = query.trim().toLowerCase()
  const visible = items.filter(
    (p) => (category === 'all' || p.category === category) && (!q || p.name.toLowerCase().includes(q) || p.expression.includes(q) || p.analysis.description.toLowerCase().includes(q)),
  )

  const copy = async (p) => {
    try {
      await copyToClipboard(p.expression)
      toast.success('Expressão copiada', { description: `${p.name} · ${p.expression}` })
      log('cron', 'Preset copiado', p.expression)
    } catch (e) {
      toast.error('Não foi possível copiar', { description: e.message })
    }
  }

  return (
    <div className="cl">
      <div className="cl__filters">
        <Segmented value={category} onChange={setCategory} options={PRESET_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} ariaLabel="Categorias" size="sm" />
        <TextField icon={mdiMagnify} placeholder="Filtrar modelos…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filtrar modelos" className="cl__search" />
      </div>
      <div className="cl__grid">
        {visible.map((p, i) => (
          <motion.article
            key={p.id}
            layout
            className={cn('cl__card', selected === p.expression && 'is-selected')}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 12) * 0.03, duration: 0.3 }}
            onClick={() => onSelect(p.expression)}
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(p.expression)}
            aria-label={`${p.name}: ${p.expression}`}
          >
            <header className="cl__card-head">
              <h4>{p.name}</h4>
              <Tag variant="neutral">{PRESET_CATEGORIES.find((c) => c.id === p.category)?.label}</Tag>
            </header>
            <code className="cl__expr">{p.expression}</code>
            <p className="cl__desc">{p.analysis.description}</p>
            <ul className="cl__runs" aria-label="Próximas execuções">
              {p.analysis.runs.map((r) => (
                <li key={r.getTime()} className="mono">
                  {formatRun(r, tz, format !== 'unix')}
                </li>
              ))}
            </ul>
            <footer className="cl__actions" onClick={(e) => e.stopPropagation()}>
              <IconButton size="sm" icon={mdiContentCopy} label="Copiar expressão" onClick={() => copy(p)} />
              <IconButton size="sm" icon={mdiPencilOutline} label="Editar no construtor" onClick={() => onEdit(p.expression)} />
            </footer>
          </motion.article>
        ))}
      </div>
    </div>
  )
}
