/**
 * Fonte JSON do Model Generator: infere classes a partir de um exemplo de JSON.
 *  - objetos viram classes (nomeadas pela chave, no singular quando vêm de arrays)
 *  - arrays de objetos têm os formatos unidos: campo ausente em algum item ou com null vira anulável
 *  - números inteiros → int32/int64; com casas decimais → decimal (valores de negócio)
 *  - textos ISO 8601 → date/datetime, UUID → guid (opcional)
 */
import { singular, toPascal } from './naming.js'

const ISO_DT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const ISO_D = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ITEMS = 5000

const NUM_ORDER = ['int32', 'int64', 'decimal']

function mergeBase(a, b) {
  if (!a || a === 'unknown') return b
  if (!b || b === 'unknown' || a === b) return a
  if (NUM_ORDER.includes(a) && NUM_ORDER.includes(b)) return NUM_ORDER[Math.max(NUM_ORDER.indexOf(a), NUM_ORDER.indexOf(b))]
  if ((a === 'date' && b === 'datetime') || (a === 'datetime' && b === 'date')) return 'datetime'
  if (['date', 'datetime', 'guid'].includes(a) && b === 'string') return 'string'
  if (['date', 'datetime', 'guid'].includes(b) && a === 'string') return 'string'
  return 'object'
}

export function jsonToModel(text, { rootName = 'Modelo', detectDates = true } = {}) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { source: 'json', classes: [], warnings: [`JSON inválido: ${e.message}`] }
  }
  const warnings = []
  const classes = new Map() // nome → { name, fieldsMap, count }

  const primitive = (v) => {
    if (v === null) return 'unknown'
    if (typeof v === 'boolean') return 'bool'
    if (typeof v === 'number') return Number.isInteger(v) ? (Math.abs(v) > 2147483647 ? 'int64' : 'int32') : 'decimal'
    if (typeof v === 'string') {
      if (detectDates && ISO_D.test(v)) return 'date'
      if (detectDates && ISO_DT.test(v)) return 'datetime'
      if (detectDates && UUID.test(v)) return 'guid'
      return 'string'
    }
    return 'object'
  }

  /** Une vários valores (de itens de array ou da mesma chave) em um descritor de campo. */
  function describe(values, hint) {
    const present = values.filter((v) => v !== undefined)
    const nonNull = present.filter((v) => v !== null)
    const nullable = present.length < values.length || nonNull.length < present.length
    if (!nonNull.length) return { type: { base: 'unknown' }, nullable: true, note: 'sempre nulo no exemplo' }
    const arrays = nonNull.filter(Array.isArray)
    const objects = nonNull.filter((v) => v && typeof v === 'object' && !Array.isArray(v))
    if (arrays.length && arrays.length === nonNull.length) {
      const items = arrays.flat().slice(0, MAX_ITEMS)
      if (arrays.flat().length > MAX_ITEMS) warnings.push(`"${hint}": só os primeiros ${MAX_ITEMS} itens foram analisados.`)
      if (!items.length) return { type: { base: 'unknown' }, nullable, list: true, note: 'lista vazia no exemplo' }
      const inner = describe(items, singular(hint))
      return { ...inner, list: true, nullable, itemNullable: inner.nullable }
    }
    if (objects.length && objects.length === nonNull.length) {
      const name = classFor(objects, hint)
      return { type: { base: 'class' }, ref: name, nullable }
    }
    if (arrays.length || objects.length) return { type: { base: 'object' }, nullable, note: 'valores de formatos diferentes no exemplo' }
    let base = null
    let maxLen = 0
    for (const v of nonNull) {
      base = mergeBase(base, primitive(v))
      if (typeof v === 'string') maxLen = Math.max(maxLen, v.length)
    }
    return { type: { base: base ?? 'unknown' }, nullable, sampleMaxLength: maxLen || undefined }
  }

  function classFor(objects, hint) {
    const name = toPascal(hint)
    let cls = classes.get(name)
    if (!cls) {
      cls = { name, keys: new Map(), count: 0 }
      classes.set(name, cls)
    }
    for (const o of objects) {
      cls.count++
      for (const k of Object.keys(o)) if (!cls.keys.has(k)) cls.keys.set(k, [])
    }
    for (const [k, list] of cls.keys) for (const o of objects) list.push(o[k])
    return name
  }

  let rootIsList = false
  if (Array.isArray(data)) {
    rootIsList = true
    const objs = data.filter((v) => v && typeof v === 'object' && !Array.isArray(v)).slice(0, MAX_ITEMS)
    if (!objs.length) return { source: 'json', classes: [], warnings: ['A raiz é uma lista sem objetos: não há classe para gerar.'] }
    classFor(objs, rootName)
  } else if (data && typeof data === 'object') classFor([data], rootName)
  else return { source: 'json', classes: [], warnings: ['O JSON precisa ter um objeto (ou lista de objetos) na raiz.'] }

  // processa as classes em ordem de descoberta (classFor durante describe adiciona novas)
  const done = new Set()
  const out = []
  for (let guard = 0; guard < 500; guard++) {
    const next = [...classes.values()].find((c) => !done.has(c.name))
    if (!next) break
    done.add(next.name)
    const total = next.count
    const fields = []
    for (const [key, values] of next.keys) {
      const padded = values.length < total ? [...values, ...Array(total - values.length).fill(undefined)] : values
      const d = describe(padded, key)
      fields.push({ name: key, jsonName: key, ...d })
    }
    out.push({ kind: 'json', name: next.name, origin: next.name === toPascal(rootName) ? (rootIsList ? 'itens da lista raiz do JSON' : 'objeto raiz do JSON') : `objeto aninhado "${next.name}"`, fields, pk: [] })
  }
  return { source: 'json', classes: out, warnings }
}
