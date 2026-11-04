/**
 * SQL Forge — formatador T-SQL no padrão do Pedro Henrique.
 *
 * Pipeline (sem regex de reescrita: tudo é feito sobre tokens e colunas):
 *   1. lex()         tokens com comentários anexados (lexer.js)
 *   2. normalize()   MAIÚSCULAS, colchetes, #tNOME, inserted/deleted, nomes de CTE
 *   3. Parser        árvore de blocos: BEGIN/END, TRY/CATCH, IF/ELSE, WHILE, módulos
 *                    (PROCEDURE, VIEW, FUNCTION, TRIGGER) e instruções simples — o fim de
 *                    cada instrução é detectado mesmo sem ";"
 *   4. transforms    regras do padrão que mudam a estrutura: remove XACT_ABORT, troca
 *                    IF OBJECT_ID(...) DROP por DROP TABLE IF EXISTS, garante o DROP antes
 *                    de criar temporárias
 *   5. Renderer      cada cláusula é posicionada pelo "rio": a palavra-chave termina na
 *                    coluna N+6 e o conteúdo começa em N+8; vírgulas à esquerda; listas
 *                    entre parênteses com vírgula sob o "("; "=" alinhados
 *   6. verificação   o resultado é relexado e comparado ao original (identificadores,
 *                    literais e comentários) para garantir que nada se perdeu
 */
import { lex } from './lexer.js'
import { ASSIGNMENT, COMPARISON, FUNCTION_ONLY, FUNCTIONS, KEYWORDS, NO_SPACE_PAREN, STMT_START, TABLE_HINTS } from './keywords.js'

export const DEFAULT_OPTIONS = { qualifyDbo: true, renameTemp: true, stripBrackets: true }

/* ───────────────────────── utilidades ───────────────────────── */

const pad = (n) => ' '.repeat(Math.max(0, n))
const isW = (t, ...ws) => !!t && t.t === 'word' && (ws.length === 0 || ws.includes(t.u))
const M1 = '\u0001'
const M2 = '\u0002'

/** Comentário dentro de uma linha: "--" vira marcador e só continua "--" se terminar a linha. */
const cm = (c) => (c.kind === 'line' ? `${M1}${c.text}${M2}` : c.text.replace(/\s*\n\s*/g, ' '))

function piece(t) {
  let s = t.out ?? t.v
  if (t.lead.length) s = `${t.lead.map(cm).join(' ')} ${s}`
  if (t.trail.length) s += ` ${t.trail.map(cm).join(' ')}`
  return s
}

const marks = (...toks) =>
  toks
    .filter(Boolean)
    .flatMap((t) => [...t.lead, ...t.trail])
    .map(cm)
    .join(' ')

function withMarks(text, ...toks) {
  const m = marks(...toks)
  return m ? `${text} ${m}` : text
}

function takeLead(t) {
  if (!t || !t.lead.length) return []
  const l = t.lead
  t.lead = []
  return l
}

function mk(word, t = 'word') {
  return { t, v: word, u: word.toUpperCase(), out: word, kw: t === 'word', lead: [], trail: [], nl: 0, synthetic: true }
}

function matchParen(toks, k) {
  let d = 0
  for (let j = k; j < toks.length; j++) {
    if (toks[j].v === '(' && toks[j].t === 'punct') d++
    else if (toks[j].v === ')' && toks[j].t === 'punct') {
      d--
      if (d === 0) return j
    }
  }
  return -1
}

function matchCase(toks, k) {
  let d = 0
  for (let j = k; j < toks.length; j++) {
    if (isW(toks[j], 'CASE')) d++
    else if (isW(toks[j], 'END')) {
      d--
      if (d === 0) return j
    }
  }
  return -1
}

/** Percorre os tokens no nível 0 (fora de parênteses e de CASE … END). */
function forTop(toks, from, fn) {
  let depth = 0
  let caseD = 0
  for (let k = from; k < toks.length; k++) {
    const t = toks[k]
    if (t.t === 'punct' && t.v === '(') {
      depth++
      continue
    }
    if (t.t === 'punct' && t.v === ')') {
      depth--
      continue
    }
    if (depth > 0) continue
    if (isW(t, 'CASE')) {
      caseD++
      continue
    }
    if (isW(t, 'END') && caseD > 0) {
      caseD--
      continue
    }
    if (caseD > 0) continue
    if (fn(t, k) === true) return k
  }
  return -1
}

function findTopWord(toks, from, words) {
  const k = forTop(toks, from, (t) => isW(t, ...words))
  return k < 0 ? toks.length : k
}

function findTop(toks, pred, from = 0) {
  return forTop(toks, from, (t) => pred(t))
}

/** Divide por vírgulas do nível 0. A vírgula leva seus comentários: os da linha anterior ficam no item anterior. */
function splitByComma(toks) {
  const items = []
  let cur = { toks: [], trailing: [], commaLead: [] }
  let depth = 0
  let caseD = 0
  for (const t of toks) {
    if (t.t === 'punct' && t.v === '(') depth++
    else if (t.t === 'punct' && t.v === ')') depth--
    else if (depth === 0 && isW(t, 'CASE')) caseD++
    else if (depth === 0 && caseD > 0 && isW(t, 'END')) caseD--
    if (depth === 0 && caseD === 0 && t.t === 'punct' && t.v === ',') {
      cur.trailing = t.trail
      items.push(cur)
      cur = { toks: [], trailing: [], commaLead: t.lead }
      continue
    }
    cur.toks.push(t)
  }
  if (cur.toks.length || items.length) items.push(cur)
  return items
}

function prepOwn(items) {
  items.forEach((it, idx) => {
    if (idx > 0 && !it.own) it.own = [...it.commaLead, ...takeLead(it.toks[0])]
  })
}

/** Separa cláusulas: isStart(toks, k) devolve o nome da cláusula que começa em k. */
function splitClauses(toks, isStart) {
  const out = []
  let cur = null
  let depth = 0
  let caseD = 0
  toks.forEach((t, k) => {
    if (depth === 0 && caseD === 0 && t.t === 'word') {
      const name = isStart(toks, k)
      if (name) {
        cur = { name, toks: [] }
        out.push(cur)
      }
    }
    if (!cur) {
      cur = { name: null, toks: [] }
      out.push(cur)
    }
    cur.toks.push(t)
    if (t.t === 'punct' && t.v === '(') depth++
    else if (t.t === 'punct' && t.v === ')') depth--
    else if (depth === 0 && isW(t, 'CASE')) caseD++
    else if (depth === 0 && caseD > 0 && isW(t, 'END')) caseD--
  })
  return out
}

function readName(toks, k) {
  const t = toks[k]
  if (!t || !['word', 'qid', 'var', 'temp'].includes(t.t)) return k
  k++
  while (toks[k]?.v === '.') {
    k++
    if (toks[k] && (toks[k].t === 'word' || toks[k].t === 'qid' || toks[k].t === 'temp')) k++
  }
  return k
}

/** WITH em k inicia uma CTE (e não uma dica de tabela / opção)? */
export function cteAt(toks, k) {
  const nx = toks[k + 1]
  if (!nx) return false
  if (isW(nx, 'XMLNAMESPACES')) return true
  if (!(nx.t === 'qid' || (nx.t === 'word' && !KEYWORDS.has(nx.u)))) return false
  const nx2 = toks[k + 2]
  if (isW(nx2, 'AS')) return true
  if (nx2?.v === '(') {
    const c = matchParen(toks, k + 2)
    return c > 0 && isW(toks[c + 1], 'AS')
  }
  return false
}

/** "(" logo depois de REFERENCES dbo.Tabela: lista de colunas, não chamada de função. */
function afterReferences(toks, k) {
  let j = k - 1
  while (j >= 0 && (toks[j].t === 'word' || toks[j].t === 'qid' || toks[j].v === '.') && !isW(toks[j], 'REFERENCES')) j--
  return j < k - 1 && isW(toks[j], 'REFERENCES')
}

const rioCol = (col, word) => (word.length <= 6 ? col + 6 - word.length : col)

function commentText(c, indent) {
  if (c.kind === 'line') return [`${pad(indent)}--${c.text.replace(/\t/g, '  ')}`]
  const parts = c.text.replace(/\t/g, '  ').split('\n')
  return [
    `${pad(indent)}${parts[0]}`.replace(/\s+$/, ''),
    ...parts.slice(1).map((p) => {
      const lead = p.length - p.trimStart().length
      return `${pad(indent)}${p.slice(Math.min(c.col ?? 0, lead))}`.replace(/\s+$/, '')
    }),
  ]
}

function commentLines(list, indent) {
  const out = []
  list.forEach((c, idx) => {
    if (idx > 0 && c.nl >= 2) out.push('')
    out.push(...commentText(c, indent))
  })
  return out
}

/* ───────────────────────── escritor de linhas ───────────────────────── */

/**
 * Acumula linhas. Com base 0 todas as linhas são absolutas; com base > 0 a primeira linha
 * é um fragmento que será colado na coluna `base` de outra linha.
 */
class Writer {
  constructor(base = 0) {
    this.base = base
    this.L = ['']
    this.fresh = base === 0
  }
  get col() {
    return (this.L.length === 1 ? this.base : 0) + this.L[this.L.length - 1].length
  }
  add(s) {
    this.L[this.L.length - 1] += s
    this.fresh = false
    return this
  }
  line(c, s = '') {
    if (this.fresh) this.L[0] = pad(c) + s
    else this.L.push(pad(c) + s)
    this.fresh = false
    return this
  }
  frag(f) {
    this.add(f[0])
    for (let i = 1; i < f.length; i++) this.L.push(f[i])
    return this
  }
  lines(arr) {
    for (const l of arr) {
      if (this.fresh) {
        this.L[0] = l
        this.fresh = false
      } else this.L.push(l)
    }
    return this
  }
  comments(list, c) {
    for (const cmt of list) this.lines(commentText(cmt, c))
    return this
  }
}

/* ───────────────────────── contexto / relatório ───────────────────────── */

class Ctx {
  constructor(opts) {
    this.opts = opts
    this.changes = new Map()
    this.extensions = new Map()
    this.warnings = []
    this.ctes = new Set()
    this.removedStrings = []
    this.stats = { statements: 0, procedures: 0, fallbacks: 0 }
  }
  note(key, message) {
    const e = this.changes.get(key)
    if (e) e.count++
    else this.changes.set(key, { key, message, count: 1 })
  }
  ext(key, message) {
    if (!this.extensions.has(key)) this.extensions.set(key, { key, message })
  }
  warn(key, message) {
    if (!this.warnings.some((w) => w.message === message)) this.warnings.push({ key, message })
  }
}

/* ───────────────────────── normalização dos tokens ───────────────────────── */

function tempTarget(v) {
  if (v.startsWith('##')) return v
  const body = v.slice(1)
  if (/^t[A-Z0-9_]+$/.test(body) && /[A-Z]/.test(body.slice(1))) return v
  let core = body.replace(/^(temp|tmp)_?/i, '')
  if (/^t[A-Z]/.test(core)) core = core.slice(1)
  else if (/^t_/i.test(core)) core = core.slice(2)
  if (!core) core = body
  return `#t${core.toUpperCase()}`
}

function normalize(tokens, ctx) {
  const { opts } = ctx
  // 1) mapa de renomeação das temporárias (#Origem, #temp_origem → #tORIGEM)
  const rename = new Map()
  if (opts.renameTemp) {
    const used = new Map()
    for (const t of tokens) {
      if (t.t !== 'temp' || t.v.startsWith('##')) continue
      const key = t.v.toUpperCase()
      if (rename.has(key)) continue
      const target = tempTarget(t.v)
      const owner = used.get(target.toUpperCase())
      if (owner && owner !== key) {
        ctx.warn('temp-clash', `${t.v} não foi renomeada: ${target} já é usada por outra temporária.`)
        rename.set(key, t.v)
        continue
      }
      used.set(target.toUpperCase(), key)
      rename.set(key, target)
      if (target !== t.v) ctx.note(`temp:${key}`, `Temporária ${t.v} → ${target}`)
    }
  }

  tokens.forEach((t, k) => {
    const prev = tokens[k - 1]
    const next = tokens[k + 1]
    if (t.t === 'word') {
      const afterDot = prev?.v === '.'
      const beforeDot = next?.v === '.'
      if ((t.u === 'INSERTED' || t.u === 'DELETED') && (beforeDot || isW(prev, 'FROM', 'JOIN'))) t.out = t.v.toLowerCase()
      else if (t.v.startsWith('$')) {
        t.out = t.v.toLowerCase()
        t.kw = true
      } else if (!afterDot && !beforeDot && KEYWORDS.has(t.u) && !(FUNCTION_ONLY.has(t.u) && next?.v !== '(')) {
        t.kw = true
        t.out = t.u
        if (t.v !== t.u) ctx.note('upper', 'Palavras-chave convertidas para MAIÚSCULAS')
      } else t.out = t.v
    } else if (t.t === 'var') t.out = t.v.startsWith('@@') ? t.u : t.v
    else if (t.t === 'qid') {
      const inner = t.v.startsWith('[') ? t.v.slice(1, -1).replace(/]]/g, ']') : t.v.slice(1, -1)
      if (opts.stripBrackets && /^[A-Za-z_][A-Za-z0-9_]*$/.test(inner) && !KEYWORDS.has(inner.toUpperCase())) {
        t.out = inner
        ctx.note('brackets', 'Colchetes removidos de identificadores')
      } else t.out = t.v
    } else if (t.t === 'temp') t.out = rename.get(t.v.toUpperCase()) ?? t.v
    else if (t.t === 'string') {
      t.out = t.v
      if (rename.size && t.v.includes('#')) {
        t.out = t.v.replace(/(?<!#)#([\p{L}\p{N}_@$]+)/gu, (m) => rename.get(m.toUpperCase()) ?? m)
      }
    } else t.out = t.v
  })

  // 2) nomes de CTE (não recebem dbo.)
  tokens.forEach((t, k) => {
    if (!isW(t, 'WITH') || !cteAt(tokens, k)) return
    let j = k + 1
    while (j < tokens.length) {
      ctx.ctes.add((tokens[j].out ?? tokens[j].v).toUpperCase())
      j++
      if (tokens[j]?.v === '(') j = matchParen(tokens, j) + 1
      if (!isW(tokens[j], 'AS') || tokens[j + 1]?.v !== '(') break
      j = matchParen(tokens, j + 1) + 1
      if (j <= 0 || tokens[j]?.v !== ',') break
      j++
    }
  })
}

/* ───────────────────────── parser estrutural ───────────────────────── */

/** ";" em linha própria colado num WITH (";WITH") pertence à CTE, não à instrução anterior. */
function leadingSemi(T, k) {
  const t = T[k]
  return (t.nl > 0 || t.lead.length > 0) && isW(T[k + 1], 'WITH') && T[k + 1].nl === 0
}

const IF_PREFIX = new Set(['TABLE', 'VIEW', 'PROCEDURE', 'PROC', 'FUNCTION', 'INDEX', 'TRIGGER', 'SCHEMA', 'TYPE', 'SEQUENCE', 'SYNONYM', 'DATABASE', 'USER', 'ROLE', 'DEFAULT', 'RULE', 'COLUMN', 'CONSTRAINT', 'STATISTICS', 'ASSEMBLY', 'LOGIN'])
const MODULE_TYPES = ['PROC', 'PROCEDURE', 'VIEW', 'FUNCTION', 'TRIGGER']

class Parser {
  constructor(toks, ctx) {
    this.t = toks
    this.i = 0
    this.ctx = ctx
  }
  get n() {
    return this.t.length
  }
  peek(o = 0) {
    return this.t[this.i + o]
  }
  next() {
    return this.t[this.i++]
  }

  isGo(k = this.i) {
    const T = this.t
    const t = T[k]
    if (!isW(t, 'GO')) return false
    const prev = T[k - 1]
    if (prev && !(t.nl > 0 || t.lead.length > 0 || prev.trail.some((c) => c.kind === 'line'))) return false
    const nx = T[k + 1]
    if (!nx || nx.nl > 0 || nx.lead.length > 0 || t.trail.some((c) => c.kind === 'line')) return true
    if (nx.t === 'number') {
      const nx2 = T[k + 2]
      return !nx2 || nx2.nl > 0 || nx2.lead.length > 0 || nx.trail.some((c) => c.kind === 'line')
    }
    return false
  }

  moduleAt(k = this.i) {
    const t = this.t[k]
    if (!isW(t, 'CREATE', 'ALTER')) return false
    let j = k + 1
    if (t.u === 'CREATE' && isW(this.t[j], 'OR') && isW(this.t[j + 1], 'ALTER')) j += 2
    return isW(this.t[j], ...MODULE_TYPES)
  }

  script() {
    return this.statements(() => false)
  }

  statements(stop) {
    const out = []
    while (this.i < this.n && !stop()) {
      const before = this.i
      const node = this.statement()
      if (node) out.push(node)
      if (this.i === before) {
        const t = this.next()
        out.push({ k: 'raw', first: t, toks: [t] })
      }
    }
    return out
  }

  statement() {
    const t = this.peek()
    if (t.t === 'punct' && t.v === ';') {
      this.i++
      return { k: 'empty', first: t, toks: [t] }
    }
    if (this.isGo()) return this.go()
    if (t.t === 'word') {
      const nx = this.peek(1)
      if (t.u === 'BEGIN') {
        if (isW(nx, 'TRY')) return this.tryCatch()
        if (!isW(nx, 'TRAN', 'TRANSACTION', 'DISTRIBUTED', 'DIALOG', 'CONVERSATION')) return this.block()
      } else if (t.u === 'IF') return this.ifStmt()
      else if (t.u === 'WHILE') return this.whileStmt()
      else if (this.moduleAt()) return this.module()
      else if (t.u === 'END' || t.u === 'ELSE') {
        this.ctx.warn('stray', `${t.u} sem bloco correspondente (linha ${t.line}); mantido como está.`)
        const toks = [this.next()]
        if (isW(this.peek(), 'TRY', 'CATCH')) toks.push(this.next())
        if (this.peek()?.v === ';') toks.push(this.next())
        return { k: 'raw', first: t, toks }
      }
      if (nx && nx.t === 'punct' && nx.v === ':' && !KEYWORDS.has(t.u) && nx.nl === 0) {
        this.i += 2
        return { k: 'label', first: t, toks: [t, nx] }
      }
    }
    const end = this.scanSimple(this.i)
    const toks = this.t.slice(this.i, end)
    this.i = end
    return { k: 'stmt', first: toks[0], toks }
  }

  /** Fim de uma instrução simples: ";" ou o início da próxima instrução no nível 0. */
  scanSimple(i0) {
    const T = this.t
    const head = T[i0]
    const st = { head: head.t === 'word' ? head.u : '', main: null, sawSet: false, insertBody: false }
    st.main = st.head === 'WITH' ? null : st.head
    let depth = 0
    let caseD = 0
    for (let k = i0; k < T.length; k++) {
      const t = T[k]
      if (t.t === 'punct') {
        if (t.v === '(') depth++
        else if (t.v === ')') depth = Math.max(0, depth - 1)
        else if (t.v === ';' && depth === 0) return k > i0 && leadingSemi(T, k) ? k : k + 1
        continue
      }
      if (k === i0 || depth > 0) continue
      if (this.isGo(k)) return k
      if (t.t !== 'word') continue
      if (t.nl > 0 && T[k + 1]?.t === 'punct' && T[k + 1].v === ':' && !KEYWORDS.has(t.u)) return k
      const u = t.u
      if (u === 'CASE') {
        caseD++
        continue
      }
      if (u === 'END') {
        if (caseD > 0) {
          caseD--
          continue
        }
        return k
      }
      if (caseD > 0) continue
      if (u === 'ELSE') return k
      if (st.main === 'INSERT' && (u === 'VALUES' || u === 'DEFAULT')) st.insertBody = true
      if (!STMT_START.has(u)) continue
      if (this.continues(k, st)) continue
      return k
    }
    return T.length
  }

  continues(k, st) {
    const T = this.t
    const t = T[k]
    const u = t.u
    const p = T[k - 1]
    const pp = T[k - 2]
    const pu = p?.t === 'word' ? p.u : p?.v
    const ppu = pp?.t === 'word' ? pp.u : pp?.v
    if (['GRANT', 'REVOKE', 'DENY'].includes(st.head) && t.nl === 0) return true
    if (u === 'ALTER' && pu === 'OR') return true
    if (['INSERT', 'UPDATE', 'DELETE'].includes(u) && ['ON', 'FOR', 'AFTER', 'OF', 'BULK'].includes(pu)) return true
    if (u === 'SET' && ppu === 'ON' && (pu === 'DELETE' || pu === 'UPDATE')) return true
    if (u === 'SELECT' && ['UNION', 'ALL', 'EXCEPT', 'INTERSECT', 'FOR'].includes(pu)) return true
    if (u === 'IF' && IF_PREFIX.has(pu)) return true
    if (u === 'FETCH' && (pu === 'ROWS' || pu === 'ROW')) return true
    if (u === 'MERGE' && ['INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER'].includes(pu)) return true
    if (u === 'WITH') return !cteAt(T, k)
    if (st.head === 'ALTER' && ['DROP', 'ALTER', 'SET', 'WITH'].includes(u)) return true
    if (st.head === 'WITH' && !st.main && ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(u)) {
      st.main = u
      return true
    }
    if (st.main === 'MERGE' && ['INSERT', 'UPDATE', 'DELETE', 'SET'].includes(u)) return true
    if (st.main === 'UPDATE' && u === 'SET' && !st.sawSet) {
      st.sawSet = true
      return true
    }
    if (st.main === 'INSERT' && !st.insertBody && ['SELECT', 'EXEC', 'EXECUTE'].includes(u)) {
      st.insertBody = true
      return true
    }
    return false
  }

  /** Condição de IF / WHILE: vai até a primeira palavra que inicia instrução. */
  scanCond(i0) {
    const T = this.t
    let depth = 0
    let caseD = 0
    for (let k = i0; k < T.length; k++) {
      const t = T[k]
      if (t.t === 'punct') {
        if (t.v === '(') depth++
        else if (t.v === ')') depth = Math.max(0, depth - 1)
        else if (t.v === ';' && depth === 0) return k
        continue
      }
      if (depth > 0) continue
      if (this.isGo(k)) return k
      if (t.t !== 'word') continue
      if (t.u === 'CASE') caseD++
      else if (t.u === 'END' && caseD > 0) caseD--
      else if (caseD === 0 && t.u === 'UPDATE' && T[k + 1]?.v === '(') continue
      else if (caseD === 0 && STMT_START.has(t.u)) return k
    }
    return T.length
  }

  block() {
    const begin = this.next()
    const body = this.statements(() => isW(this.peek(), 'END') || this.isGo())
    let end = null
    let semi = null
    if (isW(this.peek(), 'END') && !isW(this.peek(1), 'TRY', 'CATCH')) {
      end = this.next()
      if (this.peek()?.v === ';' && !leadingSemi(this.t, this.i)) semi = this.next()
    } else this.ctx.warn('unbalanced', `BEGIN da linha ${begin.line} sem END correspondente.`)
    return { k: 'block', first: begin, begin, body, end, semi }
  }

  tryCatch() {
    const bt = [this.next(), this.next()]
    const stop = () => isW(this.peek(), 'END') || this.isGo()
    const tryBody = this.statements(stop)
    const node = { k: 'try', first: bt[0], bt, tryBody, et: null, bc: null, catchBody: [], ec: null, semi: null, extra: [] }
    if (isW(this.peek(), 'END') && isW(this.peek(1), 'TRY')) node.et = [this.next(), this.next()]
    while (this.peek()?.v === ';' && !leadingSemi(this.t, this.i)) node.extra.push(this.next())
    if (isW(this.peek(), 'BEGIN') && isW(this.peek(1), 'CATCH')) {
      node.bc = [this.next(), this.next()]
      node.catchBody = this.statements(stop)
      if (isW(this.peek(), 'END') && isW(this.peek(1), 'CATCH')) {
        node.ec = [this.next(), this.next()]
        if (this.peek()?.v === ';' && !leadingSemi(this.t, this.i)) node.semi = this.next()
      }
    }
    if (!node.et || !node.bc || !node.ec) this.ctx.warn('unbalanced', `BEGIN TRY da linha ${bt[0].line} incompleto (END TRY / BEGIN CATCH / END CATCH).`)
    return node
  }

  ifStmt() {
    const ifTok = this.next()
    const end = this.scanCond(this.i)
    const cond = this.t.slice(this.i, end)
    this.i = end
    const then = this.i < this.n && !this.isGo() ? this.statement() : null
    let elseTok = null
    let els = null
    if (isW(this.peek(), 'ELSE')) {
      elseTok = this.next()
      els = this.i < this.n ? this.statement() : null
    }
    return { k: 'if', first: ifTok, ifTok, cond, then, elseTok, els }
  }

  whileStmt() {
    const tok = this.next()
    const end = this.scanCond(this.i)
    const cond = this.t.slice(this.i, end)
    this.i = end
    const body = this.i < this.n && !this.isGo() ? this.statement() : null
    return { k: 'while', first: tok, tok, cond, body }
  }

  go() {
    const toks = [this.next()]
    if (this.peek()?.t === 'number' && this.peek().nl === 0) toks.push(this.next())
    return { k: 'go', first: toks[0], toks }
  }

  skipUntilWord(words) {
    let depth = 0
    while (this.i < this.n) {
      const t = this.peek()
      if (t.v === '(') depth++
      else if (t.v === ')') depth--
      else if (depth === 0 && isW(t, ...words)) return
      else if (depth === 0 && this.isGo()) return
      this.i++
    }
  }

  group() {
    const open = this.i
    const close = matchParen(this.t, open)
    if (close < 0) return null
    this.i = close + 1
    return { open: this.t[open], close: this.t[close], toks: this.t.slice(open + 1, close) }
  }

  module() {
    const T = this.t
    const first = this.peek()
    const createTok = this.next()
    const head = [createTok]
    let orAlter = false
    if (createTok.u === 'CREATE' && isW(this.peek(), 'OR')) {
      head.push(this.next(), this.next())
      orAlter = true
    }
    const typeTok = this.next()
    head.push(typeTok)
    const type = typeTok.u === 'PROC' ? 'PROCEDURE' : typeTok.u
    const node = { k: 'module', first, head, type, orig: `${createTok.u}${orAlter ? ' OR ALTER' : ''} ${typeTok.u}` }
    const ns = this.i
    this.i = readName(T, this.i)
    node.name = T.slice(ns, this.i)

    if (type === 'PROCEDURE') {
      if (this.peek()?.v === '(') node.params = this.group()
      else {
        const s = this.i
        this.skipUntilWord(['WITH', 'AS', 'FOR'])
        node.params = { toks: T.slice(s, this.i), bare: this.i > s }
      }
    } else if (type === 'FUNCTION') {
      if (this.peek()?.v === '(') node.params = this.group()
      if (isW(this.peek(), 'RETURNS')) {
        const s = this.i
        this.next()
        this.skipUntilWord(['AS', 'WITH'])
        node.returns = T.slice(s, this.i)
      }
    } else if (type === 'VIEW') {
      if (this.peek()?.v === '(') node.cols = this.group()
    } else if (type === 'TRIGGER' && isW(this.peek(), 'ON')) {
      const s = this.i
      this.next()
      this.skipUntilWord(['WITH', 'FOR', 'AFTER', 'INSTEAD'])
      node.on = T.slice(s, this.i)
    }
    if (isW(this.peek(), 'WITH')) {
      const s = this.i
      this.next()
      let depth = 0
      while (this.i < this.n) {
        const t = this.peek()
        if (t.v === '(') depth++
        else if (t.v === ')') depth--
        else if (depth === 0 && isW(t, 'EXECUTE', 'EXEC') && isW(this.peek(1), 'AS')) {
          this.i += 3
          continue
        } else if (depth === 0 && isW(t, 'AS', 'FOR')) break
        this.i++
      }
      node.with = T.slice(s, this.i)
    }
    if (isW(this.peek(), 'FOR', 'AFTER', 'INSTEAD')) {
      const s = this.i
      this.skipUntilWord(['AS'])
      node.events = T.slice(s, this.i)
    }
    if (isW(this.peek(), 'AS')) node.as = this.next()
    else this.ctx.warn('module-as', `${node.orig} sem AS antes do corpo.`)
    node.body = this.statements(() => this.isGo() || this.moduleAt())
    if (this.isGo()) node.go = this.go()
    else if (this.i < this.n) this.ctx.warn('missing-go', `Faltava GO entre ${node.orig} e o próximo módulo; adicionado.`)
    return node
  }
}

/* ───────────────────────── transformações do padrão ───────────────────────── */

const stmtWords = (n) =>
  n.toks
    .filter((t) => t.v !== ';')
    .map((t) => (t.t === 'word' ? t.u : t.v))
    .join(' ')

function nodeComments(n) {
  const out = []
  const visit = (t) => {
    out.push(...t.lead, ...t.trail)
  }
  for (const t of n.toks ?? []) visit(t)
  return out
}

function commentsNode(n) {
  const cs = nodeComments(n)
  if (!cs.length) return null
  return { k: 'comments', first: { lead: cs, trail: [], nl: n.first?.nl ?? 1 } }
}

/** Visita todas as listas de instruções da árvore (pai antes dos filhos, na ordem do texto). */
function walkLists(nodes, fn) {
  fn(nodes)
  for (const n of nodes) {
    if (n.k === 'block') walkLists(n.body, fn)
    else if (n.k === 'try') {
      walkLists(n.tryBody, fn)
      walkLists(n.catchBody, fn)
    } else if (n.k === 'module') walkLists(n.body, fn)
    else if (n.k === 'if' || n.k === 'while') {
      for (const b of [n.then, n.els, n.body]) {
        if (!b) continue
        const holder = [b]
        walkLists(holder, fn)
        if (n.then === b) n.then = holder[0] ?? null
        else if (n.els === b) n.els = holder[0] ?? null
        else n.body = holder[0] ?? null
      }
    }
  }
}

function transform(nodes, ctx) {
  // 1) SET XACT_ABORT ON é proibido
  walkLists(nodes, (list) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i]
      if (n.k === 'stmt' && stmtWords(n) === 'SET XACT_ABORT ON') {
        const c = commentsNode(n)
        if (c) list.splice(i, 1, c)
        else list.splice(i, 1)
        ctx.note('xact', 'Removido SET XACT_ABORT ON (proibido no padrão)')
      }
    }
  })

  // 2) IF OBJECT_ID('tempdb..#x') IS NOT NULL DROP TABLE #x  →  DROP TABLE IF EXISTS #x
  walkLists(nodes, (list) => {
    list.forEach((n, i) => {
      if (n.k !== 'if' || n.els) return
      const c = n.cond
      const ok =
        c.length >= 7 &&
        isW(c[0], 'OBJECT_ID') &&
        c[1].v === '(' &&
        c[2].t === 'string' &&
        isW(c[c.length - 3], 'IS') &&
        isW(c[c.length - 2], 'NOT') &&
        isW(c[c.length - 1], 'NULL')
      if (!ok) return
      let body = n.then
      if (body?.k === 'block' && body.body.length === 1) body = body.body[0]
      if (body?.k !== 'stmt' || !isW(body.toks[0], 'DROP') || !isW(body.toks[1], 'TABLE')) return
      const nameToks = body.toks.slice(2).filter((t) => t.v !== ';')
      if (!nameToks.length || nameToks.some((t) => t.v === ',')) return
      const target = nameToks.map((t) => t.out).join('').toUpperCase()
      const ref = c[2].out.replace(/^N?'|'$/g, '').toUpperCase()
      const tail = (s) => s.split('.').filter(Boolean).pop()
      if (tail(ref) !== tail(target)) return
      const cs = [...n.ifTok.lead, ...n.ifTok.trail, ...c.flatMap((t) => [...t.lead, ...t.trail])]
      const drop = { ...mk('DROP'), lead: cs, nl: n.ifTok.nl }
      const toks = [drop, mk('TABLE'), mk('IF'), mk('EXISTS'), ...nameToks, mk(';', 'punct')]
      ctx.removedStrings.push(...c.filter((t) => t.t === 'string').map((t) => t.out))
      list[i] = { k: 'stmt', first: drop, toks }
      ctx.note('objectid', 'IF OBJECT_ID(...) IS NOT NULL DROP TABLE → DROP TABLE IF EXISTS')
    })
  })

  // 3) DROP TABLE IF EXISTS antes de criar cada temporária
  const dropped = new Set()
  walkLists(nodes, (list) => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i]
      if (n.k !== 'stmt') continue
      const T = n.toks
      if (isW(T[0], 'DROP') && isW(T[1], 'TABLE')) {
        for (const t of T) if (t.t === 'temp') dropped.add(t.out.toUpperCase())
        continue
      }
      let created = null
      if (isW(T[0], 'CREATE') && isW(T[1], 'TABLE') && T[2]?.t === 'temp') created = T[2]
      else if (isW(T[0], 'SELECT', 'WITH')) {
        const k = findTopWord(T, 0, ['INTO'])
        if (k < T.length && T[k + 1]?.t === 'temp' && !isW(T[k - 1], 'INSERT')) created = T[k + 1]
      }
      if (!created || created.out.startsWith('##')) continue
      const key = created.out.toUpperCase()
      if (dropped.has(key)) continue
      dropped.add(key)
      const first = n.first
      const drop = { ...mk('DROP'), lead: first.lead, nl: first.nl }
      first.lead = []
      first.nl = 1
      const name = { ...mk(created.out, 'temp'), kw: false }
      list.splice(i, 0, { k: 'stmt', first: drop, toks: [drop, mk('TABLE'), mk('IF'), mk('EXISTS'), name, mk(';', 'punct')] })
      i++
      ctx.note('temp-drop', 'Adicionado DROP TABLE IF EXISTS antes de criar temporária')
    }
  })
}

/* ───────────────────────── renderizador ───────────────────────── */

const SELECT_CLAUSES = new Set(['SELECT', 'INTO', 'FROM', 'WHERE', 'HAVING', 'OPTION', 'OFFSET', 'FETCH'])

function selectClauseAt(toks, k) {
  const t = toks[k]
  if (SELECT_CLAUSES.has(t.u)) return t.u
  if ((t.u === 'GROUP' || t.u === 'ORDER') && isW(toks[k + 1], 'BY')) return t.u
  if (t.u === 'FOR' && isW(toks[k + 1], 'XML', 'JSON', 'BROWSE')) return 'FOR'
  return null
}

function isUnary(prev, t) {
  if (t.t !== 'op' || !['-', '+', '~'].includes(t.v)) return false
  if (!prev) return true
  if (prev.t === 'op') return true
  if (prev.t === 'punct') return prev.v === '(' || prev.v === ','
  return prev.t === 'word' && prev.kw && !FUNCTIONS.has(prev.u) && prev.u !== 'NULL'
}

function needSpace(prev, t) {
  if (!prev) return false
  const pv = prev.v
  const tv = t.v
  if (t.t === 'punct' && (tv === ',' || tv === ';' || tv === ')' || tv === '.' || tv === ':')) return false
  if (prev.t === 'punct' && (pv === '(' || pv === '.')) return false
  if (pv === '::' || tv === '::') return false
  if (prev.unary) return false
  if (t.t === 'punct' && tv === '(') {
    if (prev.t === 'qid') return false
    if (prev.t === 'word') return prev.kw ? !NO_SPACE_PAREN.has(prev.u) : false
  }
  return true
}

function splitSetOps(toks) {
  const parts = [{ opToks: null, toks: [] }]
  let depth = 0
  let caseD = 0
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.t === 'punct' && t.v === '(') depth++
    else if (t.t === 'punct' && t.v === ')') depth--
    else if (depth === 0 && isW(t, 'CASE')) caseD++
    else if (depth === 0 && caseD > 0 && isW(t, 'END')) caseD--
    else if (depth === 0 && caseD === 0 && isW(t, 'UNION', 'EXCEPT', 'INTERSECT')) {
      const opToks = [t]
      if (isW(toks[k + 1], 'ALL')) opToks.push(toks[++k])
      parts.push({ opToks, toks: [] })
      continue
    }
    parts[parts.length - 1].toks.push(t)
  }
  return parts
}

function splitConds(toks) {
  const conds = [{ op: null, opTok: null, toks: [] }]
  let depth = 0
  let caseD = 0
  let between = false
  for (const t of toks) {
    if (t.t === 'punct' && t.v === '(') depth++
    else if (t.t === 'punct' && t.v === ')') depth--
    else if (depth === 0 && isW(t, 'CASE')) caseD++
    else if (depth === 0 && caseD > 0 && isW(t, 'END')) caseD--
    else if (depth === 0 && caseD === 0) {
      if (isW(t, 'BETWEEN')) between = true
      else if (isW(t, 'AND', 'OR')) {
        if (t.u === 'AND' && between) between = false
        else {
          conds.push({ op: t.u, opTok: t, toks: [] })
          continue
        }
      }
    }
    conds[conds.length - 1].toks.push(t)
  }
  return conds
}

function joinAt(toks, k) {
  const t = toks[k]
  if (t.t === 'punct' && t.v === ',') return { len: 1, text: ',' }
  if (!isW(t)) return null
  const u = t.u
  if (u === 'JOIN') return { len: 1, text: 'INNER JOIN', norm: 'join' }
  if (u === 'CROSS' && isW(toks[k + 1], 'JOIN', 'APPLY')) return { len: 2, text: `CROSS ${toks[k + 1].u}` }
  if (u === 'OUTER' && isW(toks[k + 1], 'APPLY')) return { len: 2, text: 'OUTER APPLY' }
  if (['INNER', 'LEFT', 'RIGHT', 'FULL'].includes(u)) {
    let j = k + 1
    const parts = [u]
    let norm = null
    if (isW(toks[j], 'OUTER')) {
      j++
      norm = 'outer'
    }
    if (isW(toks[j], 'HASH', 'MERGE', 'LOOP', 'REMOTE')) parts.push(toks[j++].u)
    if (isW(toks[j], 'JOIN')) {
      parts.push('JOIN')
      return { len: j - k + 1, text: parts.join(' '), norm }
    }
  }
  return null
}

function splitJoins(toks) {
  const segs = [{ kw: null, kwToks: [], toks: [] }]
  let depth = 0
  let caseD = 0
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (depth === 0 && caseD === 0) {
      const j = joinAt(toks, k)
      if (j) {
        segs.push({ kw: j.text, kwToks: toks.slice(k, k + j.len), norm: j.norm, toks: [] })
        k += j.len - 1
        continue
      }
    }
    if (t.t === 'punct' && t.v === '(') depth++
    else if (t.t === 'punct' && t.v === ')') depth--
    else if (depth === 0 && isW(t, 'CASE')) caseD++
    else if (depth === 0 && caseD > 0 && isW(t, 'END')) caseD--
    segs[segs.length - 1].toks.push(t)
  }
  for (const s of segs) {
    const on = findTopWord(s.toks, 0, ['ON'])
    s.src = s.toks.slice(0, on)
    s.onTok = s.toks[on] ?? null
    s.on = s.toks.slice(on + 1)
  }
  return segs
}

class Renderer {
  constructor(ctx) {
    this.ctx = ctx
  }

  /* ── expressões em linha (com subqueries e CASE em bloco) ── */
  inline(toks, col, opts = {}) {
    const w = new Writer(col)
    let prev = null
    let depth = 0
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k]
      if (t.t === 'punct' && t.v === '(') {
        const nx = toks[k + 1]
        const close = nx && (isW(nx, 'SELECT') || (isW(nx, 'WITH') && cteAt(toks, k + 1))) ? matchParen(toks, k) : -1
        if (close > 0) {
          if (needSpace(prev, t)) w.add(' ')
          const pc = w.col
          const sub = this.query(toks.slice(k + 1, close), pc + 2)
          w.add(`( ${sub[0].slice(pc + 2)}`)
          for (let r = 1; r < sub.length; r++) w.L.push(sub[r])
          w.L.push(withMarks(`${pad(pc)})`, t, toks[close]))
          prev = toks[close]
          k = close
          continue
        }
        depth++
      } else if (t.t === 'punct' && t.v === ')') depth--
      if (opts.multiCase && depth === 0 && isW(t, 'CASE')) {
        const end = matchCase(toks, k)
        if (end > 0) {
          if (needSpace(prev, t)) w.add(' ')
          w.frag(this.caseExpr(toks.slice(k, end + 1), w.col, opts))
          prev = toks[end]
          k = end
          continue
        }
      }
      t.unary = isUnary(prev, t)
      const hint = t.t === 'punct' && t.v === '(' && isW(toks[k + 1]) && TABLE_HINTS.has(toks[k + 1].u) && prev?.t !== 'punct'
      if (hint || (t.t === 'punct' && t.v === '(' && afterReferences(toks, k)) || needSpace(prev, t)) w.add(' ')
      w.add(piece(t))
      prev = t
    }
    return w.L
  }

  /** CASE em bloco: WHEN/ELSE 2 colunas à direita do CASE, END embaixo do CASE. */
  caseExpr(toks, c, opts) {
    const w = new Writer(c)
    const last = toks.length - 1
    const marksAt = []
    forTop(toks.slice(1, last), 0, (t, k) => {
      if (isW(t, 'WHEN', 'THEN', 'ELSE')) marksAt.push(k + 1)
    })
    const firstWhen = marksAt.length ? marksAt[0] : last
    w.add(piece(toks[0]))
    if (firstWhen > 1) w.add(' ').frag(this.inline(toks.slice(1, firstWhen), w.col))
    marksAt.push(last)
    for (let m = 0; m < marksAt.length - 1; m++) {
      const kwTok = toks[marksAt[m]]
      const body = toks.slice(marksAt[m] + 1, marksAt[m + 1])
      if (kwTok.u === 'THEN') {
        w.add(` ${piece(kwTok)} `)
        w.frag(this.inline(body, w.col, opts))
      } else {
        w.line(c + 2, `${piece(kwTok)} `)
        w.frag(this.inline(body, w.col, kwTok.u === 'ELSE' ? opts : {}))
      }
    }
    w.line(c, piece(toks[last]))
    this.ctx.ext('case', 'CASE em listas (SELECT, SET, VALUES) segue o modelo do OUTPUT: WHEN/ELSE 2 colunas à direita, END embaixo do CASE.')
    return w.L
  }

  /* ── listas ── */
  items(w, items, commaCol, opts = {}, renderOne = null) {
    items.forEach((it, idx) => {
      if (idx > 0) {
        w.comments(it.own ?? [...it.commaLead, ...takeLead(it.toks[0])], commaCol)
        w.line(commaCol, ', ')
      }
      if (renderOne) renderOne(it, idx)
      else w.frag(this.inline(it.toks, w.col, opts))
      if (it.trailing.length) w.add(` ${it.trailing.map(cm).join(' ')}`)
    })
  }

  parenList(w, items, opts = {}, group = {}, renderOne = null) {
    const real = items.filter((it) => it.toks.length)
    if (!real.length) {
      w.add(withMarks('()', group.open, group.close))
      return
    }
    const openCol = w.col
    w.add('( ')
    this.items(w, items, openCol, opts, renderOne)
    w.line(openCol, withMarks(')', group.close, group.open))
  }

  /* ── conjunto de condições (WHERE, HAVING, ON, AND do MERGE) ── */
  /** Lados esquerdos das comparações (para alinhar os "="), renderizados na coluna do conteúdo. */
  condInfo(conds, contentCol) {
    const info = conds.map((c) => {
      const k = findTop(c.toks, (t) => t.t === 'op' && COMPARISON.has(t.v))
      if (k <= 0) return null
      const left = this.inline(c.toks.slice(0, k), contentCol)
      return left.length === 1 ? { k, left: left[0] } : null
    })
    return { info, maxW: Math.max(0, ...info.filter(Boolean).map((x) => x.left.length)) }
  }

  /** shared: { info, maxW } pré-calculado — usado para alinhar os "=" de vários JOINs na mesma coluna. */
  conds(w, conds, connEnd, shared = null) {
    const align = w.col === connEnd + 2
    const { info, maxW } = align ? (shared ?? this.condInfo(conds, connEnd + 2)) : { info: [], maxW: 0 }
    conds.forEach((c, idx) => {
      if (idx > 0) {
        const start = Math.max(0, connEnd - c.op.length + 1)
        w.comments(takeLead(c.opTok), start)
        w.line(start, `${withMarks(c.op, c.opTok)} `)
      }
      const inf = info[idx]
      if (inf && w.col === connEnd + 2) {
        w.add(`${inf.left.padEnd(maxW)} ${piece(c.toks[inf.k])} `)
        w.frag(this.inline(c.toks.slice(inf.k + 1), w.col))
      } else w.frag(this.inline(c.toks, w.col))
    })
  }

  qualify(toks, k) {
    if (!this.ctx.opts.qualifyDbo) return
    const t = toks[k]
    if (!t || (t.t !== 'word' && t.t !== 'qid') || t.qualified || t.synthetic) return
    if (t.t === 'word' && t.kw) return
    if (toks[k + 1]?.v === '.' || toks[k - 1]?.v === '.') return
    const key = (t.out ?? t.v).toUpperCase()
    if (this.ctx.ctes.has(key) || key === 'INSERTED' || key === 'DELETED') return
    t.out = `dbo.${t.out ?? t.v}`
    t.qualified = true
    this.ctx.note('dbo', 'Prefixo dbo. adicionado a objetos permanentes')
  }

  qualifySource(src) {
    const t = src[0]
    if (!t || t.v === '(' || t.t === 'var' || t.t === 'temp') return
    this.qualify(src, 0)
  }

  /* ── SELECT ── */
  query(toks, col) {
    if (isW(toks[0], 'WITH') && cteAt(toks, 0)) return this.withCte(toks, col)
    const parts = splitSetOps(toks)
    const w = new Writer()
    parts.forEach((p) => {
      if (p.opToks) {
        const w0 = p.opToks[0].u
        w.comments(takeLead(p.opToks[0]), col)
        w.line(rioCol(col, w0), withMarks(p.opToks.map((t) => t.u).join(' '), ...p.opToks))
        if (p.opToks.length > 1 || w0 === 'UNION' || w0 === 'INTERSECT')
          this.ctx.ext('setop', 'UNION / INTERSECT seguem o EXCEPT do padrão: a palavra no rio e o próximo SELECT na coluna do primeiro.')
      }
      if (p.toks.length) this.selectBlock(w, p.toks, col)
    })
    return w.L
  }

  selectBlock(w, toks, col) {
    if (!isW(toks[0], 'SELECT')) {
      w.line(col, '')
      w.frag(this.inline(toks, col))
      return
    }
    const clauses = splitClauses(toks, selectClauseAt)
    clauses.forEach((c) => {
      const kw = c.toks[0]
      if (!w.fresh) w.comments(takeLead(kw), col)
      switch (c.name) {
        case 'SELECT':
          this.selectList(w, c.toks, col)
          break
        case 'FROM':
          this.fromClause(w, c.toks, col)
          break
        case 'WHERE':
        case 'HAVING':
          this.condClause(w, c.toks, col)
          break
        case 'GROUP':
        case 'ORDER': {
          w.line(rioCol(col, kw.u), `${withMarks(`${kw.u} BY`, kw, c.toks[1])} `)
          const rest = c.toks.slice(2)
          if (splitByComma(rest).length > 1) this.ctx.ext('by-list', 'GROUP BY / ORDER BY com várias colunas ficam em uma linha (como no OVER do padrão).')
          w.frag(this.inline(rest, w.col))
          break
        }
        case 'INTO':
          w.line(rioCol(col, 'INTO'), `${withMarks('INTO', kw)} `)
          this.qualify(c.toks, 1)
          w.frag(this.inline(c.toks.slice(1), w.col))
          break
        default:
          if (!c.name) {
            w.line(col, '')
            w.frag(this.inline(c.toks, col))
          } else {
            w.line(rioCol(col, kw.u), `${withMarks(kw.u, kw)} `)
            w.frag(this.inline(c.toks.slice(1), w.col))
          }
      }
    })
  }

  selectList(w, toks, col) {
    let k = 1
    const mods = []
    if (isW(toks[k], 'DISTINCT', 'ALL')) mods.push(toks[k++])
    if (isW(toks[k], 'TOP')) {
      mods.push(toks[k++])
      if (toks[k]?.v === '(') {
        const c = matchParen(toks, k)
        mods.push(...toks.slice(k, c + 1))
        k = c + 1
      } else if (toks[k]) mods.push(toks[k++])
      if (isW(toks[k], 'PERCENT')) mods.push(toks[k++])
      if (isW(toks[k], 'WITH') && isW(toks[k + 1], 'TIES')) mods.push(toks[k++], toks[k++])
    }
    w.line(col, `${withMarks('SELECT', toks[0])} `)
    if (mods.length) w.frag(this.inline(mods, w.col)).add(' ')
    this.items(w, splitByComma(toks.slice(k)), col + 5, { multiCase: true })
  }

  /**
   * FROM + JOINs. Com vários JOINs, todos os ON ficam na mesma coluna (o mais à direita),
   * os AND/OR alinham à direita embaixo do ON e os "=" de todos os JOINs ficam numa coluna só.
   */
  fromClause(w, toks, col) {
    const kw = toks[0]
    const segs = splitJoins(toks.slice(1))
    const joinCol = col + 7
    // 1ª passada: comentários, prefixos e fontes já renderizadas (para medir onde cada ON cairia)
    const pre = segs.map((s, idx) => {
      this.qualifySource(s.src)
      if (idx === 0) return { comments: [], head: `${withMarks('FROM', kw)} `, headCol: rioCol(col, 'FROM') }
      if (s.kw === ',') {
        this.ctx.ext('comma-join', 'Tabelas separadas por vírgula no FROM seguem a vírgula à esquerda, no rio.')
        return { comments: takeLead(s.kwToks[0]), head: `${withMarks(',', s.kwToks[0])} `, headCol: col + 5, commentCol: col + 5 }
      }
      if (s.norm === 'join') this.ctx.note('join', 'JOIN → INNER JOIN')
      if (s.norm === 'outer') this.ctx.note('outer', 'LEFT/RIGHT/FULL OUTER JOIN → sem OUTER')
      if (/APPLY/.test(s.kw)) this.ctx.ext('apply', 'CROSS / OUTER APPLY seguem a posição do JOIN (embaixo do dbo do FROM).')
      return { comments: takeLead(s.kwToks[0]), head: `${withMarks(s.kw, ...s.kwToks)} `, headCol: joinCol, commentCol: joinCol }
    })
    pre.forEach((p, idx) => {
      const startCol = p.headCol + p.head.length
      p.frag = this.inline(segs[idx].src, startCol)
      p.endCol = p.frag.length === 1 ? startCol + p.frag[0].length : p.frag[p.frag.length - 1].length
    })
    const withOn = segs.map((s, idx) => (s.onTok && idx > 0 ? idx : -1)).filter((i) => i >= 0)
    const onCol = withOn.length ? Math.max(...withOn.map((i) => pre[i].endCol + 1)) : 0
    const conds = segs.map((s) => (s.onTok ? splitConds(s.on) : null))
    let shared = null
    if (withOn.length > 1) {
      this.ctx.ext('join-multi', 'Vários JOINs: todos os ON na mesma coluna, AND/OR alinhados à direita sob o ON e os "=" de todos os JOINs numa coluna só.')
      const infos = withOn.map((i) => this.condInfo(conds[i], onCol + 3))
      shared = { maxW: Math.max(...infos.map((x) => x.maxW)), byIdx: new Map(withOn.map((i, j) => [i, infos[j].info])) }
    }
    segs.forEach((s, idx) => {
      const p = pre[idx]
      if (p.comments.length) w.comments(p.comments, p.commentCol)
      w.line(p.headCol, p.head)
      w.frag(p.frag)
      if (!s.onTok) return
      const at = withOn.length > 1 ? onCol : w.col + 1
      w.add(pad(at - w.col))
      w.add(`${withMarks('ON', s.onTok)} `)
      this.conds(w, conds[idx], at + 1, shared && { info: shared.byIdx.get(idx), maxW: shared.maxW })
    })
  }

  condClause(w, toks, col) {
    const kw = toks[0]
    w.line(rioCol(col, kw.u), `${withMarks(kw.u, kw)} `)
    this.conds(w, splitConds(toks.slice(1)), col + 5)
  }

  withCte(toks, col) {
    let k = 1
    const ctes = []
    while (k < toks.length) {
      const name = toks[k++]
      let cols = null
      if (toks[k]?.v === '(') {
        const c = matchParen(toks, k)
        cols = toks.slice(k, c + 1)
        k = c + 1
      }
      const asTok = toks[k]
      if (!isW(asTok, 'AS') || toks[k + 1]?.v !== '(') throw new Error('CTE sem AS (…)')
      const open = k + 1
      const close = matchParen(toks, open)
      if (close < 0) throw new Error('CTE sem parêntese de fechamento')
      ctes.push({ name, cols, asTok, open: toks[open], close: toks[close], inner: toks.slice(open + 1, close) })
      k = close + 1
      if (toks[k]?.v === ',') {
        ctes[ctes.length - 1].comma = toks[k]
        k++
        continue
      }
      break
    }
    if (ctes.length > 1) this.ctx.ext('cte-multi', 'CTEs seguintes começam com ", Nome" na coluna do ;WITH, cada uma com seu AS ( … ).')
    const w = new Writer()
    ctes.forEach((c, idx) => {
      if (idx === 0) w.line(col, `${withMarks(';WITH', toks[0])} ${piece(c.name)}`)
      else {
        const prevComma = ctes[idx - 1].comma
        w.comments([...takeLead(prevComma), ...takeLead(c.name)], col)
        w.line(col, `${withMarks(',', prevComma)} ${piece(c.name)}`)
      }
      if (c.cols) w.add(' ').frag(this.inline(c.cols, w.col))
      w.comments(takeLead(c.asTok), col)
      w.line(col, `${withMarks('AS', c.asTok)} `)
      const openCol = w.col
      const sub = this.query(c.inner, openCol + 2)
      w.add(`( ${sub[0].slice(openCol + 2)}`)
      for (let r = 1; r < sub.length; r++) w.L.push(sub[r])
      w.line(openCol, withMarks(')', c.close, c.open))
    })
    const main = toks.slice(k)
    if (main.length) {
      w.comments(takeLead(main[0]), col)
      w.lines(this.dispatch(main, col))
    }
    return w.L
  }

  /* ── INSERT ── */
  topMods(toks, k, mods) {
    if (isW(toks[k], 'TOP')) {
      mods.push(toks[k++])
      if (toks[k]?.v === '(') {
        const c = matchParen(toks, k)
        mods.push(...toks.slice(k, c + 1))
        k = c + 1
      } else if (toks[k]) mods.push(toks[k++])
      if (isW(toks[k], 'PERCENT')) mods.push(toks[k++])
    }
    return k
  }

  insert(toks, col) {
    const mods = []
    let k = this.topMods(toks, 1, mods)
    let intoTok = null
    if (isW(toks[k], 'INTO')) intoTok = toks[k++]
    else this.ctx.note('insert-into', 'INSERT sem INTO → INSERT INTO')
    const ts = k
    k = readName(toks, k)
    if (isW(toks[k], 'WITH') && toks[k + 1]?.v === '(') k = matchParen(toks, k + 1) + 1
    const target = toks.slice(ts, k)
    this.qualify(target, 0)
    let cols = null
    if (toks[k]?.v === '(' && !isW(toks[k + 1], 'SELECT')) {
      const c = matchParen(toks, k)
      cols = { open: toks[k], close: toks[c], toks: toks.slice(k + 1, c) }
      k = c + 1
    }
    let output = null
    if (isW(toks[k], 'OUTPUT')) {
      const s = k
      k = findTopWord(toks, k + 1, ['SELECT', 'VALUES', 'EXEC', 'EXECUTE', 'DEFAULT'])
      output = toks.slice(s, k)
    }
    const body = toks.slice(k)
    const w = new Writer()
    w.line(col, `${withMarks('INSERT', toks[0])} `)
    if (mods.length) w.frag(this.inline(mods, w.col)).add(' ')
    w.add(`${withMarks('INTO', intoTok)} `)
    w.frag(this.inline(target, w.col))
    if (cols) {
      w.add(' ')
      this.parenList(w, splitByComma(cols.toks), {}, cols)
    }
    if (output) this.output(w, output, col)
    if (body.length) {
      w.comments(takeLead(body[0]), col)
      const b0 = body[0]
      if (isW(b0, 'VALUES')) this.values(w, body, col)
      else if (isW(b0, 'SELECT', 'WITH') || b0.v === '(') w.lines(this.query(body, col))
      else if (isW(b0, 'EXEC', 'EXECUTE')) w.lines(this.exec(body, col))
      else {
        w.line(col, '')
        w.frag(this.inline(body, col))
      }
    }
    return w.L
  }

  values(w, toks, col) {
    const kw = toks[0]
    const rows = splitByComma(toks.slice(1))
    if (rows.length > 1) this.ctx.ext('values-multi', 'VALUES com várias linhas: cada linha nova começa com ", (" no rio.')
    rows.forEach((r, idx) => {
      if (idx === 0) w.line(col, `${withMarks('VALUES', kw)} `)
      else {
        w.comments([...r.commaLead, ...takeLead(r.toks[0])], col + 5)
        w.line(col + 5, ', ')
      }
      const rt = r.toks
      if (rt[0]?.v === '(' && matchParen(rt, 0) === rt.length - 1) {
        this.parenList(w, splitByComma(rt.slice(1, -1)), { multiCase: true }, { open: rt[0], close: rt[rt.length - 1] })
      } else w.frag(this.inline(rt, w.col))
      if (r.trailing.length) w.add(` ${r.trailing.map(cm).join(' ')}`)
    })
  }

  output(w, toks, col) {
    const intoAt = findTopWord(toks, 1, ['INTO'])
    w.comments(takeLead(toks[0]), col)
    w.line(col, `${withMarks('OUTPUT', toks[0])} `)
    this.items(w, splitByComma(toks.slice(1, intoAt)), col + 5, { multiCase: true })
    if (intoAt >= toks.length) return
    const into = toks.slice(intoAt)
    w.comments(takeLead(into[0]), col + 2)
    w.line(col + 2, `${withMarks('INTO', into[0])} `)
    let k = readName(into, 1)
    const target = into.slice(1, k)
    this.qualify(target, 0)
    w.frag(this.inline(target, w.col))
    if (into[k]?.v === '(') {
      const c = matchParen(into, k)
      w.add(' ')
      this.parenList(w, splitByComma(into.slice(k + 1, c)), {}, { open: into[k], close: into[c] })
      k = c + 1
    }
    if (k < into.length) w.add(' ').frag(this.inline(into.slice(k), w.col))
  }

  /* ── UPDATE / DELETE ── */
  setList(w, toks, setCol, commaCol) {
    w.line(setCol, `${withMarks('SET', toks[0])} `)
    const items = splitByComma(toks.slice(1))
    prepOwn(items)
    const info = items.map((it) => {
      const a = findTop(it.toks, (t) => t.t === 'op' && ASSIGNMENT.has(t.v))
      if (a <= 0) return null
      const left = this.inline(it.toks.slice(0, a), commaCol + 2)
      return left.length === 1 ? { a, left: left[0] } : null
    })
    const maxW = Math.max(0, ...info.filter(Boolean).map((x) => x.left.length))
    this.items(w, items, commaCol, { multiCase: true }, (it, idx) => {
      const inf = info[idx]
      if (!inf) return w.frag(this.inline(it.toks, w.col, { multiCase: true }))
      w.add(`${inf.left.padEnd(maxW)} ${piece(it.toks[inf.a])} `)
      w.frag(this.inline(it.toks.slice(inf.a + 1), w.col, { multiCase: true }))
    })
  }

  dmlClauses(w, clauses, col) {
    for (const c of clauses) {
      w.comments(takeLead(c.toks[0]), col)
      if (c.name === 'SET') this.setList(w, c.toks, col + 3, col + 5)
      else if (c.name === 'OUTPUT') this.output(w, c.toks, col)
      else if (c.name === 'FROM') this.fromClause(w, c.toks, col)
      else if (c.name === 'WHERE') this.condClause(w, c.toks, col)
      else if (c.name) {
        w.line(rioCol(col, c.toks[0].u), `${withMarks(c.toks[0].u, c.toks[0])} `)
        w.frag(this.inline(c.toks.slice(1), w.col))
      } else w.add(' ').frag(this.inline(c.toks, w.col))
    }
  }

  update(toks, col) {
    const mods = []
    const k = this.topMods(toks, 1, mods)
    const setAt = findTopWord(toks, k, ['SET'])
    const target = toks.slice(k, setAt)
    const clauses = splitClauses(toks.slice(setAt), (ts, j) => (isW(ts[j], 'SET', 'OUTPUT', 'FROM', 'WHERE', 'OPTION') ? ts[j].u : null))
    if (!clauses.some((c) => c.name === 'FROM')) this.qualify(target, 0)
    const w = new Writer()
    w.line(col, `${withMarks('UPDATE', toks[0])} `)
    if (mods.length) w.frag(this.inline(mods, w.col)).add(' ')
    w.frag(this.inline(target, w.col))
    this.dmlClauses(w, clauses, col)
    return w.L
  }

  del(toks, col) {
    const mods = []
    let k = this.topMods(toks, 1, mods)
    let firstFrom = null
    if (isW(toks[k], 'FROM')) firstFrom = toks[k++]
    const tEnd = findTopWord(toks, k, ['OUTPUT', 'FROM', 'WHERE', 'OPTION'])
    const target = toks.slice(k, tEnd)
    const clauses = splitClauses(toks.slice(tEnd), (ts, j) => (isW(ts[j], 'OUTPUT', 'FROM', 'WHERE', 'OPTION') ? ts[j].u : null))
    const hasFrom = clauses.some((c) => c.name === 'FROM')
    const w = new Writer()
    w.line(col, withMarks('DELETE', toks[0]))
    if (mods.length) w.add(' ').frag(this.inline(mods, w.col))
    if (firstFrom && !hasFrom) {
      this.ctx.ext('delete-from', 'DELETE FROM X: o FROM vai para a linha de baixo, no rio, como no DELETE O / FROM do padrão.')
      this.fromClause(w, [firstFrom, ...target], col)
    } else if (firstFrom) {
      w.add(` ${withMarks('FROM', firstFrom)} `).frag(this.inline(target, w.col))
    } else {
      if (!hasFrom) this.qualify(target, 0)
      w.add(' ').frag(this.inline(target, w.col))
    }
    this.dmlClauses(w, clauses, col)
    return w.L
  }

  /* ── MERGE ── */
  merge(toks, col) {
    const w = new Writer()
    const usingAt = findTopWord(toks, 1, ['USING'])
    const head = toks.slice(1, usingAt)
    let h = 0
    if (isW(head[h], 'TOP')) h = head[h + 1]?.v === '(' ? matchParen(head, h + 1) + 1 : h + 2
    if (isW(head[h], 'INTO')) h++
    this.qualify(head, h)
    w.line(rioCol(col, 'MERGE'), `${withMarks('MERGE', toks[0])} `)
    w.frag(this.inline(head, w.col))
    if (usingAt >= toks.length) return w.L
    const onAt = findTopWord(toks, usingAt + 1, ['ON'])
    const using = toks.slice(usingAt + 1, onAt)
    this.qualifySource(using)
    w.comments(takeLead(toks[usingAt]), col)
    w.line(rioCol(col, 'USING'), `${withMarks('USING', toks[usingAt])} `)
    w.frag(this.inline(using, w.col))
    if (onAt >= toks.length) return w.L
    const whenAt = findTopWord(toks, onAt + 1, ['WHEN', 'OUTPUT', 'OPTION'])
    w.comments(takeLead(toks[onAt]), col)
    w.line(rioCol(col, 'ON'), `${withMarks('ON', toks[onAt])} `)
    this.conds(w, splitConds(toks.slice(onAt + 1, whenAt)), col + 5)
    const sections = splitClauses(toks.slice(whenAt), (ts, j) => (isW(ts[j], 'WHEN', 'OUTPUT', 'OPTION') ? ts[j].u : null))
    for (const s of sections) {
      w.comments(takeLead(s.toks[0]), col)
      if (s.name === 'WHEN') this.mergeWhen(w, s.toks, col)
      else if (s.name === 'OUTPUT') this.output(w, s.toks, col)
      else if (s.name) {
        w.line(rioCol(col, s.toks[0].u), `${withMarks(s.toks[0].u, s.toks[0])} `)
        w.frag(this.inline(s.toks.slice(1), w.col))
      }
    }
    return w.L
  }

  mergeWhen(w, toks, col) {
    const thenAt = findTopWord(toks, 1, ['THEN'])
    const header = toks.slice(1, thenAt)
    const andAt = findTopWord(header, 0, ['AND'])
    const hw = header.slice(0, andAt)
    w.line(rioCol(col, 'WHEN'), `${withMarks('WHEN', toks[0])} `)
    w.frag(this.inline(hw, w.col))
    if (andAt < header.length) {
      const andTok = header[andAt]
      const conds = splitConds(header.slice(andAt + 1))
      if (hw.length === 1 && isW(hw[0], 'MATCHED')) w.add(` ${withMarks('AND', andTok)} `)
      else {
        w.comments(takeLead(andTok), col)
        w.line(rioCol(col, 'AND'), `${withMarks('AND', andTok)} `)
      }
      this.conds(w, conds, col + 5)
    }
    if (thenAt >= toks.length) return
    const thenTok = toks[thenAt]
    const action = toks.slice(thenAt + 1)
    const ac = col + 7
    w.comments(takeLead(thenTok), col)
    w.line(rioCol(col, 'THEN'), `${withMarks('THEN', thenTok)} `)
    const a0 = action[0]
    if (isW(a0, 'UPDATE')) {
      w.add(withMarks('UPDATE', a0))
      const setAt = findTopWord(action, 1, ['SET'])
      if (setAt < action.length) this.setList(w, action.slice(setAt), ac + 3, ac + 5)
    } else if (isW(a0, 'INSERT')) {
      w.add(withMarks('INSERT', a0))
      let k = 1
      if (action[k]?.v === '(') {
        const c = matchParen(action, k)
        w.add(' ')
        this.parenList(w, splitByComma(action.slice(k + 1, c)), {}, { open: action[k], close: action[c] })
        k = c + 1
      }
      if (isW(action[k], 'VALUES')) {
        const vt = action[k++]
        w.comments(takeLead(vt), ac)
        w.line(ac, `${withMarks('VALUES', vt)} `)
        if (action[k]?.v === '(') {
          const c = matchParen(action, k)
          this.parenList(w, splitByComma(action.slice(k + 1, c)), { multiCase: true }, { open: action[k], close: action[c] })
          k = c + 1
        }
      } else if (isW(action[k], 'DEFAULT')) {
        w.line(ac, '')
        w.frag(this.inline(action.slice(k), ac))
        k = action.length
      }
      if (k < action.length) w.add(' ').frag(this.inline(action.slice(k), w.col))
    } else w.frag(this.inline(action, w.col))
  }

  /* ── DECLARE / CREATE TABLE ── */
  declare(toks, col) {
    const items = splitByComma(toks.slice(1))
    prepOwn(items)
    const kinds = items.map((it) => {
      const [name, second] = it.toks
      if (name?.t !== 'var') return { kind: 'other' }
      if (isW(second, 'TABLE') || (isW(second, 'AS') && isW(it.toks[2], 'TABLE'))) return { kind: 'table' }
      if (isW(second, 'CURSOR')) return { kind: 'other' }
      const eq = findTop(it.toks, (t) => t.t === 'op' && t.v === '=', 1)
      const type = it.toks.slice(1, eq < 0 ? it.toks.length : eq)
      const typeStr = this.inline(type, 0)
      if (typeStr.length > 1) return { kind: 'other' }
      return { kind: 'scalar', name, typeStr: typeStr[0], eq, def: eq < 0 ? null : it.toks.slice(eq + 1) }
    })
    const scalars = kinds.filter((k) => k.kind === 'scalar')
    const nameW = Math.max(0, ...scalars.map((k) => k.name.out.length)) + 1
    const typeW = Math.max(0, ...scalars.filter((k) => k.def).map((k) => k.typeStr.length)) + 1
    const w = new Writer()
    w.line(col, `${withMarks('DECLARE', toks[0])} `)
    this.items(w, items, col + 6, {}, (it, idx) => {
      const kd = kinds[idx]
      if (kd.kind === 'scalar') {
        w.add(piece(kd.name).padEnd(nameW))
        if (kd.def) {
          w.add(`${kd.typeStr.padEnd(typeW)}${piece(it.toks[kd.eq])} `)
          w.frag(this.inline(kd.def, w.col, { multiCase: true }))
        } else w.add(kd.typeStr)
      } else if (kd.kind === 'table') {
        const open = it.toks.findIndex((t) => t.v === '(')
        const close = open < 0 ? -1 : matchParen(it.toks, open)
        if (close < 0) return w.frag(this.inline(it.toks, w.col))
        w.frag(this.inline(it.toks.slice(0, open), w.col)).add(' ')
        this.tableDef(w, it.toks[open], it.toks[close], it.toks.slice(open + 1, close))
        if (close + 1 < it.toks.length) w.add(' ').frag(this.inline(it.toks.slice(close + 1), w.col))
      } else {
        const forAt = findTopWord(it.toks, 1, ['FOR'])
        w.frag(this.inline(it.toks.slice(0, forAt + 1), w.col))
        if (forAt < it.toks.length - 1) {
          this.ctx.ext('cursor', 'DECLARE … CURSOR FOR: o SELECT do cursor vai na linha seguinte, 2 espaços à direita do DECLARE.')
          w.lines(this.query(it.toks.slice(forAt + 1), col + 2))
        }
      }
    })
    return w.L
  }

  colDef(toks) {
    const t0 = toks[0]
    if (!t0 || isW(t0, 'CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'INDEX', 'PERIOD')) return { kind: 'other' }
    if (isW(toks[1], 'AS')) return { kind: 'col', name: piece(t0), type: '', nullity: null, rest: toks.slice(1), extra: '' }
    let k = 1
    const typeToks = []
    if (toks[k]) {
      typeToks.push(toks[k++])
      while (toks[k]?.v === '.' && toks[k + 1]) typeToks.push(toks[k++], toks[k++])
      if (toks[k]?.v === '(') {
        const c = matchParen(toks, k)
        typeToks.push(...toks.slice(k, c + 1))
        k = c + 1
      }
    }
    const rest = []
    let nullity = null
    let extra = ''
    let depth = 0
    for (let j = k; j < toks.length; j++) {
      const t = toks[j]
      if (t.v === '(') depth++
      else if (t.v === ')') depth--
      if (depth === 0 && !nullity && isW(t, 'NOT') && isW(toks[j + 1], 'NULL')) {
        nullity = 'NOT NULL'
        extra = marks(t, toks[j + 1])
        j++
        continue
      }
      if (depth === 0 && !nullity && isW(t, 'NULL') && !isW(toks[j - 1], 'DEFAULT') && toks[j - 1]?.t !== 'op') {
        nullity = 'NULL'
        extra = marks(t)
        continue
      }
      rest.push(t)
    }
    return { kind: 'col', name: piece(t0), type: this.inline(typeToks, 0).join(' '), nullity, rest, extra }
  }

  tableDef(w, open, close, toks) {
    const rows = splitByComma(toks)
    prepOwn(rows)
    const info = rows.map((r) => this.colDef(r.toks))
    const cols = info.filter((x) => x.kind === 'col')
    const nameW = Math.max(0, ...cols.map((c) => c.name.length)) + 1
    const typeW = Math.max(0, ...cols.map((c) => c.type.length)) + 1
    const hasNull = cols.some((c) => c.nullity)
    this.parenList(w, rows, {}, { open, close }, (r, idx) => {
      const c = info[idx]
      if (c.kind !== 'col') return w.frag(this.inline(r.toks, w.col))
      let s = c.name.padEnd(nameW)
      if (hasNull) s += c.type.padEnd(typeW) + (c.nullity ?? '').padStart(8)
      else s += c.rest.length ? c.type.padEnd(typeW - 1) : c.type
      w.add(s)
      if (c.rest.length) w.add(' ').frag(this.inline(c.rest, w.col))
      if (c.extra) w.add(` ${c.extra}`)
    })
  }

  createTable(toks, col) {
    const ns = 2
    const k = readName(toks, ns)
    const name = toks.slice(ns, k)
    if (name[0]?.t !== 'temp') this.qualify(name, 0)
    if (toks[k]?.v !== '(') return this.generic(toks, col)
    const c = matchParen(toks, k)
    if (c < 0) return this.generic(toks, col)
    const w = new Writer()
    w.line(col, `${withMarks('CREATE TABLE', toks[0], toks[1])} `)
    w.frag(this.inline(name, w.col)).add(' ')
    this.tableDef(w, toks[k], toks[c], toks.slice(k + 1, c))
    if (c + 1 < toks.length) w.add(' ').frag(this.inline(toks.slice(c + 1), w.col))
    return w.L
  }

  /* ── DROP / EXEC / SET / transação ── */
  drop(toks, col) {
    const what = toks[1]
    if (!isW(what, 'TABLE', 'VIEW', 'PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER', 'SYNONYM', 'SEQUENCE')) return this.generic(toks, col)
    let k = 2
    let ifExists = false
    if (isW(toks[k], 'IF') && isW(toks[k + 1], 'EXISTS')) {
      ifExists = true
      k += 2
    }
    const names = splitByComma(toks.slice(k))
    const kwText = `DROP ${what.u === 'PROC' ? 'PROCEDURE' : what.u}`
    if (names.length > 1) this.ctx.note('drop-split', 'DROP com várias tabelas separado em uma linha por tabela')
    const w = new Writer()
    names.forEach((n, idx) => {
      const nt = n.toks
      const isTemp = nt[0]?.t === 'temp'
      if (!isTemp) this.qualify(nt, 0)
      let ie = ifExists
      if (!ie && isTemp && what.u === 'TABLE') {
        ie = true
        this.ctx.note('drop-ie', 'DROP TABLE #t → DROP TABLE IF EXISTS #t')
      }
      if (idx > 0) w.comments([...n.commaLead, ...takeLead(nt[0])], col)
      const head = idx === 0 ? withMarks(kwText, toks[0], what, ...(ifExists ? [toks[2], toks[3]] : [])) : kwText
      w.line(col, `${head}${ie ? ' IF EXISTS' : ''} `)
      w.frag(this.inline(nt, w.col))
      if (idx < names.length - 1) w.add(';')
      if (n.trailing.length) w.add(` ${n.trailing.map(cm).join(' ')}`)
    })
    return w.L
  }

  exec(toks, col) {
    let k = 1
    const w = new Writer()
    w.line(col, `${withMarks(toks[0].u, toks[0])} `)
    if (toks[k]?.v === '(') {
      w.frag(this.inline(toks.slice(k), w.col))
      return w.L
    }
    if (toks[k]?.t === 'var' && toks[k + 1]?.v === '=') {
      w.add(`${piece(toks[k])} ${piece(toks[k + 1])} `)
      k += 2
    }
    const ns = k
    k = readName(toks, k)
    const name = toks.slice(ns, k)
    if (name.length === 1 && name[0].t !== 'var' && !/^(sp_|xp_)/i.test(name[0].out ?? '')) this.qualify(name, 0)
    w.frag(this.inline(name, w.col))
    const rest = toks.slice(k)
    if (!rest.length) return w.L
    w.add(' ')
    const args = splitByComma(rest)
    if (args.length === 1) {
      w.frag(this.inline(rest, w.col))
      return w.L
    }
    this.ctx.ext('exec-args', 'EXEC com vários parâmetros: um por linha, vírgula 2 colunas antes do primeiro parâmetro e "=" alinhados.')
    prepOwn(args)
    const argCol = w.col
    const info = args.map((a) => (a.toks[0]?.t === 'var' && a.toks[1]?.t === 'op' && a.toks[1].v === '=' ? piece(a.toks[0]) : null))
    const maxW = Math.max(0, ...info.filter(Boolean).map((s) => s.length))
    this.items(w, args, argCol - 2, {}, (a, idx) => {
      if (!info[idx]) return w.frag(this.inline(a.toks, w.col))
      w.add(`${info[idx].padEnd(maxW)} ${piece(a.toks[1])} `)
      w.frag(this.inline(a.toks.slice(2), w.col))
    })
    return w.L
  }

  tran(toks) {
    const h = toks[0]
    const t1 = toks[1]
    if (h.u === 'BEGIN' && isW(t1, 'TRAN')) {
      t1.out = 'TRANSACTION'
      this.ctx.note('tran', 'TRAN → TRANSACTION')
    } else if (h.u === 'COMMIT' || h.u === 'ROLLBACK') {
      if (isW(t1, 'TRAN', 'WORK')) {
        t1.out = 'TRANSACTION'
        this.ctx.note('tran', 'TRAN → TRANSACTION')
      } else if (!isW(t1, 'TRANSACTION')) {
        this.ctx.note(`tran-full:${h.u}`, `${h.u} → ${h.u} TRANSACTION`)
        return [h, mk('TRANSACTION'), ...toks.slice(1)]
      }
    }
    return toks
  }

  generic(toks, col) {
    const w = new Writer()
    w.line(col, '')
    w.frag(this.inline(toks, col))
    return w.L
  }

  dispatch(toks, col) {
    const h = toks[0]
    const u = h.t === 'word' ? h.u : h.v
    switch (u) {
      case 'SELECT':
        return this.query(toks, col)
      case 'WITH':
        if (cteAt(toks, 0)) return this.withCte(toks, col)
        break
      case 'INSERT':
        return this.insert(toks, col)
      case 'UPDATE':
        if (findTopWord(toks, 1, ['SET']) < toks.length) return this.update(toks, col)
        break
      case 'DELETE':
        return this.del(toks, col)
      case 'MERGE':
        return this.merge(toks, col)
      case 'DECLARE':
        return this.declare(toks, col)
      case 'SET': {
        const w = new Writer()
        w.line(col, '')
        w.frag(this.inline(toks, col, { multiCase: true }))
        return w.L
      }
      case 'EXEC':
      case 'EXECUTE':
        return this.exec(toks, col)
      case 'CREATE':
        if (isW(toks[1], 'TABLE')) return this.createTable(toks, col)
        if (isW(toks[1], 'INDEX', 'UNIQUE', 'CLUSTERED', 'NONCLUSTERED')) {
          const on = findTopWord(toks, 1, ['ON'])
          if (on < toks.length) this.qualifySource(toks.slice(on + 1))
        }
        break
      case 'DROP':
        return this.drop(toks, col)
      case 'TRUNCATE':
      case 'ALTER':
        if (isW(toks[1], 'TABLE')) this.qualify(toks, 2)
        break
      case 'BEGIN':
      case 'COMMIT':
      case 'ROLLBACK':
        return this.generic(this.tran(toks), col)
      default:
    }
    return this.generic(toks, col)
  }

  statement(toks, ind) {
    let body = toks
    let semi = null
    if (body.length && body[body.length - 1].t === 'punct' && body[body.length - 1].v === ';') {
      semi = body[body.length - 1]
      body = body.slice(0, -1)
    }
    if (!body.length) return semi ? commentLines([...semi.lead, ...semi.trail], ind) : []
    this.ctx.stats.statements++
    let lines
    try {
      lines = this.dispatch(body, ind)
    } catch (err) {
      this.ctx.stats.fallbacks++
      this.ctx.warn('fallback', `Instrução na linha ${body[0].line} não pôde ser estruturada (${err.message}); mantida em uma linha.`)
      lines = this.generic(body, ind)
    }
    const last = lines.length - 1
    lines[last] += ';'
    const m = semi ? marks(semi) : ''
    if (m) lines[last] += ` ${m}`
    return lines
  }

  /* ── nós estruturais ── */
  list(nodes, ind) {
    const out = []
    let carryBlank = false
    nodes.forEach((node, idx) => {
      const f = node.first
      const blank = carryBlank || (f ? (f.lead?.length ? f.lead[0].nl >= 2 : f.nl >= 2) : false)
      const lines = this.node(node, ind)
      if (!lines.length) {
        carryBlank = blank
        return
      }
      carryBlank = false
      if (idx > 0 && blank && out.length) out.push('')
      out.push(...lines)
    })
    return out
  }

  node(node, ind, flags = {}) {
    const f = node.first
    const lead = f ? takeLead(f) : []
    const pre = commentLines(lead, ind)
    if (lead.length && f.nl >= 2 && node.k !== 'comments') pre.push('')
    let body = []
    switch (node.k) {
      case 'empty':
        body = commentLines(node.toks[0].trail, ind)
        break
      case 'comments':
        break
      case 'stmt':
        body = this.statement(node.toks, ind)
        break
      case 'raw':
        body = this.generic(node.toks, ind)
        break
      case 'label':
        body = [`${pad(ind)}${piece(node.toks[0])}${withMarks(':', node.toks[1])}`]
        break
      case 'go':
        body = [withMarks(node.toks.map((t) => t.out).join(' '), ...node.toks)]
        break
      case 'block':
        body = this.blockNode(node, ind, flags)
        break
      case 'try':
        body = this.tryNode(node, ind, flags)
        break
      case 'if':
        body = this.ifNode(node, ind)
        break
      case 'while':
        body = this.whileNode(node, ind)
        break
      case 'module':
        body = this.moduleNode(node)
        break
      default:
    }
    return [...pre, ...body]
  }

  blockNode(n, ind, flags) {
    const out = [pad(ind) + withMarks('BEGIN', n.begin)]
    out.push(...this.list(n.body, ind + 2))
    if (n.end) out.push(...commentLines(takeLead(n.end), ind + 2))
    out.push(pad(ind) + withMarks(flags.noSemi ? 'END' : 'END;', n.end, n.semi))
    return out
  }

  tryNode(n, ind, flags = {}) {
    const out = [pad(ind) + withMarks('BEGIN TRY', ...n.bt)]
    out.push(...this.list(n.tryBody, ind + 2))
    if (n.et) out.push(...commentLines(takeLead(n.et[0]), ind + 2))
    out.push(pad(ind) + withMarks('END TRY', ...(n.et ?? []), ...n.extra))
    if (n.bc) out.push(...commentLines(takeLead(n.bc[0]), ind))
    out.push(pad(ind) + withMarks('BEGIN CATCH', ...(n.bc ?? [])))
    out.push(...this.list(n.catchBody, ind + 2))
    if (n.ec) out.push(...commentLines(takeLead(n.ec[0]), ind + 2))
    out.push(pad(ind) + withMarks(flags.noSemi ? 'END CATCH' : 'END CATCH;', ...(n.ec ?? []), n.semi))
    return out
  }

  branch(node, ind, flags = {}) {
    if (!node) return []
    if (node.k === 'block' || node.k === 'try') return this.node(node, ind, flags)
    return this.node(node, ind + 2, flags)
  }

  ifNode(n, ind) {
    const w = new Writer()
    w.line(ind, `${withMarks('IF', n.ifTok)} `)
    w.frag(this.inline(n.cond, w.col))
    const out = [...w.L, ...this.branch(n.then, ind, { noSemi: !!n.els })]
    if (n.elseTok) {
      out.push(...commentLines(takeLead(n.elseTok), ind))
      const e = n.els
      if (e?.k === 'if') {
        out.push(...commentLines(takeLead(e.first), ind))
        const sub = this.ifNode(e, ind)
        sub[0] = `${pad(ind)}${withMarks('ELSE', n.elseTok)} ${sub[0].trimStart()}`
        out.push(...sub)
      } else {
        out.push(pad(ind) + withMarks('ELSE', n.elseTok))
        out.push(...this.branch(e, ind))
      }
    }
    return out
  }

  whileNode(n, ind) {
    this.ctx.ext('while', 'WHILE segue a regra do IF: BEGIN e END; na coluna do WHILE.')
    const w = new Writer()
    w.line(ind, `${withMarks('WHILE', n.tok)} `)
    w.frag(this.inline(n.cond, w.col))
    return [...w.L, ...this.branch(n.body, ind)]
  }

  /** Separa o corpo do módulo do BEGIN … END externo (se houver). */
  unwrapBody(body, label) {
    const isNoise = (n) => n.k === 'empty' && !nodeComments(n).length
    const firstReal = body.findIndex((n) => !isNoise(n))
    const b = body[firstReal]
    if (b?.k === 'block') {
      const rest = body.slice(firstReal + 1)
      if (rest.some((n) => !isNoise(n))) {
        this.ctx.warn('after-end', `Havia instruções depois do END de ${label}: elas já faziam parte do corpo e foram mantidas dentro do BEGIN … END.`)
      }
      return { pre: body.slice(0, firstReal), inner: [...b.body, ...rest], begin: b.begin, end: b.end, semi: b.semi }
    }
    if (body.some((n) => !isNoise(n))) this.ctx.note('wrap', 'Corpo do módulo envolvido em BEGIN … END')
    return { pre: [], inner: body, begin: null, end: null, semi: null }
  }

  procPrelude(inner) {
    const kept = []
    let hadNocount = false
    let hadIso = false
    for (const n of inner) {
      if (n.k === 'stmt') {
        const s = stmtWords(n)
        if (s === 'SET NOCOUNT ON' || /^SET TRANSACTION ISOLATION LEVEL /.test(s)) {
          if (s === 'SET NOCOUNT ON') hadNocount = true
          else {
            hadIso = true
            if (s !== 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED') this.ctx.warn('iso', `"${s}" foi substituído por READ UNCOMMITTED, como manda o padrão. Confira se a procedure dependia do outro nível.`)
          }
          const c = commentsNode(n)
          if (c) kept.push(c)
          continue
        }
      }
      kept.push(n)
    }
    if (!hadIso) this.ctx.note('iso-add', 'Adicionado SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED')
    if (!hadNocount) this.ctx.note('nocount-add', 'Adicionado SET NOCOUNT ON')
    return kept
  }

  moduleNode(node) {
    const ctx = this.ctx
    const target = `CREATE OR ALTER ${node.type}`
    if (node.orig !== target) ctx.note(`coa:${node.orig}`, `${node.orig} → ${target}`)
    if (node.type === 'PROCEDURE') ctx.stats.procedures++
    else ctx.ext(node.type.toLowerCase(), `${node.type}: mesmo cabeçalho da procedure (CREATE OR ALTER, parâmetros em "( @P", AS, GO)${node.type === 'VIEW' || node.type === 'FUNCTION' ? '; corpo sem BEGIN no nível 1' : ''}.`)
    this.qualify(node.name, node.name.length - 1)
    const w = new Writer()
    w.line(0, `${withMarks(target, ...node.head)} `)
    w.frag(this.inline(node.name, w.col))

    if (node.type === 'PROCEDURE' || node.type === 'FUNCTION') {
      const p = node.params
      const items = p ? splitByComma(p.toks).filter((it) => it.toks.length) : []
      if (!items.length) {
        if (node.type === 'FUNCTION') w.add(withMarks('()', p?.open, p?.close))
      } else {
        if (p.bare) ctx.note('params', 'Parâmetros colocados entre parênteses')
        prepOwn(items)
        const nameW = Math.max(...items.map((it) => (it.toks[0]?.out ?? '').length)) + 1
        w.line(0, '')
        this.parenList(w, items, {}, p, (it) => {
          const nm = it.toks[0]
          if (nm?.t !== 'var') return w.frag(this.inline(it.toks, w.col))
          w.add(piece(nm).padEnd(nameW))
          w.frag(this.inline(it.toks.slice(1), w.col))
        })
      }
    }
    if (node.cols) w.add(' ').frag(this.inline([node.cols.open, ...node.cols.toks, node.cols.close], w.col))
    if (node.returns) {
      const r = node.returns
      w.comments(takeLead(r[0]), 0)
      w.line(0, `${withMarks('RETURNS', r[0])} `)
      if (r[1]?.t === 'var' && isW(r[2], 'TABLE') && r[3]?.v === '(') {
        const c = matchParen(r, 3)
        w.add(`${piece(r[1])} ${withMarks('TABLE', r[2])} `)
        this.tableDef(w, r[3], r[c], r.slice(4, c))
        if (c + 1 < r.length) w.add(' ').frag(this.inline(r.slice(c + 1), w.col))
      } else w.frag(this.inline(r.slice(1), w.col))
    }
    if (node.on) {
      const on = node.on.slice(1)
      this.qualifySource(on)
      w.comments(takeLead(node.on[0]), 0)
      w.line(0, `${withMarks('ON', node.on[0])} `)
      w.frag(this.inline(on, w.col))
    }
    for (const part of [node.with, node.events]) {
      if (!part?.length) continue
      w.comments(takeLead(part[0]), 0)
      w.line(0, '')
      w.frag(this.inline(part, 0))
    }
    if (node.as) w.comments(takeLead(node.as), 0)
    w.line(0, withMarks('AS', node.as))
    const out = [...w.L]

    const firstReal = node.body.find((n) => n.k !== 'empty' || nodeComments(n).length)
    const useBlock = node.type === 'PROCEDURE' || node.type === 'TRIGGER' || (node.type === 'FUNCTION' && firstReal?.k === 'block')
    if (useBlock) {
      const { pre, inner, begin, end, semi } = this.unwrapBody(node.body, `${node.type} ${node.name.map((t) => t.out).join('')}`)
      out.push(...this.list(pre, 0))
      if (begin) out.push(...commentLines(takeLead(begin), 0))
      out.push(withMarks('BEGIN', begin))
      if (node.type === 'PROCEDURE') {
        const kept = this.procPrelude(inner)
        out.push('  SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;', '  SET NOCOUNT ON;')
        const rest = this.list(kept, 2)
        if (rest.length) out.push('', ...rest)
      } else out.push(...this.list(inner, 2))
      if (end) out.push(...commentLines(takeLead(end), 2))
      out.push(withMarks('END;', end, semi))
    } else out.push(...this.list(node.body, 2))
    out.push(node.go ? withMarks(node.go.toks.map((t) => t.out).join(' '), ...node.go.toks) : 'GO')
    return out
  }
}

/* ───────────────────────── finalização ───────────────────────── */

const TAIL_RE = new RegExp(`((?:\\s*${M1}[^${M2}]*${M2}|\\s*;)+)$`)

function finalizeLine(line) {
  let s = line.replace(/\s+$/, '')
  if (!s.includes(M1)) return s
  const m = TAIL_RE.exec(s)
  let tail = ''
  if (m && m[1].includes(M1)) {
    s = s.slice(0, m.index)
    const texts = [...m[1].matchAll(new RegExp(`${M1}([^${M2}]*)${M2}`, 'g'))].map((x) => x[1])
    if (m[1].includes(';')) s += ';'
    tail = ` --${texts.join(' --')}`
  }
  s = s.replace(new RegExp(`${M1}([^${M2}]*)${M2}`, 'g'), (_, t) => `/*${t.replace(/\*\//g, '* /')} */`)
  return (s + tail).replace(/\s+$/, '')
}

function joinLines(lines) {
  const out = []
  for (const raw of lines) {
    const l = finalizeLine(raw)
    if (l === '' && (out.length === 0 || out[out.length - 1] === '')) continue
    out.push(l)
    if (/^GO(\s+\d+)?(\s+--.*)?$/.test(l)) out.push('')
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

/* ───────────────────────── verificação de integridade ───────────────────────── */

function fingerprint(tokens, comments) {
  const bag = new Map()
  const temps = new Set()
  const add = (k) => bag.set(k, (bag.get(k) ?? 0) + 1)
  for (const t of tokens) {
    const v = t.out ?? t.v
    if (t.t === 'string') add(`literal ${v}`)
    else if (t.t === 'number') add(`número ${v.toLowerCase()}`)
    else if (t.t === 'var') add(`variável ${v.toUpperCase()}`)
    else if (t.t === 'temp') temps.add(v.toUpperCase())
    else if (t.t === 'word' || t.t === 'qid') {
      const name = t.t === 'qid' ? t.v.slice(1, -1) : t.v
      const up = name.toUpperCase()
      if (t.t === 'word' && KEYWORDS.has(up)) continue
      if (up === 'DBO') continue
      add(`identificador ${up}`)
    }
  }
  for (const c of comments) {
    const text = c.kind === 'line' ? c.text : c.text.replace(/^\/\*|\*\/$/g, '')
    for (const part of text.split(/--|\/\*|\*\//)) {
      const p = part.replace(/\s+/g, ' ').trim()
      if (p) add(`comentário ${p}`)
    }
  }
  return { bag, temps }
}

function allComments(tokens, eof) {
  return [...tokens.flatMap((t) => [...t.lead, ...t.trail]), ...eof]
}

function diffFingerprints(a, b, removedStrings) {
  const bag = new Map(a.bag)
  for (const s of removedStrings) {
    const k = `literal ${s}`
    if (bag.has(k)) bag.set(k, bag.get(k) - 1)
  }
  const issues = []
  const keys = new Set([...bag.keys(), ...b.bag.keys()])
  for (const k of keys) {
    const x = bag.get(k) ?? 0
    const y = b.bag.get(k) ?? 0
    if (x > y) issues.push(`${k.slice(0, 80)} sumiu (${x} → ${y})`)
    else if (y > x) issues.push(`${k.slice(0, 80)} apareceu (${x} → ${y})`)
  }
  for (const t of a.temps) if (!b.temps.has(t)) issues.push(`temporária ${t} sumiu`)
  return issues
}

/* ───────────────────────── checklist ───────────────────────── */

function buildChecklist(output, ctx, integrity, hadProcedure) {
  const ok = (id, label, detail = '') => ({ id, label, status: 'ok', detail })
  const warn = (id, label, detail) => ({ id, label, status: 'warn', detail })
  const na = (id, label, detail) => ({ id, label, status: 'na', detail })
  const tabs = /\t/.test(output)
  const fallbacks = ctx.stats.fallbacks
  const badTemps = [...new Set((output.match(/(?<![#\w])#(?!#)[\p{L}\p{N}_@$#]+/gu) ?? []).filter((n) => !/^#t[A-Z0-9_]+$/.test(n)))]
  const badVars = [...new Set((output.replace(/'(?:[^']|'')*'/g, "''").replace(/--.*$/gm, '').match(/(?<!@)@[\p{L}\p{N}_$#]+/gu) ?? []).filter((v) => !/^@[A-Z][A-Za-z0-9]*$/.test(v)))]
  return [
    ok('upper', 'Palavras-chave em MAIÚSCULAS', 'Aplicado em todo o script (inserted/deleted ficam em minúsculo).'),
    ctx.opts.qualifyDbo ? ok('dbo', 'Objetos permanentes com dbo.', ctx.changes.get('dbo') ? `${ctx.changes.get('dbo').count} referência(s) receberam dbo.` : 'Nenhum objeto sem schema encontrado.') : warn('dbo', 'Objetos permanentes com dbo.', 'Desativado nas opções.'),
    tabs ? warn('tabs', 'Indentação de 2 espaços, sem TAB', 'Há TAB dentro de literais de texto; o conteúdo de strings não é alterado.') : ok('tabs', 'Indentação de 2 espaços, sem TAB'),
    hadProcedure ? ok('header', 'CREATE OR ALTER PROCEDURE e parâmetros em ( @P / , @P / )') : na('header', 'CREATE OR ALTER PROCEDURE e parâmetros', 'Nenhuma procedure no script.'),
    hadProcedure ? ok('sets', 'SET TRANSACTION ISOLATION … e SET NOCOUNT ON, sem XACT_ABORT') : ctx.changes.has('xact') ? ok('sets', 'Sem SET XACT_ABORT ON', 'Removido.') : na('sets', 'SETs obrigatórios', 'Valem para procedures.'),
    fallbacks ? warn('rio', 'Palavras-chave no rio', `${fallbacks} instrução(ões) não reconhecida(s) ficaram em uma linha.`) : ok('rio', 'Palavras-chave no rio'),
    ok('commas', 'Vírgulas à esquerda, seguidas de espaço'),
    ok('parens', 'Listas entre parênteses com ) embaixo do ('),
    badTemps.length ? warn('temps', 'Temporárias #tNOME com DROP TABLE IF EXISTS', `Fora do padrão: ${badTemps.slice(0, 5).join(', ')}${ctx.opts.renameTemp ? '' : ' (renomeação desativada nas opções)'}.`) : ok('temps', 'Temporárias #tNOME com DROP TABLE IF EXISTS'),
    ok('create-table', 'CREATE TABLE com nome, tipo e nulidade alinhados'),
    ok('joins', 'JOIN embaixo do dbo do FROM, ON na mesma linha, AND sob o ON'),
    ok('equals', '"=" alinhados em SET, ON/AND, WHERE/AND e DECLARE'),
    ok('semicolon', 'Toda instrução termina com ;'),
    badVars.length ? warn('names', 'Variáveis em PascalCase', `Não renomeadas automaticamente (mudaria a interface da procedure): ${badVars.slice(0, 6).join(', ')}.`) : ok('names', 'Variáveis em PascalCase'),
    integrity.length ? warn('integrity', 'Verificação de integridade', integrity.slice(0, 4).join(' · ')) : ok('integrity', 'Verificação de integridade', 'Identificadores, literais e comentários conferidos com o original.'),
  ]
}

/* ───────────────────────── API ───────────────────────── */

export function formatTsql(input, options = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const ctx = new Ctx(opts)
  const src = input.replace(/\r\n?/g, '\n')
  const { tokens, eofComments } = lex(src)
  normalize(tokens, ctx)
  const before = fingerprint(tokens, allComments(tokens, eofComments))

  let depth = 0
  for (const t of tokens) {
    if (t.t === 'punct' && t.v === '(') depth++
    else if (t.t === 'punct' && t.v === ')') depth--
    if (depth < 0) {
      ctx.warn('parens', `Parêntese ")" sem abertura na linha ${t.line}.`)
      depth = 0
    }
  }
  if (depth > 0) ctx.warn('parens', `${depth} parêntese(s) "(" sem fechamento.`)
  const unterminated = tokens.find((t) => (t.t === 'string' && !/'$/.test(t.v)) || (t.t === 'qid' && !/[\]"]$/.test(t.v)))
  if (unterminated) ctx.warn('unterminated', `Texto ou identificador sem fechamento na linha ${unterminated.line}.`)

  const parser = new Parser(tokens, ctx)
  const nodes = parser.script()
  transform(nodes, ctx)
  const r = new Renderer(ctx)
  const lines = r.list(nodes, 0)
  if (eofComments.length) {
    if (lines.length) lines.push('')
    lines.push(...commentLines(eofComments, 0))
  }
  const outLines = joinLines(lines)
  const output = outLines.length ? `${outLines.join('\n')}\n` : ''

  const re = lex(output)
  const after = fingerprint(re.tokens, allComments(re.tokens, re.eofComments))
  const integrity = diffFingerprints(before, after, ctx.removedStrings)
  if (integrity.length) ctx.warn('integrity', `Verificação de integridade: ${integrity.slice(0, 3).join('; ')}. Revise o resultado.`)

  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
  return {
    output,
    changes: [...ctx.changes.values()],
    extensions: [...ctx.extensions.values()],
    warnings: ctx.warnings,
    checklist: buildChecklist(output, ctx, integrity, ctx.stats.procedures > 0),
    stats: { ...ctx.stats, inputLines: src ? src.split('\n').length : 0, outputLines: outLines.length, tokens: tokens.length, ms },
  }
}

/* ───────────────────────── reaproveitamento (Model Generator) ───────────────────────── */

/** Lexer + normalização + árvore de instruções, sem reescrever nada. */
export function parseTsql(input) {
  const ctx = new Ctx({ qualifyDbo: false, renameTemp: false, stripBrackets: true })
  const { tokens } = lex(input.replace(/\r\n?/g, '\n'))
  normalize(tokens, ctx)
  const nodes = new Parser(tokens, ctx).script()
  return { nodes, tokens, warnings: ctx.warnings }
}

export const internals = { isW, splitByComma, splitJoins, splitClauses, splitSetOps, selectClauseAt, findTopWord, findTop, matchParen, cteAt, readName, walkLists }
