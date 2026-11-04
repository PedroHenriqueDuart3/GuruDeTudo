import { getDialect } from './sql/dialects.js'
import { parseSql } from './sql/parser.js'

/**
 * AST → modelo do diagrama.
 *
 * Table   = { id, name, schema, columns: Column[], pk: string[], uniques: string[][], loc }
 * Column  = { name, type, pk, fk, unique, notNull, identity, default, check, computed }
 * Relation= { id, name, from: { table, columns }, to: { table, columns }, onDelete, onUpdate,
 *             cardinality: { kind: 'one-to-one'|'many-to-one', childOptional, parentOptional } }
 */
export function buildSchema(sql, dialectId = 'sqlserver') {
  const dialect = getDialect(dialectId)
  const parsed = parseSql(sql, dialectId)
  const warnings = [...parsed.warnings]
  const tables = new Map()
  const pendingFks = []

  const keyOf = (qn) => {
    const schema = qn.schema ?? dialect.defaultSchema
    return `${schema ? `${schema.toLowerCase()}.` : ''}${qn.name.toLowerCase()}`
  }
  const findTable = (qn) => tables.get(keyOf(qn)) ?? [...tables.values()].find((t) => t.name.toLowerCase() === qn.name.toLowerCase())

  const typeText = (dt) => (dt.args.length ? `${dt.name}(${dt.args.join(', ')})` : dt.name)

  for (const stmt of parsed.statements) {
    if (stmt.type !== 'createTable') continue
    const id = keyOf(stmt.name)
    if (tables.has(id)) warnings.push({ message: `Tabela ${stmt.name.name} definida mais de uma vez; a última definição foi usada.`, line: stmt.loc.line })
    const t = {
      id,
      name: stmt.name.name,
      schema: stmt.name.schema ?? dialect.defaultSchema,
      columns: [],
      pk: [],
      uniques: [],
      checks: [],
      loc: stmt.loc,
    }
    const seen = new Set()
    for (const c of stmt.columns) {
      if (seen.has(c.name.toLowerCase())) warnings.push({ message: `Coluna ${c.name} duplicada em ${t.name}.`, line: c.loc.line })
      seen.add(c.name.toLowerCase())
      t.columns.push({
        name: c.name,
        type: typeText(c.dataType),
        pk: c.primaryKey,
        fk: false,
        unique: c.unique,
        notNull: c.nullable === false || c.primaryKey,
        identity: c.identity,
        default: c.default,
        check: c.check,
        computed: c.computed,
        loc: c.loc,
      })
      if (c.primaryKey) t.pk.push(c.name)
      if (c.unique) t.uniques.push([c.name])
      if (c.references) pendingFks.push({ table: t, columns: [c.name], ref: c.references, name: c.references.constraintName, loc: c.loc })
    }
    for (const k of stmt.constraints) applyConstraint(t, k)
    tables.set(id, t)
  }

  function colOf(t, name) {
    return t.columns.find((c) => c.name.toLowerCase() === name.toLowerCase())
  }

  function applyConstraint(t, k, line) {
    const missing = (k.columns ?? []).filter((c) => !colOf(t, c))
    if (missing.length && k.kind !== 'check') {
      warnings.push({ message: `Constraint em ${t.name} usa coluna inexistente: ${missing.join(', ')}.`, line: k.loc?.line ?? line })
    }
    if (k.kind === 'primaryKey') {
      if (t.pk.length) warnings.push({ message: `Tabela ${t.name} com mais de uma PRIMARY KEY.`, line: k.loc?.line })
      t.pk = k.columns.map((c) => colOf(t, c)?.name ?? c)
      for (const c of k.columns) {
        const col = colOf(t, c)
        if (col) {
          col.pk = true
          col.notNull = true
        }
      }
    } else if (k.kind === 'unique') {
      t.uniques.push(k.columns)
      if (k.columns.length === 1) {
        const col = colOf(t, k.columns[0])
        if (col) col.unique = true
      }
    } else if (k.kind === 'foreignKey') {
      pendingFks.push({ table: t, columns: k.columns, ref: k.references, name: k.name, loc: k.loc })
    } else if (k.kind === 'check') {
      t.checks.push(k.expression)
    }
  }

  // ALTER TABLE … ADD CONSTRAINT / ADD COLUMN e CREATE UNIQUE INDEX
  for (const stmt of parsed.statements) {
    if (stmt.type === 'alterTable') {
      const t = findTable(stmt.name)
      if (!t) {
        warnings.push({ message: `ALTER TABLE em tabela não declarada: ${stmt.name.name}.`, line: stmt.loc.line })
        continue
      }
      for (const a of stmt.actions) {
        if (a.kind === 'addConstraint') applyConstraint(t, a.constraint, stmt.loc.line)
        else if (a.kind === 'addColumn') {
          const c = a.column
          t.columns.push({ name: c.name, type: typeText(c.dataType), pk: c.primaryKey, fk: false, unique: c.unique, notNull: c.nullable === false, identity: c.identity, default: c.default })
          if (c.references) pendingFks.push({ table: t, columns: [c.name], ref: c.references, loc: c.loc })
        }
      }
    } else if (stmt.type === 'createIndex' && stmt.unique) {
      const t = findTable(stmt.table)
      if (t) {
        t.uniques.push(stmt.columns)
        if (stmt.columns.length === 1) {
          const col = colOf(t, stmt.columns[0])
          if (col) col.unique = true
        }
      }
    }
  }

  // Resolve as foreign keys depois que todas as tabelas existem (ordem do script não importa)
  const relations = []
  for (const fk of pendingFks) {
    const target = findTable(fk.ref.table)
    if (!target) {
      warnings.push({ message: `${fk.table.name}.${fk.columns.join(', ')} referencia a tabela inexistente ${fk.ref.table.name}.`, line: fk.loc?.line })
      continue
    }
    const toCols = fk.ref.columns ?? target.pk
    if (!toCols.length) {
      warnings.push({ message: `${fk.table.name} referencia ${target.name}, que não tem PRIMARY KEY nem colunas explícitas.`, line: fk.loc?.line })
      continue
    }
    const missingTo = toCols.filter((c) => !colOf(target, c))
    if (missingTo.length) warnings.push({ message: `FK de ${fk.table.name} aponta para coluna inexistente ${target.name}.${missingTo.join(', ')}.`, line: fk.loc?.line })
    const fromCols = fk.columns.map((c) => colOf(fk.table, c)?.name ?? c)
    for (const c of fromCols) {
      const col = colOf(fk.table, c)
      if (col) col.fk = true
    }
    // cardinalidade: FK coincidindo com PK/UNIQUE → 1:1; senão N:1
    const same = (a, b) => a.length === b.length && a.every((x) => b.some((y) => y.toLowerCase() === x.toLowerCase()))
    const isUnique = same(fromCols, fk.table.pk) || fk.table.uniques.some((u) => same(fromCols, u))
    const nullable = fromCols.some((c) => colOf(fk.table, c) && !colOf(fk.table, c).notNull)
    relations.push({
      id: `${fk.table.id}:${fromCols.join(',')}->${target.id}`,
      name: fk.name ?? `FK_${fk.table.name}_${target.name}`,
      from: { table: fk.table.id, columns: fromCols },
      to: { table: target.id, columns: toCols.map((c) => colOf(target, c)?.name ?? c) },
      onDelete: fk.ref.onDelete,
      onUpdate: fk.ref.onUpdate,
      selfRef: fk.table.id === target.id,
      cardinality: { kind: isUnique ? 'one-to-one' : 'many-to-one', parentOptional: nullable },
    })
  }

  return {
    tables: [...tables.values()],
    relations,
    errors: parsed.errors,
    warnings,
    stats: { statements: parsed.statements.length, skipped: parsed.skipped },
  }
}
