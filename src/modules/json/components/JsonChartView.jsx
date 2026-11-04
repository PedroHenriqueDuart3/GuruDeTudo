import { useEffect, useMemo, useState } from 'react'
import { mdiChartBar, mdiChartBellCurve, mdiChartLine, mdiChartPie, mdiChartScatterPlot, mdiPlay, mdiTableEye } from '@mdi/js'
import Button from '@core/components/Button'
import { Alert, Card, EmptyState, Segmented, Select, Tag } from '@core/components/ui'
import { formatNumber } from '@core/utils'
import { BarChart, Histogram, LineChart, PieChart, ScatterChart, fmtValue } from '@/shared/charts/Charts'

const CHARTS = [
  { value: 'bar', label: 'Barras', icon: mdiChartBar },
  { value: 'line', label: 'Linhas', icon: mdiChartLine },
  { value: 'pie', label: 'Pizza', icon: mdiChartPie },
  { value: 'scatter', label: 'Dispersão', icon: mdiChartScatterPlot },
  { value: 'histogram', label: 'Histograma', icon: mdiChartBellCurve },
]

const AGGS = [
  { value: 'sum', label: 'Soma' },
  { value: 'avg', label: 'Média' },
  { value: 'count', label: 'Contagem' },
  { value: 'min', label: 'Mínimo' },
  { value: 'max', label: 'Máximo' },
]

const KIND_LABEL = { number: 'número', date: 'data', category: 'categoria', boolean: 'booleano' }

/** Que campos fazem sentido em cada eixo para cada tipo de gráfico. */
const AXIS_RULES = {
  bar: { x: ['category', 'date', 'boolean', 'number'], y: ['number'] },
  pie: { x: ['category', 'boolean', 'date'], y: ['number'] },
  line: { x: ['date', 'number', 'category', 'index'], y: ['number'] },
  scatter: { x: ['number', 'date', 'index'], y: ['number'] },
  histogram: { x: ['number', 'date'], y: [] },
}

/**
 * Chart View: detecta arrays com dados numéricos/temporais, deixa o usuário escolher os eixos,
 * mostra uma prévia dos dados e só então gera o gráfico (cálculo feito no worker).
 */
export default function JsonChartView({ client, version }) {
  const [candidates, setCandidates] = useState(null)
  const [error, setError] = useState(null)
  const [datasetIdx, setDatasetIdx] = useState(0)
  const [chart, setChart] = useState('bar')
  const [x, setX] = useState('')
  const [y, setY] = useState('')
  const [agg, setAgg] = useState('sum')
  const [result, setResult] = useState(null)
  const [building, setBuilding] = useState(false)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    let alive = true
    setCandidates(null)
    setResult(null)
    client
      .call('chartCandidates')
      .then((c) => alive && (setCandidates(c), setDatasetIdx(0)))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [client, version])

  const dataset = candidates?.[datasetIdx]
  const fields = useMemo(() => {
    if (!dataset) return []
    const list = [...dataset.fields]
    list.unshift({ name: '#', kind: 'index', distinct: dataset.length })
    return list
  }, [dataset])

  const xOptions = fields.filter((f) => AXIS_RULES[chart].x.includes(f.kind))
  const yOptions = fields.filter((f) => AXIS_RULES[chart].y.includes(f.kind))
  const needsY = chart !== 'histogram' && agg !== 'count'

  // escolhe eixos padrão que façam sentido para o tipo de gráfico (ex.: barras por uma
  // categoria com poucos valores distintos, nunca por um identificador único)
  useEffect(() => {
    if (!dataset) return
    const isId = (f) => /^(id|.*_id|.*Id|#)$/.test(f.name)
    const xRank = (f) => {
      const few = f.distinct != null && f.distinct >= 2 && f.distinct <= 60
      if (chart === 'bar' || chart === 'pie') return f.kind === 'category' && few ? 0 : f.kind === 'boolean' ? 1 : f.kind === 'date' ? 2 : f.kind === 'category' ? 3 : 4 + isId(f)
      if (chart === 'line') return f.kind === 'date' ? 0 : f.kind === 'number' && !isId(f) ? 1 : f.kind === 'index' ? 2 : 3
      if (chart === 'scatter') return f.kind === 'number' && !isId(f) ? 0 : f.kind === 'date' ? 1 : f.kind === 'index' ? 2 : 3
      return f.kind === 'number' && !isId(f) ? 0 : f.kind === 'date' ? 1 : 2 // histograma
    }
    // desempate: menos valores distintos primeiro (agrupa melhor em barras/pizza)
    const best = (opts, rank, avoid) =>
      [...opts].filter((f) => f.name !== avoid).sort((a, b) => rank(a) - rank(b) || (a.distinct ?? 1e9) - (b.distinct ?? 1e9))[0]
    const nx = best(xOptions, xRank)
    setX(nx?.name ?? '')
    const ny = best(yOptions, (f) => (isId(f) ? 1 : 0), nx?.name)
    setY(ny?.name ?? '')
    setResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, chart])

  const kindOf = (name) => fields.find((f) => f.name === name)?.kind

  const build = async () => {
    setBuilding(true)
    setError(null)
    try {
      const xKind = kindOf(x) === 'index' ? 'number' : kindOf(x)
      const res = await client.call('chartData', {
        path: dataset.path,
        chart,
        x,
        y: needsY ? y : null,
        xKind,
        yKind: needsY ? kindOf(y) : null,
        agg: chart === 'scatter' || chart === 'histogram' ? undefined : needsY ? agg : 'count',
      })
      setResult({ ...res, x, y: needsY ? y : null, agg })
    } catch (e) {
      setError(e.message)
    } finally {
      setBuilding(false)
    }
  }

  if (candidates === null && !error)
    return (
      <div className="js-chart-loading">
        <span className="btn__spinner btn__spinner--lg" /> Procurando dados numéricos e temporais…
      </div>
    )

  if (!candidates?.length)
    return (
      <EmptyState
        icon={mdiChartBar}
        title="Nenhum dataset adequado para gráficos"
        description="A Chart View precisa de um array de objetos com campos numéricos, de data ou de categoria — ou de um array de números."
      />
    )

  const label = (f) => (f.name === '#' ? '# (índice do item)' : f.name === '@valor' ? 'valor do item' : f.name)
  const fieldOpts = (opts) => opts.map((f) => ({ value: f.name, label: `${label(f)} · ${f.kind === 'index' ? 'posição' : KIND_LABEL[f.kind]}` }))

  return (
    <div className="js-chart">
      <Card title="Configurar gráfico" subtitle="Escolha o dataset, o tipo e os eixos">
        <div className="js-chart__form">
          <Select
            label="Dataset (array)"
            value={datasetIdx}
            onChange={(e) => setDatasetIdx(Number(e.target.value))}
            options={candidates.map((c, i) => ({ value: i, label: `${c.pathLabel} — ${formatNumber(c.length)} itens` }))}
          />
          <div className="field">
            <span className="field__label">Tipo de gráfico</span>
            <Segmented value={chart} onChange={setChart} options={CHARTS} ariaLabel="Tipo de gráfico" size="sm" />
          </div>
          <div className="js-chart__axes">
            <Select label={chart === 'histogram' ? 'Campo (distribuição)' : 'Eixo X'} value={x} onChange={(e) => setX(e.target.value)} options={fieldOpts(xOptions)} />
            {chart !== 'histogram' && chart !== 'scatter' && (
              <Select label="Agregação" value={agg} onChange={(e) => setAgg(e.target.value)} options={AGGS} />
            )}
            {needsY && <Select label="Eixo Y" value={y} onChange={(e) => setY(e.target.value)} options={yOptions.length ? fieldOpts(yOptions) : [{ value: '', label: 'Nenhum campo numérico' }]} />}
          </div>
        </div>

        <div className="js-chart__preview">
          <div className="row">
            <span className="field__label">Prévia dos dados</span>
            <Tag variant="neutral">primeiros 8 de {formatNumber(dataset.length)}</Tag>
          </div>
          <PreviewTable client={client} dataset={dataset} x={x} y={needsY ? y : null} />
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <Button icon={mdiPlay} onClick={build} loading={building} disabled={!x || (needsY && !y)}>
            Gerar gráfico
          </Button>
        </div>
      </Card>

      {error && <Alert kind="error" title="Não foi possível gerar o gráfico">{error}</Alert>}

      {result && (
        <Card
          title={chartTitle(result)}
          subtitle={chartSubtitle(result)}
          actions={<Button variant="ghost" size="sm" icon={mdiTableEye} onClick={() => setShowTable((s) => !s)}>{showTable ? 'Ver gráfico' : 'Ver tabela'}</Button>}
        >
          {showTable ? <ResultTable result={result} /> : <ChartRender result={result} />}
        </Card>
      )}
    </div>
  )
}

function PreviewTable({ client, dataset, x, y }) {
  const [rows, setRows] = useState(null)
  const cols = [x, y].filter(Boolean)
  const colsKey = cols.join('|')

  useEffect(() => {
    if (!cols.length) return
    let alive = true
    client
      .call('preview', { path: dataset.path, fields: cols })
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, dataset, colsKey])

  const fieldInfo = cols.map((c) => dataset.fields.find((f) => f.name === c) ?? { name: c, kind: 'index' })
  return (
    <table className="data-table">
      <thead>
        <tr>
          {fieldInfo.map((f) => (
            <th key={f.name}>
              {f.name === '#' ? '#' : f.name === '@valor' ? 'valor' : f.name}{' '}
              <span className="subtle">({f.kind === 'index' ? 'posição' : KIND_LABEL[f.kind]})</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(rows ?? []).map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => (
              <td key={j} className={fieldInfo[j]?.kind === 'number' ? 'num' : 'mono'}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
        {rows === null && (
          <tr>
            <td colSpan={cols.length || 1} className="muted">
              Carregando prévia…
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function chartTitle(r) {
  const yName = r.y ? r.y : 'registros'
  switch (r.chart) {
    case 'histogram':
      return `Distribuição de ${r.x}`
    case 'scatter':
      return `${r.y} × ${r.x === '#' ? 'índice' : r.x}`
    case 'pie':
      return `${r.agg === 'count' || !r.y ? 'Contagem' : AGGS.find((a) => a.value === r.agg).label} de ${yName} por ${r.x}`
    default:
      return `${r.agg === 'count' || !r.y ? 'Contagem' : AGGS.find((a) => a.value === r.agg).label} de ${yName} por ${r.x === '#' ? 'índice' : r.x}`
  }
}

function chartSubtitle(r) {
  const parts = []
  if (r.totalGroups) parts.push(`${formatNumber(r.totalGroups)} grupos`)
  if (r.otherCount) parts.push(`${formatNumber(r.otherCount)} agrupados em “Outros”`)
  if (r.points && typeof r.points === 'number') parts.push(`${formatNumber(r.points)} valores`)
  if (r.sampled) parts.push('amostrado para desempenho')
  if (r.skipped) parts.push(`${formatNumber(r.skipped)} itens sem valor válido ignorados`)
  return parts.join(' · ')
}

function ChartRender({ result: r }) {
  const yLabel = r.y ?? 'contagem'
  if (r.chart === 'bar') return <BarChart data={r.categories} horizontal={r.xKind !== 'date' && r.categories.length > 8} valueLabel={yLabel} ariaLabel={chartTitle(r)} />
  if (r.chart === 'pie') return <PieChart data={r.categories} ariaLabel={chartTitle(r)} />
  if (r.chart === 'histogram') return <Histogram bins={r.bins} isDate={r.xKind === 'date'} ariaLabel={chartTitle(r)} />
  if (r.chart === 'scatter') return <ScatterChart points={r.points} xKind={r.xKind} xLabel={r.x === '#' ? 'índice' : r.x} yLabel={r.y} ariaLabel={chartTitle(r)} />
  return (
    <LineChart
      points={r.points}
      xKind={r.xKind}
      categories={r.xKind === 'category' ? r.points.map((p) => p[0]) : undefined}
      yLabel={yLabel}
      ariaLabel={chartTitle(r)}
    />
  )
}

function ResultTable({ result: r }) {
  let rows
  if (r.categories) rows = r.categories.map((c) => [c.label, fmtValue(c.value)])
  else if (r.bins) rows = r.bins.map((b) => [`${fmtValue(b.x0)} – ${fmtValue(b.x1)}`, fmtValue(b.count)])
  else rows = r.points.slice(0, 1000).map((p) => [r.xKind === 'date' ? new Date(p[0]).toISOString().slice(0, 10) : String(p[0]), fmtValue(p[1])])
  return (
    <div style={{ maxHeight: 360, overflow: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>{r.chart === 'histogram' ? 'Faixa' : r.x}</th>
            <th className="num">{r.chart === 'histogram' ? 'Registros' : r.y ?? 'Contagem'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>{row[0]}</td>
              <td className="num">{row[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.points?.length > 1000 && <p className="subtle" style={{ padding: 8 }}>Exibindo 1.000 de {formatNumber(r.points.length)} pontos.</p>}
    </div>
  )
}
