import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildChartData, computeStats, evaluateJsonPath, findChartCandidates, getChildren, locateJsonError, pathToString, searchJson } from '../src/modules/json/lib/jsonEngine.js'

const doc = {
  loja: 'X',
  itens: [
    { id: 1, nome: 'Teclado', preco: 150, cat: 'perifericos', data: '2026-01-02' },
    { id: 2, nome: 'Mouse', preco: 80, cat: 'perifericos', data: '2026-01-05' },
    { id: 3, nome: 'Monitor', preco: 1200, cat: 'video', data: '2026-02-01' },
  ],
  meta: { 'chave com espaço': true, vazio: null },
}

test('estatísticas estruturais', async () => {
  const s = await computeStats(doc)
  assert.equal(s.objects, 5)
  assert.equal(s.arrays, 1)
  assert.equal(s.maxDepth, 3)
  assert.equal(s.nulls, 1)
  assert.equal(s.numbers, 6)
})

test('filhos paginados e posicionados', () => {
  const big = { arr: Array.from({ length: 2000 }, (_, i) => i) }
  const r = getChildren(big, ['arr'], 0, 100, 1500)
  assert.ok(r.offset <= 1500 && r.offset + r.items.length > 1500)
  assert.equal(r.total, 2000)
})

test('caminhos JSONPath', () => {
  assert.equal(pathToString(['itens', 0, 'nome']), '$.itens[0].nome')
  assert.equal(pathToString(['meta', 'chave com espaço']), "$.meta['chave com espaço']")
})

test('avaliação JSONPath com filtros, slices e descendentes', () => {
  assert.equal(evaluateJsonPath(doc, '$.itens[?(@.preco > 100)].nome').total, 2)
  assert.equal(evaluateJsonPath(doc, '$.itens[-1:].id').results[0].preview, '3')
  assert.equal(evaluateJsonPath(doc, '$..preco').total, 3)
  assert.equal(evaluateJsonPath(doc, "$.itens[?(@.cat == 'video')]").total, 1)
  assert.throws(() => evaluateJsonPath(doc, 'itens'))
})

test('busca por chaves e valores', async () => {
  const r = await searchJson(doc, 'mo')
  assert.deepEqual(r.results.map((x) => pathToString(x.path)).sort(), ['$.itens[1].nome', '$.itens[2].nome'])
})

test('localiza erro de sintaxe', () => {
  const text = '{\n  "a": 1,\n  "b": \n}'
  try {
    JSON.parse(text)
  } catch (e) {
    const loc = locateJsonError(text, e)
    assert.equal(loc.line, 4)
  }
})

test('detecção de datasets e dados de gráfico', () => {
  const c = findChartCandidates(doc)
  assert.equal(c[0].pathLabel, '$.itens')
  assert.ok(c[0].fields.find((f) => f.name === 'preco').kind === 'number')
  assert.ok(c[0].fields.find((f) => f.name === 'data').kind === 'date')
  const bar = buildChartData(doc, { path: ['itens'], chart: 'bar', x: 'cat', y: 'preco', xKind: 'category', yKind: 'number', agg: 'sum' })
  assert.deepEqual(bar.categories, [
    { label: 'video', value: 1200 },
    { label: 'perifericos', value: 230 },
  ])
  const hist = buildChartData(doc, { path: ['itens'], chart: 'histogram', x: 'preco', xKind: 'number', bins: 2 })
  assert.equal(hist.bins.reduce((a, b) => a + b.count, 0), 3)
})
