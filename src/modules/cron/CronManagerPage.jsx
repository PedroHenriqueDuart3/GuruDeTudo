import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { mdiBookOpenPageVariantOutline, mdiConsoleLine, mdiRobotOutline, mdiTimerCogOutline, mdiTuneVariant } from '@mdi/js'
import Icon from '@core/components/Icon'
import { Segmented, Select } from '@core/components/ui'
import PageHeader from '@layouts/components/PageHeader'
import { useSettings } from '@/stores/settings'
import CronBuilder from './components/CronBuilder'
import CronInspector from './components/CronInspector'
import CronLibrary from './components/CronLibrary'
import CronNatural from './components/CronNatural'
import { FORMATS } from './lib/cronSpec'
import { useCronAnalysis } from './useCronAnalysis'
import './cron.css'

const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC', 'America/Sao_Paulo', 'America/New_York', 'Europe/London', 'Europe/Lisbon', 'Asia/Tokyo']
  }
})()

export default function CronManagerPage() {
  const settings = useSettings()
  const [format, setFormat] = useState(settings.cronFormat)
  const [tz, setTz] = useState(settings.timezone)
  const [tab, setTab] = useState('library')
  const [expression, setExpression] = useState('0 9 * * 1-5')
  const [inspectFormat, setInspectFormat] = useState('auto')
  const [builderSeed, setBuilderSeed] = useState(null)

  const analysis = useCronAnalysis(expression, inspectFormat, tz)

  const inspect = useCallback((expr, fmt = 'auto') => {
    setExpression(expr)
    setInspectFormat(fmt)
  }, [])

  const editInBuilder = (expr, fmt) => {
    const target = fmt ?? format
    if (fmt && fmt !== format) setFormat(fmt)
    setBuilderSeed({ expression: expr, format: target, nonce: Date.now() })
    setTab('builder')
  }

  const onNatural = useCallback((expr, fmt) => expr && inspect(expr, fmt), [inspect])
  const onBuilder = useCallback((expr) => inspect(expr, format), [inspect, format])

  const tzOptions = useMemo(() => TIMEZONES.map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), [])

  return (
    <div className="cron-page">
      <PageHeader
        icon={mdiTimerCogOutline}
        eyebrow="Módulo · CRON"
        title="Cron Manager"
        description="Crie, interprete e valide expressões CRON em 5, 6 ou 7 campos, com explicação campo a campo e as próximas execuções no seu fuso horário."
      />

      <div className="cron-controls">
        <Segmented
          value={tab}
          onChange={setTab}
          ariaLabel="Modo"
          options={[
            { value: 'library', label: 'Biblioteca', icon: mdiBookOpenPageVariantOutline },
            { value: 'natural', label: 'Linguagem natural', icon: mdiRobotOutline },
            { value: 'builder', label: 'Construtor visual', icon: mdiTuneVariant },
          ]}
        />
        <span className="grow" />
        <Select
          label="Formato"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          options={Object.values(FORMATS).map((f) => ({ value: f.id, label: f.label }))}
          title={FORMATS[format].hint}
        />
        <Select label="Fuso horário" value={tz} onChange={(e) => setTz(e.target.value)} options={tzOptions} />
      </div>

      <div className="cron-layout">
        <div className="cron-main">
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
              {tab === 'library' && <CronLibrary format={format} tz={tz} selected={expression} onSelect={(e) => inspect(e, format)} onEdit={(e) => editInBuilder(e, format)} />}
              {tab === 'natural' && <CronNatural format={format} tz={tz} onResult={onNatural} onEdit={editInBuilder} />}
              {tab === 'builder' && <CronBuilder format={format} seed={builderSeed} onChange={onBuilder} />}
            </motion.div>
          </AnimatePresence>
        </div>

        <aside className="cron-side">
          <div className="cron-input">
            <label htmlFor="cron-expr" className="field__label">
              <Icon path={mdiConsoleLine} size={14} /> Interpretar expressão
            </label>
            <div className="cron-input__row">
              <input
                id="cron-expr"
                className="input mono cron-input__field"
                value={expression}
                onChange={(e) => {
                  setExpression(e.target.value)
                  setInspectFormat('auto')
                }}
                spellCheck={false}
                placeholder="*/5 * * * *"
                aria-describedby="cron-expr-hint"
              />
              <select className="input select cron-input__fmt" value={inspectFormat} onChange={(e) => setInspectFormat(e.target.value)} aria-label="Formato da expressão">
                <option value="auto">Detectar</option>
                {Object.values(FORMATS).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.short}
                  </option>
                ))}
              </select>
            </div>
            <span id="cron-expr-hint" className="field__hint">
              Cole qualquer expressão — o formato é identificado pelo número e conteúdo dos campos. Macros como @daily também funcionam.
            </span>
          </div>
          <CronInspector analysis={analysis} tz={tz} />
        </aside>
      </div>
    </div>
  )
}
