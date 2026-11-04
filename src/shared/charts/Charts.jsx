import { useMemo, useRef, useState } from 'react'
import { scaleBand, scaleLinear, scaleTime } from 'd3-scale'
import { arc as d3arc, line as d3line, pie as d3pie, area as d3area } from 'd3-shape'
import { useElementSize } from '@core/hooks'
import './charts.css'

/*
 * Gráficos SVG leves sobre d3-scale/d3-shape.
 * Specs (skill de dataviz): barras ≤ 24px com ponta arredondada de 4px e base reta,
 * linhas de 2px, marcadores ≥ 8px com anel na cor da superfície, grade em hairline sólida,
 * texto sempre em tokens de texto (nunca na cor da série), tooltip em toda marca.
 */

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)']
export const seriesColor = (i, other) => (other ? 'var(--series-other)' : SERIES[i % SERIES.length])

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
export const fmtTick = (v) => (Math.abs(v) >= 10_000 ? compact.format(v) : full.format(v))
export const fmtValue = (v) => full.format(v)
const fmtDate = (t) => new Date(t).toLocaleDateString('pt-BR', { timeZone: 'UTC' })

/** Caminho de barra com ponta arredondada (4px) e base reta. */
function barPath(x, y, w, h, horizontal) {
  const r = Math.min(4, horizontal ? h / 2 : w / 2, horizontal ? w : h)
  if (w <= 0 || h <= 0) return ''
  if (horizontal) {
    return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`
  }
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

function useTooltip() {
  const [tip, setTip] = useState(null)
  const show = (e, content, host) => {
    const rect = host.getBoundingClientRect()
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, content })
  }
  const node = tip && (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.content}
    </div>
  )
  return { show, hide: () => setTip(null), node }
}

function TipBody({ value, label, color, extra }) {
  return (
    <>
      <strong className="chart-tip__value">{value}</strong>
      <span className="chart-tip__label">
        {color && <span className="chart-tip__key" style={{ background: color }} />}
        {label}
      </span>
      {extra && <span className="chart-tip__label">{extra}</span>}
    </>
  )
}

/* ───────── Barras (vertical ou horizontal), uma série ───────── */
export function BarChart({ data, height = 300, horizontal = false, valueLabel = 'Valor', ariaLabel }) {
  const [ref, { width }] = useElementSize()
  const hostRef = useRef(null)
  const tip = useTooltip()
  const labelW = horizontal ? Math.min(160, Math.max(60, Math.max(...data.map((d) => String(d.label).length)) * 6.5)) : 0
  const longest = Math.max(...data.map((d) => Math.min(14, String(d.label).length)))
  // rótulos do eixo X giram quando não cabem lado a lado (mede antes, nunca sobrepõe)
  const rotateX = !horizontal && width > 0 && longest * 6.4 > (width - 64) / data.length - 6
  const m = horizontal ? { t: 8, r: 56, b: 24, l: labelW + 8 } : { t: 16, r: 12, b: rotateX ? 24 + longest * 4.6 : 32, l: 52 }
  const h = horizontal ? Math.max(height, data.length * 28 + m.t + m.b) : height
  const iw = Math.max(0, width - m.l - m.r)
  const ih = Math.max(0, h - m.t - m.b)
  const max = Math.max(0, ...data.map((d) => d.value))
  const min = Math.min(0, ...data.map((d) => d.value))
  const val = scaleLinear().domain([min, max || 1]).nice().range(horizontal ? [0, iw] : [ih, 0])
  const band = scaleBand().domain(data.map((_, i) => i)).range(horizontal ? [0, ih] : [0, iw]).padding(0.25)
  const thick = Math.min(24, band.bandwidth())
  const ticks = val.ticks(horizontal ? Math.max(2, Math.floor(iw / 90)) : 5)

  return (
    <div ref={(el) => ((ref.current = el), (hostRef.current = el))} className="chart" style={{ height: h }}>
      {width > 0 && (
        <svg width={width} height={h} role="img" aria-label={ariaLabel}>
          <g transform={`translate(${m.l},${m.t})`}>
            {ticks.map((t) => (
              <g key={t}>
                {horizontal ? (
                  <>
                    <line x1={val(t)} x2={val(t)} y1={0} y2={ih} className="chart-grid" />
                    <text x={val(t)} y={ih + 16} textAnchor="middle" className="chart-tick">
                      {fmtTick(t)}
                    </text>
                  </>
                ) : (
                  <>
                    <line x1={0} x2={iw} y1={val(t)} y2={val(t)} className="chart-grid" />
                    <text x={-8} y={val(t) + 4} textAnchor="end" className="chart-tick">
                      {fmtTick(t)}
                    </text>
                  </>
                )}
              </g>
            ))}
            {horizontal ? <line x1={val(0)} x2={val(0)} y1={0} y2={ih} className="chart-axis" /> : <line x1={0} x2={iw} y1={val(0)} y2={val(0)} className="chart-axis" />}
            {data.map((d, i) => {
              const pos = band(i) + (band.bandwidth() - thick) / 2
              const v0 = val(0)
              const v1 = val(d.value)
              const path = horizontal ? barPath(v0, pos, v1 - v0, thick, true) : barPath(pos, v1, thick, v0 - v1, false)
              const color = seriesColor(0, d.other)
              const content = <TipBody value={fmtValue(d.value)} label={d.label} color={color} extra={valueLabel} />
              return (
                <g
                  key={i}
                  className="chart-mark"
                  tabIndex={0}
                  onPointerMove={(e) => tip.show(e, content, hostRef.current)}
                  onPointerLeave={tip.hide}
                  onFocus={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    tip.show({ clientX: r.x + r.width / 2, clientY: r.y }, content, hostRef.current)
                  }}
                  onBlur={tip.hide}
                  aria-label={`${d.label}: ${fmtValue(d.value)}`}
                >
                  {/* área de toque maior que a barra */}
                  {horizontal ? <rect x={0} y={band(i)} width={iw} height={band.bandwidth()} fill="transparent" /> : <rect x={band(i)} y={0} width={band.bandwidth()} height={ih} fill="transparent" />}
                  <path d={path} fill={color} className="chart-bar" />
                  {horizontal && (
                    <>
                      <text x={-8} y={pos + thick / 2 + 4} textAnchor="end" className="chart-label">
                        {trunc(d.label, Math.floor(labelW / 6.5))}
                      </text>
                      <text x={v1 + 6} y={pos + thick / 2 + 4} className="chart-value">
                        {fmtTick(d.value)}
                      </text>
                    </>
                  )}
                </g>
              )
            })}
            {!horizontal &&
              data.map((d, i) =>
                data.length <= 40 && (i % Math.ceil(data.length / Math.max(1, iw / 48)) === 0) ? (
                  <text key={i} transform={`translate(${band(i) + band.bandwidth() / 2},${ih + 14}) rotate(${rotateX ? -35 : 0})`} textAnchor={rotateX ? 'end' : 'middle'} className="chart-tick">
                    {trunc(d.label, 14)}
                  </text>
                ) : null,
              )}
          </g>
        </svg>
      )}
      {tip.node}
    </div>
  )
}

/* ───────── Histograma: colunas encostadas com gap de 2px ───────── */
export function Histogram({ bins, height = 300, isDate = false, ariaLabel }) {
  const [ref, { width }] = useElementSize()
  const hostRef = useRef(null)
  const tip = useTooltip()
  const m = { t: 16, r: 12, b: 36, l: 52 }
  const iw = Math.max(0, width - m.l - m.r)
  const ih = height - m.t - m.b
  const x = (isDate ? scaleTime() : scaleLinear()).domain([bins[0].x0, bins[bins.length - 1].x1]).range([0, iw])
  const y = scaleLinear().domain([0, Math.max(...bins.map((b) => b.count)) || 1]).nice().range([ih, 0])
  const fmtX = isDate ? fmtDate : fmtTick
  return (
    <div ref={(el) => ((ref.current = el), (hostRef.current = el))} className="chart" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          <g transform={`translate(${m.l},${m.t})`}>
            {y.ticks(5).map((t) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={-8} y={y(t) + 4} textAnchor="end" className="chart-tick">
                  {fmtTick(t)}
                </text>
              </g>
            ))}
            {x.ticks(Math.max(2, Math.floor(iw / 90))).map((t) => (
              <text key={+t} x={x(t)} y={ih + 18} textAnchor="middle" className="chart-tick">
                {isDate ? fmtDate(t) : fmtTick(t)}
              </text>
            ))}
            <line x1={0} x2={iw} y1={ih} y2={ih} className="chart-axis" />
            {bins.map((b, i) => {
              const bx = x(b.x0) + 1
              const bw = Math.max(0, x(b.x1) - x(b.x0) - 2)
              const content = <TipBody value={`${fmtValue(b.count)} registros`} label={`${fmtX(b.x0)} – ${fmtX(b.x1)}`} color={seriesColor(0)} />
              return (
                <g key={i} className="chart-mark" onPointerMove={(e) => tip.show(e, content, hostRef.current)} onPointerLeave={tip.hide}>
                  <rect x={x(b.x0)} y={0} width={x(b.x1) - x(b.x0)} height={ih} fill="transparent" />
                  <path d={barPath(bx, y(b.count), bw, ih - y(b.count), false)} fill={seriesColor(0)} className="chart-bar" />
                </g>
              )
            })}
          </g>
        </svg>
      )}
      {tip.node}
    </div>
  )
}

/* ───────── Linha com crosshair e área em wash de 10% ───────── */
export function LineChart({ points, height = 300, xKind = 'number', categories, yLabel = 'Valor', ariaLabel }) {
  const [ref, { width }] = useElementSize()
  const [hover, setHover] = useState(null)
  const m = { t: 16, r: 20, b: 36, l: 56 }
  const iw = Math.max(0, width - m.l - m.r)
  const ih = height - m.t - m.b
  const isCat = xKind === 'category'
  const xs = points.map((p, i) => (isCat ? i : p[0]))
  const x = (xKind === 'date' ? scaleTime() : scaleLinear()).domain([Math.min(...xs), Math.max(...xs)]).range([0, iw])
  const ys = points.map((p) => p[1])
  const y = scaleLinear().domain([Math.min(0, ...ys), Math.max(...ys) || 1]).nice().range([ih, 0])
  const line = d3line().x((_, i) => x(xs[i])).y((p) => y(p[1]))
  const area = d3area().x((_, i) => x(xs[i])).y0(y(Math.max(0, y.domain()[0]))).y1((p) => y(p[1]))
  const fmtX = (v, i) => (isCat ? categories?.[i] ?? points[i]?.[0] : xKind === 'date' ? fmtDate(v) : fmtTick(v))

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left - m.l
    const target = x.invert(px)
    // busca binária do ponto mais próximo no eixo X
    let lo = 0
    let hi = xs.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] < +target) lo = mid
      else hi = mid
    }
    const i = Math.abs(xs[lo] - target) <= Math.abs(xs[hi] - target) ? lo : hi
    setHover(i)
  }

  const last = points.length - 1
  return (
    <div ref={ref} className="chart" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <g transform={`translate(${m.l},${m.t})`}>
            {y.ticks(5).map((t) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={-8} y={y(t) + 4} textAnchor="end" className="chart-tick">
                  {fmtTick(t)}
                </text>
              </g>
            ))}
            {(isCat ? x.ticks(Math.min(points.length, Math.floor(iw / 90))).filter(Number.isInteger) : x.ticks(Math.max(2, Math.floor(iw / 100)))).map((t) => (
              <text key={+t} x={x(t)} y={ih + 18} textAnchor="middle" className="chart-tick">
                {trunc(String(isCat ? fmtX(t, t) : fmtX(t)), 14)}
              </text>
            ))}
            <line x1={0} x2={iw} y1={ih} y2={ih} className="chart-axis" />
            <path d={area(points)} fill="var(--series-1)" opacity={0.1} />
            <path d={line(points)} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="chart-line" />
            {/* rótulo seletivo: só o último ponto */}
            <circle cx={x(xs[last])} cy={y(points[last][1])} r={4} fill="var(--series-1)" className="chart-dot" />
            <text x={x(xs[last]) - 6} y={y(points[last][1]) - 10} textAnchor="end" className="chart-value">
              {fmtTick(points[last][1])}
            </text>
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(xs[hover])} x2={x(xs[hover])} y1={0} y2={ih} className="chart-crosshair" />
                <circle cx={x(xs[hover])} cy={y(points[hover][1])} r={5} fill="var(--series-1)" className="chart-dot" />
              </g>
            )}
          </g>
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="chart-tip" style={{ left: m.l + x(xs[hover]), top: m.t + y(points[hover][1]) }}>
          <TipBody value={fmtValue(points[hover][1])} label={String(fmtX(xs[hover], hover))} color="var(--series-1)" extra={yLabel} />
        </div>
      )}
    </div>
  )
}

/* ───────── Dispersão: ponto mais próximo (não exige mirar no ponto) ───────── */
export function ScatterChart({ points, height = 320, xKind = 'number', xLabel, yLabel, ariaLabel }) {
  const [ref, { width }] = useElementSize()
  const [hover, setHover] = useState(null)
  const m = { t: 16, r: 20, b: 40, l: 56 }
  const iw = Math.max(0, width - m.l - m.r)
  const ih = height - m.t - m.b
  const x = (xKind === 'date' ? scaleTime() : scaleLinear()).domain([Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0]))]).nice().range([0, iw])
  const y = scaleLinear().domain([Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[1]))]).nice().range([ih, 0])
  const r = points.length > 1500 ? 2.5 : 4

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left - m.l
    const py = e.clientY - rect.top - m.t
    let best = -1
    let bestD = 24 * 24 // raio de captura de 24px
    for (let i = 0; i < points.length; i++) {
      const dx = x(points[i][0]) - px
      const dy = y(points[i][1]) - py
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    setHover(best >= 0 ? best : null)
  }
  const fmtX = xKind === 'date' ? fmtDate : fmtValue
  return (
    <div ref={ref} className="chart" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <g transform={`translate(${m.l},${m.t})`}>
            {y.ticks(5).map((t) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={-8} y={y(t) + 4} textAnchor="end" className="chart-tick">
                  {fmtTick(t)}
                </text>
              </g>
            ))}
            {x.ticks(Math.max(2, Math.floor(iw / 100))).map((t) => (
              <text key={+t} x={x(t)} y={ih + 18} textAnchor="middle" className="chart-tick">
                {xKind === 'date' ? fmtDate(t) : fmtTick(t)}
              </text>
            ))}
            <line x1={0} x2={iw} y1={ih} y2={ih} className="chart-axis" />
            {xLabel && (
              <text x={iw} y={ih + 34} textAnchor="end" className="chart-axis-title">
                {xLabel} →
              </text>
            )}
            {yLabel && (
              <text x={0} y={-4} className="chart-axis-title">
                ↑ {yLabel}
              </text>
            )}
            {points.map((p, i) => (
              <circle key={i} cx={x(p[0])} cy={y(p[1])} r={r} fill="var(--series-1)" fillOpacity={0.75} className="chart-dot" />
            ))}
            {hover !== null && <circle cx={x(points[hover][0])} cy={y(points[hover][1])} r={6} fill="var(--series-1)" className="chart-dot chart-dot--hover" pointerEvents="none" />}
          </g>
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="chart-tip" style={{ left: m.l + x(points[hover][0]), top: m.t + y(points[hover][1]) }}>
          <TipBody value={`${fmtValue(points[hover][1])}`} label={yLabel} extra={`${xLabel}: ${fmtX(points[hover][0])}`} />
        </div>
      )}
    </div>
  )
}

/* ───────── Pizza (rosca) com legenda sempre visível + valores ───────── */
export function PieChart({ data, height = 300, ariaLabel }) {
  const [hover, setHover] = useState(null)
  const total = data.reduce((a, d) => a + Math.max(0, d.value), 0) || 1
  const size = height
  const radius = size / 2 - 8
  const arcs = useMemo(() => d3pie().sort(null).value((d) => Math.max(0, d.value)).padAngle(0.012)(data), [data])
  const arc = d3arc().innerRadius(radius * 0.58).outerRadius(radius).cornerRadius(3)
  const arcHover = d3arc().innerRadius(radius * 0.58).outerRadius(radius + 5).cornerRadius(3)
  const focus = hover !== null ? data[hover] : null
  return (
    <div className="chart chart--pie">
      <svg width={size} height={size} role="img" aria-label={ariaLabel} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`translate(${size / 2},${size / 2})`}>
          {arcs.map((a, i) => (
            <path
              key={i}
              d={(hover === i ? arcHover : arc)(a)}
              fill={seriesColor(i, data[i].other)}
              className="chart-arc"
              tabIndex={0}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${data[i].label}: ${fmtValue(data[i].value)}`}
            />
          ))}
          <text textAnchor="middle" y={-4} className="chart-pie-value">
            {focus ? `${((Math.max(0, focus.value) / total) * 100).toFixed(1).replace('.', ',')}%` : fmtTick(total)}
          </text>
          <text textAnchor="middle" y={16} className="chart-pie-label">
            {focus ? trunc(focus.label, 18) : 'total'}
          </text>
        </g>
      </svg>
      <ul className="chart-legend chart-legend--column">
        {data.map((d, i) => (
          <li key={i} className={hover === i ? 'is-active' : ''} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <span className="chart-legend__swatch" style={{ background: seriesColor(i, d.other) }} />
            <span className="grow truncate" title={d.label}>
              {d.label}
            </span>
            <span className="chart-legend__value">{fmtValue(d.value)}</span>
            <span className="chart-legend__pct">{((Math.max(0, d.value) / total) * 100).toFixed(1).replace('.', ',')}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function trunc(s, n) {
  s = String(s)
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s
}
