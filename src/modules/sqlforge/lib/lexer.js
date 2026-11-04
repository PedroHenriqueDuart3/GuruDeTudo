/**
 * Lexer T-SQL do SQL Forge.
 *
 * Diferente do lexer do Database Diagram, este preserva os comentários: cada token guarda
 *  - lead:  comentários que vêm antes dele (em linhas próprias ou no meio da instrução)
 *  - trail: comentários na mesma linha, logo depois dele
 * e as quebras de linha que o antecedem (para manter linhas em branco entre blocos).
 *
 * Tipos: word · qid ([x] / "x") · var (@x, @@x) · temp (#x, ##x) · string · number · op · punct
 */

const isSpace = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿'
const isDigit = (c) => c >= '0' && c <= '9'
const isIdentStart = (c) => /[\p{L}_]/u.test(c)
const isIdentPart = (c) => /[\p{L}\p{N}_@$#]/u.test(c)

const MULTI_OPS = ['<>', '!=', '>=', '<=', '!<', '!>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::']

export function lex(src) {
  const toks = []
  const n = src.length
  let i = 0
  let line = 1
  let nl = 0 // quebras de linha desde o último token ou comentário
  let pending = []
  let last = null
  let lineStart = 0

  const comment = (kind, text, startLine, col) => {
    const c = { kind, text, nl, line: startLine, col }
    if (last && nl === 0 && pending.length === 0) last.trail.push(c)
    else pending.push(c)
    nl = 0
  }

  const push = (t, v, startLine) => {
    const tok = { t, v, u: t === 'word' || t === 'var' ? v.toUpperCase() : v, nl, line: startLine, lead: pending, trail: [], i: toks.length }
    toks.push(tok)
    pending = []
    nl = 0
    last = tok
    return tok
  }

  while (i < n) {
    const c = src[i]
    if (c === '\n') {
      nl++
      line++
      i++
      lineStart = i
      continue
    }
    if (isSpace(c)) {
      i++
      continue
    }
    const startLine = line

    // comentário de linha
    if (c === '-' && src[i + 1] === '-') {
      let j = src.indexOf('\n', i)
      if (j < 0) j = n
      comment('line', src.slice(i + 2, j).replace(/\s+$/, ''), startLine, i - lineStart)
      i = j
      continue
    }
    // comentário de bloco (T-SQL permite aninhar)
    if (c === '/' && src[i + 1] === '*') {
      let depth = 1
      let j = i + 2
      while (j < n && depth > 0) {
        if (src[j] === '/' && src[j + 1] === '*') {
          depth++
          j += 2
        } else if (src[j] === '*' && src[j + 1] === '/') {
          depth--
          j += 2
        } else {
          if (src[j] === '\n') line++
          j++
        }
      }
      comment('block', src.slice(i, j), startLine, i - lineStart)
      const lastNl = src.lastIndexOf('\n', j - 1)
      if (lastNl >= i) lineStart = lastNl + 1
      i = j
      continue
    }
    // strings: '...' e N'...'
    if (c === "'" || ((c === 'N' || c === 'n') && src[i + 1] === "'")) {
      let j = c === "'" ? i + 1 : i + 2
      while (j < n) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            j += 2
            continue
          }
          break
        }
        if (src[j] === '\n') line++
        j++
      }
      const raw = src.slice(i, Math.min(n, j + 1))
      push('string', c === 'n' ? `N${raw.slice(1)}` : raw, startLine)
      i = j + 1
      continue
    }
    // identificadores delimitados
    if (c === '[') {
      let j = i + 1
      while (j < n) {
        if (src[j] === ']') {
          if (src[j + 1] === ']') {
            j += 2
            continue
          }
          break
        }
        j++
      }
      push('qid', src.slice(i, j + 1), startLine)
      i = j + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < n && src[j] !== '"') j++
      push('qid', src.slice(i, j + 1), startLine)
      i = j + 1
      continue
    }
    // variáveis e tabelas temporárias
    if (c === '@' || c === '#') {
      let j = i + 1
      while (j < n && (src[j] === c || isIdentPart(src[j]))) j++
      push(c === '@' ? 'var' : 'temp', src.slice(i, j), startLine)
      i = j
      continue
    }
    // números (inclui 0x…, 1.5, .5, 1e10)
    const prevIsName = last && (last.t === 'word' || last.t === 'qid' || last.v === ')')
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? '') && !prevIsName)) {
      const m = /^(0x[0-9a-f]*|\d*\.?\d+(?:e[+-]?\d+)?|\d+\.?(?:e[+-]?\d+)?)/i.exec(src.slice(i, i + 64))
      push('number', m[0], startLine)
      i += m[0].length
      continue
    }
    // palavras ($action, $identity também)
    if (isIdentStart(c) || (c === '$' && isIdentStart(src[i + 1] ?? ''))) {
      let j = i + 1
      while (j < n && isIdentPart(src[j])) j++
      push('word', src.slice(i, j), startLine)
      i = j
      continue
    }
    const two = src.slice(i, i + 2)
    if (MULTI_OPS.includes(two)) {
      push('op', two, startLine)
      i += 2
      continue
    }
    if ('(),.;:'.includes(c)) {
      push('punct', c, startLine)
      i++
      continue
    }
    push('op', c, startLine)
    i++
  }

  return { tokens: toks, eofComments: pending }
}
