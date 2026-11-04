/**
 * Fonte SQL do Model Generator. Usa o lexer e o parser do SQL Forge (T-SQL), então entende
 * scripts reais: procedures, GO, comentários, colchetes.
 *
 * Gera classes a partir de:
 *  - CREATE TABLE (permanentes e #temporárias), DECLARE @t TABLE, RETURNS @t TABLE, CREATE TYPE … AS TABLE
 *  - ALTER TABLE … ADD PRIMARY KEY / FOREIGN KEY
 *  - SELECTs que devolvem dados numa procedure (o "resultado" vira um DTO). Os tipos das colunas
 *    vêm das tabelas declaradas no próprio script, das variáveis/parâmetros e das funções usadas.
 *    O que não dá para descobrir fica marcado como tipo desconhecido, nunca inventado.
 */
import { internals, parseTsql } from '../../sqlforge/lib/formatter.js'

const { isW, splitByComma, splitJoins, splitClauses, splitSetOps, selectClauseAt, findTopWord, findTop, matchParen, cteAt, readName } = internals

/* ───────── tipos ───────── */

const BASE = {
  BIT: 'bool',
  TINYINT: 'uint8',
  SMALLINT: 'int16',
  INT: 'int32',
  INTEGER: 'int32',
  BIGINT: 'int64',
  DECIMAL: 'decimal',
  NUMERIC: 'decimal',
  MONEY: 'decimal',
  SMALLMONEY: 'decimal',
  FLOAT: 'float64',
  REAL: 'float32',
  DATE: 'date',
  DATETIME: 'datetime',
  DATETIME2: 'datetime',
  SMALLDATETIME: 'datetime',
  DATETIMEOFFSET: 'datetimeoffset',
  TIME: 'time',
  CHAR: 'string',
  VARCHAR: 'string',
  NCHAR: 'string',
  NVARCHAR: 'string',
  TEXT: 'string',
  NTEXT: 'string',
  SYSNAME: 'string',
  XML: 'string',
  UNIQUEIDENTIFIER: 'guid',
  BINARY: 'bytes',
  VARBINARY: 'bytes',
  IMAGE: 'bytes',
  ROWVERSION: 'bytes',
  TIMESTAMP: 'bytes',
  SQL_VARIANT: 'object',
  HIERARCHYID: 'object',
  GEOGRAPHY: 'object',
  GEOMETRY: 'object',
}

const text = (toks) => toks.map((t) => t.out ?? t.v).join('')
const tokText = (toks) =>
  toks
    .map((t, i) => {
      const s = t.out ?? t.v
      const prev = toks[i - 1]
      if (!prev || ['(', '.', ','].includes(prev.v) || [')', '.', ','].includes(t.v) || t.v === '(') return t.v === ',' ? ', ' : s
      return ` ${s}`
    })
    .join('')
    .replace(/, +/g, ', ')

/** VARCHAR(20) → { base: 'string', length: 20, sql: 'VARCHAR(20)' } */
export function sqlType(typeToks) {
  if (!typeToks.length) return { base: 'unknown', sql: '' }
  const open = typeToks.findIndex((t) => t.v === '(')
  const name = nameParts(open < 0 ? typeToks : typeToks.slice(0, open)).name.toUpperCase()
  const args = open < 0 ? [] : typeToks.slice(open + 1, -1).filter((t) => t.v !== ',').map((t) => (isW(t, 'MAX') ? 'MAX' : Number(t.v)))
  const base = BASE[name] ?? 'object'
  const out = { base, sql: tokText(typeToks).toUpperCase() }
  if (base === 'string' || base === 'bytes') {
    if (args[0] === 'MAX' || ['TEXT', 'NTEXT', 'XML', 'IMAGE'].includes(name)) out.length = null
    else if (typeof args[0] === 'number') out.length = args[0]
    else if (['CHAR', 'NCHAR', 'BINARY', 'VARCHAR', 'NVARCHAR', 'VARBINARY'].includes(name)) out.length = 1
    else if (name === 'SYSNAME') out.length = 128
    out.fixed = ['CHAR', 'NCHAR', 'BINARY'].includes(name)
  }
  if (base === 'decimal') {
    if (name === 'MONEY') Object.assign(out, { precision: 19, scale: 4 })
    else if (name === 'SMALLMONEY') Object.assign(out, { precision: 10, scale: 4 })
    else Object.assign(out, { precision: typeof args[0] === 'number' ? args[0] : 18, scale: typeof args[1] === 'number' ? args[1] : 0 })
  }
  if (name === 'FLOAT' && typeof args[0] === 'number' && args[0] <= 24) out.base = 'float32'
  if (name === 'ROWVERSION' || name === 'TIMESTAMP') out.rowversion = true
  if (!BASE[name]) out.userType = name
  return out
}

/* ───────── tabelas ───────── */

const tableKey = (s) => s.replace(/^\[|\]$/g, '').toUpperCase()

function nameParts(toks) {
  const parts = toks.filter((t) => t.v !== '.').map((t) => (t.out ?? t.v).replace(/^\[|\]$/g, ''))
  const name = parts[parts.length - 1] ?? ''
  const schema = parts.length > 1 ? parts[parts.length - 2] : null
  return { name, schema }
}

function parseColumns(defs) {
  const fields = []
  const pk = []
  const fks = []
  for (const row of splitByComma(defs)) {
    const r = row.toks
    if (!r.length) continue
    let k = 0
    if (isW(r[0], 'CONSTRAINT')) k = 2
    if (isW(r[k], 'PRIMARY') && isW(r[k + 1], 'KEY')) {
      const open = r.findIndex((t, i) => i > k && t.v === '(')
      if (open > 0) pk.push(...splitByComma(r.slice(open + 1, matchParen(r, open))).map((c) => nameParts(c.toks.filter((t) => !isW(t, 'ASC', 'DESC'))).name))
      continue
    }
    if (isW(r[k], 'FOREIGN') && isW(r[k + 1], 'KEY')) {
      fks.push(parseFk(r, k + 2))
      continue
    }
    if (isW(r[k], 'UNIQUE', 'CHECK', 'INDEX', 'PERIOD') || k === 2) continue
    const name = nameParts([r[0]]).name
    if (isW(r[1], 'AS')) {
      fields.push({ name, type: { base: 'unknown' }, nullable: true, computed: tokText(r.slice(2)), computedToks: r.slice(2) })
      continue
    }
    let j = 1
    const typeToks = []
    if (r[j]) {
      typeToks.push(r[j++])
      while (r[j]?.v === '.' && r[j + 1]) typeToks.push(r[j++], r[j++])
      if (r[j]?.v === '(') {
        const c = matchParen(r, j)
        typeToks.push(...r.slice(j, c + 1))
        j = c + 1
      }
    }
    const f = { name, type: sqlType(typeToks), nullable: true, pk: false, identity: false, fk: null, defaultSql: null }
    let depth = 0
    for (; j < r.length; j++) {
      const t = r[j]
      if (t.v === '(') depth++
      else if (t.v === ')') depth--
      if (depth > 0) continue
      if (isW(t, 'NOT') && isW(r[j + 1], 'NULL')) {
        f.nullable = false
        j++
      } else if (isW(t, 'PRIMARY') && isW(r[j + 1], 'KEY')) {
        f.pk = true
        f.nullable = false
      } else if (isW(t, 'IDENTITY')) f.identity = true
      else if (isW(t, 'DEFAULT')) {
        let e = j + 1
        if (r[e]?.v === '(') e = matchParen(r, e)
        f.defaultSql = tokText(r.slice(j + 1, e + 1))
        j = e
      } else if (isW(t, 'REFERENCES')) {
        const ref = refAt(r, j)
        f.fk = { table: ref.table, column: ref.toCols[0] ?? null }
        j = ref.end - 1
      }
    }
    if (f.type.rowversion) f.nullable = false
    fields.push(f)
  }
  for (const name of pk) {
    const f = fields.find((x) => x.name.toUpperCase() === name.toUpperCase())
    if (f) {
      f.pk = true
      f.nullable = false
    }
  }
  return { fields, pk: fields.filter((f) => f.pk).map((f) => f.name), fks }
}

/** "REFERENCES tabela (cols)" com REFERENCES na posição k */
function refAt(r, k) {
  const end = readName(r, k + 1)
  const { name, schema } = nameParts(r.slice(k + 1, end))
  const close = r[end]?.v === '(' ? matchParen(r, end) : -1
  const toCols = close < 0 ? [] : splitByComma(r.slice(end + 1, close)).map((c) => nameParts(c.toks).name)
  return { table: schema ? `${schema}.${name}` : name, toCols, end: close < 0 ? end : close + 1 }
}

/** "(cols) REFERENCES tabela (cols)" começando em k */
function parseFk(r, k) {
  const open = r.findIndex((t, i) => i >= k && t.v === '(')
  const fromCols = open < 0 ? [] : splitByComma(r.slice(open + 1, matchParen(r, open))).map((c) => nameParts(c.toks).name)
  const ref = r.findIndex((t, i) => i >= k && isW(t, 'REFERENCES'))
  if (ref < 0) return { fromCols, table: null, toCols: [] }
  return { fromCols, ...refAt(r, ref) }
}

function collectTables(T) {
  const tables = []
  const add = (kind, nameToks, open) => {
    const close = matchParen(T, open)
    if (close < 0) return
    const { name, schema } = nameParts(nameToks)
    const { fields, pk, fks } = parseColumns(T.slice(open + 1, close))
    const t = { kind, name, schema: kind === 'table' ? schema ?? 'dbo' : schema, fields, pk, line: nameToks[0].line }
    applyFks(t, fks)
    tables.push(t)
  }
  for (let k = 0; k < T.length; k++) {
    const t = T[k]
    if (isW(t, 'CREATE') && isW(T[k + 1], 'TABLE')) {
      const end = readName(T, k + 2)
      if (T[end]?.v === '(') add(T[k + 2]?.t === 'temp' ? 'temp' : 'table', T.slice(k + 2, end), end)
    } else if (isW(t, 'CREATE') && isW(T[k + 1], 'TYPE')) {
      const end = readName(T, k + 2)
      if (isW(T[end], 'AS') && isW(T[end + 1], 'TABLE') && T[end + 2]?.v === '(') add('type', T.slice(k + 2, end), end + 2)
    } else if (t.t === 'var' && isW(T[k + 1], 'TABLE') && T[k + 2]?.v === '(') add('tablevar', [t], k + 2)
  }
  // ALTER TABLE x ADD [CONSTRAINT n] PRIMARY KEY (...) / FOREIGN KEY (...) REFERENCES ...
  for (let k = 0; k < T.length; k++) {
    if (!isW(T[k], 'ALTER') || !isW(T[k + 1], 'TABLE')) continue
    const end = readName(T, k + 2)
    const { name } = nameParts(T.slice(k + 2, end))
    const tbl = tables.find((x) => x.name.toUpperCase() === name.toUpperCase())
    if (!tbl) continue
    let stop = end
    while (stop < T.length && T[stop].v !== ';' && !(isW(T[stop], 'GO') && T[stop].nl > 0) && !(stop > end && isW(T[stop], 'ALTER', 'CREATE') && T[stop].nl > 0)) stop++
    const seg = T.slice(end, stop)
    const pkAt = seg.findIndex((t, i) => isW(t, 'PRIMARY') && isW(seg[i + 1], 'KEY'))
    const fkAt = seg.findIndex((t, i) => isW(t, 'FOREIGN') && isW(seg[i + 1], 'KEY'))
    if (pkAt >= 0) {
      const open = seg.findIndex((t, i) => i > pkAt && t.v === '(')
      const cols = open < 0 ? [] : splitByComma(seg.slice(open + 1, matchParen(seg, open))).map((c) => nameParts(c.toks.filter((t) => !isW(t, 'ASC', 'DESC'))).name)
      for (const c of cols) {
        const f = tbl.fields.find((x) => x.name.toUpperCase() === c.toUpperCase())
        if (f) Object.assign(f, { pk: true, nullable: false })
      }
      tbl.pk = tbl.fields.filter((f) => f.pk).map((f) => f.name)
    }
    if (fkAt >= 0) applyFks(tbl, [parseFk(seg, fkAt + 2)])
  }
  return tables
}

function applyFks(t, fks) {
  for (const fk of fks) {
    fk.fromCols.forEach((c, i) => {
      const f = t.fields.find((x) => x.name.toUpperCase() === c.toUpperCase())
      if (f) f.fk = { table: fk.table, column: fk.toCols[i] ?? null }
    })
  }
}

/* ───────── variáveis e parâmetros (para tipar SELECT @x AS Y) ───────── */

function collectVars(T) {
  const vars = new Map()
  for (let k = 0; k < T.length; k++) {
    const t = T[k]
    if (t.t !== 'var' || t.v.startsWith('@@')) continue
    const prev = T[k - 1]
    const isDecl = isW(prev, 'DECLARE') || prev?.v === ',' || prev?.v === '('
    if (!isDecl || vars.has(t.v.toUpperCase())) continue
    let j = k + 1
    if (isW(T[j], 'AS')) j++
    if (!T[j] || !(T[j].t === 'word' && BASE[T[j].u])) continue
    const typeToks = [T[j]]
    if (T[j + 1]?.v === '(') typeToks.push(...T.slice(j + 1, matchParen(T, j + 1) + 1))
    vars.set(t.v.toUpperCase(), sqlType(typeToks))
  }
  return vars
}

/* ───────── inferência de tipo das expressões ───────── */

const T_ = (base, extra = {}) => ({ type: { base, ...extra }, nullable: extra.nullable ?? false })
const STRING_FN = new Set(['LTRIM', 'RTRIM', 'TRIM', 'UPPER', 'LOWER', 'SUBSTRING', 'LEFT', 'RIGHT', 'REPLACE', 'CONCAT', 'CONCAT_WS', 'FORMAT', 'STUFF', 'REPLICATE', 'REVERSE', 'QUOTENAME', 'STR', 'CHAR', 'NCHAR', 'SPACE', 'DATENAME', 'STRING_AGG', 'JSON_VALUE', 'JSON_QUERY', 'TRANSLATE', 'OBJECT_NAME', 'DB_NAME', 'SUSER_SNAME', 'HOST_NAME', 'ERROR_MESSAGE', 'ERROR_PROCEDURE', 'FORMATMESSAGE'])
const INT_FN = new Set(['LEN', 'DATALENGTH', 'CHARINDEX', 'PATINDEX', 'DATEDIFF', 'DATEPART', 'YEAR', 'MONTH', 'DAY', 'ERROR_NUMBER', 'ERROR_LINE', 'ERROR_SEVERITY', 'ERROR_STATE', 'ASCII', 'UNICODE', 'SIGN', 'OBJECT_ID', 'ISNUMERIC', 'ISDATE', 'COUNT', 'GROUPING', '@@ROWCOUNT', 'DB_ID'])
const BIGINT_FN = new Set(['COUNT_BIG', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'DATEDIFF_BIG'])
const DATETIME_FN = new Set(['GETDATE', 'GETUTCDATE', 'SYSDATETIME', 'SYSUTCDATETIME', 'CURRENT_TIMESTAMP', 'DATETIMEFROMPARTS', 'DATETIME2FROMPARTS', 'SMALLDATETIMEFROMPARTS'])

function stripParens(toks) {
  while (toks.length >= 2 && toks[0].v === '(' && matchParen(toks, 0) === toks.length - 1) toks = toks.slice(1, -1)
  return toks
}

function args(toks) {
  // toks = NOME ( ... )
  return splitByComma(toks.slice(2, -1)).map((a) => a.toks)
}

function inferExpr(toks, scope) {
  toks = stripParens(toks)
  // função de janela: COUNT(*) OVER (...) tem o tipo da função
  const over = findTopWord(toks, 1, ['OVER'])
  if (over < toks.length && toks[over + 1]?.v === '(' && matchParen(toks, over + 1) === toks.length - 1) toks = toks.slice(0, over)
  if (!toks.length) return { type: { base: 'unknown' }, nullable: true }
  const t0 = toks[0]
  if (toks.length === 1) {
    if (t0.t === 'string') return T_('string')
    if (t0.t === 'number') return /[.e]/i.test(t0.v) ? T_('decimal', { precision: 18, scale: (t0.v.split('.')[1] ?? '').length }) : T_(Math.abs(Number(t0.v)) > 2147483647 ? 'int64' : 'int32')
    if (isW(t0, 'NULL')) return { type: { base: 'unknown' }, nullable: true }
    if (t0.t === 'word' && DATETIME_FN.has(t0.u)) return T_('datetime')
    if (t0.t === 'var') {
      if (t0.u.startsWith('@@')) return T_('int32')
      const v = scope.vars.get(t0.u)
      return v ? { type: v, nullable: true } : { type: { base: 'unknown' }, nullable: true }
    }
  }
  // referência a coluna: [alias.]coluna
  if (toks.every((t, i) => (i % 2 === 0 ? t.t === 'word' || t.t === 'qid' : t.v === '.')) && toks.length % 2 === 1) {
    const col = nameParts([toks[toks.length - 1]]).name.toUpperCase()
    const alias = toks.length >= 3 ? nameParts([toks[toks.length - 3]]).name.toUpperCase() : null
    return scope.lookup(alias, col) ?? { type: { base: 'unknown' }, nullable: true, missing: tokText(toks) }
  }
  // função
  if ((t0.t === 'word' || t0.t === 'qid') && toks[1]?.v === '(' && matchParen(toks, 1) === toks.length - 1) {
    const fn = t0.u
    const a = args(toks)
    if (fn === 'CAST' || fn === 'TRY_CAST') {
      const as = findTopWord(toks.slice(2, -1), 0, ['AS'])
      return { type: sqlType(toks.slice(2, -1).slice(as + 1)), nullable: fn === 'TRY_CAST' || inferExpr(toks.slice(2, -1).slice(0, as), scope).nullable }
    }
    if (fn === 'CONVERT' || fn === 'TRY_CONVERT') return { type: sqlType(a[0] ?? []), nullable: fn === 'TRY_CONVERT' || inferExpr(a[1] ?? [], scope).nullable }
    if (fn === 'ISNULL' || fn === 'COALESCE') {
      const parts = a.map((x) => inferExpr(x, scope))
      const known = parts.find((p) => p.type.base !== 'unknown') ?? parts[0]
      return { type: known.type, nullable: parts.every((p) => p.nullable) }
    }
    if (fn === 'NULLIF') return { ...inferExpr(a[0] ?? [], scope), nullable: true }
    if (fn === 'IIF') {
      const r = inferExpr(a[1] ?? [], scope)
      return r.type.base === 'unknown' ? inferExpr(a[2] ?? [], scope) : r
    }
    if (['SUM', 'MIN', 'MAX', 'AVG', 'ABS', 'ROUND', 'FLOOR', 'CEILING'].includes(fn)) return { ...inferExpr(a[a.length - 1] ?? [], scope), nullable: ['SUM', 'MIN', 'MAX', 'AVG'].includes(fn) || inferExpr(a[0] ?? [], scope).nullable }
    if (STRING_FN.has(fn)) return T_('string', { nullable: fn !== 'CONCAT' && fn !== 'FORMAT' ? a.some((x) => inferExpr(x, scope).nullable) : false })
    if (INT_FN.has(fn)) return T_('int32')
    if (BIGINT_FN.has(fn)) return T_('int64')
    if (DATETIME_FN.has(fn)) return T_('datetime')
    if (fn === 'DATEADD') return { type: inferExpr(a[2] ?? [], scope).type, nullable: false }
    if (fn === 'EOMONTH' || fn === 'DATEFROMPARTS') return T_('date')
    if (fn === 'NEWID' || fn === 'NEWSEQUENTIALID') return T_('guid')
    if (fn === 'SYSDATETIMEOFFSET' || fn === 'TODATETIMEOFFSET' || fn === 'SWITCHOFFSET') return T_('datetimeoffset')
    return { type: { base: 'unknown' }, nullable: true, missing: `${tokText([t0])}()` }
  }
  // CASE … END: tipo do primeiro THEN/ELSE conhecido; anula se não houver ELSE
  if (isW(t0, 'CASE')) {
    const inner = toks.slice(1, -1)
    const results = []
    let hasElse = false
    let depth = 0
    let start = -1
    inner.forEach((t, i) => {
      if (t.v === '(') depth++
      else if (t.v === ')') depth--
      if (depth) return
      if (isW(t, 'CASE')) depth += 1000
      if (isW(t, 'END') && depth >= 1000) depth -= 1000
      if (depth) return
      if (isW(t, 'THEN', 'ELSE')) {
        if (start >= 0) results.push(inner.slice(start, i))
        start = i + 1
        if (t.u === 'ELSE') hasElse = true
      } else if (isW(t, 'WHEN') && start >= 0) {
        results.push(inner.slice(start, i))
        start = -1
      }
    })
    if (start >= 0) results.push(inner.slice(start))
    const typed = results.map((r) => inferExpr(r, scope))
    const known = typed.find((r) => r.type.base !== 'unknown')
    return known ? { type: known.type, nullable: !hasElse || typed.some((r) => r.nullable) } : { type: { base: 'unknown' }, nullable: true, missing: 'CASE' }
  }
  // operações: + com texto vira texto; senão o tipo "mais largo" entre os operandos
  const opAt = []
  findTop(toks, (t) => {
    if (t.t === 'op' && ['+', '-', '*', '/', '%'].includes(t.v)) opAt.push(toks.indexOf(t))
    return false
  })
  if (opAt.length) {
    const operands = []
    let s = 0
    for (const o of opAt) {
      if (o > s) operands.push(toks.slice(s, o))
      s = o + 1
    }
    operands.push(toks.slice(s))
    const typed = operands.filter((x) => x.length).map((x) => inferExpr(x, scope))
    const order = ['string', 'datetimeoffset', 'datetime', 'date', 'float64', 'float32', 'decimal', 'int64', 'int32', 'int16', 'uint8', 'bool']
    const pick = order.find((b) => typed.some((x) => x.type.base === b))
    if (pick) return { type: typed.find((x) => x.type.base === pick).type, nullable: typed.some((x) => x.nullable) }
  }
  return { type: { base: 'unknown' }, nullable: true, missing: tokText(toks).slice(0, 60) }
}

/* ───────── SELECT → colunas ───────── */

function makeScope(tables, vars, extra = new Map()) {
  return {
    tables,
    vars,
    extra,
    aliases: new Map(),
    lookup(alias, col) {
      const lists = alias ? [this.aliases.get(alias)].filter(Boolean) : [...this.aliases.values()]
      for (const a of lists) {
        const f = a.fields?.find((x) => x.name.toUpperCase() === col)
        if (f) return { type: f.type, nullable: f.nullable || a.nullable, from: f }
      }
      return null
    },
    resolve(name) {
      const key = tableKey(name)
      return this.extra.get(key) ?? this.tables.find((t) => (t.kind === 'temp' ? t.name.toUpperCase() : tableKey(t.name)) === key || `@${t.name}`.toUpperCase() === key || t.name.toUpperCase() === key)
    },
  }
}

function itemName(toks) {
  const n = toks.length
  if (n >= 3 && (toks[0].t === 'word' || toks[0].t === 'qid' || toks[0].t === 'string') && toks[1].t === 'op' && toks[1].v === '=' && toks[0].t !== 'var') return { name: unquote(toks[0]), expr: toks.slice(2) }
  if (n >= 3 && isW(toks[n - 2], 'AS')) return { name: unquote(toks[n - 1]), expr: toks.slice(0, -2) }
  const last = toks[n - 1]
  const prev = toks[n - 2]
  if (n >= 2 && (last.t === 'qid' || last.t === 'string' || (last.t === 'word' && !last.kw)) && prev.v !== '.' && prev.t !== 'op' && !isW(prev, 'CASE', 'WHEN', 'THEN', 'ELSE', 'AND', 'OR', 'NOT', 'IS', 'DISTINCT', 'TOP')) return { name: unquote(last), expr: toks.slice(0, -1) }
  if (toks.every((t, i) => (i % 2 === 0 ? t.t === 'word' || t.t === 'qid' : t.v === '.'))) return { name: nameParts([last]).name, expr: toks }
  return { name: null, expr: toks }
}

const unquote = (t) => (t.t === 'string' ? t.v.replace(/^N?'|'$/g, '') : nameParts([t]).name)

export function inferSelect(toks, scope, warn) {
  if (isW(toks[0], 'WITH') && cteAt(toks, 0)) {
    let k = 1
    while (k < toks.length) {
      const name = toks[k++]
      if (toks[k]?.v === '(') k = matchParen(toks, k) + 1
      if (!isW(toks[k], 'AS') || toks[k + 1]?.v !== '(') break
      const close = matchParen(toks, k + 1)
      const cols = inferSelect(toks.slice(k + 2, close), makeScope(scope.tables, scope.vars, scope.extra), warn)
      scope.extra.set(tableKey(nameParts([name]).name), { kind: 'cte', name: nameParts([name]).name, fields: cols })
      k = close + 1
      if (toks[k]?.v === ',') k++
      else break
    }
    toks = toks.slice(k)
  }
  const first = splitSetOps(toks)[0].toks
  const clauses = splitClauses(first, selectClauseAt)
  const sel = clauses.find((c) => c.name === 'SELECT')
  if (!sel) return []
  const from = clauses.find((c) => c.name === 'FROM')
  const local = makeScope(scope.tables, scope.vars, scope.extra)
  if (from) {
    for (const seg of splitJoins(from.toks.slice(1))) {
      const src = seg.src
      if (!src.length) continue
      const nullable = /LEFT|FULL/.test(seg.kw ?? '')
      let fields = null
      let end
      if (src[0].v === '(') {
        end = matchParen(src, 0)
        fields = inferSelect(src.slice(1, end), makeScope(scope.tables, scope.vars, scope.extra), warn)
        end++
      } else {
        end = readName(src, 0)
        if (src[end]?.v === '(') end = matchParen(src, end) + 1
        const { name } = nameParts(src.slice(0, end))
        const tbl = local.resolve(src[0].t === 'temp' || src[0].t === 'var' ? src[0].out ?? src[0].v : name)
        fields = tbl?.fields ?? null
        local.aliases.set(name.toUpperCase(), { fields, nullable })
      }
      if (isW(src[end], 'AS')) end++
      const al = src[end]
      if (al && (al.t === 'qid' || (al.t === 'word' && !al.kw))) local.aliases.set(nameParts([al]).name.toUpperCase(), { fields, nullable })
    }
  }
  let k = 1
  if (isW(sel.toks[k], 'DISTINCT', 'ALL')) k++
  if (isW(sel.toks[k], 'TOP')) {
    k++
    k = sel.toks[k]?.v === '(' ? matchParen(sel.toks, k) + 1 : k + 1
    if (isW(sel.toks[k], 'PERCENT')) k++
    if (isW(sel.toks[k], 'WITH') && isW(sel.toks[k + 1], 'TIES')) k += 2
  }
  const out = []
  splitByComma(sel.toks.slice(k)).forEach((it, idx) => {
    const t = it.toks
    if (!t.length) return
    // * e alias.*
    if (t[t.length - 1].v === '*' && (t.length === 1 || t[t.length - 2].v === '.')) {
      const alias = t.length >= 3 ? nameParts([t[0]]).name.toUpperCase() : null
      const lists = alias ? [local.aliases.get(alias)] : [...new Set(local.aliases.values())]
      let added = false
      for (const a of lists) for (const f of a?.fields ?? []) {
        out.push({ ...f, nullable: f.nullable || a.nullable, pk: false, identity: false, fk: null })
        added = true
      }
      if (!added) warn(`SELECT ${tokText(t)}: as colunas não são conhecidas (a tabela não está no script).`)
      return
    }
    const { name, expr } = itemName(t)
    const r = inferExpr(expr, local)
    const f = { name: name ?? `Coluna${idx + 1}`, type: r.type, nullable: r.nullable, origin: tokText(expr).slice(0, 80) }
    if (!name) warn(`Coluna ${idx + 1} sem nome (${f.origin}); chamada de ${f.name}.`)
    if (r.type.base === 'unknown') f.note = r.missing ? `tipo não identificado: ${r.missing}` : 'tipo não identificado'
    out.push(f)
  })
  return out
}

/* ───────── API ───────── */

export function sqlToModel(input) {
  const { nodes, tokens, warnings: parseWarnings } = parseTsql(input)
  const warnings = parseWarnings.map((w) => w.message)
  const warn = (m) => !warnings.includes(m) && warnings.push(m)
  const tables = collectTables(tokens)
  const vars = collectVars(tokens)
  // colunas calculadas: tipo inferido da expressão sobre as colunas da própria tabela
  for (const t of tables) {
    for (const f of t.fields.filter((x) => x.computedToks)) {
      const scope = makeScope(tables, vars)
      scope.aliases.set(t.name.toUpperCase(), { fields: t.fields.filter((x) => !x.computedToks), nullable: false })
      const r = inferExpr(f.computedToks, scope)
      f.type = r.type.base === 'unknown' ? r.type : { ...r.type, sql: undefined }
      f.nullable = true
      delete f.computedToks
    }
  }

  const classes = tables.map((t) => ({
    kind: t.kind,
    name: t.kind === 'temp' ? t.name.replace(/^#+/, '').replace(/^(temp|tmp)_?/i, '').replace(/^t(?=[A-Z])/, '') || t.name : t.kind === 'tablevar' ? t.name.replace(/^@/, '') : t.name,
    schema: t.schema,
    table: t.kind === 'table' ? t.name : null,
    origin: { table: `tabela ${t.schema ?? 'dbo'}.${t.name}`, temp: `temporária ${t.name}`, tablevar: `variável de tabela ${t.name}`, type: `tipo de tabela ${t.name}` }[t.kind],
    fields: t.fields,
    pk: t.pk,
  }))

  // SELECTs que devolvem dados dentro de procedures
  const visit = (list, proc) => {
    for (const n of list) {
      if (n.k === 'module') {
        if (n.type === 'PROCEDURE') {
          const name = nameParts(n.name).name
          const before = classes.length
          visit(n.body, { name, count: 0 })
          const added = classes.length - before
          if (added === 1) classes[classes.length - 1].name = `${name.replace(/^(pc|sp|usp|proc|prc)_/i, '')}Resultado`
        }
        continue
      }
      if (n.k === 'block') visit(n.body, proc)
      else if (n.k === 'try') {
        visit(n.tryBody, proc)
        visit(n.catchBody, proc)
      } else if (n.k === 'if' || n.k === 'while') visit([n.then, n.els, n.body].filter(Boolean), proc)
      else if (n.k === 'stmt' && proc) {
        const T = n.toks.filter((t) => t.v !== ';')
        const isWith = isW(T[0], 'WITH') && cteAt(T, 0)
        if (!isW(T[0], 'SELECT') && !isWith) continue
        if (isWith) {
          // o WITH precisa terminar num SELECT
          const mainAt = findTopWord(T, 1, ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'])
          if (!isW(T[mainAt], 'SELECT')) continue
        }
        const clauses = splitClauses(T, selectClauseAt)
        if (clauses.some((c) => c.name === 'INTO')) continue
        const sel = clauses.find((c) => c.name === 'SELECT')
        if (sel && sel.toks.slice(1).some((t, i, a) => t.t === 'var' && a[i + 1]?.t === 'op' && a[i + 1].v === '=' && (i === 0 || a[i - 1].v === ','))) continue
        const fields = inferSelect(T, makeScope(tables, vars), warn)
        if (!fields.length) continue
        proc.count++
        const base = proc.name.replace(/^(pc|sp|usp|proc|prc)_/i, '')
        classes.push({ kind: 'result', name: `${base}Resultado${proc.count}`, schema: null, table: null, origin: `resultado ${proc.count} de ${proc.name} (linha ${T[0].line})`, fields, pk: [] })
      }
    }
  }
  visit(nodes, null)

  const unknown = classes.flatMap((c) => c.fields.filter((f) => f.type.base === 'unknown').map((f) => `${c.name}.${f.name}`))
  if (unknown.length) warn(`${unknown.length} campo(s) com tipo não identificado (${unknown.slice(0, 4).join(', ')}${unknown.length > 4 ? '…' : ''}): ficaram como tipo genérico e marcados no código.`)
  if (!classes.length) warn('Nenhuma tabela (CREATE TABLE, DECLARE @t TABLE) nem SELECT de procedure encontrado no script.')
  return { source: 'sql', classes, warnings }
}
