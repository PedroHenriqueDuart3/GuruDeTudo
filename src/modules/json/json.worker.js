/**
 * Web Worker do JSON Organizer.
 *
 * O documento parseado fica AQUI (fora da thread principal). A interface só recebe
 * resumos e fatias pequenas (filhos paginados, resultados de busca), então JSONs de
 * centenas de MB não travam a tela nem duplicam memória com structured clone.
 */
import { exposeWorker, yieldToLoop } from '@core/workers/createWorkerClient'
import {
  buildChartData,
  computeStats,
  evaluateJsonPath,
  findChartCandidates,
  generateTestDataset,
  getAt,
  getChildren,
  locateJsonError,
  previewRows,
  searchJson,
  summarize,
} from './lib/jsonEngine'

let doc
let hasDoc = false
let sourceBytes = 0

exposeWorker({
  async load({ text }, ctx) {
    hasDoc = false
    doc = undefined
    const t0 = performance.now()
    sourceBytes = new Blob([text]).size
    ctx.progress(0.05, 'Validando sintaxe…')
    if (!text.trim()) return { ok: false, empty: true, bytes: 0 }
    try {
      doc = JSON.parse(text)
    } catch (err) {
      return { ok: false, error: locateJsonError(text, err), bytes: sourceBytes }
    }
    hasDoc = true
    const parseMs = performance.now() - t0
    ctx.progress(0.35, 'Analisando estrutura…')
    const stats = await computeStats(doc, {
      yieldFn: yieldToLoop,
      isCancelled: ctx.isCancelled,
      onProgress: (n) => ctx.progress(0.35 + Math.min(0.6, n / 4_000_000), `Analisando estrutura… ${n.toLocaleString('pt-BR')} nós`),
    })
    ctx.progress(0.97, 'Finalizando…')
    const minifiedChars = JSON.stringify(doc).length
    return {
      ok: true,
      bytes: sourceBytes,
      minifiedChars,
      parseMs,
      totalMs: performance.now() - t0,
      stats,
      root: summarize('$', doc),
    }
  },

  children({ path, offset, limit, around }) {
    assertDoc()
    return getChildren(doc, path, offset, limit, around)
  },

  value({ path }) {
    assertDoc()
    const v = getAt(doc, path)
    return typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : v
  },

  format({ indent }, ctx) {
    assertDoc()
    ctx.progress(0.3, 'Formatando…')
    const space = indent === 'tab' ? '\t' : Number(indent)
    return JSON.stringify(doc, null, space)
  },

  minify(_, ctx) {
    assertDoc()
    ctx.progress(0.3, 'Minificando…')
    return JSON.stringify(doc)
  },

  sortKeys({ indent }, ctx) {
    assertDoc()
    ctx.progress(0.3, 'Ordenando chaves…')
    const sorted = (v) => {
      if (Array.isArray(v)) return v.map(sorted)
      if (v && typeof v === 'object') {
        const out = {}
        for (const k of Object.keys(v).sort((a, b) => a.localeCompare(b))) out[k] = sorted(v[k])
        return out
      }
      return v
    }
    doc = sorted(doc)
    return JSON.stringify(doc, null, indent === 'tab' ? '\t' : Number(indent))
  },

  async search({ query, mode, caseSensitive, regex }, ctx) {
    assertDoc()
    return searchJson(doc, query, {
      mode,
      caseSensitive,
      regex,
      yieldFn: yieldToLoop,
      isCancelled: ctx.isCancelled,
      onProgress: (n) => ctx.progress(null, `Buscando… ${n.toLocaleString('pt-BR')} nós`),
    })
  },

  jsonpath({ expr }) {
    assertDoc()
    return evaluateJsonPath(doc, expr)
  },

  chartCandidates() {
    assertDoc()
    return findChartCandidates(doc)
  },

  chartData(spec) {
    assertDoc()
    return buildChartData(doc, spec)
  },

  preview({ path, fields }) {
    assertDoc()
    return previewRows(doc, path, fields)
  },

  generate({ count, indent }, ctx) {
    ctx.progress(0.2, `Gerando ${count.toLocaleString('pt-BR')} registros de teste…`)
    const data = generateTestDataset(count)
    ctx.progress(0.7, 'Serializando…')
    return JSON.stringify(data, null, Number(indent) || 2)
  },
})

function assertDoc() {
  if (!hasDoc) throw new Error('Nenhum JSON válido carregado')
}
