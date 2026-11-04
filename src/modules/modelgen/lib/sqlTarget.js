/**
 * Saída SQL do Model Generator: JSON (ou tabelas já existentes) → T-SQL.
 *
 * JSON → modelo relacional
 *  - o objeto raiz vira uma tabela; objetos aninhados (1:1) viram colunas com prefixo
 *    (endereco.rua → EnderecoRua)
 *  - listas de objetos viram tabelas filhas com FK para a tabela pai; listas de valores
 *    viram uma tabela filha com a coluna Valor
 *  - campo id / codigo não nulo vira a chave primária; sem ele, a tabela ganha
 *    Codigo<Tabela> INT IDENTITY
 *
 * Procedure de carga: recebe @Json, percorre os níveis com OPENJSON e grava tudo numa
 * transação. Quando a chave do pai é IDENTITY, o MERGE ... OUTPUT guarda o par
 * (posição no JSON → chave gerada) numa #tMAPA para ligar os filhos.
 *
 * O texto gerado passa pelo formatador do SQL Forge, então sai no padrão do Pedro.
 */
import { formatTsql } from '../../sqlforge/lib/formatter.js'
import { prepare, todo } from './generators.js'
import { singular, toPascal, toSafe } from './naming.js'

const STEPS = [20, 50, 100, 150, 200, 255, 500, 1000, 4000]
const NATURAL_KEY = /^(id|codigo|cod)$/i

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const pathKey = (k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `"${k.replace(/"/g, '\\"')}"`)

/** Tipo T-SQL de um campo do modelo (o tipo original quando vem de um CREATE TABLE). */
export function sqlTypeOf(f) {
  const t = f.type
  if (t.sql && !t.userType) return t.sql.replace(/\s+/g, ' ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')')
  switch (t.base) {
    case 'bool':
      return 'BIT'
    case 'uint8':
      return 'TINYINT'
    case 'int16':
      return 'SMALLINT'
    case 'int32':
      return 'INT'
    case 'int64':
      return 'BIGINT'
    case 'decimal':
      return `DECIMAL(${t.precision ?? 18}, ${t.scale ?? Math.max(2, f.sampleScale ?? 2)})`
    case 'float32':
      return 'REAL'
    case 'float64':
      return 'FLOAT'
    case 'string': {
      if (t.length) return `VARCHAR(${t.length})`
      if (t.length === null) return 'VARCHAR(MAX)'
      if (!f.sampleMaxLength) return 'VARCHAR(100)'
      const n = STEPS.find((s) => s >= Math.ceil(f.sampleMaxLength * 1.5))
      return n ? `VARCHAR(${n})` : 'VARCHAR(MAX)'
    }
    case 'date':
      return 'DATE'
    case 'datetime':
      return 'DATETIME2(0)'
    case 'datetimeoffset':
      return 'DATETIMEOFFSET(0)'
    case 'time':
      return 'TIME(0)'
    case 'guid':
      return 'UNIQUEIDENTIFIER'
    case 'bytes':
      return 'VARBINARY(MAX)'
    default:
      return 'NVARCHAR(MAX)'
  }
}

/** Converte o texto vindo do JSON para o tipo da coluna. Texto não é convertido: se passar do tamanho, o INSERT acusa. */
function fromJson(expr, c) {
  const b = c.field?.type.base
  if (b === 'string' || b === 'object' || b === 'unknown' || !b) return expr
  if (b === 'datetime' || b === 'datetimeoffset') return `CONVERT(${c.sqlType}, ${expr}, 127)`
  return `CAST(${expr} AS ${c.sqlType})`
}

/* ───────── JSON → tabelas ───────── */

function fromJsonModel(model, o) {
  const byName = new Map(model.classes.map((c) => [c.name, c]))
  const tables = []
  const usedTables = new Set()
  const colName = (n) => (o.naming === 'keep' ? toSafe(n) : toPascal(n))
  const uniqueTable = (n) => {
    let x = n
    for (let i = 2; usedTables.has(x.toUpperCase()); i++) x = `${n}${i}`
    usedTables.add(x.toUpperCase())
    return x
  }
  const uniqueCol = (t, n) => {
    let x = n
    for (let i = 2; t.columns.some((c) => c.name.toUpperCase() === x.toUpperCase()); i++) x = `${n}${i}`
    return x
  }

  function addFields(t, cls, prefix, jsonPrefix, depth, optional, pending) {
    for (const f of cls.fields) {
      const path = `${jsonPrefix}.${pathKey(f.name)}`
      if (f.list) pending.push({ f, path })
      else if (f.ref && byName.get(f.ref) && depth < 4) addFields(t, byName.get(f.ref), prefix + colName(f.name), path, depth + 1, optional || f.nullable, pending)
      else {
        const c = { name: uniqueCol(t, prefix + colName(f.name)), source: f.name, field: f, path, nullable: f.nullable || optional, flat: !!prefix }
        c.sqlType = sqlTypeOf(f)
        c.todo = todo(f)
        t.columns.push(c)
      }
    }
  }

  function build(cls, name, parent, arrayPath, primitive) {
    const t = { name: uniqueTable(name), columns: [], parent, arrayPath, level: parent ? parent.level + 1 : 0, children: [], primitive: !!primitive, origin: cls?.origin }
    tables.push(t)
    if (parent) parent.children.push(t)
    const pending = []
    if (primitive) {
      const c = { name: 'Valor', source: 'valor', field: primitive, path: null, nullable: !!primitive.itemNullable }
      c.sqlType = sqlTypeOf(primitive)
      c.todo = todo(primitive)
      t.columns.push(c)
    } else addFields(t, cls, '', '$', 0, false, pending)

    const natural = t.columns.find((c) => !c.flat && NATURAL_KEY.test(c.source) && !c.nullable && ['int16', 'int32', 'int64', 'guid', 'string'].includes(c.field.type.base))
    if (natural) {
      natural.pk = true
      t.natural = natural
      t.pk = natural
    } else {
      t.pk = { name: uniqueCol(t, `Codigo${t.name}`), sqlType: 'INT', identity: true, pk: true, nullable: false }
      t.columns.unshift(t.pk)
    }
    if (parent) {
      const p = parent.pk
      const fkName = uniqueCol(t, parent.natural && NATURAL_KEY.test(p.name) ? `${p.name}${parent.name}` : p.name)
      t.fk = { name: fkName, sqlType: p.sqlType, nullable: false, fk: { table: parent.name, column: p.name } }
      t.columns.splice(t.columns.indexOf(t.pk) + 1, 0, t.fk)
    }
    for (const { f, path } of pending) {
      const ref = f.ref && byName.get(f.ref)
      if (ref) {
        const childName = usedTables.has(ref.name.toUpperCase()) ? `${t.name}${ref.name}` : ref.name
        build(ref, childName, t, path, null)
      } else build(null, `${t.name}${toPascal(singular(f.name))}`, t, path, f)
    }
    return t
  }

  const root = model.classes[0]
  if (root) build(root, colName(root.name), null, null, null)
  return tables
}

/* ───────── tabelas existentes (fonte SQL) ───────── */

function fromSqlModel(model, o) {
  const props = prepare(model, 'json', o)
  return model.classes
    .map((c, i) => ({ c, props: props[i] }))
    .filter(({ c }) => c.kind === 'table')
    .map(({ c, props: p }) => {
      const t = { name: c.table ?? c.name, schema: c.schema ?? 'dbo', columns: [], existing: true, origin: c.origin }
      c.fields.forEach((f, j) => {
        t.columns.push({
          name: f.name,
          source: p.fields[j].prop,
          field: f,
          path: `$.${pathKey(p.fields[j].prop)}`,
          sqlType: f.computed ? null : sqlTypeOf(f),
          nullable: f.nullable,
          pk: f.pk,
          identity: f.identity,
          computed: f.computed,
          rowversion: f.type.rowversion,
          defaultSql: f.defaultSql,
          fk: f.fk?.table ? { table: f.fk.table, column: f.fk.column } : null,
          todo: todo(f),
        })
      })
      t.pkCols = t.columns.filter((x) => x.pk).map((x) => x.name)
      return t
    })
}

/* ───────── texto T-SQL ───────── */

const qualified = (t) => `${t.schema ?? 'dbo'}.${t.name}`

function createTable(t) {
  const defs = t.columns.map((c) => {
    if (c.computed) return `${c.name} AS ${c.computed}`
    let d = `${c.name} ${c.sqlType}${c.identity ? ' IDENTITY(1, 1)' : ''}${c.nullable ? ' NULL' : ' NOT NULL'}`
    if (c.defaultSql) d += ` DEFAULT ${c.defaultSql}`
    return c.todo ? `${d} -- TODO: ${c.todo}\n` : d
  })
  const pk = t.pkCols ?? (t.pk ? [t.pk.name] : [])
  if (pk.length) defs.push(`CONSTRAINT PK_${t.name} PRIMARY KEY (${pk.join(', ')})`)
  for (const c of t.columns.filter((x) => x.fk)) {
    const ref = c.fk.table.includes('.') ? c.fk.table : `dbo.${c.fk.table}`
    defs.push(`CONSTRAINT FK_${t.name}_${c.fk.table.split('.').pop()}${t.columns.filter((x) => x.fk).length > 1 ? `_${c.name}` : ''} FOREIGN KEY (${c.name}) REFERENCES ${ref} (${c.fk.column ?? c.name})`)
  }
  return `CREATE TABLE ${qualified(t)} (${defs.map((d, i) => (i ? `, ${d}` : d)).join('\n')});`
}

const TRY_OPEN = ['BEGIN TRY']
const CATCH = `END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
/* Se houver tabela de log, grave o erro aqui (depois do ROLLBACK) */
THROW;
END CATCH;
END;
GO`

function procHeader(name, extraComment) {
  return [
    `CREATE OR ALTER PROCEDURE dbo.${name} (@Json NVARCHAR(MAX)) AS BEGIN`,
    'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;',
    'SET NOCOUNT ON;',
    '',
    ...TRY_OPEN,
    ...(extraComment ? [extraComment] : []),
    `IF ISJSON(@Json) = 0 THROW 50000, ${q('O parâmetro @Json não contém um JSON válido.')}, 1;`,
    '',
    '/* Um objeto único vira uma lista de um item: o restante do código trata sempre uma lista */',
    `IF LEFT(LTRIM(@Json), 1) = ${q('{')} SET @Json = CONCAT(${q('[')}, @Json, ${q(']')});`,
  ]
}

/** Procedure que grava o JSON nas tabelas geradas (fonte JSON). */
function loadProcedure(tables, rootName) {
  const name = `pc_Carrega${rootName}`
  const lines = procHeader(name)
  const needMap = tables.filter((t) => !t.natural && t.children.length)
  if (needMap.length) {
    lines.push('', '/* Chave gerada (IDENTITY) de cada registro pai, pela posição dele no JSON */')
    for (const t of needMap) lines.push(`DROP TABLE IF EXISTS #tMAPA${t.name.toUpperCase()};`)
    for (const t of needMap) lines.push(`CREATE TABLE #tMAPA${t.name.toUpperCase()} (ChaveJson VARCHAR(400) NOT NULL PRIMARY KEY, ${t.pk.name} INT NOT NULL);`)
  }
  lines.push('', 'BEGIN TRANSACTION;')

  tables.forEach((t, n) => {
    const chain = []
    for (let x = t; x; x = x.parent) chain.unshift(x)
    const d = chain.length - 1
    const R = (i) => `R${i}`
    const from = [`OPENJSON(@Json) ${R(0)}`]
    for (let i = 1; i <= d; i++) from.push(`CROSS APPLY OPENJSON(${R(i - 1)}.value, ${q(chain[i].arrayPath)}) ${R(i)}`)
    const keyExpr = (lvl) => (lvl === 0 ? `CAST(${R(0)}.[key] AS VARCHAR(400))` : `CONCAT(${Array.from({ length: lvl + 1 }, (_, i) => `${R(i)}.[key]`).join(`, '/', `)})`)
    const cols = []
    const exprs = []
    for (const c of t.columns) {
      if (c.identity) continue
      if (c === t.fk) {
        const p = t.parent
        if (p.natural) exprs.push(fromJson(`JSON_VALUE(${R(d - 1)}.value, ${q(p.natural.path)})`, p.natural))
        else {
          from.push(`INNER JOIN #tMAPA${p.name.toUpperCase()} M ON M.ChaveJson = ${keyExpr(d - 1)}`)
          exprs.push(`M.${p.pk.name}`)
        }
      } else exprs.push(fromJson(c.path ? `JSON_VALUE(${R(d)}.value, ${q(c.path)})` : `${R(d)}.value`, c))
      cols.push(c.name)
    }
    lines.push('', `/* ${n + 1}. ${t.name}${t.level ? ` (filha de ${t.parent.name})` : ''} */`)
    if (!t.natural && t.children.length) {
      const sel = [`${keyExpr(d)} AS ChaveJson`, ...exprs.map((e, i) => `${e} AS ${cols[i]}`)]
      lines.push(
        `MERGE ${qualified(t)} AS Destino USING (SELECT ${sel.join(', ')} FROM ${from.join(' ')}) AS Origem ON 1 = 0`,
        `WHEN NOT MATCHED BY TARGET THEN INSERT (${cols.join(', ')}) VALUES (${cols.map((c) => `Origem.${c}`).join(', ')})`,
        `OUTPUT inserted.${t.pk.name}, Origem.ChaveJson INTO #tMAPA${t.name.toUpperCase()} (${t.pk.name}, ChaveJson);`,
      )
    } else lines.push(`INSERT INTO ${qualified(t)} (${cols.join(', ')}) SELECT ${exprs.join(', ')} FROM ${from.join(' ')};`)
  })
  lines.push('', 'COMMIT TRANSACTION;', CATCH)
  return lines.join('\n')
}

/** Uma procedure de carga por tabela existente (fonte SQL): @Json é uma lista de registros. */
function tableProcedure(t) {
  const lines = procHeader(`pc_Carrega${toPascal(t.name)}`)
  const cols = t.columns.filter((c) => !c.identity && !c.computed && !c.rowversion)
  lines.push('', 'BEGIN TRANSACTION;', '')
  lines.push(`INSERT INTO ${qualified(t)} (${cols.map((c) => c.name).join(', ')}) SELECT ${cols.map((c) => fromJson(`JSON_VALUE(R0.value, ${q(c.path)})`, c)).join(', ')} FROM OPENJSON(@Json) R0;`)
  lines.push('', 'COMMIT TRANSACTION;', CATCH)
  return lines.join('\n')
}

export function generateSql(model, o = {}) {
  const style = ['tables', 'procedure', 'script'].includes(o.style) ? o.style : 'tables'
  const warnings = []
  const isJson = model.source === 'json'
  const tables = isJson ? fromJsonModel(model, o) : fromSqlModel(model, o)
  if (!tables.length) return { files: [], warnings: isJson ? [] : ['Nenhum CREATE TABLE no script: a saída SQL precisa de tabelas (ou de um JSON).'] }
  const rootName = tables[0].name
  if (isJson && tables.some((t) => t.columns.some((c) => c.field?.type.base === 'string' && !c.field.type.length && c.field.sampleMaxLength)))
    warnings.push('Tamanhos de VARCHAR estimados pelo maior texto do exemplo (com folga de 50%): revise antes de criar as tabelas.')
  if (tables.some((t) => t.columns.some((c) => c.field?.type.base === 'string' && /\(MAX\)/.test(c.sqlType ?? '')))) warnings.push('JSON_VALUE devolve no máximo 4.000 caracteres: colunas (MAX) com textos maiores precisam de OPENJSON ... WITH (… AS JSON).')

  const head = isJson
    ? `/* Gerado pelo DevTools Workspace a partir do JSON: ${tables.length} tabela(s), raiz ${rootName}. */`
    : `/* Gerado pelo DevTools Workspace a partir de ${tables.length} tabela(s) do script. */`
  const parts = []
  if (style !== 'procedure') parts.push(tables.map(createTable).join('\n\n'), 'GO')
  if (style !== 'tables') parts.push(isJson ? loadProcedure(tables, rootName) : tables.map(tableProcedure).join('\n\n'))
  const raw = `${head}\n${parts.join('\n\n')}\n`
  const r = formatTsql(raw)
  for (const w of r.warnings) warnings.push(`Formatação: ${w.message}`)
  const fileName = style === 'tables' ? `${rootName}.tabelas.sql` : style === 'procedure' ? `pc_Carrega${isJson ? rootName : ''}.sql`.replace('pc_Carrega.sql', 'procedures.sql') : `${rootName}.sql`
  return { files: [{ name: fileName, content: r.output }], warnings }
}
