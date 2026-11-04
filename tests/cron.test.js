import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assemble, convertFormat, detectFormat, nextRuns, parseCron } from '../src/modules/cron/lib/cronEngine.js'
import { describeCron } from '../src/modules/cron/lib/describe.js'
import { interpretNatural } from '../src/modules/cron/lib/natural.js'

const iso = (d) => d.toISOString()

test('detecta formatos 5, 6 e 7 campos', () => {
  assert.equal(detectFormat('*/5 * * * *'), 'unix')
  assert.equal(detectFormat('0 30 9 * * 1-5'), 'seconds')
  assert.equal(detectFormat('0 30 9 ? * MON-FRI'), 'quartz')
  assert.equal(detectFormat('0 0 12 1 * ? 2027'), 'quartz')
})

test('valida campos com mensagens claras', () => {
  const r = parseCron('61 * * * *', 'unix')
  assert.equal(r.ok, false)
  assert.match(r.errors[0].message, /fora do intervalo/)
  assert.equal(parseCron('* * * *', 'unix').ok, false)
  assert.equal(parseCron('0 0 L * *', 'unix').ok, false)
  assert.equal(parseCron('0 0 12 * * MON', 'quartz').ok, false, 'Quartz exige ?')
})

test('próximas execuções a cada 15 minutos (UTC)', () => {
  const p = parseCron('*/15 * * * *')
  const runs = nextRuns(p, { from: Date.UTC(2026, 0, 1, 10, 7, 0), count: 3, tz: 'UTC' })
  assert.deepEqual(runs.map(iso), ['2026-01-01T10:15:00.000Z', '2026-01-01T10:30:00.000Z', '2026-01-01T10:45:00.000Z'])
})

test('dias úteis às 09:30 em America/Sao_Paulo (UTC-3)', () => {
  const p = parseCron('30 9 * * 1-5')
  // 2026-01-02 é sexta-feira
  const runs = nextRuns(p, { from: Date.UTC(2026, 0, 2, 13, 0, 0), count: 2, tz: 'America/Sao_Paulo' })
  assert.deepEqual(runs.map(iso), ['2026-01-05T12:30:00.000Z', '2026-01-06T12:30:00.000Z'])
})

test('formato com segundos', () => {
  const p = parseCron('0 30 9 * * 1-5')
  assert.equal(p.format, 'seconds')
  const runs = nextRuns(p, { from: Date.UTC(2026, 0, 5, 0, 0, 0), count: 1, tz: 'UTC' })
  assert.equal(iso(runs[0]), '2026-01-05T09:30:00.000Z')
})

test('Quartz: último dia do mês, dia útil mais próximo e n-ésimo dia da semana', () => {
  const last = nextRuns(parseCron('0 0 12 L * ?'), { from: Date.UTC(2026, 1, 1), count: 2, tz: 'UTC' })
  assert.deepEqual(last.map(iso), ['2026-02-28T12:00:00.000Z', '2026-03-31T12:00:00.000Z'])
  // 15/08/2026 é sábado → dia útil mais próximo = sexta 14
  const w = nextRuns(parseCron('0 0 8 15W * ?'), { from: Date.UTC(2026, 7, 1), count: 1, tz: 'UTC' })
  assert.equal(iso(w[0]), '2026-08-14T08:00:00.000Z')
  // 6#3 = terceira sexta-feira (Quartz 6 = sexta)
  const nth = nextRuns(parseCron('0 0 10 ? * 6#3'), { from: Date.UTC(2026, 0, 1), count: 1, tz: 'UTC' })
  assert.equal(iso(nth[0]), '2026-01-16T10:00:00.000Z')
})

test('Unix: dia do mês OU dia da semana', () => {
  const p = parseCron('0 0 13 * 5')
  assert.ok(p.warnings.some((w) => /QUALQUER/.test(w)))
  const runs = nextRuns(p, { from: Date.UTC(2026, 0, 1), count: 3, tz: 'UTC' })
  assert.deepEqual(runs.map(iso), ['2026-01-02T00:00:00.000Z', '2026-01-09T00:00:00.000Z', '2026-01-13T00:00:00.000Z'])
})

test('horário de verão: horário inexistente é pulado', () => {
  // EUA: 08/03/2026 às 02:00 o relógio salta para 03:00
  const runs = nextRuns(parseCron('30 2 * * *'), { from: Date.UTC(2026, 2, 7, 12), count: 2, tz: 'America/New_York' })
  assert.deepEqual(runs.map(iso), ['2026-03-09T06:30:00.000Z', '2026-03-10T06:30:00.000Z'])
})

test('descrição em português', () => {
  assert.equal(describeCron(parseCron('*/5 * * * *')), 'A cada 5 minutos.')
  assert.equal(describeCron(parseCron('30 9 * * 1-5')), 'Às 09:30, de segunda a sexta-feira.')
  assert.equal(describeCron(parseCron('0 0 1 * *')), 'Às 00:00, no dia 1 do mês.')
  assert.equal(describeCron(parseCron('0 8 * * *')), 'Às 08:00, todos os dias.')
})

test('montagem e conversão entre formatos', () => {
  assert.equal(assemble({ minute: '0', hour: '9', dow: '1-5' }, 'quartz'), '0 0 9 ? * 2-6')
  assert.equal(convertFormat(parseCron('0 0 9 ? * 2-6'), 'unix').expression, '0 9 * * 1-5')
  // passo e "#n" não podem ser deslocados na conversão Unix → Quartz
  assert.equal(assemble({ minute: '0', hour: '9', dow: '1-5/2' }, 'quartz'), '0 0 9 ? * 2-6/2')
  assert.equal(assemble({ minute: '0', hour: '9', dow: '5#3' }, 'quartz'), '0 0 9 ? * 6#3')
  assert.ok(parseCron(assemble({ minute: '0', hour: '9', dow: '*/2' }, 'quartz')).ok)
})

test('linguagem natural', () => {
  const cases = [
    ['Executar todos os dias às 8 da manhã', '0 8 * * *'],
    ['Executar a cada 15 minutos', '*/15 * * * *'],
    ['Executar toda segunda-feira às 10 horas', '0 10 * * 1'],
    ['Executar no primeiro dia de cada mês', '0 0 1 * *'],
    ['Executar a cada 2 horas, de segunda a sexta', '0 */2 * * 1-5'],
    ['A cada 30 minutos das 8h às 18h em dias úteis', '*/30 8-17 * * 1-5'],
    ['Todo dia 5 e 20 às 23:30', '30 23 5,20 * *'],
  ]
  for (const [text, expected] of cases) {
    const r = interpretNatural(text, { format: 'unix' })
    assert.equal(r.expression, expected, text)
    assert.ok(parseCron(r.expression, 'unix').ok, `${text} → expressão válida`)
  }
})

test('linguagem natural pede esclarecimento em horário ambíguo', () => {
  const r = interpretNatural('Às 8 de segunda a sexta', { format: 'unix' })
  assert.equal(r.status, 'clarify')
  const answered = interpretNatural('Às 8 de segunda a sexta', { format: 'unix', answers: { [r.clarifications[0].id]: 'pm' } })
  assert.equal(answered.status, 'ok')
  assert.equal(answered.expression, '0 20 * * 1-5')
})
