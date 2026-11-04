import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom'
import { mdiKeyVariant, mdiLinkVariant, mdiMinus, mdiPlus, mdiTableLarge } from '@mdi/js'
import { cn } from '@core/utils'
import { HEADER_H, ROW_H } from '../lib/layout'

/**
 * Canvas SVG do diagrama ER.
 * Tabelas e relacionamentos são SVG puro (exporta para SVG/PNG com fidelidade).
 * Notação "pé de galinha": || um obrigatório · o| zero ou um · o< zero ou muitos.
 */
const DiagramCanvas = forwardRef(function DiagramCanvas(
  { schema, positions, sizes, collapsed, selected, onSelect, onMove, onToggleCollapse, hits, onBackgroundClick },
  ref,
) {
  const svgRef = useRef(null)
  const zoomLayerRef = useRef(null)
  const exportRootRef = useRef(null)
  const zoomRef = useRef(null)
  const [k, setK] = useState(1)
  const [hovered, setHovered] = useState(null)
  const dragRef = useRef(null)
  const seenTables = useRef(new Set())

  useEffect(() => {
    const svg = select(svgRef.current)
    const z = d3zoom()
      .scaleExtent([0.1, 2.5])
      // arrastar uma tabela não deve mover o canvas (a roda continua dando zoom)
      .filter((e) => e.type === 'wheel' || !e.target.closest?.('.dbt'))
      .on('zoom', (e) => {
        zoomLayerRef.current?.setAttribute('transform', e.transform.toString())
        setK(e.transform.k)
      })
    zoomRef.current = z
    svg.call(z).on('dblclick.zoom', null)
    return () => svg.on('.zoom', null)
  }, [])

  // depois que a animação de entrada termina, as tabelas deixam de ser "novas"
  useEffect(() => {
    const t = setTimeout(() => schema.tables.forEach((tb) => seenTables.current.add(tb.id)), 1800)
    return () => clearTimeout(t)
  }, [schema])

  const bounds = () => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const t of schema.tables) {
      const p = positions.get(t.id)
      const s = sizes.get(t.id)
      if (!p || !s) continue
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + s.w)
      maxY = Math.max(maxY, p.y + s.h)
    }
    return { minX, minY, maxX, maxY }
  }

  useImperativeHandle(ref, () => ({
    fit(duration = 600) {
      const svg = svgRef.current
      const b = bounds()
      if (!Number.isFinite(b.minX)) return
      const pad = 60
      const scale = Math.min(1.1, (svg.clientWidth - pad * 2) / (b.maxX - b.minX || 1), (svg.clientHeight - pad * 2) / (b.maxY - b.minY || 1))
      const t = zoomIdentity
        .translate(svg.clientWidth / 2 - ((b.minX + b.maxX) / 2) * scale, svg.clientHeight / 2 - ((b.minY + b.maxY) / 2) * scale)
        .scale(Math.max(0.1, scale))
      select(svg).transition().duration(duration).call(zoomRef.current.transform, t)
    },
    centerOn(id) {
      const svg = svgRef.current
      const p = positions.get(id)
      const s = sizes.get(id)
      if (!p || !s) return
      const scale = Math.max(0.85, k)
      const t = zoomIdentity.translate(svg.clientWidth / 2 - (p.x + s.w / 2) * scale, svg.clientHeight / 2 - (p.y + s.h / 2) * scale).scale(scale)
      select(svg).transition().duration(500).call(zoomRef.current.transform, t)
    },
    zoomBy(f) {
      select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, f)
    },
    elements: () => ({ svg: svgRef.current, root: exportRootRef.current }),
  }))

  const tablesById = useMemo(() => new Map(schema.tables.map((t) => [t.id, t])), [schema])
  const focus = hovered ?? selected
  const related = useMemo(() => {
    if (!focus) return null
    const set = new Set([focus])
    for (const r of schema.relations) {
      if (r.from.table === focus) set.add(r.to.table)
      if (r.to.table === focus) set.add(r.from.table)
    }
    return set
  }, [focus, schema.relations])

  const visibleCols = (t) => (collapsed.has(t.id) ? t.columns.filter((c) => c.pk || c.fk) : t.columns)
  const colY = (t, colName) => {
    const cols = visibleCols(t)
    let idx = cols.findIndex((c) => c.name.toLowerCase() === colName.toLowerCase())
    if (idx < 0) idx = 0
    return HEADER_H + idx * ROW_H + ROW_H / 2
  }

  /* ── Arrastar tabelas ── */
  const onPointerDown = (e, id) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = positions.get(id)
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false }
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.sx) / k
    const dy = (e.clientY - d.sy) / k
    if (!d.moved && Math.hypot(dx, dy) < 3) return
    d.moved = true
    onMove(d.id, { x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) })
  }
  const onPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d && !d.moved) onSelect(d.id === selected ? null : d.id)
  }

  /* ── Relacionamentos ── */
  const edges = schema.relations.map((r) => {
    const child = tablesById.get(r.from.table)
    const parent = tablesById.get(r.to.table)
    const cp = positions.get(child.id)
    const pp = positions.get(parent.id)
    const cs = sizes.get(child.id)
    const ps = sizes.get(parent.id)
    if (!cp || !pp || !cs || !ps) return null
    const y1 = cp.y + colY(child, r.from.columns[0])
    const y2 = pp.y + colY(parent, r.to.columns[0])
    let d
    if (r.selfRef) {
      const x = cp.x + cs.w
      d = `M ${x} ${y1} C ${x + 70} ${y1}, ${x + 70} ${y2 + 10}, ${x} ${y2 + 10}`
    } else {
      const childRight = cp.x + cs.w / 2 < pp.x + ps.w / 2
      const overlapX = Math.abs(cp.x + cs.w / 2 - (pp.x + ps.w / 2)) < (cs.w + ps.w) / 2 - 20
      let x1
      let x2
      let c1
      let c2
      if (overlapX) {
        x1 = cp.x + cs.w
        x2 = pp.x + ps.w
        const out = Math.max(x1, x2) + 60
        c1 = out
        c2 = out
      } else if (childRight) {
        x1 = cp.x + cs.w
        x2 = pp.x
        const off = Math.max(50, (x2 - x1) / 2)
        c1 = x1 + off
        c2 = x2 - off
      } else {
        x1 = cp.x
        x2 = pp.x + ps.w
        const off = Math.max(50, (x1 - x2) / 2)
        c1 = x1 - off
        c2 = x2 + off
      }
      d = `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`
    }
    const active = focus && (r.from.table === focus || r.to.table === focus)
    const childMarker = r.cardinality.kind === 'one-to-one' ? 'zero-one' : 'zero-many'
    const parentMarker = r.cardinality.parentOptional ? 'zero-one' : 'one'
    return { r, d, active, childMarker, parentMarker }
  })

  return (
    <svg
      ref={svgRef}
      className="dbc grid-bg"
      role="img"
      aria-label="Diagrama de banco de dados"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => e.target === svgRef.current && onBackgroundClick?.()}
    >
      <defs>
        <linearGradient id="dbt-head" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="dbt-head-stop1" />
          <stop offset="1" className="dbt-head-stop2" />
        </linearGradient>
        {['n', 'a'].map((v) => (
          <g key={v}>
            <marker id={`m-one-${v}`} viewBox="0 0 20 20" refX="20" refY="10" markerWidth="18" markerHeight="18" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M12 4 V16 M16 4 V16" className={`dbm dbm--${v}`} />
            </marker>
            <marker id={`m-zero-one-${v}`} viewBox="0 0 20 20" refX="20" refY="10" markerWidth="18" markerHeight="18" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M16 4 V16" className={`dbm dbm--${v}`} />
              <circle cx="8" cy="10" r="3.2" className={`dbm dbm--${v} dbm--hollow`} />
            </marker>
            <marker id={`m-zero-many-${v}`} viewBox="0 0 24 20" refX="24" refY="10" markerWidth="22" markerHeight="18" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M12 10 L24 3 M12 10 L24 17 M12 10 H24" className={`dbm dbm--${v}`} />
              <circle cx="6" cy="10" r="3.2" className={`dbm dbm--${v} dbm--hollow`} />
            </marker>
          </g>
        ))}
      </defs>

      <g ref={zoomLayerRef} data-zoom-layer="">
        <g ref={exportRootRef} data-export-root="">
          {/* relacionamentos */}
          <g className="dbr-layer">
            {edges.map(
              (e, i) =>
                e && (
                  <g key={e.r.id} className={cn('dbr', e.active && 'is-active', focus && !e.active && 'is-dimmed')}>
                    <title>
                      {`${e.r.name}: ${tablesById.get(e.r.from.table).name}(${e.r.from.columns.join(', ')}) → ${tablesById.get(e.r.to.table).name}(${e.r.to.columns.join(', ')})${e.r.onDelete ? ` · ON DELETE ${e.r.onDelete}` : ''} · ${e.r.cardinality.kind === 'one-to-one' ? '1:1' : 'N:1'}`}
                    </title>
                    <path d={e.d} className="dbr__hit" />
                    <path
                      d={e.d}
                      className="dbr__line"
                      pathLength="1"
                      style={{ animationDelay: `${0.25 + i * 0.04}s` }}
                      markerStart={`url(#m-${e.childMarker}-${e.active ? 'a' : 'n'})`}
                      markerEnd={`url(#m-${e.parentMarker}-${e.active ? 'a' : 'n'})`}
                    />
                    {e.active && <path d={e.d} className="dbr__flow" data-export-hide="" />}
                  </g>
                ),
            )}
          </g>

          {/* tabelas */}
          {schema.tables.map((t, i) => {
            const p = positions.get(t.id)
            const s = sizes.get(t.id)
            if (!p || !s) return null
            const cols = visibleCols(t)
            const hidden = t.columns.length - cols.length
            const isNew = !seenTables.current.has(t.id)
            const isSel = selected === t.id
            return (
              <g
                key={t.id}
                className={cn('dbt', isSel && 'is-selected', related && related.has(t.id) && !isSel && 'is-related', related && !related.has(t.id) && 'is-dimmed', hits?.has(t.id) && 'is-hit', isNew && 'is-new')}
                style={{ transform: `translate(${p.x}px, ${p.y}px)`, animationDelay: isNew ? `${Math.min(i, 20) * 0.05}s` : undefined }}
                onPointerDown={(e) => onPointerDown(e, t.id)}
                onPointerEnter={() => !dragRef.current && setHovered(t.id)}
                onPointerLeave={() => !dragRef.current && setHovered(null)}
                tabIndex={0}
                role="button"
                aria-label={`Tabela ${t.name}, ${t.columns.length} colunas`}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(t.id)}
              >
                <rect width={s.w} height={s.h} rx="8" className="dbt__box" />
                <path d={`M0 8 a8 8 0 0 1 8 -8 H${s.w - 8} a8 8 0 0 1 8 8 V${HEADER_H} H0 Z`} fill="url(#dbt-head)" className="dbt__head" />
                <path d={mdiTableLarge} transform="translate(12, 11) scale(0.75)" className="dbt__icon" />
                <text x="36" y="25" className="dbt__name">
                  {t.name}
                </text>
                {t.schema && (
                  <text x={s.w - 36} y="25" textAnchor="end" className="dbt__schema">
                    {t.schema}
                  </text>
                )}
                <g
                  className="dbt__toggle"
                  transform={`translate(${s.w - 28}, 12)`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleCollapse(t.id)
                  }}
                >
                  <title>{collapsed.has(t.id) ? 'Mostrar todas as colunas' : 'Mostrar só chaves'}</title>
                  <rect width="16" height="16" rx="4" />
                  <path d={collapsed.has(t.id) ? mdiPlus : mdiMinus} transform="translate(1,1) scale(0.58)" />
                </g>
                {cols.map((c, ci) => (
                  <g key={c.name} transform={`translate(0, ${HEADER_H + ci * ROW_H})`} className={cn('dbt__row', ci % 2 === 1 && 'is-odd')}>
                    <rect x="1" width={s.w - 2} height={ROW_H} className="dbt__row-bg" />
                    {c.pk && <path d={mdiKeyVariant} transform="translate(10, 5) scale(0.58)" className="dbt__pk" />}
                    {c.fk && <path d={mdiLinkVariant} transform={`translate(${c.pk ? 22 : 10}, 5) scale(0.58)`} className="dbt__fk" />}
                    <text x={c.pk && c.fk ? 40 : c.pk || c.fk ? 28 : 14} y="16" className={cn('dbt__col', c.pk && 'is-pk', c.fk && 'is-fk')}>
                      {c.name}
                    </text>
                    <text x={s.w - 12} y="16" textAnchor="end" className="dbt__type">
                      {c.type.length > 22 ? `${c.type.slice(0, 21)}…` : c.type}
                      {c.notNull && !c.pk ? ' ·NN' : ''}
                      {c.unique && !c.pk ? ' ·U' : ''}
                      {c.identity ? ' ·ID' : ''}
                    </text>
                    <title>{`${c.name} ${c.type}${c.pk ? ' · PRIMARY KEY' : ''}${c.fk ? ' · FOREIGN KEY' : ''}${c.unique ? ' · UNIQUE' : ''}${c.notNull ? ' · NOT NULL' : ' · NULL'}${c.identity ? ' · IDENTITY' : ''}${c.default ? ` · DEFAULT ${c.default}` : ''}`}</title>
                  </g>
                ))}
                {hidden > 0 && (
                  <text x="14" y={HEADER_H + cols.length * ROW_H + 16} className="dbt__hidden">
                    + {hidden} coluna{hidden > 1 ? 's' : ''} oculta{hidden > 1 ? 's' : ''}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </g>
      <text x="12" y="20" className="dbc__zoom" data-export-hide="">
        {Math.round(k * 100)}%
      </text>
    </svg>
  )
})

export default DiagramCanvas
