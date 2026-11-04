/**
 * Web Worker do XML Visualizer: parse, validação, estatísticas, linhas do visualizador
 * e serialização acontecem fora da thread principal.
 */
import { exposeWorker } from '@core/workers/createWorkerClient'
import { buildLines, lineStarts, parseXml, posToLineCol, serialize, xmlStats } from './lib/xmlParser'

let last = null

exposeWorker({
  parse({ text }, ctx) {
    const t0 = performance.now()
    ctx.progress(0.05, 'Lendo XML…')
    const res = parseXml(text, { onProgress: (v) => ctx.progress(0.05 + v * 0.6, 'Validando estrutura…') })
    let error = null
    const starts = lineStarts(text)
    if (res.error) {
      const { line, col } = posToLineCol(starts, res.error.pos)
      error = { message: res.error.message, line, col }
    }
    ctx.progress(0.75, 'Montando visualização…')
    const lines = buildLines(res.nodes)
    const stats = xmlStats(res.nodes)
    last = error ? null : res
    // remove campos não usados pela interface antes de transferir
    const nodes = res.nodes.map((nd) => ({
      id: nd.id,
      type: nd.type,
      name: nd.name,
      attrs: nd.attrs,
      parent: nd.parent,
      depth: nd.depth,
      children: nd.children,
      selfClosing: nd.selfClosing,
      text: nd.type === 'element' ? undefined : nd.text,
      line: posToLineCol(starts, nd.start).line, // linha no texto original (sincroniza com o editor)
    }))
    return { nodes, lines, stats, error, bytes: new Blob([text]).size, ms: performance.now() - t0 }
  },

  format({ indent }) {
    if (!last) throw new Error('Corrija os erros de sintaxe antes de formatar')
    return serialize(last.nodes, { indent: indent === 'tab' ? '\t' : ' '.repeat(Number(indent) || 2) })
  },

  minify() {
    if (!last) throw new Error('Corrija os erros de sintaxe antes de minificar')
    return serialize(last.nodes, { minify: true })
  },
})
