import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MSSQL, MySQL, PostgreSQL, sql as sqlLang } from '@codemirror/lang-sql'
import {
  mdiArrowCollapseAll,
  mdiArrowExpandAll,
  mdiAutoFix,
  mdiDatabaseOutline,
  mdiDownload,
  mdiFileDocumentOutline,
  mdiFitToScreenOutline,
  mdiKeyVariant,
  mdiLinkVariant,
  mdiMagnify,
  mdiMinus,
  mdiPlus,
  mdiTrayArrowUp,
  mdiViewSplitVertical,
  mdiAlertOutline,
  mdiClose,
} from '@mdi/js'
import Button, { IconButton } from '@core/components/Button'
import Icon from '@core/components/Icon'
import { useToast } from '@core/components/Toast'
import { DropZone, EmptyState, Segmented, Tag, Toolbar, ToolbarDivider } from '@core/components/ui'
import { useDebouncedValue } from '@core/hooks'
import { cn, downloadBlob, downloadText, formatNumber, pickFile, readFileAsText } from '@core/utils'
import PageHeader from '@layouts/components/PageHeader'
import CodeEditor from '@/shared/editor/CodeEditor'
import { useActivity } from '@/stores/activity'
import { useSettings } from '@/stores/settings'
import DiagramCanvas from './components/DiagramCanvas'
import { serializeDiagramSvg, svgToPngBlob, toDBML, toJSON, toMermaid } from './lib/exporters'
import { autoLayout, tableSize } from './lib/layout'
import { buildSchema } from './lib/schema'
import { DIALECTS } from './lib/sql/dialects'
import { SAMPLE_SQL } from './sample'
import '@/shared/workspace.css'
import './dbdiagram.css'

const LANG = {
  sqlserver: sqlLang({ dialect: MSSQL }),
  postgres: sqlLang({ dialect: PostgreSQL }),
  mysql: sqlLang({ dialect: MySQL }),
}

const easeOut = (t) => 1 - (1 - t) ** 3
const prefersReduced = () => document.documentElement.dataset.motion === 'reduced' || (document.documentElement.dataset.motion !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

export default function DbDiagramPage() {
  const toast = useToast()
  const log = useActivity((s) => s.log)
  const settings = useSettings()
  const editorRef = useRef(null)
  const canvasRef = useRef(null)

  const [sql, setSql] = useState(SAMPLE_SQL)
  const [fileName, setFileName] = useState('modelo.sql')
  const [dialect, setDialect] = useState(settings.sqlDialect)
  const [layout, setLayout] = useState('split')
  const [positions, setPositions] = useState(() => new Map())
  const [pinned, setPinned] = useState(() => new Map())
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [crossings, setCrossings] = useState(0)
  const [exportOpen, setExportOpen] = useState(false)
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const tween = useRef(null)
  const firstFit = useRef(true)

  const debouncedSql = useDebouncedValue(sql, 350)
  const schema = useMemo(() => {
    const t0 = performance.now()
    const s = buildSchema(debouncedSql, dialect)
    s.ms = performance.now() - t0
    return s
  }, [debouncedSql, dialect])

  const sizes = useMemo(() => new Map(schema.tables.map((t) => [t.id, tableSize(t, collapsed.has(t.id))])), [schema, collapsed])

  /** Anima as tabelas até as novas posições (interpolação em JS, para as linhas acompanharem). */
  const animateTo = useCallback((target) => {
    cancelAnimationFrame(tween.current)
    const from = positionsRef.current
    if (prefersReduced() || !from.size) {
      setPositions(target)
      return
    }
    const start = performance.now()
    const dur = 550
    const step = (now) => {
      const t = easeOut(Math.min(1, (now - start) / dur))
      const next = new Map()
      for (const [id, to] of target) {
        const f = from.get(id) ?? to
        next.set(id, { x: f.x + (to.x - f.x) * t, y: f.y + (to.y - f.y) * t })
      }
      setPositions(next)
      if (t < 1) tween.current = requestAnimationFrame(step)
    }
    tween.current = requestAnimationFrame(step)
  }, [])

  const runLayout = useCallback(
    (keepPinned = true) => {
      const pins = keepPinned ? new Map([...pinned].filter(([id]) => sizes.has(id))) : new Map()
      const res = autoLayout(schema.tables, schema.relations, { sizes, pinned: pins })
      setCrossings(res.crossings)
      animateTo(res.positions)
      if (!keepPinned) setPinned(new Map())
      return res
    },
    [schema, sizes, pinned, animateTo],
  )

  // Reorganiza quando o conjunto de tabelas ou relacionamentos muda (alterar só colunas mantém o layout)
  const structureKey = useMemo(
    () => `${schema.tables.map((t) => t.id).sort().join('|')}#${schema.relations.map((r) => r.id).sort().join('|')}`,
    [schema],
  )
  useEffect(() => {
    runLayout(true)
    if (firstFit.current && schema.tables.length) {
      firstFit.current = false
      setTimeout(() => canvasRef.current?.fit(0), 30)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey])

  useEffect(() => () => cancelAnimationFrame(tween.current), [])

  const onMove = useCallback((id, p) => {
    cancelAnimationFrame(tween.current)
    setPositions((prev) => new Map(prev).set(id, p))
    setPinned((prev) => new Map(prev).set(id, p))
  }, [])

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return new Set(schema.tables.filter((t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))).map((t) => t.id))
  }, [query, schema])

  const focusFirstHit = () => {
    const first = hits && [...hits][0]
    if (first) {
      setSelected(first)
      canvasRef.current?.centerOn(first)
    } else if (query) toast.info('Nenhuma tabela encontrada', { description: query })
  }

  /* ── Exportação ── */
  const doExport = async (kind) => {
    setExportOpen(false)
    if (!schema.tables.length) return toast.error('Nada para exportar', { description: 'O script não possui tabelas válidas.' })
    const base = fileName.replace(/\.\w+$/, '') || 'diagrama'
    try {
      if (kind === 'svg' || kind === 'png') {
        const { svg, root } = canvasRef.current.elements()
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated').trim() || '#0e1522'
        const { markup, width, height } = serializeDiagramSvg(svg, root, bg)
        if (kind === 'svg') downloadText(markup, `${base}.svg`, 'image/svg+xml')
        else downloadBlob(await svgToPngBlob(markup, width, height, 2), `${base}.png`)
      } else if (kind === 'dbml') downloadText(toDBML(schema), `${base}.dbml`)
      else if (kind === 'mermaid') downloadText(toMermaid(schema), `${base}.mmd`)
      else downloadText(toJSON(schema, positions), `${base}.diagram.json`, 'application/json')
      toast.success('Diagrama exportado', { description: `${base}.${kind === 'mermaid' ? 'mmd' : kind === 'json' ? 'diagram.json' : kind}` })
      log('db', `Diagrama exportado (${kind.toUpperCase()})`, `${schema.tables.length} tabelas`)
    } catch (err) {
      toast.error('Falha na exportação', { description: err.message })
    }
  }

  const importFile = async (file, error) => {
    if (error) return toast.error('Arquivo não suportado', { description: error.message })
    if (!file) return
    try {
      const content = await readFileAsText(file)
      setSql(content)
      setFileName(file.name)
      firstFit.current = true
      setPinned(new Map())
      toast.success('Script importado', { description: file.name })
      log('db', 'Script SQL importado', file.name)
    } catch (err) {
      toast.error('Não foi possível ler o arquivo', { description: err.message })
    }
  }

  const sel = selected ? schema.tables.find((t) => t.id === selected) : null
  const tableName = (id) => schema.tables.find((t) => t.id === id)?.name ?? id
  const diagnostics = schema.errors.map((e) => ({ line: e.line, col: e.col, message: e.message }))

  return (
    <div className="tool-page">
      <PageHeader
        icon={mdiDatabaseOutline}
        eyebrow="Módulo · SQL → ER"
        title="Database Diagram Generator"
        description="Cole scripts CREATE TABLE e veja o diagrama se montar: PK, FK, UNIQUE, NOT NULL e cardinalidade, com layout automático e exportação."
      />

      <Toolbar className="tool-toolbar">
        <Button variant="ghost" size="sm" icon={mdiTrayArrowUp} onClick={async () => importFile(await pickFile('.sql,.txt,.ddl'))}>
          Importar .sql
        </Button>
        <select className="input select tool-select" value={dialect} onChange={(e) => setDialect(e.target.value)} aria-label="Dialeto SQL">
          {Object.values(DIALECTS).map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <Button variant="text" size="sm" icon={mdiFileDocumentOutline} onClick={() => (setSql(SAMPLE_SQL), setDialect('sqlserver'), (firstFit.current = true))}>
          Exemplo
        </Button>
        <ToolbarDivider />
        <Button size="sm" icon={mdiAutoFix} onClick={() => (runLayout(false), setTimeout(() => canvasRef.current?.fit(), 600), toast.info('Diagrama reorganizado', { description: 'Posições manuais descartadas.' }))}>
          Reorganizar
        </Button>
        <IconButton icon={mdiFitToScreenOutline} label="Enquadrar diagrama" onClick={() => canvasRef.current?.fit()} />
        <IconButton icon={mdiMinus} label="Diminuir zoom" onClick={() => canvasRef.current?.zoomBy(0.8)} />
        <IconButton icon={mdiPlus} label="Aumentar zoom" onClick={() => canvasRef.current?.zoomBy(1.25)} />
        <IconButton icon={mdiArrowCollapseAll} label="Mostrar só chaves em todas as tabelas" onClick={() => setCollapsed(new Set(schema.tables.map((t) => t.id)))} />
        <IconButton icon={mdiArrowExpandAll} label="Mostrar todas as colunas" onClick={() => setCollapsed(new Set())} />
        <div className="db-search">
          <Icon path={mdiMagnify} size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && focusFirstHit()} placeholder="Buscar tabela ou coluna…" aria-label="Buscar tabelas" />
          {hits && <span className="mono db-search__count">{hits.size}</span>}
        </div>
        <div className="db-export">
          <Button size="sm" variant="outlined" icon={mdiDownload} onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen} aria-haspopup="menu">
            Exportar
          </Button>
          {exportOpen && (
            <div className="db-export__menu" role="menu" onMouseLeave={() => setExportOpen(false)}>
              {[
                ['svg', 'SVG', 'vetorial, para documentos'],
                ['png', 'PNG', 'imagem em alta resolução (2×)'],
                ['dbml', 'DBML', 'editável no dbdiagram.io'],
                ['mermaid', 'Mermaid', 'erDiagram para Markdown'],
                ['json', 'JSON', 'modelo + posições do layout'],
              ].map(([k, label, desc]) => (
                <button key={k} type="button" role="menuitem" onClick={() => doExport(k)}>
                  <strong>{label}</strong>
                  <span>{desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="grow" />
        <Segmented
          size="sm"
          value={layout}
          onChange={setLayout}
          ariaLabel="Layout"
          options={[
            { value: 'editor', label: 'SQL' },
            { value: 'split', label: '', icon: mdiViewSplitVertical, title: 'Dividido' },
            { value: 'view', label: 'Diagrama' },
          ]}
        />
      </Toolbar>

      <DropZone onFile={importFile} accept=".sql,.txt,.ddl" className={`tool-split db-split tool-split--${layout}`} label="Solte o script SQL para importar">
        {layout !== 'view' && (
          <section className="pane" aria-label="Editor SQL">
            <div className="pane__header">
              <span className="pane__title mono">{fileName}</span>
              {schema.errors.length ? (
                <Tag variant="error" dot>
                  {schema.errors.length} erro{schema.errors.length > 1 ? 's' : ''}
                </Tag>
              ) : (
                <Tag variant="success" dot>
                  {schema.tables.length} tabela{schema.tables.length === 1 ? '' : 's'}
                </Tag>
              )}
              {schema.warnings.length > 0 && <Tag variant="warning">{schema.warnings.length} aviso(s)</Tag>}
            </div>
            {(schema.errors.length > 0 || schema.warnings.length > 0) && (
              <ul className="db-issues">
                {schema.errors.map((e, i) => (
                  <li key={`e${i}`}>
                    <button type="button" className="db-issue db-issue--error" onClick={() => editorRef.current?.goToLine(e.line, e.col)}>
                      <Icon path={mdiAlertOutline} size={14} /> <strong>L{e.line}:</strong> {e.message}
                    </button>
                  </li>
                ))}
                {schema.warnings.map((w, i) => (
                  <li key={`w${i}`}>
                    <button type="button" className="db-issue db-issue--warning" onClick={() => w.line && editorRef.current?.goToLine(w.line)}>
                      <Icon path={mdiAlertOutline} size={14} /> {w.line && <strong>L{w.line}:</strong>} {w.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="pane__body">
              <CodeEditor
                ref={editorRef}
                value={sql}
                onChange={setSql}
                language={LANG[dialect]}
                fontSize={settings.editorFontSize}
                wrap={settings.wrapLines}
                indent={4}
                diagnostics={diagnostics}
                ariaLabel="Editor SQL"
                changeDelay={150}
              />
            </div>
          </section>
        )}

        {layout !== 'editor' && (
          <section className="pane db-pane" aria-label="Diagrama">
            <div className="pane__body">
              {schema.tables.length ? (
                <DiagramCanvas
                  ref={canvasRef}
                  schema={schema}
                  positions={positions}
                  sizes={sizes}
                  collapsed={collapsed}
                  selected={selected}
                  onSelect={setSelected}
                  onMove={onMove}
                  hits={hits}
                  onBackgroundClick={() => setSelected(null)}
                  onToggleCollapse={(id) =>
                    setCollapsed((s) => {
                      const n = new Set(s)
                      if (n.has(id)) n.delete(id)
                      else n.add(id)
                      return n
                    })
                  }
                />
              ) : (
                <EmptyState
                  icon={mdiDatabaseOutline}
                  title={schema.errors.length ? 'Nenhuma tabela válida' : 'Nenhuma tabela ainda'}
                  description={schema.errors.length ? 'Corrija os erros apontados no editor para gerar o diagrama.' : 'Escreva ou cole comandos CREATE TABLE no editor.'}
                />
              )}
              <div className="db-legend" aria-label="Legenda">
                <span>
                  <Icon path={mdiKeyVariant} size={13} className="db-legend__pk" /> PK
                </span>
                <span>
                  <Icon path={mdiLinkVariant} size={13} className="db-legend__fk" /> FK
                </span>
                <span className="mono">NN</span> not null
                <span className="mono">U</span> unique
                <span className="mono">ID</span> identity
                <span className="db-legend__sym">||</span> um
                <span className="db-legend__sym">o|</span> zero ou um
                <span className="db-legend__sym">o&lt;</span> zero ou muitos
              </div>
            </div>

            {sel && (
              <aside className="db-inspector" aria-label={`Detalhes de ${sel.name}`}>
                <header>
                  <Icon path={mdiDatabaseOutline} size={16} />
                  <strong>{sel.name}</strong>
                  <span className="subtle">{sel.schema}</span>
                  <span className="grow" />
                  <IconButton size="sm" icon={mdiClose} label="Fechar detalhes" onClick={() => setSelected(null)} />
                </header>
                <ul className="db-inspector__cols">
                  {sel.columns.map((c) => (
                    <li key={c.name}>
                      <span className={cn('mono', c.pk && 'db-c-pk', c.fk && 'db-c-fk')}>{c.name}</span>
                      <span className="subtle mono">{c.type}</span>
                      <span className="db-inspector__tags">
                        {c.pk && <Tag variant="warning">PK</Tag>}
                        {c.fk && <Tag variant="cyan">FK</Tag>}
                        {c.unique && !c.pk && <Tag variant="violet">UNIQUE</Tag>}
                        {c.notNull && !c.pk && <Tag variant="neutral">NOT NULL</Tag>}
                        {c.identity && <Tag variant="info">IDENTITY</Tag>}
                        {c.default && <Tag variant="neutral">DEFAULT {c.default}</Tag>}
                        {c.check && <Tag variant="neutral">CHECK</Tag>}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="db-inspector__rels">
                  {schema.relations
                    .filter((r) => r.from.table === sel.id || r.to.table === sel.id)
                    .map((r) => (
                      <button key={r.id} type="button" className="db-rel" onClick={() => {
                        const other = r.from.table === sel.id ? r.to.table : r.from.table
                        setSelected(other)
                        canvasRef.current?.centerOn(other)
                      }}>
                        <span className="mono">
                          {tableName(r.from.table)}.{r.from.columns.join(', ')} → {tableName(r.to.table)}.{r.to.columns.join(', ')}
                        </span>
                        <Tag variant={r.cardinality.kind === 'one-to-one' ? 'violet' : 'info'}>{r.cardinality.kind === 'one-to-one' ? '1 : 1' : 'N : 1'}</Tag>
                        {r.onDelete && <Tag variant="neutral">ON DELETE {r.onDelete}</Tag>}
                      </button>
                    ))}
                </div>
              </aside>
            )}
          </section>
        )}
      </DropZone>

      <footer className="status-bar">
        <span>{formatNumber(schema.tables.length)} tabelas</span>
        <span>{formatNumber(schema.relations.length)} relacionamentos</span>
        <span>{formatNumber(schema.tables.reduce((a, t) => a + t.columns.length, 0))} colunas</span>
        <span>cruzamentos: {crossings}</span>
        {schema.stats.skipped > 0 && <span className="subtle">{schema.stats.skipped} instrução(ões) não-DDL ignorada(s)</span>}
        <span className="subtle">parse em {schema.ms.toFixed(1).replace('.', ',')} ms</span>
        <span className="grow" />
        <span className="subtle">{DIALECTS[dialect].label} · parser com AST</span>
      </footer>
    </div>
  )
}
