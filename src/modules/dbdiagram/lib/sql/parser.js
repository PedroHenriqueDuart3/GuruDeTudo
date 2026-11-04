import { getDialect } from './dialects.js'
import { SqlLexError, tokenize } from './lexer.js'

/**
 * Parser SQL (descida recursiva) → AST de DDL.
 *
 * Nós da AST:
 *   { type: 'createTable', name: QName, columns: ColumnDef[], constraints: TableConstraint[], loc }
 *   { type: 'alterTable', name: QName, actions: [{ kind: 'addConstraint', constraint } | { kind: 'addColumn', column }], loc }
 *   { type: 'createIndex', name, unique, table: QName, columns: string[], loc }
 *   QName = { schema, name, parts: string[] }
 *   ColumnDef = { name, dataType: { name, args }, nullable, primaryKey, unique, identity, default, references, check, computed, loc }
 *   TableConstraint = { kind: 'primaryKey'|'foreignKey'|'unique'|'check'|'index', name, columns, references, loc }
 *
 * Instruções não-DDL (INSERT, SET, USE, procedures…) são ignoradas com segurança;
 * erros num CREATE TABLE não impedem a leitura dos demais (recuperação por instrução).
 */
export class SqlParseError extends Error {
  constructor(message, token) {
    super(message)
    this.token = token
  }
}

const TYPE_CONTINUATIONS = new Set(['PRECISION', 'VARYING', 'UNSIGNED', 'SIGNED', 'ZEROFILL', 'WITHOUT', 'WITH', 'TIME', 'ZONE', 'LOCAL'])
const COLUMN_STOP = new Set([
  'CONSTRAINT', 'PRIMARY', 'NOT', 'NULL', 'UNIQUE', 'IDENTITY', 'AUTO_INCREMENT', 'AUTOINCREMENT', 'DEFAULT', 'REFERENCES',
  'FOREIGN', 'CHECK', 'COLLATE', 'GENERATED', 'AS', 'COMMENT', 'ON', 'SPARSE', 'ROWGUIDCOL', 'PERSISTED', 'KEY', 'CHARACTER', 'CHARSET',
])
const REF_ACTIONS = ['CASCADE', 'RESTRICT', 'NO ACTION', 'SET NULL', 'SET DEFAULT']

class TokenStream {
  constructor(tokens) {
    this.t = tokens
    this.i = 0
  }
  peek(o = 0) {
    return this.t[Math.min(this.i + o, this.t.length - 1)]
  }
  next() {
    const tok = this.t[this.i]
    if (this.i < this.t.length - 1) this.i++
    return tok
  }
  isWord(...words) {
    const p = this.peek()
    return p.type === 'word' && words.includes(p.upper)
  }
  isPunct(v) {
    const p = this.peek()
    return p.type === 'punct' && p.value === v
  }
  acceptWord(...words) {
    if (this.isWord(...words)) return this.next()
    return null
  }
  acceptPunct(v) {
    if (this.isPunct(v)) return this.next()
    return null
  }
  expectWord(word, context) {
    const tok = this.peek()
    if (!this.acceptWord(word)) throw new SqlParseError(`Esperado ${word}${context ? ` ${context}` : ''}, encontrado ${describe(tok)}`, tok)
    return tok
  }
  expectPunct(v, context) {
    const tok = this.peek()
    if (!this.acceptPunct(v)) throw new SqlParseError(`Esperado "${v}"${context ? ` ${context}` : ''}, encontrado ${describe(tok)}`, tok)
    return tok
  }
  atStatementEnd() {
    const p = this.peek()
    return p.type === 'eof' || p.type === 'batch' || (p.type === 'punct' && p.value === ';')
  }
}

function describe(tok) {
  if (tok.type === 'eof') return 'fim do script'
  if (tok.type === 'batch') return 'GO'
  if (tok.type === 'string') return `'${tok.value}'`
  return `"${tok.value}"`
}

const loc = (tok) => ({ line: tok.line, col: tok.col, pos: tok.pos })

export function parseSql(sql, dialectId = 'sqlserver') {
  const dialect = getDialect(dialectId)
  const result = { statements: [], errors: [], warnings: [], skipped: 0 }
  let tokens
  try {
    tokens = tokenize(sql, dialect)
  } catch (err) {
    if (err instanceof SqlLexError) {
      result.errors.push({ message: err.message, line: err.line, col: err.col })
      return result
    }
    throw err
  }
  const ts = new TokenStream(tokens)
  const p = new Parser(ts, dialect, result)

  while (ts.peek().type !== 'eof') {
    const start = ts.peek()
    if (start.type === 'batch' || (start.type === 'punct' && start.value === ';')) {
      ts.next()
      continue
    }
    try {
      const stmt = p.statement()
      if (stmt) result.statements.push(stmt)
    } catch (err) {
      if (!(err instanceof SqlParseError)) throw err
      const tok = err.token ?? ts.peek()
      result.errors.push({ message: err.message, line: tok.line, col: tok.col, statementLine: start.line })
      p.recover()
    }
  }
  return result
}

class Parser {
  constructor(ts, dialect, result) {
    this.ts = ts
    this.d = dialect
    this.result = result
  }

  /** Pula até o fim da instrução atual (";" ou GO no nível 0 de parênteses). */
  recover({ untilBatch = false } = {}) {
    let depth = 0
    const ts = this.ts
    const startIndex = ts.i
    while (true) {
      const tok = ts.peek()
      if (tok.type === 'eof' || tok.type === 'batch') return
      if (tok.type === 'punct') {
        if (tok.value === '(') depth++
        else if (tok.value === ')') depth = Math.max(0, depth - 1)
        else if (tok.value === ';' && depth === 0 && !untilBatch) {
          ts.next()
          return
        }
      }
      // um novo CREATE/ALTER no início da linha encerra a instrução quebrada
      // (exige ter avançado ao menos um token, para nunca ficar parado no mesmo lugar)
      if (!untilBatch && depth === 0 && ts.i > startIndex && tok.type === 'word' && (tok.upper === 'CREATE' || tok.upper === 'ALTER') && tok.col === 1) return
      ts.next()
    }
  }

  statement() {
    const ts = this.ts
    const first = ts.peek()
    if (ts.isWord('CREATE')) {
      const save = ts.i
      ts.next()
      ts.acceptWord('OR')
      if (ts.isWord('REPLACE', 'ALTER')) ts.next()
      // modificadores de tabela temporária / tipo
      while (ts.isWord('TEMPORARY', 'TEMP', 'GLOBAL', 'LOCAL', 'UNLOGGED')) ts.next()
      if (ts.isWord('TABLE')) {
        ts.next()
        return this.createTable(first)
      }
      if (ts.isWord('UNIQUE', 'CLUSTERED', 'NONCLUSTERED', 'INDEX')) return this.createIndex(first)
      if (ts.isWord(...this.d.blockStatements)) {
        // corpo de procedure/view pode conter CREATE TABLE #temp: ignora até o fim do lote
        this.result.skipped++
        this.recover({ untilBatch: !!this.d.batchSeparator })
        return null
      }
      ts.i = save
    }
    if (ts.isWord('ALTER') && ts.peek(1).upper === 'TABLE') {
      ts.next()
      ts.next()
      return this.alterTable(first)
    }
    this.result.skipped++
    this.recover()
    return null
  }

  qname() {
    const ts = this.ts
    const parts = [this.ident('nome')]
    while (ts.isPunct('.')) {
      ts.next()
      // "db..tabela" (schema omitido)
      if (ts.isPunct('.')) continue
      parts.push(this.ident('nome'))
    }
    const name = parts[parts.length - 1]
    const schema = parts.length > 1 ? parts[parts.length - 2] : null
    return { name, schema, parts }
  }

  ident(what = 'identificador') {
    const tok = this.ts.peek()
    if (tok.type === 'word' || tok.type === 'qident') {
      this.ts.next()
      return tok.value
    }
    throw new SqlParseError(`Esperado ${what}, encontrado ${describe(tok)}`, tok)
  }

  identList() {
    const ts = this.ts
    ts.expectPunct('(', 'antes da lista de colunas')
    const cols = []
    do {
      cols.push(this.ident('nome de coluna'))
      ts.acceptWord('ASC', 'DESC')
      // MySQL: KEY (col(10))
      if (ts.isPunct('(')) this.skipParens()
    } while (ts.acceptPunct(','))
    ts.expectPunct(')', 'ao fechar a lista de colunas')
    return cols
  }

  /** Pula um bloco entre parênteses balanceados e devolve o texto bruto. */
  skipParens() {
    const ts = this.ts
    const open = ts.expectPunct('(')
    let depth = 1
    const parts = []
    while (depth > 0) {
      const tok = ts.next()
      if (tok.type === 'eof') throw new SqlParseError('Parêntese "(" sem fechamento', open)
      if (tok.type === 'punct' && tok.value === '(') depth++
      if (tok.type === 'punct' && tok.value === ')') depth--
      if (depth > 0) parts.push(tok.type === 'string' ? `'${tok.value}'` : tok.value)
    }
    return parts.join(' ').replace(/ \( /g, '(').replace(/ \)/g, ')').replace(/ , /g, ', ')
  }

  createTable(startTok) {
    const ts = this.ts
    if (ts.acceptWord('IF')) {
      ts.expectWord('NOT')
      ts.expectWord('EXISTS')
    }
    const name = this.qname()
    const table = { type: 'createTable', name, columns: [], constraints: [], loc: loc(startTok) }
    if (ts.isWord('AS')) throw new SqlParseError('CREATE TABLE … AS SELECT não define colunas explicitamente', ts.peek())
    ts.expectPunct('(', `após o nome da tabela ${name.name}`)
    if (ts.isPunct(')')) throw new SqlParseError(`Tabela ${name.name} sem colunas`, ts.peek())
    do {
      if (ts.isPunct(')')) break // vírgula sobrando antes de ")" — tolerado
      if (this.isTableConstraintStart()) table.constraints.push(this.tableConstraint())
      else if (ts.isWord('PERIOD')) this.skipUntilElementEnd()
      else if (ts.isWord('LIKE')) this.skipUntilElementEnd()
      else table.columns.push(this.columnDef())
    } while (ts.acceptPunct(','))
    ts.expectPunct(')', `ao fechar a definição de ${name.name} (vírgula faltando?)`)
    // opções após a tabela: WITH (...), ON [PRIMARY], ENGINE=InnoDB, TEXTIMAGE_ON...
    while (!ts.atStatementEnd() && !(ts.isWord('CREATE', 'ALTER') && ts.peek().col === 1)) {
      if (ts.isPunct('(')) this.skipParens()
      else ts.next()
    }
    return table
  }

  isTableConstraintStart() {
    const ts = this.ts
    if (ts.isWord('CONSTRAINT', 'PRIMARY', 'FOREIGN', 'CHECK')) return true
    if (ts.isWord('UNIQUE')) return ts.peek(1).type === 'punct' || ['KEY', 'INDEX', 'CLUSTERED', 'NONCLUSTERED'].includes(ts.peek(1).upper) || ts.peek(2).value === '('
    if (ts.isWord('INDEX', 'KEY', 'FULLTEXT', 'SPATIAL')) {
      // MySQL: INDEX idx (col) ; mas "key" também pode ser nome de coluna: "key VARCHAR(10)"
      const n1 = ts.peek(1)
      return n1.type === 'punct' || ts.peek(2).value === '(' || ['INDEX', 'KEY'].includes(n1.upper)
    }
    return false
  }

  skipUntilElementEnd() {
    const ts = this.ts
    while (!ts.isPunct(',') && !ts.isPunct(')') && ts.peek().type !== 'eof') {
      if (ts.isPunct('(')) this.skipParens()
      else ts.next()
    }
  }

  references() {
    const ts = this.ts
    const tok = ts.expectWord('REFERENCES')
    const table = this.qname()
    let columns = null
    if (ts.isPunct('(')) columns = this.identList()
    const ref = { table, columns, onDelete: null, onUpdate: null, loc: loc(tok) }
    while (true) {
      if (ts.isWord('ON') && ['DELETE', 'UPDATE'].includes(ts.peek(1).upper)) {
        ts.next()
        const which = ts.next().upper
        let action = ts.next().upper
        if ((action === 'NO' || action === 'SET') && ts.peek().type === 'word') action = `${action} ${ts.next().upper}`
        if (!REF_ACTIONS.includes(action)) throw new SqlParseError(`Ação referencial inválida "${action}"`, ts.peek(-1))
        if (which === 'DELETE') ref.onDelete = action
        else ref.onUpdate = action
        continue
      }
      if (ts.isWord('NOT') && ts.peek(1).upper === 'FOR') {
        ts.next()
        ts.next()
        ts.acceptWord('REPLICATION')
        continue
      }
      if (ts.isWord('MATCH')) {
        ts.next()
        ts.next()
        continue
      }
      if (ts.isWord('DEFERRABLE', 'INITIALLY', 'DEFERRED', 'IMMEDIATE')) {
        ts.next()
        continue
      }
      break
    }
    return ref
  }

  tableConstraint() {
    const ts = this.ts
    const start = ts.peek()
    let name = null
    if (ts.acceptWord('CONSTRAINT')) name = this.ident('nome da constraint')
    if (ts.acceptWord('PRIMARY')) {
      ts.expectWord('KEY', 'após PRIMARY')
      ts.acceptWord('CLUSTERED', 'NONCLUSTERED')
      const columns = this.identList()
      this.skipIndexOptions()
      return { kind: 'primaryKey', name, columns, loc: loc(start) }
    }
    if (ts.acceptWord('FOREIGN')) {
      ts.expectWord('KEY', 'após FOREIGN')
      if (ts.peek().type !== 'punct') this.ident() // MySQL: FOREIGN KEY nome (col)
      const columns = this.identList()
      const references = this.references()
      if (references.columns && references.columns.length !== columns.length)
        throw new SqlParseError(`FOREIGN KEY com ${columns.length} coluna(s) referencia ${references.columns.length} coluna(s)`, start)
      return { kind: 'foreignKey', name, columns, references, loc: loc(start) }
    }
    if (ts.acceptWord('UNIQUE')) {
      ts.acceptWord('KEY', 'INDEX')
      ts.acceptWord('CLUSTERED', 'NONCLUSTERED')
      if (ts.peek().type !== 'punct') name = name ?? this.ident()
      const columns = this.identList()
      this.skipIndexOptions()
      return { kind: 'unique', name, columns, loc: loc(start) }
    }
    if (ts.acceptWord('CHECK')) {
      ts.acceptWord('NOT')
      ts.acceptWord('FOR')
      ts.acceptWord('REPLICATION')
      const expr = this.skipParens()
      return { kind: 'check', name, expression: expr, loc: loc(start) }
    }
    if (ts.acceptWord('INDEX', 'KEY', 'FULLTEXT', 'SPATIAL')) {
      ts.acceptWord('INDEX', 'KEY')
      let idxName = null
      if (ts.peek().type !== 'punct') idxName = this.ident()
      const columns = this.identList()
      this.skipIndexOptions()
      return { kind: 'index', name: idxName, columns, loc: loc(start) }
    }
    if (ts.isWord('DEFAULT')) {
      // SQL Server: CONSTRAINT DF_x DEFAULT (0) FOR coluna
      ts.next()
      this.defaultExpr()
      ts.acceptWord('FOR') && this.ident()
      return { kind: 'default', name, loc: loc(start) }
    }
    throw new SqlParseError(`Constraint inválida: ${describe(ts.peek())}`, ts.peek())
  }

  skipIndexOptions() {
    const ts = this.ts
    while (ts.isWord('WITH', 'ON', 'USING', 'COMMENT', 'TEXTIMAGE_ON', 'INCLUDE')) {
      ts.next()
      if (ts.isPunct('(')) this.skipParens()
      else if (!ts.isPunct(',') && !ts.isPunct(')')) ts.next()
    }
  }

  dataType() {
    const ts = this.ts
    const tok = ts.peek()
    if (tok.type !== 'word' && tok.type !== 'qident') throw new SqlParseError(`Tipo de dado esperado, encontrado ${describe(tok)}`, tok)
    let name = this.qname().parts.join('.')
    while (ts.peek().type === 'word' && TYPE_CONTINUATIONS.has(ts.peek().upper)) {
      // "WITH TIME ZONE" só é tipo se for seguido de TIME
      if (ts.isWord('WITH', 'WITHOUT') && ts.peek(1).upper !== 'TIME') break
      name += ` ${ts.next().value}`
    }
    let args = []
    if (ts.isPunct('(')) {
      ts.next()
      while (!ts.isPunct(')')) {
        const a = ts.next()
        if (a.type === 'eof') throw new SqlParseError(`Parêntese do tipo ${name} sem fechamento`, a)
        if (a.type !== 'punct' || a.value !== ',') args.push(a.type === 'string' ? `'${a.value}'` : a.value)
      }
      ts.next()
    }
    // arrays do Postgres: int[]
    while (ts.peek().type === 'op' && ts.peek().value === '[') {
      ts.next()
      if (ts.peek().type === 'number') ts.next()
      if (ts.peek().value === ']') ts.next()
      name += '[]'
    }
    return { name, args }
  }

  defaultExpr() {
    const ts = this.ts
    const parts = []
    let depth = 0
    while (true) {
      const tok = ts.peek()
      if (tok.type === 'eof' || tok.type === 'batch') break
      if (depth === 0 && tok.type === 'punct' && (tok.value === ',' || tok.value === ')' || tok.value === ';')) break
      if (depth === 0 && tok.type === 'word' && COLUMN_STOP.has(tok.upper) && parts.length) break
      if (tok.type === 'punct' && tok.value === '(') depth++
      if (tok.type === 'punct' && tok.value === ')') depth--
      ts.next()
      parts.push(tok.type === 'string' ? `'${tok.value}'` : tok.value)
    }
    return parts.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')')
  }

  columnDef() {
    const ts = this.ts
    const start = ts.peek()
    const name = this.ident('nome de coluna')
    const col = {
      name,
      dataType: null,
      nullable: null,
      primaryKey: false,
      unique: false,
      identity: false,
      default: null,
      references: null,
      check: null,
      computed: null,
      loc: loc(start),
    }
    // coluna computada do SQL Server: Total AS (Preco * Qtd)
    if (ts.isWord('AS')) {
      ts.next()
      col.computed = ts.isPunct('(') ? this.skipParens() : this.defaultExpr()
      col.dataType = { name: 'computed', args: [] }
    } else {
      col.dataType = this.dataType()
      if (this.d.serialTypes?.includes(col.dataType.name.toUpperCase())) col.identity = true
    }
    let pendingConstraintName = null
    while (!ts.isPunct(',') && !ts.isPunct(')')) {
      const tok = ts.peek()
      if (tok.type === 'eof' || tok.type === 'batch') throw new SqlParseError(`Definição da coluna ${name} não terminou (falta ")"?)`, tok)
      if (ts.acceptWord('CONSTRAINT')) {
        pendingConstraintName = this.ident('nome da constraint')
        continue
      }
      if (ts.acceptWord('NOT')) {
        if (ts.acceptWord('NULL')) col.nullable = false
        else if (ts.acceptWord('FOR')) ts.acceptWord('REPLICATION')
        else throw new SqlParseError(`Esperado NULL após NOT na coluna ${name}`, ts.peek())
        continue
      }
      if (ts.acceptWord('NULL')) {
        col.nullable = true
        continue
      }
      if (ts.acceptWord('PRIMARY')) {
        ts.expectWord('KEY', 'após PRIMARY')
        ts.acceptWord('CLUSTERED', 'NONCLUSTERED')
        ts.acceptWord('ASC', 'DESC')
        col.primaryKey = true
        col.pkName = pendingConstraintName
        continue
      }
      if (ts.acceptWord('UNIQUE')) {
        ts.acceptWord('KEY')
        ts.acceptWord('CLUSTERED', 'NONCLUSTERED')
        col.unique = true
        continue
      }
      if (ts.isWord('KEY')) {
        ts.next() // MySQL "KEY" isolado = PRIMARY KEY
        col.primaryKey = true
        continue
      }
      if (ts.acceptWord('IDENTITY')) {
        col.identity = true
        if (ts.isPunct('(')) col.identitySpec = this.skipParens()
        continue
      }
      if (ts.acceptWord('AUTO_INCREMENT', 'AUTOINCREMENT')) {
        col.identity = true
        continue
      }
      if (ts.acceptWord('GENERATED')) {
        ts.acceptWord('ALWAYS')
        if (ts.acceptWord('BY')) ts.expectWord('DEFAULT')
        ts.expectWord('AS')
        if (ts.acceptWord('IDENTITY')) {
          col.identity = true
          if (ts.isPunct('(')) this.skipParens()
        } else if (ts.isPunct('(')) {
          col.computed = this.skipParens()
          ts.acceptWord('STORED', 'VIRTUAL')
        }
        continue
      }
      if (ts.acceptWord('DEFAULT')) {
        col.default = this.defaultExpr()
        continue
      }
      if (ts.isWord('REFERENCES')) {
        col.references = { ...this.references(), constraintName: pendingConstraintName }
        continue
      }
      if (ts.acceptWord('FOREIGN')) {
        ts.expectWord('KEY')
        col.references = { ...this.references(), constraintName: pendingConstraintName }
        continue
      }
      if (ts.acceptWord('CHECK')) {
        ts.acceptWord('NOT')
        ts.acceptWord('FOR')
        ts.acceptWord('REPLICATION')
        col.check = this.skipParens()
        continue
      }
      if (ts.acceptWord('COLLATE')) {
        this.ident('collation')
        continue
      }
      if (ts.acceptWord('COMMENT')) {
        if (ts.peek().type === 'string') col.comment = ts.next().value
        continue
      }
      if (ts.acceptWord('CHARACTER', 'CHARSET')) {
        ts.acceptWord('SET')
        this.ident()
        continue
      }
      if (ts.isWord('PERSISTED', 'SPARSE', 'ROWGUIDCOL', 'FILESTREAM', 'UNSIGNED', 'ZEROFILL', 'BINARY', 'ON', 'STORED', 'VIRTUAL', 'MASKED', 'HIDDEN')) {
        ts.next()
        if (ts.isWord('UPDATE')) {
          ts.next()
          this.defaultExpr()
        }
        continue
      }
      if (ts.isPunct('(')) {
        this.skipParens()
        continue
      }
      throw new SqlParseError(`Opção desconhecida ${describe(tok)} na coluna ${name}`, tok)
    }
    return col
  }

  createIndex(startTok) {
    const ts = this.ts
    const unique = !!ts.acceptWord('UNIQUE')
    ts.acceptWord('CLUSTERED', 'NONCLUSTERED')
    ts.expectWord('INDEX')
    ts.acceptWord('CONCURRENTLY')
    if (ts.acceptWord('IF')) {
      ts.expectWord('NOT')
      ts.expectWord('EXISTS')
    }
    const name = this.ident('nome do índice')
    ts.expectWord('ON')
    const table = this.qname()
    if (ts.acceptWord('USING')) this.ident()
    const columns = this.identList()
    this.recover()
    return { type: 'createIndex', name, unique, table, columns, loc: loc(startTok) }
  }

  alterTable(startTok) {
    const ts = this.ts
    ts.acceptWord('ONLY')
    if (ts.acceptWord('IF')) ts.expectWord('EXISTS')
    const name = this.qname()
    const stmt = { type: 'alterTable', name, actions: [], loc: loc(startTok) }
    if (ts.acceptWord('WITH')) ts.acceptWord('CHECK', 'NOCHECK')
    if (ts.acceptWord('ADD')) {
      do {
        ts.acceptWord('COLUMN')
        if (this.isTableConstraintStart()) stmt.actions.push({ kind: 'addConstraint', constraint: this.tableConstraint() })
        else stmt.actions.push({ kind: 'addColumn', column: this.columnDef() })
      } while (ts.acceptPunct(',') && !ts.atStatementEnd())
    }
    // demais formas (CHECK CONSTRAINT, DROP, ALTER COLUMN…) não afetam o diagrama
    this.recover()
    return stmt.actions.length ? stmt : null
  }
}
