/**
 * Geradores de model por linguagem. Todos recebem o mesmo modelo intermediário
 * ({ source, classes: [{ name, kind, schema, table, origin, pk, fields: [...] }] })
 * e devolvem arquivos: [{ name, content }].
 *
 * Tipos base do modelo: bool uint8 int16 int32 int64 decimal float32 float64 string date
 * datetime datetimeoffset time guid bytes object unknown class (referência a outra classe).
 */
import { safeIdent, toCamel, toGoName, toPascal, toSafe, toSnake, uniqueNamer } from './naming.js'

export const LANGUAGES = {
  csharp: {
    label: 'C#',
    styles: { poco: 'Classe (POCO)', ef: 'Entity Framework Core', record: 'record' },
    defaultNamespace: 'Empresa.Modelos',
    ext: 'cs',
  },
  java: {
    label: 'Java',
    styles: { pojo: 'POJO (getters/setters)', lombok: 'Lombok', jpa: 'Entidade JPA', record: 'record' },
    defaultNamespace: 'br.com.empresa.modelos',
    ext: 'java',
  },
  kotlin: { label: 'Kotlin', styles: { data: 'data class', jpa: 'Entidade JPA' }, defaultNamespace: 'br.com.empresa.modelos', ext: 'kt' },
  python: { label: 'Python', styles: { dataclass: 'dataclass', pydantic: 'Pydantic v2', sqlalchemy: 'SQLAlchemy 2.0' }, defaultNamespace: '', ext: 'py' },
  typescript: { label: 'TypeScript', styles: { interface: 'interface', type: 'type', class: 'class', zod: 'Zod schema' }, defaultNamespace: '', ext: 'ts' },
  go: { label: 'Go', styles: { struct: 'struct (json/db)', gorm: 'GORM' }, defaultNamespace: 'modelos', ext: 'go' },
}

const NUMERIC = new Set(['uint8', 'int16', 'int32', 'int64', 'decimal', 'float32', 'float64'])

/* ───────── preparação: nomes por convenção ───────── */

function prepare(model, lang, o) {
  const keep = o.naming === 'keep'
  const classNamer = uniqueNamer()
  const classConv = lang === 'go' ? toGoName : toPascal
  const byOriginal = new Map()
  const classes = model.classes.map((c) => {
    const name = classNamer(safeIdent(keep ? toSafe(c.name) : classConv(c.name), lang))
    byOriginal.set(c.name, name)
    return { ...c, className: name }
  })
  const fieldConv = {
    csharp: toPascal,
    java: toCamel,
    kotlin: toCamel,
    python: toSnake,
    typescript: model.source === 'json' ? (n) => n : toCamel,
    go: toGoName,
  }[lang]
  for (const c of classes) {
    const namer = uniqueNamer()
    c.fields = c.fields.map((f) => {
      let n = keep && lang !== 'go' ? toSafe(f.name) : fieldConv(f.name)
      if (lang === 'go' && keep) n = toGoName(f.name)
      if (lang === 'csharp' && n === c.className) n = `${n}Valor`
      if (lang !== 'typescript') n = safeIdent(n, lang)
      return { ...f, prop: namer(n), source: f.jsonName ?? f.name, ref: f.ref ? byOriginal.get(f.ref) ?? f.ref : null }
    })
  }
  return classes
}

/** Comentário descritivo do campo: tipo SQL e restrições, ou a origem no JSON. */
function meta(f) {
  const parts = []
  if (f.type.sql) parts.push(f.type.sql)
  if (f.pk) parts.push('PK')
  if (f.identity) parts.push('IDENTITY')
  if (f.fk?.table) parts.push(`FK → ${f.fk.table}${f.fk.column ? `.${f.fk.column}` : ''}`)
  if (f.defaultSql) parts.push(`DEFAULT ${f.defaultSql}`)
  if (f.computed) parts.push(`calculada: ${f.computed}`)
  if (f.origin && !f.type.sql) parts.push(`origem: ${f.origin}`)
  return parts.join(' · ')
}

const todo = (f) => (f.type.base === 'unknown' || f.note ? f.note ?? 'tipo não identificado' : null)

function header(model, c, mark = '//') {
  return `${mark} Gerado pelo DevTools Workspace a partir de ${c.origin ?? c.name}.`
}

const fieldComments = (f, o, mark, ind) => {
  const out = []
  const t = todo(f)
  if (t) out.push(`${ind}${mark} TODO: ${t}`)
  if (o.comments) {
    const m = meta(f)
    if (m) out.push(`${ind}${mark} ${m}`)
  }
  return out
}

/* ───────────────────────── C# ───────────────────────── */

const CS = { bool: 'bool', uint8: 'byte', int16: 'short', int32: 'int', int64: 'long', decimal: 'decimal', float32: 'float', float64: 'double', string: 'string', date: 'DateOnly', datetime: 'DateTime', datetimeoffset: 'DateTimeOffset', time: 'TimeOnly', guid: 'Guid', bytes: 'byte[]', object: 'object', unknown: 'object' }
const CS_VALUE = new Set(['bool', 'uint8', 'int16', 'int32', 'int64', 'decimal', 'float32', 'float64', 'date', 'datetime', 'datetimeoffset', 'time', 'guid'])

function csType(f) {
  let t = f.ref ?? CS[f.type.base] ?? 'object'
  if (f.list) t = `List<${t}${f.itemNullable && CS_VALUE.has(f.type.base) ? '?' : ''}>`
  return f.nullable ? `${t}?` : t
}

function csharp(model, o) {
  const classes = prepare(model, 'csharp', o)
  const ns = o.namespace || LANGUAGES.csharp.defaultNamespace
  return classes.map((c) => {
    const usings = new Set()
    const body = []
    const ind = '    '
    const isEf = o.style === 'ef' && model.source === 'sql'
    const jsonAttr = model.source === 'json'
    if (c.fields.some((f) => f.list)) usings.add('System.Collections.Generic')
    if (c.fields.some((f) => ['date', 'datetime', 'datetimeoffset', 'time', 'guid'].includes(f.type.base))) usings.add('System')
    const attrs = []
    if (isEf) {
      usings.add('System.ComponentModel.DataAnnotations')
      usings.add('System.ComponentModel.DataAnnotations.Schema')
      if (c.kind === 'table') attrs.push(`[Table("${c.table}"${c.schema ? `, Schema = "${c.schema}"` : ''})]`)
      if (c.pk.length > 1) {
        usings.add('Microsoft.EntityFrameworkCore')
        attrs.push(`[PrimaryKey(${c.pk.map((p) => `nameof(${c.fields.find((f) => f.name === p)?.prop ?? p})`).join(', ')})]`)
      }
      if (!c.pk.length) {
        usings.add('Microsoft.EntityFrameworkCore')
        attrs.push('[Keyless]')
      }
    }
    if (jsonAttr && c.fields.some((f) => f.prop !== f.source)) usings.add('System.Text.Json.Serialization')

    if (o.style === 'record') {
      body.push(`public record ${c.className}(`)
      c.fields.forEach((f, i) => {
        body.push(...fieldComments(f, o, '//', ind))
        const a = jsonAttr && f.prop !== f.source ? `[property: JsonPropertyName("${f.source}")] ` : ''
        body.push(`${ind}${a}${csType(f)} ${f.prop}${i < c.fields.length - 1 ? ',' : ''}`)
      })
      body.push(');')
    } else {
      body.push(...attrs, `public class ${c.className}`, '{')
      c.fields.forEach((f, i) => {
        if (i > 0 && (isEf || o.comments)) body.push('')
        body.push(...fieldComments(f, o, '//', ind))
        if (isEf) {
          if (f.pk && c.pk.length === 1) body.push(`${ind}[Key]`)
          if (f.identity) body.push(`${ind}[DatabaseGenerated(DatabaseGeneratedOption.Identity)]`)
          if (f.computed) body.push(`${ind}[DatabaseGenerated(DatabaseGeneratedOption.Computed)]`)
          if (f.type.rowversion) body.push(`${ind}[Timestamp]`)
          if (!f.nullable && ['string', 'bytes'].includes(f.type.base) && !f.type.rowversion) body.push(`${ind}[Required]`)
          if (f.type.base === 'string' && f.type.length) body.push(`${ind}[MaxLength(${f.type.length})]`)
          const colArgs = []
          if (f.prop !== f.name) colArgs.push(`"${f.name}"`)
          if (f.type.base === 'decimal' && f.type.sql) colArgs.push(`TypeName = "${f.type.sql.toLowerCase().replace(/\s/g, '')}"`)
          if (colArgs.length) body.push(`${ind}[Column(${colArgs.join(', ')})]`)
        }
        if (jsonAttr && f.prop !== f.source) body.push(`${ind}[JsonPropertyName("${f.source}")]`)
        let init = ''
        if (!f.nullable) {
          if (f.list || f.ref) init = ' = new();'
          else if (f.type.base === 'string') init = ' = string.Empty;'
          else if (f.type.base === 'bytes') init = ' = [];'
        }
        body.push(`${ind}public ${csType(f)} ${f.prop} { get; set; }${init}`)
      })
      body.push('}')
    }
    const content = [header(model, c), ...[...usings].sort((a, b) => (a.startsWith('System') === b.startsWith('System') ? a.localeCompare(b) : a.startsWith('System') ? -1 : 1)).map((u) => `using ${u};`), ...(usings.size ? [''] : []), `namespace ${ns};`, '', ...body, ''].join('\n')
    return { name: `${c.className}.cs`, content }
  })
}

/* ───────────────────────── Java ───────────────────────── */

const JAVA = { bool: ['boolean', 'Boolean'], uint8: ['short', 'Short'], int16: ['short', 'Short'], int32: ['int', 'Integer'], int64: ['long', 'Long'], decimal: 'BigDecimal', float32: ['float', 'Float'], float64: ['double', 'Double'], string: 'String', date: 'LocalDate', datetime: 'LocalDateTime', datetimeoffset: 'OffsetDateTime', time: 'LocalTime', guid: 'UUID', bytes: 'byte[]', object: 'Object', unknown: 'Object' }
const JAVA_IMPORT = { decimal: 'java.math.BigDecimal', date: 'java.time.LocalDate', datetime: 'java.time.LocalDateTime', datetimeoffset: 'java.time.OffsetDateTime', time: 'java.time.LocalTime', guid: 'java.util.UUID' }

function javaType(f, boxed) {
  const m = JAVA[f.type.base] ?? 'Object'
  let t = f.ref ?? (Array.isArray(m) ? m[boxed || f.nullable || f.list ? 1 : 0] : m)
  if (f.list) t = `List<${t}>`
  return t
}

const javaCap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

function java(model, o) {
  const classes = prepare(model, 'java', o)
  const pkg = o.namespace || LANGUAGES.java.defaultNamespace
  const files = []
  const ind = '    '
  for (const c of classes) {
    const imports = new Set()
    const jpa = o.style === 'jpa' && model.source === 'sql' && c.kind === 'table'
    const lombok = o.style === 'lombok'
    const json = model.source === 'json'
    for (const f of c.fields) {
      if (JAVA_IMPORT[f.type.base] && !f.ref) imports.add(JAVA_IMPORT[f.type.base])
      if (f.list) imports.add('java.util.List')
      if (json && f.prop !== f.source) imports.add('com.fasterxml.jackson.annotation.JsonProperty')
    }
    const body = []
    const annos = []
    if (jpa) {
      imports.add('jakarta.persistence.*')
      annos.push('@Entity')
      annos.push(`@Table(name = "${c.table}"${c.schema ? `, schema = "${c.schema}"` : ''})`)
      if (c.pk.length > 1) annos.push(`@IdClass(${c.className}Id.class)`)
    }
    if (lombok) {
      for (const a of ['Data', 'Builder', 'NoArgsConstructor', 'AllArgsConstructor']) imports.add(`lombok.${a}`)
      annos.push('@Data', '@Builder', '@NoArgsConstructor', '@AllArgsConstructor')
    }
    if (o.style === 'record') {
      body.push(`public record ${c.className}(`)
      c.fields.forEach((f, i) => {
        body.push(...fieldComments(f, o, '//', ind))
        const a = json && f.prop !== f.source ? `@JsonProperty("${f.source}") ` : ''
        body.push(`${ind}${a}${javaType(f, false)} ${f.prop}${i < c.fields.length - 1 ? ',' : ''}`)
      })
      body.push(') {', '}')
    } else {
      body.push(...annos, `public class ${c.className} {`, '')
      for (const f of c.fields) {
        body.push(...fieldComments(f, o, '//', ind))
        if (jpa) {
          if (f.pk) body.push(`${ind}@Id`)
          if (f.identity) body.push(`${ind}@GeneratedValue(strategy = GenerationType.IDENTITY)`)
          if (f.type.rowversion) body.push(`${ind}@Version`)
          const col = [`name = "${f.name}"`]
          if (!f.nullable) col.push('nullable = false')
          if (f.type.base === 'string' && f.type.length) col.push(`length = ${f.type.length}`)
          if (f.type.base === 'decimal' && f.type.precision) col.push(`precision = ${f.type.precision}`, `scale = ${f.type.scale ?? 0}`)
          if (f.identity || f.computed || f.type.rowversion) col.push('insertable = false', 'updatable = false')
          body.push(`${ind}@Column(${col.join(', ')})`)
        }
        if (json && f.prop !== f.source) body.push(`${ind}@JsonProperty("${f.source}")`)
        body.push(`${ind}private ${javaType(f, jpa)} ${f.prop};`, '')
      }
      if (!lombok) {
        body.push(`${ind}public ${c.className}() {`, `${ind}}`, '')
        for (const f of c.fields) {
          const t = javaType(f, jpa)
          const getter = `${t === 'boolean' ? 'is' : 'get'}${javaCap(f.prop.replace(/_$/, ''))}`
          body.push(`${ind}public ${t} ${getter}() {`, `${ind}${ind}return ${f.prop};`, `${ind}}`, '')
          body.push(`${ind}public void set${javaCap(f.prop.replace(/_$/, ''))}(${t} ${f.prop}) {`, `${ind}${ind}this.${f.prop} = ${f.prop};`, `${ind}}`, '')
        }
      }
      while (body[body.length - 1] === '') body.pop()
      body.push('}')
    }
    const imp = [...imports].sort()
    files.push({ name: `${c.className}.java`, content: [header(model, c), `package ${pkg};`, '', ...imp.map((i) => `import ${i};`), ...(imp.length ? [''] : []), ...body, ''].join('\n') })

    // chave composta da JPA: classe <Nome>Id com equals/hashCode
    if (jpa && c.pk.length > 1) {
      const keys = c.fields.filter((f) => f.pk)
      const kImports = new Set(['java.io.Serializable', 'java.util.Objects'])
      for (const f of keys) if (JAVA_IMPORT[f.type.base]) kImports.add(JAVA_IMPORT[f.type.base])
      const k = [`public class ${c.className}Id implements Serializable {`, '']
      for (const f of keys) k.push(`${ind}private ${javaType(f, true)} ${f.prop};`)
      k.push('', `${ind}public ${c.className}Id() {`, `${ind}}`, '')
      k.push(`${ind}@Override`, `${ind}public boolean equals(Object o) {`, `${ind}${ind}if (this == o) return true;`, `${ind}${ind}if (!(o instanceof ${c.className}Id other)) return false;`, `${ind}${ind}return ${keys.map((f) => `Objects.equals(${f.prop}, other.${f.prop})`).join(`\n${ind}${ind}${ind}&& `)};`, `${ind}}`, '')
      k.push(`${ind}@Override`, `${ind}public int hashCode() {`, `${ind}${ind}return Objects.hash(${keys.map((f) => f.prop).join(', ')});`, `${ind}}`, '}')
      files.push({ name: `${c.className}Id.java`, content: [`// Chave composta de ${c.className} (${c.pk.join(', ')}).`, `package ${pkg};`, '', ...[...kImports].sort().map((i) => `import ${i};`), '', ...k, ''].join('\n') })
    }
  }
  return files
}

/* ───────────────────────── Kotlin ───────────────────────── */

const KT = { bool: 'Boolean', uint8: 'Short', int16: 'Short', int32: 'Int', int64: 'Long', decimal: 'BigDecimal', float32: 'Float', float64: 'Double', string: 'String', date: 'LocalDate', datetime: 'LocalDateTime', datetimeoffset: 'OffsetDateTime', time: 'LocalTime', guid: 'UUID', bytes: 'ByteArray', object: 'Any', unknown: 'Any' }

function kotlin(model, o) {
  const classes = prepare(model, 'kotlin', o)
  const pkg = o.namespace || LANGUAGES.kotlin.defaultNamespace
  const ind = '    '
  const files = []
  for (const c of classes) {
    const imports = new Set()
    const jpa = o.style === 'jpa' && model.source === 'sql' && c.kind === 'table'
    const json = model.source === 'json'
    const lines = []
    if (jpa) {
      imports.add('jakarta.persistence.*')
      lines.push('@Entity')
      lines.push(`@Table(name = "${c.table}"${c.schema ? `, schema = "${c.schema}"` : ''})`)
      if (c.pk.length > 1) lines.push(`@IdClass(${c.className}Id::class)`)
    }
    lines.push(`${jpa ? 'class' : 'data class'} ${c.className}(`)
    c.fields.forEach((f) => {
      if (JAVA_IMPORT[f.type.base] && !f.ref) imports.add(JAVA_IMPORT[f.type.base])
      lines.push(...fieldComments(f, o, '//', ind))
      if (jpa) {
        if (f.pk) lines.push(`${ind}@Id`)
        if (f.identity) lines.push(`${ind}@GeneratedValue(strategy = GenerationType.IDENTITY)`)
        if (f.type.rowversion) lines.push(`${ind}@Version`)
        const col = [`name = "${f.name}"`]
        if (!f.nullable) col.push('nullable = false')
        if (f.type.base === 'string' && f.type.length) col.push(`length = ${f.type.length}`)
        if (f.type.base === 'decimal' && f.type.precision) col.push(`precision = ${f.type.precision}`, `scale = ${f.type.scale ?? 0}`)
        lines.push(`${ind}@Column(${col.join(', ')})`)
      }
      if (json && f.prop !== f.source) {
        imports.add('com.fasterxml.jackson.annotation.JsonProperty')
        lines.push(`${ind}@JsonProperty("${f.source}")`)
      }
      let t = f.ref ?? KT[f.type.base] ?? 'Any'
      if (f.list) t = `List<${t}>`
      const nullable = f.nullable || (jpa && (f.identity || f.pk))
      lines.push(`${ind}${jpa ? 'var' : 'val'} ${f.prop}: ${t}${nullable ? '? = null' : ''},`)
    })
    lines.push(')')
    if (jpa && c.pk.length > 1) {
      imports.add('java.io.Serializable')
      const keys = c.fields.filter((f) => f.pk)
      lines.push('', `data class ${c.className}Id(`, ...keys.map((f) => `${ind}val ${f.prop}: ${KT[f.type.base] ?? 'Any'}? = null,`), ') : Serializable')
    }
    const imp = [...imports].sort()
    const kHead = jpa ? [header(model, c), '// Requer o plugin kotlin("plugin.jpa") (construtor sem argumentos para a JPA).'] : [header(model, c)]
    files.push({ name: `${c.className}.kt`, content: [...kHead, `package ${pkg}`, '', ...imp.map((i) => `import ${i}`), ...(imp.length ? [''] : []), ...lines, ''].join('\n') })
  }
  return files
}

/* ───────────────────────── Python ───────────────────────── */

const PY = { bool: 'bool', uint8: 'int', int16: 'int', int32: 'int', int64: 'int', decimal: 'Decimal', float32: 'float', float64: 'float', string: 'str', date: 'date', datetime: 'datetime', datetimeoffset: 'datetime', time: 'time', guid: 'UUID', bytes: 'bytes', object: 'Any', unknown: 'Any' }
const PY_IMPORT = { Decimal: ['decimal', 'Decimal'], date: ['datetime', 'date'], datetime: ['datetime', 'datetime'], time: ['datetime', 'time'], UUID: ['uuid', 'UUID'] }

function saType(f, need) {
  const t = f.type
  const s = (n) => (need.add(n), n)
  switch (t.base) {
    case 'bool':
      return s('Boolean')
    case 'uint8':
    case 'int16':
      return s('SmallInteger')
    case 'int32':
      return s('Integer')
    case 'int64':
      return s('BigInteger')
    case 'decimal':
      return `${s('Numeric')}(${t.precision ?? 18}, ${t.scale ?? 0})`
    case 'float32':
    case 'float64':
      return s('Float')
    case 'string': {
      const uni = /^N/.test(t.sql ?? '')
      if (!t.length) return s(uni ? 'UnicodeText' : 'Text')
      return `${s(uni ? 'Unicode' : 'String')}(${t.length})`
    }
    case 'date':
      return s('Date')
    case 'datetime':
      return s('DateTime')
    case 'datetimeoffset':
      return `${s('DateTime')}(timezone=True)`
    case 'time':
      return s('Time')
    case 'guid':
      return s('Uuid')
    case 'bytes':
      return s('LargeBinary')
    default:
      return s('String')
  }
}

function python(model, o) {
  const classes = prepare(model, 'python', o)
  const from = new Map() // módulo → Set(nomes)
  const imp = (mod, name) => {
    if (!from.has(mod)) from.set(mod, new Set())
    from.get(mod).add(name)
  }
  const sa = new Set()
  const ind = '    '
  const blocks = []
  const json = model.source === 'json'
  let needBase = false
  const order = json ? [...classes].reverse() : classes

  for (const c of order) {
    const style = o.style === 'sqlalchemy' && (model.source !== 'sql' || c.kind !== 'table') ? 'dataclass' : o.style
    const lines = [`# ${(c.origin ?? c.name).replace(/^./, (x) => x.toUpperCase())}${style !== o.style ? ' (não é tabela: gerado como dataclass)' : ''}`]
    const pyType = (f) => {
      let t = f.ref ?? PY[f.type.base] ?? 'Any'
      if (t === 'Any') imp('typing', 'Any')
      if (PY_IMPORT[t]) imp(...PY_IMPORT[t])
      if (f.list) {
        imp('typing', 'List')
        t = `List[${t}]`
      }
      if (f.nullable) {
        imp('typing', 'Optional')
        t = `Optional[${t}]`
      }
      return t
    }
    if (style === 'dataclass') {
      imp('dataclasses', 'dataclass')
      lines.push('@dataclass', `class ${c.className}:`)
      // campos obrigatórios antes dos opcionais (exigência do dataclass)
      const fields = [...c.fields.filter((f) => !f.nullable), ...c.fields.filter((f) => f.nullable)]
      if (!fields.length) lines.push(`${ind}pass`)
      for (const f of fields) {
        lines.push(...fieldComments(f, o, '#', ind))
        if (json && f.prop !== f.source && !o.comments) lines.push(`${ind}# JSON: "${f.source}"`)
        lines.push(`${ind}${f.prop}: ${pyType(f)}${f.nullable ? ' = None' : ''}`)
      }
    } else if (style === 'pydantic') {
      imp('pydantic', 'BaseModel')
      lines.push(`class ${c.className}(BaseModel):`)
      if (c.fields.some((f) => f.prop !== f.source)) {
        imp('pydantic', 'ConfigDict')
        lines.push(`${ind}model_config = ConfigDict(populate_by_name=True)`, '')
      }
      if (!c.fields.length) lines.push(`${ind}pass`)
      for (const f of c.fields) {
        lines.push(...fieldComments(f, o, '#', ind))
        const args = []
        if (f.nullable) args.push('default=None')
        if (f.prop !== f.source) args.push(`alias="${f.source}"`)
        if (f.type.base === 'string' && f.type.length) args.push(`max_length=${f.type.length}`)
        if (f.type.base === 'decimal' && f.type.precision) args.push(`max_digits=${f.type.precision}`, `decimal_places=${f.type.scale ?? 0}`)
        if (args.length) imp('pydantic', 'Field')
        const val = args.length ? ` = Field(${args.join(', ')})` : f.nullable ? ' = None' : ''
        lines.push(`${ind}${f.prop}: ${pyType(f)}${val}`)
      }
    } else {
      needBase = true
      imp('sqlalchemy.orm', 'Mapped')
      imp('sqlalchemy.orm', 'mapped_column')
      lines.push(`class ${c.className}(Base):`, `${ind}__tablename__ = "${c.table}"`)
      if (c.schema) lines.push(`${ind}__table_args__ = {"schema": "${c.schema}"}`)
      if (!c.pk.length) lines.push(`${ind}# ATENÇÃO: tabela sem chave primária; o SQLAlchemy exige uma para mapear.`)
      lines.push('')
      for (const f of c.fields) {
        lines.push(...fieldComments(f, o, '#', ind))
        const args = [`"${f.name}"`, saType(f, sa)]
        if (f.fk?.table && f.fk.column) {
          sa.add('ForeignKey')
          args.push(`ForeignKey("${f.fk.table}.${f.fk.column}")`)
        }
        if (f.pk) args.push('primary_key=True')
        if (f.identity) args.push('autoincrement=True')
        if (!f.nullable && !f.pk) args.push('nullable=False')
        lines.push(`${ind}${f.prop}: Mapped[${pyType(f)}] = mapped_column(${args.join(', ')})`)
      }
    }
    blocks.push(lines.join('\n'))
  }
  if (sa.size) for (const n of sa) imp('sqlalchemy', n)
  if (needBase) imp('sqlalchemy.orm', 'DeclarativeBase')
  const importLines = ['from __future__ import annotations', '']
  const std = ['dataclasses', 'datetime', 'decimal', 'typing', 'uuid']
  const sortMods = (mods) => mods.sort().map((m) => `from ${m} import ${[...from.get(m)].sort().join(', ')}`)
  const stdMods = [...from.keys()].filter((m) => std.includes(m))
  const extMods = [...from.keys()].filter((m) => !std.includes(m))
  importLines.push(...sortMods(stdMods))
  if (extMods.length) importLines.push('', ...sortMods(extMods))
  const parts = [`# Gerado pelo DevTools Workspace (${classes.length} classe${classes.length === 1 ? '' : 's'}).\n${importLines.join('\n')}`]
  if (needBase) parts.push('class Base(DeclarativeBase):\n    pass')
  parts.push(...blocks)
  return [{ name: 'models.py', content: `${parts.join('\n\n\n')}\n` }]
}

/* ───────────────────────── TypeScript ───────────────────────── */

const TS = { bool: 'boolean', uint8: 'number', int16: 'number', int32: 'number', int64: 'number', decimal: 'number', float32: 'number', float64: 'number', string: 'string', date: 'string', datetime: 'string', datetimeoffset: 'string', time: 'string', guid: 'string', bytes: 'string', object: 'unknown', unknown: 'unknown' }

const tsKey = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`)

function zodOf(f, json) {
  let z
  if (f.ref) z = `${f.ref}Schema`
  else {
    const b = f.type.base
    if (b === 'bool') z = 'z.boolean()'
    else if (['uint8', 'int16', 'int32', 'int64'].includes(b)) z = 'z.number().int()'
    else if (NUMERIC.has(b)) z = 'z.number()'
    else if (b === 'string') z = f.type.length ? `z.string().max(${f.type.length})` : 'z.string()'
    else if (b === 'datetime' || b === 'datetimeoffset') z = 'z.string().datetime({ offset: true })'
    else if (b === 'guid') z = 'z.string().uuid()'
    else if (['date', 'time', 'bytes'].includes(b)) z = 'z.string()'
    else z = 'z.unknown()'
  }
  if (f.list) z = `z.array(${z})`
  if (f.nullable) z += '.nullable()'
  if (f.nullable && json) z += '.optional()'
  return z
}

function typescript(model, o) {
  const classes = prepare(model, 'typescript', o)
  const ind = '  '
  const json = model.source === 'json'
  const order = json ? [...classes].reverse() : classes
  const blocks = []
  const tsType = (f) => {
    let t = f.ref ?? TS[f.type.base] ?? 'unknown'
    if (f.list) t = `${t}[]`
    return f.nullable ? `${t} | null` : t
  }
  for (const c of order) {
    const lines = [`/** ${(c.origin ?? c.name).replace(/^./, (x) => x.toUpperCase())} */`]
    const fieldLines = (f, sep) => {
      const out = fieldComments(f, o, '//', ind)
      if (['date', 'datetime', 'datetimeoffset', 'time'].includes(f.type.base) && !o.comments && o.style !== 'zod') out.push(`${ind}// ISO 8601`)
      return out
    }
    if (o.style === 'zod') {
      lines.push(`export const ${c.className}Schema = z.object({`)
      for (const f of c.fields) lines.push(...fieldLines(f), `${ind}${tsKey(f.prop)}: ${zodOf(f, json)},`)
      lines.push('});', `export type ${c.className} = z.infer<typeof ${c.className}Schema>;`)
    } else if (o.style === 'class') {
      lines.push(`export class ${c.className} {`)
      for (const f of c.fields) lines.push(...fieldLines(f), `${ind}${tsKey(f.prop)}${f.nullable ? '' : '!'}: ${tsType(f)}${f.nullable ? ' = null' : ''};`)
      lines.push('}')
    } else {
      lines.push(o.style === 'type' ? `export type ${c.className} = {` : `export interface ${c.className} {`)
      for (const f of c.fields) lines.push(...fieldLines(f), `${ind}${tsKey(f.prop)}${json && f.nullable ? '?' : ''}: ${tsType(f)};`)
      lines.push(o.style === 'type' ? '};' : '}')
    }
    blocks.push(lines.join('\n'))
  }
  const head = [`// Gerado pelo DevTools Workspace (${classes.length} ${classes.length === 1 ? 'tipo' : 'tipos'}).`]
  if (o.style === 'zod') head.push("import { z } from 'zod';")
  return [{ name: o.style === 'zod' ? 'schemas.ts' : 'models.ts', content: `${head.join('\n')}\n\n${blocks.join('\n\n')}\n` }]
}

/* ───────────────────────── Go ───────────────────────── */

const GO = { bool: 'bool', uint8: 'uint8', int16: 'int16', int32: 'int32', int64: 'int64', decimal: 'decimal.Decimal', float32: 'float32', float64: 'float64', string: 'string', date: 'time.Time', datetime: 'time.Time', datetimeoffset: 'time.Time', time: 'time.Time', guid: 'string', bytes: '[]byte', object: 'any', unknown: 'any' }

function go(model, o) {
  const classes = prepare(model, 'go', o)
  const pkg = o.namespace || LANGUAGES.go.defaultNamespace
  const json = model.source === 'json'
  const imports = new Set()
  const blocks = []
  const gorm = o.style === 'gorm' && model.source === 'sql'
  for (const c of classes) {
    const rows = c.fields.map((f) => {
      let t = f.ref ?? GO[f.type.base] ?? 'any'
      if (t.startsWith('time.')) imports.add('time')
      if (t.startsWith('decimal.')) imports.add('github.com/shopspring/decimal')
      if (f.list) t = `[]${t}`
      else if (f.nullable && !['any', '[]byte'].includes(t)) t = `*${t}`
      const jsonName = json ? f.source : toCamel(f.name)
      const tags = [`json:"${jsonName}${f.nullable ? ',omitempty' : ''}"`]
      if (model.source === 'sql') {
        if (gorm) {
          const g = [`column:${f.name}`]
          if (f.pk) g.push('primaryKey')
          if (f.identity) g.push('autoIncrement')
          if (!f.nullable && !f.pk) g.push('not null')
          if (f.type.base === 'string' && f.type.length) g.push(`size:${f.type.length}`)
          if (f.type.base === 'decimal' && f.type.precision) g.push(`type:decimal(${f.type.precision},${f.type.scale ?? 0})`)
          tags.push(`gorm:"${g.join(';')}"`)
        } else tags.push(`db:"${f.name}"`)
      }
      return { f, name: f.prop, type: t, tag: `\`${tags.join(' ')}\`` }
    })
    const wn = Math.max(0, ...rows.map((r) => r.name.length))
    const wt = Math.max(0, ...rows.map((r) => r.type.length))
    const lines = [`// ${c.className} representa ${c.origin ?? c.name}.`, `type ${c.className} struct {`]
    for (const r of rows) {
      lines.push(...fieldComments(r.f, o, '//', '\t'))
      lines.push(`\t${r.name.padEnd(wn)} ${r.type.padEnd(wt)} ${r.tag}`)
    }
    lines.push('}')
    if (gorm && c.kind === 'table') lines.push('', `// TableName informa ao GORM o nome real da tabela.`, `func (${c.className}) TableName() string {`, `\treturn "${c.schema ? `${c.schema}.` : ''}${c.table}"`, '}')
    blocks.push(lines.join('\n'))
  }
  const imp = [...imports].sort((a, b) => (a.includes('.') === b.includes('.') ? a.localeCompare(b) : a.includes('.') ? 1 : -1))
  let importBlock = ''
  if (imp.length === 1) importBlock = `import "${imp[0]}"\n\n`
  else if (imp.length) {
    const std = imp.filter((i) => !i.includes('.'))
    const ext = imp.filter((i) => i.includes('.'))
    importBlock = `import (\n${std.map((i) => `\t"${i}"`).join('\n')}${std.length && ext.length ? '\n\n' : ''}${ext.map((i) => `\t"${i}"`).join('\n')}\n)\n\n`
  }
  return [{ name: 'models.go', content: `// Gerado pelo DevTools Workspace (${classes.length} struct${classes.length === 1 ? '' : 's'}).\npackage ${pkg}\n\n${importBlock}${blocks.join('\n\n')}\n` }]
}

const GENERATORS = { csharp, java, kotlin, python, typescript, go }

export function generate(model, language, options = {}) {
  const lang = LANGUAGES[language] ? language : 'csharp'
  const styles = Object.keys(LANGUAGES[lang].styles)
  const o = { naming: 'convention', comments: true, ...options, style: styles.includes(options.style) ? options.style : styles[0] }
  if (!model.classes.length) return []
  return GENERATORS[lang](model, o)
}
