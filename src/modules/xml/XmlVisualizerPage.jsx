import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { xml as xmlLang } from '@codemirror/lang-xml'
import {
  mdiArrowCollapseVertical,
  mdiChevronDown,
  mdiChevronUp,
  mdiContentCopy,
  mdiDownload,
  mdiFileDocumentOutline,
  mdiFileTreeOutline,
  mdiFormatAlignLeft,
  mdiMagnify,
  mdiTrayArrowUp,
  mdiUnfoldLessHorizontal,
  mdiUnfoldMoreHorizontal,
  mdiViewSplitVertical,
  mdiXml,
  mdiCheckDecagramOutline,
  mdiLightningBoltOutline,
} from '@mdi/js'
import Button, { IconButton } from '@core/components/Button'
import Icon from '@core/components/Icon'
import { useToast } from '@core/components/Toast'
import { BusyOverlay, DropZone, EmptyState, Segmented, Tag, Toolbar, ToolbarDivider } from '@core/components/ui'
import { createWorkerClient } from '@core/workers/createWorkerClient'
import { copyToClipboard, downloadText, formatBytes, formatDuration, formatNumber, pickFile, readFileAsText } from '@core/utils'
import PageHeader from '@layouts/components/PageHeader'
import CodeEditor from '@/shared/editor/CodeEditor'
import { useActivity } from '@/stores/activity'
import { useSettings } from '@/stores/settings'
import XmlNeonViewer from './components/XmlNeonViewer'
import XmlTreeView from './components/XmlTreeView'
import { xpathOf } from './lib/xmlParser'
import { SAMPLE_XML } from './sample'
import '@/shared/workspace.css'
import './xml.css'

const xmlExtension = xmlLang()

function useXmlWorker() {
  const client = useMemo(() => createWorkerClient(() => new Worker(new URL('./xml.worker.js', import.meta.url), { type: 'module' })), [])
  useEffect(() => () => client.terminate(), [client])
  return client
}

export default function XmlVisualizerPage() {
  const client = useXmlWorker()
  const toast = useToast()
  const log = useActivity((s) => s.log)
  const { editorFontSize, wrapLines } = useSettings()
  const editorRef = useRef(null)
  const viewerRef = useRef(null)

  const [text, setText] = useState(SAMPLE_XML)
  const [fileName, setFileName] = useState('exemplo.xml')
  const [result, setResult] = useState(null)
  const [data, setData] = useState(null) // último resultado válido (mantém a visualização enquanto o usuário digita)
  const [busy, setBusy] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [layout, setLayout] = useState('split')
  const [view, setView] = useState('neon')
  const [indent, setIndent] = useState('4')
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [hovered, setHovered] = useState(null)
  const [selected, setSelected] = useState(null)
  const [entering, setEntering] = useState(null)
  const [query, setQuery] = useState('')
  const [hitIndex, setHitIndex] = useState(0)
  const [pendingReveal, setPendingReveal] = useState(null)
  const seq = useRef(0)

  const analyze = useCallback(
    async (value, { quiet = true } = {}) => {
      const id = ++seq.current
      setAnalyzing(true)
      if (!quiet) setBusy({ message: 'Analisando XML…' })
      try {
        const res = await client.call('parse', { text: value }, { onProgress: (p) => !quiet && setBusy(p) })
        if (id !== seq.current) return null
        setResult(res)
        if (!res.error) {
          setData(res)
          setCollapsed(new Set())
          setSelected(null)
        }
        return res
      } catch (err) {
        if (id === seq.current && !err.terminated && !err.cancelled) toast.error('Falha ao analisar o XML', { description: err.message })
        return null
      } finally {
        if (id === seq.current) {
          setAnalyzing(false)
          setBusy(null)
        }
      }
    },
    [client, toast],
  )

  useEffect(() => {
    analyze(SAMPLE_XML)
  }, [analyze])

  /* ── Linhas visíveis (respeitando elementos recolhidos) ── */
  const visible = useMemo(() => {
    if (!data) return []
    const out = []
    const { lines } = data
    for (let i = 0; i < lines.length; i++) {
      out.push(i)
      const l = lines[i]
      if (l.kind === 'open' && collapsed.has(l.node)) i = l.pair
    }
    return out
  }, [data, collapsed])

  const lineOfNode = useMemo(() => {
    const m = new Map()
    data?.lines.forEach((l, i) => !m.has(l.node) && m.set(l.node, i))
    return m
  }, [data])

  /* ── Busca: nomes de tag, atributos e textos ── */
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !data) return null
    const ids = []
    for (const nd of data.nodes) {
      if (nd.type === 'element') {
        if (nd.name.toLowerCase().includes(q) || nd.attrs.some(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q))) ids.push(nd.id)
      } else if (nd.text && nd.text.toLowerCase().includes(q)) {
        // texto de elementos "inline" aparece na linha do pai
        ids.push(lineOfNode.has(nd.id) ? nd.id : nd.parent)
      }
    }
    return [...new Set(ids)]
  }, [query, data, lineOfNode])
  const hitSet = useMemo(() => (hits ? new Set(hits) : null), [hits])

  /** Expande os ancestores de um nó e rola o visualizador até ele. */
  const reveal = useCallback(
    (nodeId) => {
      if (!data) return
      const ancestors = []
      let p = data.nodes[nodeId].parent
      while (p >= 0) {
        ancestors.push(p)
        p = data.nodes[p].parent
      }
      setCollapsed((s) => {
        if (!ancestors.some((a) => s.has(a))) return s
        const n = new Set(s)
        ancestors.forEach((a) => n.delete(a))
        return n
      })
      setSelected(nodeId)
      setPendingReveal(nodeId)
    },
    [data],
  )

  useEffect(() => {
    if (pendingReveal === null || view !== 'neon') return
    const target = lineOfNode.get(pendingReveal) ?? lineOfNode.get(data?.nodes[pendingReveal]?.parent)
    const vi = visible.indexOf(target)
    if (vi >= 0) {
      viewerRef.current?.scrollToVisibleIndex(vi)
      setPendingReveal(null)
    }
  }, [pendingReveal, visible, lineOfNode, view, data])

  const stepHit = (d) => {
    if (!hits?.length) return
    const i = (hitIndex + d + hits.length) % hits.length
    setHitIndex(i)
    setView('neon')
    reveal(hits[i])
  }

  useEffect(() => setHitIndex(0), [query])

  const toggle = (nodeId) => {
    const expanding = collapsed.has(nodeId)
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(nodeId)) n.delete(nodeId)
      else n.add(nodeId)
      return n
    })
    // anima a entrada dos filhos que acabaram de aparecer
    if (expanding) setEntering({ node: nodeId, at: Date.now() })
  }

  useEffect(() => {
    if (!entering) return
    const t = setTimeout(() => setEntering(null), 700)
    return () => clearTimeout(t)
  }, [entering])

  const collapseToDepth = (depth) => {
    if (!data) return
    setCollapsed(new Set(data.lines.filter((l) => l.kind === 'open' && l.depth >= depth).map((l) => l.node)))
  }

  const select = (nodeId) => {
    setSelected(nodeId)
    const line = data?.nodes[nodeId]?.line
    if (line && layout !== 'view') editorRef.current?.goToLine(line)
  }

  /* ── Ações ── */
  const setContent = (value, name) => {
    setText(value)
    if (name) setFileName(name)
    return analyze(value, { quiet: value.length < 1_000_000 })
  }

  const transform = async (method, successMsg) => {
    if (result?.error) return toast.error('Corrija os erros de sintaxe antes', { description: result.error.message })
    setBusy({ message: 'Processando…' })
    try {
      const out = await client.call(method, { indent })
      await setContent(out)
      toast.success(successMsg, { description: formatBytes(new Blob([out]).size) })
      log('xml', successMsg, fileName)
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
      if (res?.error) toast.warning('Arquivo importado com erros', { description: `${res.error.message} (linha ${res.error.line})` })
      else toast.success('Arquivo importado', { description: `${file.name} · ${formatBytes(file.size)}` })
      log('xml', 'Arquivo importado', `${file.name} · ${formatBytes(file.size)}`)
    } catch (err) {
      toast.error('Não foi possível ler o arquivo', { description: err.message })
      setBusy(null)
    }
  }

  const exportFile = () => {
    const content = editorRef.current?.getValue() ?? text
    const name = /\.\w+$/.test(fileName) ? fileName : `${fileName}.xml`
    downloadText(content, name, 'application/xml')
    toast.success('Arquivo exportado', { description: name })
    log('xml', 'Arquivo exportado', name)
  }

  const err = result?.error
  const stale = !!err && !!data
  const selNode = selected !== null && data ? data.nodes[selected] : null

  return (
    <div className="tool-page">
      <PageHeader
        icon={mdiXml}
        eyebrow="Módulo · XML"
        title="XML Visualizer"
        description="Cada elemento ganha uma cor neon por nível: abertura e fechamento combinam, guias ligam pais e filhos e o hover acende o par inteiro."
      />

      <Toolbar className="tool-toolbar">
        <Button variant="ghost" size="sm" icon={mdiTrayArrowUp} onClick={async () => importFile(await pickFile('.xml,.xsd,.xsl,.svg,.config,.csproj,.txt'))}>
          Importar
        </Button>
        <Button variant="ghost" size="sm" icon={mdiDownload} onClick={exportFile}>
          Exportar
        </Button>
        <ToolbarDivider />
        <Button size="sm" icon={mdiFormatAlignLeft} onClick={() => transform('format', 'XML formatado')} disabled={!!err}>
          Formatar
        </Button>
        <select className="input select tool-select" value={indent} onChange={(e) => setIndent(e.target.value)} aria-label="Indentação">
          <option value="2">2 espaços</option>
          <option value="4">4 espaços</option>
          <option value="tab">Tab</option>
        </select>
        <Button variant="outlined" size="sm" icon={mdiArrowCollapseVertical} onClick={() => transform('minify', 'XML minificado')} disabled={!!err}>
          Minificar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={mdiCheckDecagramOutline}
          onClick={async () => {
            const res = await analyze(editorRef.current?.getValue() ?? text, { quiet: false })
            if (!res) return
            if (res.error) toast.error('XML inválido', { description: `${res.error.message} — linha ${res.error.line}, coluna ${res.error.col}` })
            else toast.success('XML bem formado', { description: `${formatNumber(res.stats.elements)} elementos · profundidade ${res.stats.maxDepth}` })
          }}
        >
          Validar
        </Button>
        <IconButton
          icon={mdiContentCopy}
          label="Copiar XML"
          onClick={async () => {
            await copyToClipboard(editorRef.current?.getValue() ?? text)
            toast.success('XML copiado')
          }}
        />
        <ToolbarDivider />
        <Button variant="text" size="sm" icon={mdiFileDocumentOutline} onClick={() => setContent(SAMPLE_XML, 'exemplo.xml')}>
          Exemplo
        </Button>
        <span className="grow" />
        <Segmented
          size="sm"
          value={layout}
          onChange={setLayout}
          ariaLabel="Layout"
          options={[
            { value: 'editor', label: 'Editor' },
            { value: 'split', label: '', icon: mdiViewSplitVertical, title: 'Dividido' },
            { value: 'view', label: 'Visualização' },
          ]}
        />
      </Toolbar>

      <DropZone onFile={importFile} accept=".xml,.xsd,.xsl,.svg,.config,.csproj,.txt" className={`tool-split tool-split--${layout}`} label="Solte o arquivo XML para importar">
        {layout !== 'view' && (
          <section className="pane" aria-label="Editor XML">
            <div className="pane__header">
              <span className="pane__title mono">{fileName}</span>
              {err ? (
                <Tag variant="error" dot>
                  erro L{err.line}:{err.col}
                </Tag>
              ) : result ? (
                <Tag variant="success" dot>
                  bem formado
                </Tag>
              ) : null}
              <span className="grow" />
              <IconButton size="sm" icon={mdiMagnify} label="Buscar no editor (Ctrl+F)" onClick={() => editorRef.current?.openSearch()} />
            </div>
            {err && (
              <button type="button" className="pane__error" onClick={() => editorRef.current?.goToLine(err.line, err.col)}>
                <strong>
                  Linha {err.line}, coluna {err.col}:
                </strong>{' '}
                {err.message}
              </button>
            )}
            <div className="pane__body">
              <CodeEditor
                ref={editorRef}
                value={text}
                onChange={(v) => {
                  setText(v)
                  analyze(v)
                }}
                language={xmlExtension}
                fontSize={editorFontSize}
                wrap={wrapLines}
                indent={indent === 'tab' ? 4 : Number(indent)}
                diagnostics={err ? [{ line: err.line, col: err.col, message: err.message }] : []}
                ariaLabel="Editor XML"
                changeDelay={350}
              />
            </div>
          </section>
        )}

        {layout !== 'editor' && (
          <section className="pane" aria-label="Visualização do XML">
            <div className="pane__header xv-header">
              <Segmented
                size="sm"
                value={view}
                onChange={setView}
                ariaLabel="Modo de visualização"
                options={[
                  { value: 'neon', label: 'Neon', icon: mdiLightningBoltOutline },
                  { value: 'tree', label: 'Árvore', icon: mdiFileTreeOutline },
                ]}
              />
              <div className="xv-search">
                <Icon path={mdiMagnify} size={15} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && stepHit(e.shiftKey ? -1 : 1)}
                  placeholder="Tag, atributo ou texto…"
                  aria-label="Buscar no XML"
                />
                {hits && <span className="xv-search__count mono">{hits.length ? `${hitIndex + 1}/${formatNumber(hits.length)}` : '0'}</span>}
                <IconButton size="sm" icon={mdiChevronUp} label="Anterior" onClick={() => stepHit(-1)} disabled={!hits?.length} />
                <IconButton size="sm" icon={mdiChevronDown} label="Próximo" onClick={() => stepHit(1)} disabled={!hits?.length} />
              </div>
              {view === 'neon' && (
                <>
                  <IconButton size="sm" icon={mdiUnfoldMoreHorizontal} label="Expandir tudo" onClick={() => setCollapsed(new Set())} />
                  <IconButton size="sm" icon={mdiUnfoldLessHorizontal} label="Recolher a partir do 2º nível" onClick={() => collapseToDepth(1)} />
                </>
              )}
              {analyzing && <span className="btn__spinner" aria-label="Analisando" />}
            </div>
            {stale && <div className="xv-stale">Exibindo a última versão válida — corrija o erro na linha {err.line} para atualizar.</div>}
            <div className="pane__body pane__body--view">
              {!data ? (
                err ? (
                  <EmptyState icon={mdiXml} title="XML inválido" description={`${err.message} — linha ${err.line}, coluna ${err.col}.`} />
                ) : (
                  <EmptyState icon={mdiXml} title="Carregando…" />
                )
              ) : view === 'neon' ? (
                <XmlNeonViewer
                  ref={viewerRef}
                  data={data}
                  visible={visible}
                  collapsed={collapsed}
                  onToggle={toggle}
                  hovered={hovered}
                  onHover={setHovered}
                  selected={selected}
                  onSelect={select}
                  hits={hitSet}
                  activeHit={hits?.[hitIndex]}
                  entering={entering}
                />
              ) : (
                <XmlTreeView
                  data={data}
                  selected={selected}
                  hits={hitSet}
                  onSelect={(id) => {
                    select(id)
                  }}
                />
              )}
            </div>
            {selNode && (
              <div className="xv-detail">
                <code className="xv-detail__path">{xpathOf(data.nodes, selNode.id)}</code>
                {selNode.type === 'element' && (
                  <>
                    <span className="subtle">
                      {formatNumber(selNode.children.length)} filho(s) · {selNode.attrs.length} atributo(s) · linha {selNode.line}
                    </span>
                    {selNode.attrs.length > 0 && (
                      <div className="xv-detail__attrs">
                        {selNode.attrs.map(([k, v]) => (
                          <span key={k} className="xv-detail__attr">
                            <span className="xv-attr">{k}</span> <span className="xv-val">{v}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {view === 'tree' && (
                      <Button size="sm" variant="ghost" icon={mdiLightningBoltOutline} onClick={() => (setView('neon'), reveal(selNode.id))}>
                        Ver no visualizador
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        )}
        <BusyOverlay busy={!!busy} progress={busy} />
      </DropZone>

      <footer className="status-bar">
        <span>{formatBytes(result?.bytes ?? 0)}</span>
        {data && (
          <>
            <span>{formatNumber(data.stats.elements)} elementos</span>
            <span>{formatNumber(data.stats.attributes)} atributos</span>
            <span>{formatNumber(data.stats.uniqueTags)} tags distintas</span>
            <span>profundidade {data.stats.maxDepth}</span>
            <span>{formatNumber(data.lines.length)} linhas</span>
            {result && <span className="subtle">analisado em {formatDuration(result.ms)}</span>}
          </>
        )}
        {err && <span className="status-bar__error">XML inválido</span>}
        <span className="grow" />
        <span className="subtle">Web Worker · processamento local</span>
      </footer>
    </div>
  )
}
