/**
 * Lexer SQL: converte o script em tokens com posição (linha/coluna).
 *
 * Tipos: word (identificador/palavra-chave), qident (identificador delimitado),
 *        number, string, punct ( ( ) , ; . ), op (demais símbolos), batch (GO), eof
 */
export class SqlLexError extends Error {
  constructor(message, pos, line, col) {
    super(message)
    this.pos = pos
    this.line = line
    this.col = col
  }
}

export function tokenize(sql, dialect) {
  const tokens = []
  const n = sql.length
  let i = 0
  let line = 1
  let lineStart = 0

  const push = (type, value, start, extra = {}) =>
    tokens.push({ type, value, upper: type === 'word' ? value.toUpperCase() : value, pos: start, line: startLine, col: start - startLineStart + 1, end: i, ...extra })
  let startLine = 1
  let startLineStart = 0

  const advance = (to) => {
    for (let k = i; k < to; k++) {
      if (sql.charCodeAt(k) === 10) {
        line++
        lineStart = k + 1
      }
    }
    i = to
  }
  const err = (msg) => {
    throw new SqlLexError(msg, i, startLine, i - startLineStart + 1)
  }

  while (i < n) {
    const c = sql[i]
    startLine = line
    startLineStart = lineStart
    // espaços
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      advance(i + 1)
      continue
    }
    // comentários
    if (c === '-' && sql[i + 1] === '-') {
      const e = sql.indexOf('\n', i)
      advance(e === -1 ? n : e)
      continue
    }
    if (c === '#' && dialect.hashComments) {
      const e = sql.indexOf('\n', i)
      advance(e === -1 ? n : e)
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      let depth = 0
      let k = i
      while (k < n) {
        if (sql[k] === '/' && sql[k + 1] === '*') {
          depth++
          k += 2
          if (!dialect.nestedComments && depth > 1) depth = 1
          continue
        }
        if (sql[k] === '*' && sql[k + 1] === '/') {
          depth--
          k += 2
          if (depth === 0) break
          continue
        }
        k++
      }
      if (depth !== 0) err('Comentário /* não fechado')
      advance(k)
      continue
    }
    const start = i
    // strings ('...' com '' de escape; N'...' do SQL Server; E'...' do Postgres)
    if (c === "'" || ((c === 'N' || c === 'n' || c === 'E' || c === 'e') && sql[i + 1] === "'")) {
      let k = c === "'" ? i + 1 : i + 2
      let value = ''
      while (true) {
        if (k >= n) err('String não fechada (falta aspas simples)')
        if (sql[k] === "'") {
          if (sql[k + 1] === "'") {
            value += "'"
            k += 2
            continue
          }
          break
        }
        value += sql[k++]
      }
      advance(k + 1)
      push('string', value, start)
      continue
    }
    // dollar quoting do Postgres ($$ ... $$ / $tag$ ... $tag$)
    if (c === '$' && dialect.dollarQuotes) {
      const m = sql.slice(i).match(/^\$[A-Za-z_]*\$/)
      if (m) {
        const close = sql.indexOf(m[0], i + m[0].length)
        if (close === -1) err(`Bloco ${m[0]} não fechado`)
        const value = sql.slice(i + m[0].length, close)
        advance(close + m[0].length)
        push('string', value, start)
        continue
      }
    }
    // identificadores delimitados
    if (dialect.identQuotes[c]) {
      const close = dialect.identQuotes[c]
      let k = i + 1
      let value = ''
      while (true) {
        if (k >= n) err(`Identificador ${c}… não fechado (falta ${close})`)
        if (sql[k] === close) {
          if (sql[k + 1] === close) {
            value += close
            k += 2
            continue
          }
          break
        }
        value += sql[k++]
      }
      advance(k + 1)
      push('qident', value, start)
      continue
    }
    // números
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      const m = sql.slice(i).match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/)
      advance(i + m[0].length)
      push('number', m[0], start)
      continue
    }
    // palavras (inclui @variaveis e #temp do SQL Server)
    if (/[A-Za-z_@#À-￿]/.test(c)) {
      const m = sql.slice(i).match(/^[A-Za-z_@#À-￿][\w@#$À-￿]*/)
      advance(i + m[0].length)
      // GO sozinho na linha = separador de lote (SQL Server)
      if (dialect.batchSeparator && m[0].toUpperCase() === dialect.batchSeparator) {
        const before = sql.slice(startLineStart, start).trim()
        const lineEnd = sql.indexOf('\n', i)
        const after = sql.slice(i, lineEnd === -1 ? n : lineEnd).trim()
        if (!before && (!after || /^\d+$/.test(after) || after.startsWith('--'))) {
          push('batch', m[0], start)
          continue
        }
      }
      push('word', m[0], start)
      continue
    }
    if ('(),;.'.includes(c)) {
      advance(i + 1)
      push('punct', c, start)
      continue
    }
    // operadores (inclui :: do Postgres)
    const two = sql.slice(i, i + 2)
    if (['::', '<=', '>=', '<>', '!=', '||'].includes(two)) {
      advance(i + 2)
      push('op', two, start)
      continue
    }
    advance(i + 1)
    push('op', c, start)
  }
  startLine = line
  startLineStart = lineStart
  push('eof', '', n)
  return tokens
}
