import { useEffect, useMemo, useState } from 'react'
import { json as jsonLang } from '@codemirror/lang-json'
import { MSSQL, sql as sqlLang } from '@codemirror/lang-sql'
import {
  mdiAlertOutline,
  mdiCheck,
  mdiContentCopy,
  mdiCubeOutline,
  mdiDeleteOutline,
  mdiDownload,
  mdiFileDocumentOutline,
  mdiMinusCircleOutline,
  mdiTrayArrowUp,
  mdiViewSplitVertical,
} from '@mdi/js'
import Button from '@core/components/Button'
import Icon from '@core/components/Icon'
import { useToast } from '@core/components/Toast'
import { DropZone, EmptyState, Segmented, Tag, Toolbar, ToolbarDivider } from '@core/components/ui'
import { useDebouncedValue } from '@core/hooks'
import { cn, copyToClipboard, downloadBlob, downloadText, formatDuration, formatNumber, pickFile, readFileAsText } from '@core/utils'
import { createZip } from '@core/utils/zip'
import PageHeader from '@layouts/components/PageHeader'
import CodeEditor from '@/shared/editor/CodeEditor'
import { useActivity } from '@/stores/activity'
import { useSettings } from '@/stores/settings'
import { detectSource, generateModels, LANGUAGES } from './lib/index.js'
import { loadLanguage } from './languages'
import { SAMPLE_JSON, SAMPLE_SQL } from './sample'
import '@/shared/workspace.css'
import './modelgen.css'

const INPUT_LANG = { sql: sqlLang({ dialect: MSSQL, upperCaseKeywords: true }), json: jsonLang() }

const DEFAULTS = { language: 'csharp', styles: {}, namespaces: {}, naming: 'convention', comments: true, detectDates: true, rootName: 'Modelo' }

export default function ModelGeneratorPage() {
  const toast = useToast()
  const log = useActivity((s) => s.log)
  const settings = useSettings()
  const cfg = { ...DEFAULTS, ...(settings.modelgen ?? {}) }
  const setCfg = (patch) => settings.set({ modelgen: { ...cfg, ...patch } })
  const lang = LANGUAGES[cfg.language] ? cfg.language : 'csharp'
  const meta = LANGUAGES[lang]
  const style = meta.styles[cfg.styles[lang]] ? cfg.styles[lang] : Object.keys(meta.styles)[0]
  const namespace = cfg.namespaces[lang] ?? meta.defaultNamespace

  const [input, setInput] = useState(SAMPLE_SQL)
  const [fileName, setFileName] = useState('exemplo.sql')
  const [source, setSource] = useState('auto')
  const [layout, setLayout] = useState('split')
  const [active, setActive] = useState(0)
  const [outLang, setOutLang] = useState([])

  const debounced = useDebouncedValue(input, 200)
  const detected = source === 'auto' ? detectSource(debounced) : source
  const result = useMemo(() => {
    if (!debounced.trim()) return null
    try {
      return generateModels(debounced, { source: detected, language: lang, style, namespace, naming: cfg.naming, comments: cfg.comments, detectDates: cfg.detectDates, rootName: cfg.rootName || 'Modelo' })
    } catch (err) {
      return { error: err.message ?? String(err), files: [], classes: [], warnings: [], stats: { classes: 0, fields: 0, ms: 0 } }
    }
  }, [debounced, detected, lang, style, namespace, cfg.naming, cfg.comments, cfg.detectDates, cfg.rootName])

  useEffect(() => setActive(0), [lang])

  useEffect(() => {
    let alive = true
    loadLanguage(lang).then((ext) => alive && setOutLang(ext))
    return () => {
      alive = false
    }
  }, [lang])

  const files = result?.files ?? []
  const current = files[Math.min(active, files.length - 1)] ?? null
  useEffect(() => {
    if (active >= files.length) setActive(0)
  }, [files.length, active])

  const importFile = async (file, err) => {
    if (err) return toast.error('Arquivo não suportado', { description: err.message })
    if (!file) return
    try {
      const text = await readFileAsText(file)
      setInput(text)
      setFileName(file.name)
      setSource('auto')
      toast.success('Arquivo importado', { description: file.name })
      log('modelgen', 'Arquivo importado', file.name)
    } catch (e) {
      toast.error('Não foi possível ler o arquivo', { description: e.message })
    }
  }

  const copyCurrent = async () => {
    if (!current) return
    try {
      await copyToClipboard(current.content)
      toast.success('Código copiado', { description: current.name })
      log('modelgen', `Model copiada (${meta.label})`, current.name)
    } catch (e) {
      toast.error('Não foi possível copiar', { description: e.message })
    }
  }

  const download = () => {
    if (!files.length) return
    if (files.length === 1) {
      downloadText(files[0].content, files[0].name)
      toast.success('Arquivo gerado', { description: files[0].name })
    } else {
      const name = `models-${lang}.zip`
      downloadBlob(new Blob([createZip(files)], { type: 'application/zip' }), name)
      toast.success('Arquivos gerados', { description: `${name} · ${files.length} arquivos` })
    }
    log('modelgen', `Models baixadas (${meta.label})`, `${files.length} arquivo(s)`)
  }

  const inputLines = input ? input.split('\n').length : 0
  const unknown = (result?.classes ?? []).reduce((n, c) => n + c.unknown, 0)

  return (
    <div className="tool-page">
      <PageHeader
        icon={mdiCubeOutline}
        eyebrow="Módulo · SQL / JSON → classes"
        title="Model Generator"
        description="Cole CREATE TABLEs, uma procedure ou um JSON. Saem as models em C#, Java, Kotlin, Python, TypeScript ou Go, com tipos, nulidade, chaves e mapeamento para os nomes originais."
      />

      <Toolbar className="tool-toolbar">
        <Button variant="ghost" size="sm" icon={mdiTrayArrowUp} onClick={async () => importFile(await pickFile('.sql,.json,.txt'))}>
          Importar
        </Button>
        <Button variant="text" size="sm" icon={mdiFileDocumentOutline} onClick={() => (setInput(SAMPLE_SQL), setFileName('exemplo.sql'), setSource('auto'))}>
          Exemplo SQL
        </Button>
        <Button variant="text" size="sm" icon={mdiFileDocumentOutline} onClick={() => (setInput(SAMPLE_JSON), setFileName('exemplo.json'), setSource('auto'))}>
          Exemplo JSON
        </Button>
        <Button variant="text" size="sm" icon={mdiDeleteOutline} onClick={() => setInput('')} disabled={!input}>
          Limpar
        </Button>
        <ToolbarDivider />
        <Segmented
          size="sm"
          value={source}
          onChange={setSource}
          ariaLabel="Tipo da entrada"
          layoutId="mg-source"
          options={[
            { value: 'auto', label: `Auto${source === 'auto' && debounced.trim() ? ` · ${detected.toUpperCase()}` : ''}` },
            { value: 'sql', label: 'SQL' },
            { value: 'json', label: 'JSON' },
          ]}
        />
        <span className="grow" />
        <Button size="sm" icon={mdiContentCopy} onClick={copyCurrent} disabled={!current}>
          Copiar
        </Button>
        <Button size="sm" variant="outlined" icon={mdiDownload} onClick={download} disabled={!files.length}>
          {files.length > 1 ? `Baixar .zip (${files.length})` : 'Baixar'}
        </Button>
        <Segmented
          size="sm"
          value={layout}
          onChange={setLayout}
          ariaLabel="Layout"
          layoutId="mg-layout"
          options={[
            { value: 'editor', label: 'Entrada' },
            { value: 'split', label: '', icon: mdiViewSplitVertical, title: 'Lado a lado' },
            { value: 'view', label: 'Código' },
          ]}
        />
      </Toolbar>

      <div className="mg-options" role="group" aria-label="Opções de geração">
        <Segmented size="sm" value={lang} onChange={(v) => setCfg({ language: v })} ariaLabel="Linguagem" layoutId="mg-lang" options={Object.entries(LANGUAGES).map(([value, l]) => ({ value, label: l.label }))} />
        <label className="mg-field">
          <span>Estilo</span>
          <select className="input select tool-select" value={style} onChange={(e) => setCfg({ styles: { ...cfg.styles, [lang]: e.target.value } })}>
            {Object.entries(meta.styles).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {lang !== 'python' && lang !== 'typescript' && (
          <label className="mg-field">
            <span>{lang === 'csharp' ? 'Namespace' : 'Pacote'}</span>
            <input className="input mono mg-ns" value={namespace} spellCheck={false} onChange={(e) => setCfg({ namespaces: { ...cfg.namespaces, [lang]: e.target.value } })} placeholder={meta.defaultNamespace} />
          </label>
        )}
        <label className="mg-field">
          <span>Nomes</span>
          <select className="input select tool-select" value={cfg.naming} onChange={(e) => setCfg({ naming: e.target.value })}>
            <option value="convention">convenção da linguagem</option>
            <option value="keep">manter os originais</option>
          </select>
        </label>
        <Chip on={cfg.comments} onClick={() => setCfg({ comments: !cfg.comments })} title="Comentário com o tipo SQL e as restrições de cada campo">
          comentários
        </Chip>
        {detected === 'json' && (
          <>
            <label className="mg-field">
              <span>Classe raiz</span>
              <input className="input mono mg-root" value={cfg.rootName} spellCheck={false} onChange={(e) => setCfg({ rootName: e.target.value })} placeholder="Modelo" />
            </label>
            <Chip on={cfg.detectDates} onClick={() => setCfg({ detectDates: !cfg.detectDates })} title="Textos ISO 8601 viram data e UUIDs viram Guid/UUID">
              datas e UUID
            </Chip>
          </>
        )}
      </div>

      <DropZone onFile={importFile} accept=".sql,.json,.txt" className={`tool-split mg-split tool-split--${layout}`} label="Solte o .sql ou .json">
        {layout !== 'view' && (
          <section className="pane" aria-label="Entrada">
            <div className="pane__header">
              <span className="pane-step mono">1</span>
              <strong className="pane-name">Entrada</strong>
              <span className="pane__title mono">{fileName}</span>
              <span className="grow" />
              <Tag variant="neutral">{detected.toUpperCase()}</Tag>
              <Tag variant="neutral">{formatNumber(inputLines)} linhas</Tag>
            </div>
            <div className="pane__body">
              <CodeEditor value={input} onChange={setInput} language={INPUT_LANG[detected]} fontSize={settings.editorFontSize} wrap={settings.wrapLines} indent={2} ariaLabel="SQL ou JSON de entrada" changeDelay={250} />
            </div>
          </section>
        )}

        {layout !== 'editor' && (
          <section className="pane mg-out" aria-label="Código gerado">
            <div className="pane__header">
              <span className="pane-step mono">2</span>
              <strong className="pane-name">{meta.label}</strong>
              <span className="pane__title">{meta.styles[style]}</span>
              <span className="grow" />
              {result && !result.error && (
                <Tag variant={unknown || result.warnings.length ? 'warning' : 'success'} dot>
                  {result.stats.classes} classe{result.stats.classes === 1 ? '' : 's'} · {result.stats.fields} campos
                </Tag>
              )}
            </div>
            {files.length > 1 && (
              <div className="mg-tabs" role="tablist" aria-label="Arquivos gerados">
                {files.map((f, i) => (
                  <button key={f.name} type="button" role="tab" aria-selected={i === active} className={cn('mg-tab mono', i === active && 'is-active')} onClick={() => setActive(i)}>
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            {result?.warnings?.length > 0 && (
              <ul className="mg-issues">
                {result.warnings.map((w) => (
                  <li key={w}>
                    <span className="mg-issue">
                      <Icon path={mdiAlertOutline} size={14} /> {w}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {result?.error && <div className="pane__error">Falha ao gerar: {result.error}</div>}
            <div className="pane__body">
              {current ? (
                <CodeEditor key={lang} value={current.content} language={outLang} readOnly fontSize={settings.editorFontSize} wrap={settings.wrapLines} indent={lang === 'typescript' ? 2 : 4} ariaLabel={`Código ${meta.label} gerado (somente leitura)`} />
              ) : (
                <EmptyState icon={mdiCubeOutline} title="Nenhuma classe ainda" description="Cole CREATE TABLEs, uma procedure com SELECT ou um JSON no campo de entrada." />
              )}
            </div>
          </section>
        )}
      </DropZone>

      <footer className="status-bar">
        <span>entrada {formatNumber(inputLines)} linhas · {detected.toUpperCase()}</span>
        {result && !result.error && (
          <>
            <span>{result.stats.classes} classe(s)</span>
            <span>{result.stats.fields} campos</span>
            <span>{files.length} arquivo(s)</span>
            {unknown > 0 && <span className="status-bar__error">{unknown} tipo(s) não identificado(s)</span>}
            <span>{formatDuration(result.stats.ms)}</span>
          </>
        )}
      </footer>
    </div>
  )
}

function Chip({ on, onClick, title, children }) {
  return (
    <button type="button" className={cn('chip-toggle', on && 'is-on')} aria-pressed={on} title={title} onClick={onClick}>
      <Icon path={on ? mdiCheck : mdiMinusCircleOutline} size={14} />
      <span>{children}</span>
    </button>
  )
}
