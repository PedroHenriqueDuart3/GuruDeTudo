import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { MSSQL, sql as sqlLang } from '@codemirror/lang-sql'
import {
  mdiAlertOutline,
  mdiAnvil,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiClose,
  mdiContentCopy,
  mdiDeleteOutline,
  mdiDownload,
  mdiFileDocumentOutline,
  mdiFormatListChecks,
  mdiInformationOutline,
  mdiMinusCircleOutline,
  mdiTrayArrowUp,
  mdiViewSplitVertical,
} from '@mdi/js'
import Button from '@core/components/Button'
import Icon from '@core/components/Icon'
import { useToast } from '@core/components/Toast'
import { DropZone, EmptyState, Segmented, Tag, Toolbar, ToolbarDivider } from '@core/components/ui'
import { createWorkerClient } from '@core/workers/createWorkerClient'
import { cn, copyToClipboard, downloadText, formatDuration, formatNumber, pickFile, readFileAsText } from '@core/utils'
import PageHeader from '@layouts/components/PageHeader'
import CodeEditor from '@/shared/editor/CodeEditor'
import { useActivity } from '@/stores/activity'
import { useSettings } from '@/stores/settings'
import { SAMPLE_TSQL } from './sample'
import '@/shared/workspace.css'
import './sqlforge.css'

const tsql = sqlLang({ dialect: MSSQL, upperCaseKeywords: true })

const OPTIONS = [
  { key: 'qualifyDbo', label: 'dbo.', title: 'Adicionar dbo. a tabelas, procedures, views e functions sem schema' },
  { key: 'renameTemp', label: '#tNOME', title: 'Renomear temporárias para #tNOME (ex.: #Origem → #tORIGEM)' },
  { key: 'stripBrackets', label: 'Sem [ ]', title: 'Remover colchetes de identificadores que não precisam deles' },
]

function useForgeWorker() {
  const client = useMemo(() => createWorkerClient(() => new Worker(new URL('./sqlforge.worker.js', import.meta.url), { type: 'module' })), [])
  useEffect(() => () => client.terminate(), [client])
  return client
}

export default function SqlForgePage() {
  const client = useForgeWorker()
  const toast = useToast()
  const log = useActivity((s) => s.log)
  const settings = useSettings()
  const options = settings.forge ?? { qualifyDbo: true, renameTemp: true, stripBrackets: true }

  const [input, setInput] = useState(SAMPLE_TSQL)
  const [fileName, setFileName] = useState('exemplo.sql')
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [layout, setLayout] = useState('split')
  const [reportOpen, setReportOpen] = useState(false)
  const seq = useRef(0)

  const run = useCallback(
    async (text, opts) => {
      const id = ++seq.current
      if (!text.trim()) {
        setResult(null)
        setError(null)
        setRunning(false)
        return
      }
      setRunning(true)
      try {
        const res = await client.call('format', { text, options: opts })
        if (id !== seq.current) return
        setResult(res)
        setError(null)
      } catch (err) {
        if (err?.terminated || id !== seq.current) return
        setError(err.message ?? String(err))
      } finally {
        if (id === seq.current) setRunning(false)
      }
    },
    [client],
  )

  // Formata a cada mudança (o editor já espera a digitação parar antes de avisar)
  useEffect(() => {
    run(input, options)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, options.qualifyDbo, options.renameTemp, options.stripBrackets, run])

  const output = result?.output ?? ''
  const warnings = result?.warnings ?? []
  const checklist = result?.checklist ?? []
  const pending = checklist.filter((c) => c.status === 'warn')

  const toggleOption = (key) => settings.set({ forge: { ...options, [key]: !options[key] } })

  const importFile = async (file, err) => {
    if (err) return toast.error('Arquivo não suportado', { description: err.message })
    if (!file) return
    try {
      const text = await readFileAsText(file)
      setInput(text)
      setFileName(file.name)
      toast.success('Script importado', { description: file.name })
      log('sqlforge', 'Script T-SQL importado', file.name)
    } catch (e) {
      toast.error('Não foi possível ler o arquivo', { description: e.message })
    }
  }

  const copyOutput = async () => {
    if (!output) return
    try {
      await copyToClipboard(output)
      toast.success('Resultado copiado', { description: `${formatNumber(result.stats.outputLines)} linhas no padrão` })
      log('sqlforge', 'Resultado copiado', fileName)
    } catch (e) {
      toast.error('Não foi possível copiar', { description: e.message })
    }
  }

  const downloadOutput = () => {
    if (!output) return
    const name = fileName.replace(/(\.\w+)?$/, '.padrao.sql')
    downloadText(output, name, 'application/sql')
    toast.success('Arquivo gerado', { description: name })
    log('sqlforge', 'Resultado baixado', name)
  }

  const inputLines = input ? input.split('\n').length : 0

  return (
    <div className="tool-page">
      <PageHeader
        icon={mdiAnvil}
        eyebrow="Módulo · T-SQL"
        title="SQL Forge"
        description="Cole procedures, views, functions ou scripts T-SQL no campo 1. No campo 2 sai o mesmo código no padrão do Pedro: rio de palavras-chave, vírgula à esquerda, listas alinhadas e “=” em coluna."
      />

      <Toolbar className="tool-toolbar">
        <Button variant="ghost" size="sm" icon={mdiTrayArrowUp} onClick={async () => importFile(await pickFile('.sql,.txt'))}>
          Importar .sql
        </Button>
        <Button variant="text" size="sm" icon={mdiFileDocumentOutline} onClick={() => (setInput(SAMPLE_TSQL), setFileName('exemplo.sql'))}>
          Exemplo
        </Button>
        <Button variant="text" size="sm" icon={mdiDeleteOutline} onClick={() => (setInput(''), setFileName('script.sql'))} disabled={!input}>
          Limpar
        </Button>
        <ToolbarDivider />
        <div className="sf-options" role="group" aria-label="Regras opcionais">
          {OPTIONS.map((o) => (
            <button key={o.key} type="button" className={cn('chip-toggle', options[o.key] && 'is-on')} aria-pressed={options[o.key]} title={o.title} onClick={() => toggleOption(o.key)}>
              <Icon path={options[o.key] ? mdiCheck : mdiMinusCircleOutline} size={14} />
              <span className="mono">{o.label}</span>
            </button>
          ))}
        </div>
        <span className="grow" />
        <Button size="sm" icon={mdiContentCopy} onClick={copyOutput} disabled={!output}>
          Copiar resultado
        </Button>
        <Button size="sm" variant="outlined" icon={mdiDownload} onClick={downloadOutput} disabled={!output}>
          Baixar .sql
        </Button>
        <Segmented
          size="sm"
          value={layout}
          onChange={setLayout}
          ariaLabel="Layout"
          options={[
            { value: 'editor', label: 'Entrada' },
            { value: 'split', label: '', icon: mdiViewSplitVertical, title: 'Lado a lado' },
            { value: 'view', label: 'Resultado' },
          ]}
        />
      </Toolbar>

      <DropZone onFile={importFile} accept=".sql,.txt" className={`tool-split tool-split--${layout}`} label="Solte o script .sql para formatar">
        {layout !== 'view' && (
          <section className="pane" aria-label="Entrada">
            <div className="pane__header">
              <span className="pane-step mono">1</span>
              <strong className="pane-name">Entrada</strong>
              <span className="pane__title mono">{fileName}</span>
              <span className="grow" />
              <Tag variant="neutral">{formatNumber(inputLines)} linhas</Tag>
            </div>
            <div className="pane__body">
              <CodeEditor
                value={input}
                onChange={setInput}
                language={tsql}
                fontSize={settings.editorFontSize}
                wrap={settings.wrapLines}
                indent={2}
                ariaLabel="T-SQL de entrada"
                changeDelay={300}
              />
            </div>
          </section>
        )}

        {layout !== 'editor' && (
          <section className="pane sf-out" aria-label="Resultado no padrão">
            <div className="pane__header">
              <span className="pane-step mono">2</span>
              <strong className="pane-name">Resultado</strong>
              <span className="pane__title">padrão do Pedro</span>
              <span className="grow" />
              {running && <Tag variant="info" dot>formatando…</Tag>}
              {!running && result && (pending.length || warnings.length ? (
                <Tag variant="warning" dot>
                  {pending.length + warnings.length} ponto(s) de atenção
                </Tag>
              ) : (
                <Tag variant="success" dot>
                  checklist completo
                </Tag>
              ))}
              <Button size="sm" variant={reportOpen ? 'default' : 'ghost'} icon={mdiFormatListChecks} onClick={() => setReportOpen((o) => !o)} aria-expanded={reportOpen} disabled={!result}>
                Relatório
              </Button>
            </div>
            {error && (
              <button type="button" className="pane__error" onClick={() => run(input, options)}>
                <strong>Falha ao formatar:</strong> {error} — clique para tentar de novo
              </button>
            )}
            <div className="pane__body">
              {output ? (
                <CodeEditor value={output} language={tsql} readOnly fontSize={settings.editorFontSize} wrap={settings.wrapLines} indent={2} ariaLabel="T-SQL formatado (somente leitura)" />
              ) : (
                <EmptyState icon={mdiAnvil} title="Nada para formatar" description="Cole ou digite T-SQL no campo de entrada. O resultado aparece aqui enquanto você escreve." />
              )}
              <AnimatePresence>
                {reportOpen && result && (
                  <motion.aside
                    className="sf-report"
                    aria-label="Relatório da formatação"
                    initial={{ y: 24, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 24, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <header>
                      <Icon path={mdiFormatListChecks} size={16} />
                      <strong>Relatório</strong>
                      <span className="subtle mono">
                        {formatNumber(result.stats.statements)} instruções · {formatDuration(result.stats.ms)}
                      </span>
                      <span className="grow" />
                      <button type="button" className="sf-report__close" onClick={() => setReportOpen(false)} aria-label="Fechar relatório">
                        <Icon path={mdiClose} size={16} />
                      </button>
                    </header>
                    <div className="sf-report__body">
                      {warnings.length > 0 && (
                        <section>
                          <h4>Avisos</h4>
                          <ul>
                            {warnings.map((w) => (
                              <li key={w.message} className="sf-item sf-item--warn">
                                <Icon path={mdiAlertOutline} size={15} />
                                <span>{w.message}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                      <section>
                        <h4>Checklist do padrão</h4>
                        <ul>
                          {checklist.map((c) => (
                            <li key={c.id} className={`sf-item sf-item--${c.status}`}>
                              <Icon path={c.status === 'ok' ? mdiCheckCircleOutline : c.status === 'warn' ? mdiAlertOutline : mdiMinusCircleOutline} size={15} />
                              <span>
                                {c.label}
                                {c.detail && <small>{c.detail}</small>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                      {result.changes.length > 0 && (
                        <section>
                          <h4>Alterações aplicadas</h4>
                          <ul>
                            {result.changes.map((c) => (
                              <li key={c.key} className="sf-item">
                                <span className="sf-count mono">{c.count}×</span>
                                <span>{c.message}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                      {result.extensions.length > 0 && (
                        <section>
                          <h4>Extensões do padrão</h4>
                          <p className="sf-note">
                            <Icon path={mdiInformationOutline} size={14} /> Construções que o padrão do Pedro não define. A regra foi estendida a partir do rio, da vírgula à esquerda e das listas alinhadas. Não são regras dele.
                          </p>
                          <ul>
                            {result.extensions.map((e) => (
                              <li key={e.key} className="sf-item sf-item--ext">
                                <Icon path={mdiInformationOutline} size={15} />
                                <span>{e.message}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </div>
                  </motion.aside>
                )}
              </AnimatePresence>
            </div>
          </section>
        )}
      </DropZone>

      <footer className="status-bar">
        <span>entrada {formatNumber(inputLines)} linhas</span>
        {result && (
          <>
            <span>saída {formatNumber(result.stats.outputLines)} linhas</span>
            <span>{formatNumber(result.stats.statements)} instruções</span>
            {result.stats.procedures > 0 && <span>{result.stats.procedures} procedure(s)</span>}
            <span>{formatDuration(result.stats.ms)}</span>
            {checklist.find((c) => c.id === 'integrity')?.status === 'ok' ? <span>integridade conferida</span> : <span className="status-bar__error">revise a integridade</span>}
          </>
        )}
      </footer>
    </div>
  )
}
