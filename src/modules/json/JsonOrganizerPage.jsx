import { useCallback, useEffect, useRef, useState } from 'react'
import { json as jsonLang } from '@codemirror/lang-json'
import {
  mdiChartBar,
  mdiCheckDecagramOutline,
  mdiCodeBraces,
  mdiContentCopy,
  mdiDatabaseArrowDownOutline,
  mdiDownload,
  mdiFileDocumentOutline,
  mdiFormatAlignLeft,
  mdiFormatListBulletedTriangle,
  mdiGraphOutline,
  mdiMagnify,
  mdiSortAlphabeticalAscending,
  mdiTrayArrowUp,
  mdiArrowCollapseVertical,
  mdiViewSplitVertical,
  mdiChartBoxOutline,
} from '@mdi/js'
import Button, { IconButton } from '@core/components/Button'
import { useToast } from '@core/components/Toast'
import { Alert, BusyOverlay, DropZone, EmptyState, Segmented, Tag, Toolbar, ToolbarDivider } from '@core/components/ui'
import { copyToClipboard, downloadText, formatBytes, formatDuration, formatNumber, pickFile, readFileAsText } from '@core/utils'
import PageHeader from '@layouts/components/PageHeader'
import CodeEditor from '@/shared/editor/CodeEditor'
import { useActivity } from '@/stores/activity'
import { useSettings } from '@/stores/settings'
import JsonChartView from './components/JsonChartView'
import JsonGraphView from './components/JsonGraphView'
import JsonQueryPanel from './components/JsonQueryPanel'
import JsonStatsView from './components/JsonStatsView'
import JsonTreeView from './components/JsonTreeView'
import { useLazyTree } from './hooks/useLazyTree'
import { pathToString } from './lib/jsonEngine'
import { SAMPLE_JSON } from './sample'
import { useJsonWorker } from './useJsonWorker'
import '@/shared/workspace.css'
import './json.css'

/** Acima disso o texto não vai para o editor (só análise/visualização), para não esgotar memória. */
const EDITOR_LIMIT_CHARS = 40_000_000
const jsonExtension = jsonLang()

export default function JsonOrganizerPage() {
  const client = useJsonWorker()
  const toast = useToast()
  const log = useActivity((s) => s.log)
  const { editorFontSize, indent, wrapLines } = useSettings()
  const editorRef = useRef(null)
  const treeRef = useRef(null)

  const [text, setText] = useState(SAMPLE_JSON)
  const [fileName, setFileName] = useState('exemplo.json')
  const [analysis, setAnalysis] = useState(null) // resultado do worker (ok/erro)
  const [analyzing, setAnalyzing] = useState(false)
  const [busy, setBusy] = useState(null) // { message, value }
  const [version, setVersion] = useState(0)
  const [view, setView] = useState('tree')
  const [layout, setLayout] = useState('split') // split | editor | view
  const [indentChoice, setIndentChoice] = useState(String(indent))
  const [editorDisabled, setEditorDisabled] = useState(false)
  const loadSeq = useRef(0)

  const tree = useLazyTree(client, analysis?.ok ? analysis.root : null, version)

  /** Envia o texto ao worker: valida, parseia e calcula estatísticas. */
  const analyze = useCallback(
    async (value, { quiet = false } = {}) => {
      const seq = ++loadSeq.current
      setAnalyzing(true)
      if (!quiet) setBusy({ message: 'Analisando…', value: 0 })
      try {
        const res = await client.call('load', { text: value }, { onProgress: (p) => !quiet && setBusy(p) })
        if (seq !== loadSeq.current) return null
        setAnalysis(res)
        if (res.ok) setVersion((v) => v + 1)
        return res
      } catch (err) {
        if (seq === loadSeq.current && !err.terminated && !err.cancelled) toast.error('Falha ao analisar o JSON', { description: err.message })
        return null
      } finally {
        if (seq === loadSeq.current) {
          setAnalyzing(false)
          setBusy(null)
        }
      }
    },
    [client, toast],
  )

  useEffect(() => {
    analyze(SAMPLE_JSON, { quiet: true })
  }, [analyze])

  const onEditorChange = useCallback(
    (value) => {
      setText(value)
      analyze(value, { quiet: value.length < 2_000_000 })
    },
    [analyze],
  )

  /** Define um novo conteúdo vindo de fora do editor (arquivo, formatação, exemplo). */
  const setContent = async (value, name) => {
    const tooBig = value.length > EDITOR_LIMIT_CHARS
    setEditorDisabled(tooBig)
    setText(tooBig ? '' : value)
    if (name) setFileName(name)
    if (tooBig) setLayout('view')
    return analyze(value)
  }

  const runWorkerText = async (method, params, successMsg, action) => {
    if (!analysis?.ok) return toast.error('Corrija os erros de sintaxe antes', { description: 'A operação exige um JSON válido.' })
    setBusy({ message: 'Processando…' })
    try {
      const out = await client.call(method, params, { onProgress: setBusy })
      await setContent(out)
      toast.success(successMsg, { description: formatBytes(new Blob([out]).size) })
      log('json', action, fileName)
    } catch (err) {
      toast.error('Operação falhou', { description: err.message })
    } finally {
      setBusy(null)
    }
  }

  const importFile = async (file, error) => {
    if (error) return toast.error('Arquivo não suportado', { description: error.message })
    if (!file) return
    setBusy({ message: `Lendo ${file.name}…`, value: 0 })
    try {
      const content = await readFileAsText(file, (v) => setBusy({ message: `Lendo ${file.name}…`, value: v }))
      const res = await setContent(content, file.name)
      if (res?.ok) toast.success('Arquivo importado', { description: `${file.name} · ${formatBytes(file.size)}` })
      else if (res?.error) toast.warning('Arquivo importado com erros de sintaxe', { description: res.error.message })
      log('json', 'Arquivo importado', `${file.name} · ${formatBytes(file.size)}`)
    } catch (err) {
      toast.error('Não foi possível ler o arquivo', { description: err.message })
      setBusy(null)
    }
  }

  const currentText = () => (editorDisabled ? null : editorRef.current?.getValue() ?? text)

  const exportFile = async () => {
    let content = currentText()
    if (content === null) content = await client.call('format', { indent: indentChoice })
    const name = fileName.endsWith('.json') ? fileName : `${fileName}.json`
    downloadText(content, name, 'application/json')
    toast.success('Arquivo exportado', { description: name })
    log('json', 'Arquivo exportado', name)
  }

  const copyAll = async () => {
    try {
      const content = currentText() ?? (await client.call('minify'))
      await copyToClipboard(content)
      toast.success('JSON copiado', { description: formatBytes(new Blob([content]).size) })
    } catch (err) {
      toast.error('Não foi possível copiar', { description: err.message })
    }
  }

  const generate = async (count) => {
    setBusy({ message: 'Gerando dados de teste…' })
    try {
      const out = await client.call('generate', { count, indent: 2 }, { onProgress: setBusy })
      await setContent(out, `dataset-teste-${count}.json`)
      toast.info('Dataset de teste gerado', { description: `${formatNumber(count)} registros sintéticos · ${formatBytes(new Blob([out]).size)}` })
      log('json', 'Dataset de teste gerado', `${formatNumber(count)} registros`)
    } finally {
      setBusy(null)
    }
  }

  const revealPath = async (path) => {
    setView('tree')
    // aguarda a Tree View montar caso outra visualização estivesse ativa
    await new Promise((r) => setTimeout(r, 30))
    treeRef.current?.revealPath(path)
  }

  const copyPath = async (path) => {
    await copyToClipboard(pathToString(path))
    toast.success('Caminho copiado', { description: pathToString(path) })
  }

  const copyValue = async (path) => {
    try {
      const v = await client.call('value', { path })
      await copyToClipboard(typeof v === 'string' ? v : JSON.stringify(v))
      toast.success('Valor copiado')
    } catch (err) {
      toast.error('Não foi possível copiar o valor', { description: err.message })
    }
  }

  const err = analysis && !analysis.ok && analysis.error
  const diagnostics = err?.line ? [{ line: err.line, col: err.col ?? 1, message: err.message }] : []
  const stats = analysis?.ok ? analysis.stats : null

  return (
    <div className="tool-page">
      <PageHeader
        icon={mdiCodeBraces}
        eyebrow="Módulo · JSON"
        title="JSON Organizer"
        description="Valide, formate, consulte e visualize JSONs de qualquer tamanho. O processamento acontece em um Web Worker, sem travar a interface."
      />

      <Toolbar className="tool-toolbar">
        <Button variant="ghost" size="sm" icon={mdiTrayArrowUp} onClick={async () => importFile(await pickFile('.json,application/json,.txt'))}>
          Importar
        </Button>
        <Button variant="ghost" size="sm" icon={mdiDownload} onClick={exportFile} disabled={!text && !editorDisabled}>
          Exportar
        </Button>
        <ToolbarDivider />
        <Button size="sm" icon={mdiFormatAlignLeft} onClick={() => runWorkerText('format', { indent: indentChoice }, 'JSON formatado', 'JSON formatado')} disabled={!analysis?.ok}>
          Formatar
        </Button>
        <select className="input select tool-select" value={indentChoice} onChange={(e) => setIndentChoice(e.target.value)} aria-label="Indentação">
          <option value="2">2 espaços</option>
          <option value="4">4 espaços</option>
          <option value="tab">Tab</option>
        </select>
        <Button variant="outlined" size="sm" icon={mdiArrowCollapseVertical} onClick={() => runWorkerText('minify', {}, 'JSON minificado', 'JSON minificado')} disabled={!analysis?.ok}>
          Minificar
        </Button>
        <Button variant="ghost" size="sm" icon={mdiSortAlphabeticalAscending} onClick={() => runWorkerText('sortKeys', { indent: indentChoice }, 'Chaves ordenadas', 'Chaves ordenadas')} disabled={!analysis?.ok}>
          Ordenar chaves
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={mdiCheckDecagramOutline}
          onClick={async () => {
            const res = await analyze(currentText() ?? text)
            if (res?.ok) toast.success('JSON válido', { description: `${formatNumber(res.stats.totalNodes)} nós · profundidade ${res.stats.maxDepth}` })
            else if (res?.error) toast.error('JSON inválido', { description: `${res.error.message}${res.error.line ? ` (linha ${res.error.line}, coluna ${res.error.col})` : ''}` })
            else if (res?.empty) toast.info('O editor está vazio')
          }}
        >
          Validar
        </Button>
        <IconButton icon={mdiContentCopy} label="Copiar JSON" onClick={copyAll} />
        <IconButton icon={mdiMagnify} label="Buscar no editor (Ctrl+F)" onClick={() => editorRef.current?.openSearch()} disabled={editorDisabled} />
        <ToolbarDivider />
        <Button variant="text" size="sm" icon={mdiFileDocumentOutline} onClick={() => setContent(SAMPLE_JSON, 'exemplo.json')}>
          Exemplo
        </Button>
        <select
          className="input select tool-select"
          value=""
          onChange={(e) => e.target.value && generate(Number(e.target.value))}
          aria-label="Gerar dataset de teste"
          title="Gera dados sintéticos para testar desempenho"
        >
          <option value="">Teste de carga…</option>
          <option value="10000">10 mil registros</option>
          <option value="100000">100 mil registros</option>
          <option value="500000">500 mil registros</option>
        </select>
        <span className="grow" />
        <Segmented
          size="sm"
          value={layout}
          onChange={setLayout}
          ariaLabel="Layout"
          options={[
            { value: 'editor', label: 'Editor', disabled: editorDisabled },
            { value: 'split', label: '', icon: mdiViewSplitVertical, title: 'Dividido', disabled: editorDisabled },
            { value: 'view', label: 'Visualização' },
          ]}
        />
      </Toolbar>

      <DropZone onFile={importFile} accept=".json,.txt" className={`tool-split tool-split--${layout}`} label="Solte o arquivo JSON para importar">
        {layout !== 'view' && (
          <section className="pane pane--editor" aria-label="Editor JSON">
            <div className="pane__header">
              <span className="pane__title mono">{fileName}</span>
              {err ? (
                <Tag variant="error" dot>
                  erro {err.line ? `L${err.line}:${err.col}` : ''}
                </Tag>
              ) : analysis?.ok ? (
                <Tag variant="success" dot>
                  válido
                </Tag>
              ) : null}
              <span className="grow" />
              <IconButton size="sm" icon={mdiFormatListBulletedTriangle} label="Recolher todos os blocos" onClick={() => editorRef.current?.foldAll()} />
            </div>
            {err && (
              <button type="button" className="pane__error" onClick={() => err.line && editorRef.current?.goToLine(err.line, err.col)}>
                <strong>Erro de sintaxe{err.line ? ` na linha ${err.line}, coluna ${err.col}` : ''}:</strong> {err.message}
              </button>
            )}
            <div className="pane__body">
              <CodeEditor
                ref={editorRef}
                value={text}
                onChange={onEditorChange}
                language={jsonExtension}
                fontSize={editorFontSize}
                wrap={wrapLines}
                indent={indentChoice === 'tab' ? 2 : Number(indentChoice)}
                diagnostics={diagnostics}
                ariaLabel="Editor JSON"
                changeDelay={350}
              />
            </div>
          </section>
        )}

        {layout !== 'editor' && (
          <section className="pane pane--view" aria-label="Visualizações">
            <div className="pane__header">
              <Segmented
                size="sm"
                value={view}
                onChange={setView}
                ariaLabel="Modo de visualização"
                options={[
                  { value: 'tree', label: 'Tree', icon: mdiFormatListBulletedTriangle },
                  { value: 'graph', label: 'Graph', icon: mdiGraphOutline },
                  { value: 'stats', label: 'Statistics', icon: mdiChartBoxOutline },
                  { value: 'chart', label: 'Charts', icon: mdiChartBar },
                ]}
              />
              <span className="grow" />
              {analyzing && <span className="btn__spinner" aria-label="Analisando" />}
            </div>

            {editorDisabled && (
              <Alert kind="warning" title="Arquivo muito grande para edição" className="pane__alert">
                Com mais de {formatNumber(EDITOR_LIMIT_CHARS / 1_000_000)} milhões de caracteres o editor fica desativado; todas as visualizações, buscas e
                exportação continuam funcionando.
              </Alert>
            )}

            {view === 'tree' && analysis?.ok && <JsonQueryPanel client={client} disabled={!analysis?.ok} onReveal={revealPath} />}

            <div className="pane__body pane__body--view">
              {!analysis ? (
                <EmptyState icon={mdiDatabaseArrowDownOutline} title="Carregando…" />
              ) : analysis.empty ? (
                <EmptyState icon={mdiCodeBraces} title="Editor vazio" description="Cole um JSON, importe um arquivo ou arraste-o para cá." />
              ) : !analysis.ok ? (
                <EmptyState
                  icon={mdiCodeBraces}
                  title="JSON inválido"
                  description={`${err.message}${err.line ? ` — linha ${err.line}, coluna ${err.col}` : ''}. As visualizações voltam assim que a sintaxe for corrigida.`}
                />
              ) : view === 'tree' ? (
                <JsonTreeView ref={treeRef} tree={tree} root={analysis.root} onCopyPath={copyPath} onCopyValue={copyValue} />
              ) : view === 'graph' ? (
                <JsonGraphView client={client} root={analysis.root} version={version} />
              ) : view === 'stats' ? (
                <div className="pane__scroll">
                  <JsonStatsView analysis={analysis} />
                </div>
              ) : (
                <div className="pane__scroll">
                  <JsonChartView client={client} version={version} />
                </div>
              )}
            </div>
          </section>
        )}
        <BusyOverlay busy={!!busy} progress={busy} />
      </DropZone>

      <footer className="status-bar" aria-live="polite">
        <span>{formatBytes(analysis?.bytes ?? 0)}</span>
        {stats && (
          <>
            <span>{formatNumber(stats.totalNodes)} nós</span>
            <span>{formatNumber(stats.objects)} objetos</span>
            <span>{formatNumber(stats.arrays)} arrays</span>
            <span>{formatNumber(stats.properties)} propriedades</span>
            <span>profundidade {stats.maxDepth}</span>
            <span className="subtle">analisado em {formatDuration(analysis.totalMs)}</span>
          </>
        )}
        {err && <span className="status-bar__error">JSON inválido</span>}
        <span className="grow" />
        <span className="subtle">Web Worker · processamento local</span>
      </footer>
    </div>
  )
}
