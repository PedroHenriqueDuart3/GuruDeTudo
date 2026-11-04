import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hierarchy, tree as d3tree } from 'd3-hierarchy'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom'
import { linkHorizontal, linkVertical } from 'd3-shape'
import {
  mdiArrowCollapseAll,
  mdiArrowExpandAll,
  mdiChevronDown,
  mdiChevronUp,
  mdiFitToScreenOutline,
  mdiMagnify,
  mdiMinus,
  mdiPlus,
  mdiRotate3dVariant,
} from '@mdi/js'
import { IconButton } from '@core/components/Button'
import Icon from '@core/components/Icon'
import { Segmented, Tag } from '@core/components/ui'
import { cn, formatNumber } from '@core/utils'
import { pathToString } from '../lib/jsonEngine'
import { keyOf, useLazyTree } from '../hooks/useLazyTree'

const NODE_W = 190
const NODE_H = 28
const TYPE_COLOR = {
  object: 'var(--c-neon)',
  array: 'var(--c-cyan)',
  string: 'var(--syn-string)',
  number: 'var(--syn-number)',
  boolean: 'var(--syn-bool)',
  null: 'var(--syn-null)',
  more: 'var(--text-subtle)',
}

/**
 * Graph View: a estrutura JSON como grafo (árvore organizada automaticamente).
 * Zoom/pan com roda e arraste; clique em objetos/arrays para expandir/recolher.
 */
export default function JsonGraphView({ client, root, version, onSelect }) {
  const tree = useLazyTree(client, root, version, { pageSize: 40, initialDepth: 2 })
  const svgRef = useRef(null)
  const gRef = useRef(null)
  const zoomRef = useRef(null)
  const [orientation, setOrientation] = useState('h')
  const [zoomK, setZoomK] = useState(1)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState(null)
  const [hitIndex, setHitIndex] = useState(0)
  const [focusId, setFocusId] = useState(null)
  const [searching, setSearching] = useState(false)

  // Monta a hierarquia apenas com o que já foi carregado/expandido
  const layout = useMemo(() => {
    if (!root) return null
    const build = (path, summary) => {
      const k = keyOf(path)
      const node = { id: k, path, summary, children: undefined }
      if ((summary.type === 'object' || summary.type === 'array') && tree.expanded.has(k)) {
        const entry = tree.cache.get(k)
        if (entry) {
          node.children = entry.items.map((it) => build([...path, it.key], it))
          const rest = entry.total - (entry.offset + entry.items.length)
          if (rest > 0) node.children.push({ id: `${k}:more`, path, summary: { type: 'more', size: rest, key: `+${formatNumber(rest)}` }, more: true })
        }
      }
      return node
    }
    const h = hierarchy(build([], root))
    const gapX = orientation === 'h' ? NODE_W + 60 : NODE_W + 16
    const gapY = orientation === 'h' ? NODE_H + 12 : NODE_H + 70
    d3tree()
      .nodeSize(orientation === 'h' ? [gapY, gapX] : [gapX, gapY])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.25))(h)
    const nodes = h.descendants().map((d) => ({
      ...d.data,
      depth: d.depth,
      x: orientation === 'h' ? d.y : d.x,
      y: orientation === 'h' ? d.x : d.y,
    }))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const links = h.links().map((l) => ({ id: `${l.source.data.id}->${l.target.data.id}`, s: byId.get(l.source.data.id), t: byId.get(l.target.data.id) }))
    return { nodes, links, byId }
  }, [root, tree.expanded, tree.cache, orientation])

  // Zoom / pan — aplicado direto no <g> (sem re-render do React a cada frame)
  useEffect(() => {
    const svg = select(svgRef.current)
    const z = d3zoom()
      .scaleExtent([0.08, 3])
      .on('zoom', (e) => {
        gRef.current?.setAttribute('transform', e.transform.toString())
        setZoomK(e.transform.k)
      })
    zoomRef.current = z
    svg.call(z).on('dblclick.zoom', null)
    svg.call(z.transform, zoomIdentity.translate(60, svgRef.current.clientHeight / 2).scale(0.9))
    return () => svg.on('.zoom', null)
  }, [])

  const fit = useCallback(() => {
    if (!layout?.nodes.length) return
    const svg = svgRef.current
    const xs = layout.nodes.map((n) => n.x)
    const ys = layout.nodes.map((n) => n.y)
    const minX = Math.min(...xs) - 20
    const maxX = Math.max(...xs) + NODE_W + 20
    const minY = Math.min(...ys) - NODE_H
    const maxY = Math.max(...ys) + NODE_H
    const k = Math.min(1.2, Math.min(svg.clientWidth / (maxX - minX), svg.clientHeight / (maxY - minY)))
    const t = zoomIdentity.translate(svg.clientWidth / 2 - ((minX + maxX) / 2) * k, svg.clientHeight / 2 - ((minY + maxY) / 2) * k).scale(k)
    select(svg).transition().duration(600).call(zoomRef.current.transform, t)
  }, [layout])

  const centerOn = useCallback((node) => {
    const svg = svgRef.current
    const k = Math.max(0.8, zoomK)
    const t = zoomIdentity.translate(svg.clientWidth / 2 - (node.x + NODE_W / 2) * k, svg.clientHeight / 2 - node.y * k).scale(k)
    select(svg).transition().duration(500).call(zoomRef.current.transform, t)
  }, [zoomK])

  // Após revelar um resultado de busca, centraliza quando o nó existir no layout
  useEffect(() => {
    if (!focusId || !layout) return
    const n = layout.byId.get(focusId)
    if (n) centerOn(n)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, layout?.byId])

  const zoomBy = (f) => select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, f)

  const runSearch = async (e) => {
    e?.preventDefault()
    if (!query.trim()) return setHits(null)
    setSearching(true)
    try {
      const res = await client.call('search', { query, mode: 'all', limit: 200 })
      setHits(res)
      setHitIndex(0)
      if (res.results[0]) goToHit(res.results[0])
    } finally {
      setSearching(false)
    }
  }

  const goToHit = async (hit) => {
    await tree.reveal(hit.path)
    setFocusId(keyOf(hit.path))
    onSelect?.(hit.path)
  }

  const stepHit = (d) => {
    if (!hits?.results.length) return
    const i = (hitIndex + d + hits.results.length) % hits.results.length
    setHitIndex(i)
    goToHit(hits.results[i])
  }

  const linkGen = orientation === 'h' ? linkHorizontal() : linkVertical()
  const linkPath = (l) =>
    orientation === 'h'
      ? linkGen({ source: [l.s.x + NODE_W, l.s.y], target: [l.t.x, l.t.y] })
      : linkGen({ source: [l.s.x + NODE_W / 2, l.s.y + NODE_H / 2], target: [l.t.x + NODE_W / 2, l.t.y - NODE_H / 2] })

  const q = query.trim().toLowerCase()

  return (
    <div className="jg">
      <div className="jg-toolbar">
        <form className="jg-search" onSubmit={runSearch}>
          <Icon path={mdiMagnify} size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nós no documento…" aria-label="Buscar nós" />
          {searching && <span className="btn__spinner" />}
          {hits && (
            <span className="jg-hits">
              {hits.total ? `${hitIndex + 1}/${formatNumber(hits.results.length)}${hits.truncated ? '+' : ''}` : '0'}
            </span>
          )}
          <IconButton size="sm" icon={mdiChevronUp} label="Resultado anterior" onClick={() => stepHit(-1)} disabled={!hits?.results.length} />
          <IconButton size="sm" icon={mdiChevronDown} label="Próximo resultado" onClick={() => stepHit(1)} disabled={!hits?.results.length} />
        </form>
        <div className="grow" />
        <Segmented
          size="sm"
          value={orientation}
          onChange={setOrientation}
          ariaLabel="Orientação"
          options={[
            { value: 'h', label: 'Horizontal' },
            { value: 'v', label: 'Vertical' },
          ]}
        />
        <IconButton icon={mdiArrowExpandAll} label="Expandir 3 níveis" onClick={() => tree.expandLevels(3, 150)} />
        <IconButton icon={mdiArrowCollapseAll} label="Recolher tudo" onClick={tree.collapseAll} />
        <IconButton icon={mdiRotate3dVariant} label="Reorganizar e enquadrar" onClick={fit} />
        <IconButton icon={mdiMinus} label="Diminuir zoom" onClick={() => zoomBy(0.8)} />
        <span className="jg-zoom mono">{Math.round(zoomK * 100)}%</span>
        <IconButton icon={mdiPlus} label="Aumentar zoom" onClick={() => zoomBy(1.25)} />
        <IconButton icon={mdiFitToScreenOutline} label="Enquadrar" onClick={fit} />
      </div>

      <svg ref={svgRef} className="jg-canvas grid-bg" role="img" aria-label="Grafo da estrutura JSON">
        <g ref={gRef}>
          {layout?.links.map((l) => (
            <path key={l.id} d={linkPath(l)} className={cn('jg-link', focusId && l.t.id === focusId && 'is-focus')} style={{ stroke: TYPE_COLOR[l.s.summary.type] }} />
          ))}
          {layout?.nodes.map((n) => {
            const s = n.summary
            const container = s.type === 'object' || s.type === 'array'
            const open = container && tree.expanded.has(n.id)
            const key = n.path.length === 0 ? '$' : n.more ? s.key : String(n.path[n.path.length - 1])
            const label = n.more ? 'carregar mais' : container ? `${s.type === 'array' ? '[ ]' : '{ }'} ${formatNumber(s.size)}` : s.preview
            const hit = q && !n.more && (key.toLowerCase().includes(q) || (!container && String(s.preview).toLowerCase().includes(q)))
            return (
              <g
                key={n.id}
                className={cn('jg-node', `jg-node--${s.type}`, hit && 'is-hit', focusId === n.id && 'is-focus', container && 'is-container')}
                style={{ transform: `translate(${n.x}px, ${n.y - NODE_H / 2}px)`, '--node-color': TYPE_COLOR[s.type] }}
                onClick={() => {
                  if (n.more) tree.loadMore(n.path)
                  else {
                    if (container) tree.toggle(n.path)
                    setFocusId(n.id)
                    onSelect?.(n.path)
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`${key}: ${label}`}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }))}
              >
                <title>{n.more ? `${s.size} itens restantes` : `${pathToString(n.path)} — ${s.type}`}</title>
                <rect width={NODE_W} height={NODE_H} rx={6} className="jg-node__box" />
                <rect width={3} height={NODE_H - 10} y={5} x={4} rx={1.5} className="jg-node__bar" />
                <text x={14} y={NODE_H / 2 + 4} className="jg-node__key">
                  {truncate(key, container ? 16 : 12)}
                </text>
                <text x={NODE_W - 10} y={NODE_H / 2 + 4} textAnchor="end" className="jg-node__val">
                  {truncate(String(label), container ? 10 : 14)}
                </text>
                {container && (
                  <circle cx={NODE_W} cy={NODE_H / 2} r={6} className={cn('jg-node__toggle', open && 'is-open')} />
                )}
              </g>
            )
          })}
        </g>
      </svg>

      <div className="jg-legend">
        {['object', 'array', 'string', 'number', 'boolean', 'null'].map((t) => (
          <span key={t} className="jg-legend__item">
            <span className="jg-legend__dot" style={{ background: TYPE_COLOR[t] }} />
            {t}
          </span>
        ))}
        <span className="grow" />
        <Tag variant="neutral">{formatNumber(layout?.nodes.length ?? 0)} nós renderizados</Tag>
      </div>
    </div>
  )
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
