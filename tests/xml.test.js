import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLines, lineStarts, parseXml, posToLineCol, serialize, xpathOf } from '../src/modules/xml/lib/xmlParser.js'

const sample = `<?xml version="1.0"?>
<Colaborador id="7">
    <Nome>Pedro</Nome>
    <Empresa>
        <Nome>JBS</Nome>
        <!-- comentário -->
        <Logo/>
    </Empresa>
</Colaborador>`

test('parse válido gera nós e linhas pareadas', () => {
  const r = parseXml(sample)
  assert.equal(r.error, null)
  const root = r.nodes[r.rootId]
  assert.equal(root.name, 'Colaborador')
  assert.deepEqual(root.attrs, [['id', '7']])
  const lines = buildLines(r.nodes)
  const kinds = lines.map((l) => l.kind)
  assert.deepEqual(kinds, ['pi', 'open', 'inline', 'open', 'inline', 'comment', 'self', 'close', 'close'])
  // abertura e fechamento referenciam-se mutuamente
  assert.equal(lines[lines[1].pair].pair, 1)
  assert.equal(lines[lines[3].pair].kind, 'close')
})

test('erros de boa formação com posição', () => {
  const cases = [
    ['<a><b></a>', /esperado <\/b>|fecha <b>/],
    ['<a>', /não foi fechada/],
    ['<a x=1></a>', /aspas/],
    ['<a></a><b/>', /mais de um elemento raiz/],
    ['<a x="1" x="2"/>', /duplicado/],
    ['<a>& solto</a>', /&amp;/],
  ]
  for (const [xml, re] of cases) {
    const r = parseXml(xml)
    assert.ok(r.error, xml)
    assert.match(r.error.message, re, xml)
  }
  const r = parseXml('<a>\n  <b>\n</a>')
  const { line } = posToLineCol(lineStarts('<a>\n  <b>\n</a>'), r.error.pos)
  assert.equal(line, 3)
})

test('serialização formatada e minificada', () => {
  const r = parseXml('<a><b>x</b><c/></a>')
  assert.equal(serialize(r.nodes, { indent: '  ' }), '<a>\n  <b>x</b>\n  <c/>\n</a>\n')
  assert.equal(serialize(r.nodes, { minify: true }), '<a><b>x</b><c/></a>')
})

test('xpath de um nó', () => {
  const r = parseXml('<a><b/><b><c/></b></a>')
  const c = r.nodes.find((n) => n.name === 'c')
  assert.equal(xpathOf(r.nodes, c.id), '/a/b[2]/c')
})
