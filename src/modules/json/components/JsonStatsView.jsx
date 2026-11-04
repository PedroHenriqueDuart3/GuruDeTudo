import { motion } from 'motion/react'
import {
  mdiCodeArray,
  mdiCodeBraces,
  mdiFileOutline,
  mdiFormatListNumbered,
  mdiKeyVariant,
  mdiLayersTripleOutline,
  mdiTimerOutline,
  mdiZipBoxOutline,
} from '@mdi/js'
import { Card, StatCard } from '@core/components/ui'
import { formatBytes, formatDuration, formatNumber } from '@core/utils'
import { BarChart } from '@/shared/charts/Charts'

const TYPE_LABELS = [
  ['objects', 'Objetos'],
  ['arrays', 'Arrays'],
  ['strings', 'Strings'],
  ['numbers', 'Números'],
  ['booleans', 'Booleanos'],
  ['nulls', 'Nulos'],
]

/** Dashboard estrutural do JSON — todos os números vêm da análise real feita no worker. */
export default function JsonStatsView({ analysis }) {
  const { stats, bytes, minifiedChars, parseMs, totalMs } = analysis
  const typeData = TYPE_LABELS.map(([k, label]) => ({ label, value: stats[k] })).filter((d) => d.value > 0)
  const depthData = stats.depthHistogram.map((count, depth) => ({ label: `nível ${depth}`, value: count }))
  const cards = [
    { label: 'Tamanho do arquivo', value: formatBytes(bytes), sub: `≈ ${formatBytes(minifiedChars)} minificado`, icon: mdiFileOutline },
    { label: 'Total de nós', value: formatNumber(stats.totalNodes), sub: 'valores em toda a árvore', icon: mdiLayersTripleOutline, accent: 'cyan' },
    { label: 'Objetos', value: formatNumber(stats.objects), sub: `até ${formatNumber(stats.maxObjectKeys)} chaves em um objeto`, icon: mdiCodeBraces },
    { label: 'Arrays', value: formatNumber(stats.arrays), sub: `maior: ${formatNumber(stats.maxArrayLength)} itens`, icon: mdiCodeArray, accent: 'cyan' },
    { label: 'Propriedades', value: formatNumber(stats.properties), sub: `${formatNumber(stats.uniqueKeys)} nomes distintos`, icon: mdiKeyVariant, accent: 'violet' },
    { label: 'Profundidade máxima', value: formatNumber(stats.maxDepth), sub: 'níveis de aninhamento', icon: mdiFormatListNumbered, accent: 'violet' },
    { label: 'Economia ao minificar', value: bytes ? `${Math.max(0, Math.round((1 - minifiedChars / bytes) * 100))}%` : '—', sub: 'espaços e quebras de linha', icon: mdiZipBoxOutline },
    { label: 'Tempo de análise', value: formatDuration(totalMs), sub: `parse: ${formatDuration(parseMs)} · em Web Worker`, icon: mdiTimerOutline, accent: 'cyan' },
  ]

  return (
    <div className="js-stats">
      <div className="js-stats__grid">
        {cards.map((c, i) => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.35 }}>
            <StatCard label={c.label} value={c.value} sublabel={c.sub} icon={c.icon} accent={c.accent} />
          </motion.div>
        ))}
      </div>

      <div className="js-stats__charts">
        <Card title="Distribuição de tipos" subtitle="Quantidade de valores por tipo de dado">
          <BarChart data={typeData} horizontal valueLabel="valores" ariaLabel="Distribuição de tipos de dados" />
          <TableFallback rows={typeData} total={stats.totalNodes} />
        </Card>
        <Card title="Nós por nível de profundidade" subtitle="Onde os dados se concentram na hierarquia">
          <BarChart data={depthData} height={260} valueLabel="nós" ariaLabel="Nós por profundidade" />
        </Card>
        <Card title="Chaves mais frequentes" subtitle={`Top ${stats.topKeys.length} de ${formatNumber(stats.uniqueKeys)} nomes distintos`}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Chave</th>
                <th className="num">Ocorrências</th>
                <th style={{ width: '40%' }} aria-label="Proporção" />
              </tr>
            </thead>
            <tbody>
              {stats.topKeys.map((k) => (
                <tr key={k.key}>
                  <td className="mono" style={{ color: 'var(--syn-key)' }}>
                    {k.key}
                  </td>
                  <td className="num">{formatNumber(k.count)}</td>
                  <td>
                    <span className="js-meter">
                      <span style={{ width: `${(k.count / stats.topKeys[0].count) * 100}%` }} />
                    </span>
                  </td>
                </tr>
              ))}
              {!stats.topKeys.length && (
                <tr>
                  <td colSpan={3} className="muted">
                    O documento não possui objetos com chaves.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  )
}

function TableFallback({ rows, total }) {
  return (
    <details className="js-table-toggle">
      <summary>Ver como tabela</summary>
      <table className="data-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="num">{formatNumber(r.value)}</td>
              <td className="num">{((r.value / total) * 100).toFixed(1).replace('.', ',')}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
