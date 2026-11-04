/**
 * Motor do JSON Organizer — funções puras (sem DOM), executadas dentro do Web Worker.
 *
 * Caminhos (paths) são arrays: ['usuarios', 0, 'nome'] — strings para chaves de objeto,
 * números para índices de array.
 */

/* ───────────────────────── Tipos e resumo de nós ───────────────────────── */

export function typeOf(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v // object | string | number | boolean
}

// Cache de chaves por objeto: Object.keys() em objetos gigantes custa caro a cada expansão
const keysCache = new WeakMap()
export function keysOf(obj) {
  let k = keysCache.get(obj)
  if (!k) {
    k = Object.keys(obj)
    keysCache.set(obj, k)
  }
  return k
}

export function childCount(v) {
  const t = typeOf(v)
  if (t === 'array') return v.length
  if (t === 'object') return keysOf(v).length
  return 0
}

function previewOf(v, max = 120) {
  const t = typeOf(v)
  if (t === 'string') return v.length > max ? `${v.slice(0, max)}…` : v
  if (t === 'number' || t === 'boolean') return String(v)
  if (t === 'null') return 'null'
  if (t === 'array') return `${v.length} ${v.length === 1 ? 'item' : 'itens'}`
  const keys = keysOf(v)
  const head = keys.slice(0, 4).join(', ')
  return keys.length > 4 ? `${head}, …` : head
}

/** Resumo enviado à interface (nunca o valor inteiro de um container). */
export function summarize(key, v) {
  const type = typeOf(v)
  return {
    key,
    type,
    size: childCount(v),
    preview: previewOf(v),
    // strings longas: a interface pode pedir o valor completo sob demanda
    long: type === 'string' && v.length > 120,
  }
}

export function getAt(root, path) {
  let cur = root
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[seg]
  }
  return cur
}

/** Filhos de um nó paginados — base do lazy loading da Tree e Graph View. */
export function getChildren(root, path, offset = 0, limit = 500, around) {
  const node = getAt(root, path)
  const type = typeOf(node)
  // `around`: chave/índice que precisa estar visível (usado para revelar resultados de busca)
  if (around !== undefined && around !== null) {
    const idx = type === 'array' ? Number(around) : type === 'object' ? keysOf(node).indexOf(around) : -1
    if (idx >= 0) offset = Math.max(0, idx - Math.floor(limit / 5))
  }
  if (type === 'array') {
    const end = Math.min(node.length, offset + limit)
    const items = []
    for (let i = offset; i < end; i++) items.push(summarize(i, node[i]))
    return { items, total: node.length, offset }
  }
  if (type === 'object') {
    const keys = keysOf(node)
    const end = Math.min(keys.length, offset + limit)
    const items = []
    for (let i = offset; i < end; i++) items.push(summarize(keys[i], node[keys[i]]))
    return { items, total: keys.length, offset }
  }
  return { items: [], total: 0, offset: 0 }
}

/* ───────────────────────── Caminhos (JSONPath) ───────────────────────── */

const SIMPLE_KEY = /^[A-Za-z_$][\w$]*$/

export function pathToString(path) {
  let out = '$'
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else if (SIMPLE_KEY.test(seg)) out += `.${seg}`
    else out += `['${seg.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`
  }
  return out
}

/* ───────────────────────── Erros de sintaxe ───────────────────────── */

function posToLineCol(text, pos) {
  let line = 1
  let lastNl = -1
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lastNl = i
    }
  }
  return { line, col: pos - lastNl }
}

/**
 * Converte o erro do JSON.parse em linha/coluna + mensagem em português.
 * As mensagens variam entre motores (e o V8 recente às vezes omite a posição), então
 * quando necessário a posição é encontrada por um validador próprio (scanJsonError).
 */
export function locateJsonError(text, err) {
  const msg = String(err?.message ?? err)
  let pos = null
  const scanned = scanJsonError(text)
  let m = msg.match(/line (\d+) column (\d+)/i)
  if (m) return finish(Number(m[1]), Number(m[2]), scanned?.message)
  m = msg.match(/position (\d+)/i)
  if (m) pos = Number(m[1])
  if (pos === null && scanned) pos = scanned.pos
  const { line, col } = pos === null ? { line: null, col: null } : posToLineCol(text, pos)
  return finish(line, col, scanned?.message)

  function finish(line, col, scannedMessage) {
    const clean = msg
      .replace(/^JSON\.parse: /, '')
      .replace(/ in JSON at position \d+.*$/, '')
      .replace(/ at line \d+ column \d+ of the JSON data$/, '')
      .replace(/, ".*" is not valid JSON$/s, '')
    return { message: scannedMessage ?? translateJsonError(clean), raw: msg, line, col }
  }
}

/**
 * Validador JSON iterativo (sem recursão) que devolve a posição e a causa do primeiro erro.
 * Só é executado quando o JSON.parse já falhou.
 */
export function scanJsonError(text) {
  let i = 0
  const n = text.length
  const stack = [] // '{' | '['
  // estados: value | key | colon | after
  let state = 'value'
  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i)
      if (c === 32 || c === 9 || c === 10 || c === 13) i++
      else break
    }
  }
  const fail = (message, at = i) => ({ pos: at, message })
  const readString = () => {
    const start = i
    i++
    while (i < n) {
      const c = text[i]
      if (c === '"') {
        i++
        return null
      }
      if (c === '\\') {
        const e = text[i + 1]
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) return fail('Escape \\u inválido (use 4 dígitos hexadecimais)')
          i += 6
          continue
        }
        if (!'"\\/bfnrt'.includes(e)) return fail(`Escape inválido "\\${e ?? ''}" dentro de string`)
        i += 2
        continue
      }
      if (text.charCodeAt(i) < 32) return fail('Caractere de controle (ex.: quebra de linha) dentro de string — use \\n')
      i++
    }
    return fail('String não terminada (falta fechar aspas)', start)
  }

  ws()
  if (i >= n) return fail('Documento vazio')
  while (true) {
    ws()
    if (state === 'value') {
      if (i >= n) return fail('Fim inesperado do JSON: falta um valor')
      const c = text[i]
      if (c === '{') {
        stack.push('{')
        i++
        ws()
        if (text[i] === '}') {
          stack.pop()
          i++
          state = 'after'
        } else state = 'key'
        continue
      }
      if (c === '[') {
        stack.push('[')
        i++
        ws()
        if (text[i] === ']') {
          stack.pop()
          i++
          state = 'after'
        } else state = 'value'
        continue
      }
      if (c === '"') {
        const e = readString()
        if (e) return e
        state = 'after'
        continue
      }
      const lit = text.slice(i).match(/^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)/)
      if (lit) {
        i += lit[0].length
        state = 'after'
        continue
      }
      if (c === "'") return fail('Strings devem usar aspas duplas (")')
      if (c === ']' || c === '}') return fail(`"${c}" inesperado: vírgula sobrando antes do fechamento?`)
      if (/[A-Za-z_]/.test(c)) return fail(`Valor inválido "${text.slice(i).match(/^\w+/)[0]}" — strings precisam de aspas duplas`)
      return fail(`Caractere inesperado "${c}"`)
    }
    if (state === 'key') {
      if (i >= n) return fail('Fim inesperado do JSON dentro de um objeto')
      if (text[i] === '}') return fail('Vírgula sobrando antes de "}"')
      if (text[i] !== '"') return fail(text[i] === "'" ? 'Nomes de propriedade devem usar aspas duplas (")' : 'Nome de propriedade esperado (entre aspas duplas)')
      const e = readString()
      if (e) return e
      state = 'colon'
      continue
    }
    if (state === 'colon') {
      if (text[i] !== ':') return fail('Esperado ":" após o nome da propriedade')
      i++
      state = 'value'
      continue
    }
    // after: depois de um valor
    if (!stack.length) {
      if (i < n) return fail('Conteúdo extra após o fim do JSON')
      return null
    }
    if (i >= n) return fail(`Fim inesperado do JSON: falta fechar "${stack[stack.length - 1] === '{' ? '}' : ']'}"`)
    const top = stack[stack.length - 1]
    const c = text[i]
    if (c === ',') {
      i++
      state = top === '{' ? 'key' : 'value'
      continue
    }
    if ((top === '{' && c === '}') || (top === '[' && c === ']')) {
      stack.pop()
      i++
      continue
    }
    return fail(top === '{' ? `Esperado "," ou "}" após o valor da propriedade (encontrado "${c}")` : `Esperado "," ou "]" após o elemento do array (encontrado "${c}")`)
  }
}

function translateJsonError(msg) {
  const map = [
    [/Unexpected end of JSON input|unexpected end of data/i, 'Fim inesperado do JSON (falta fechar algum } ou ]?)'],
    [/Unexpected token '?(.)'?,?/i, (m) => `Caractere inesperado "${m[1]}"`],
    [/Expected ',' or '}' after property value/i, "Esperado ',' ou '}' após o valor da propriedade"],
    [/Expected ',' or ']' after array element/i, "Esperado ',' ou ']' após o elemento do array"],
    [/Expected property name or '}'/i, "Esperado nome de propriedade (entre aspas duplas) ou '}'"],
    [/Expected ':' after property name/i, "Esperado ':' após o nome da propriedade"],
    [/Bad control character in string literal/i, 'Caractere de controle inválido dentro de string'],
    [/Unterminated string/i, 'String não terminada (falta fechar aspas)'],
    [/Expected double-quoted property name/i, 'Nome de propriedade deve usar aspas duplas'],
    [/Unexpected non-whitespace character after JSON/i, 'Conteúdo extra após o fim do JSON'],
    [/No number after minus sign|Exponent part is missing|Unterminated fractional number/i, 'Número malformado'],
  ]
  for (const [re, out] of map) {
    const m = msg.match(re)
    if (m) return typeof out === 'function' ? out(m) : out
  }
  return msg
}

/* ───────────────────────── Estatísticas ───────────────────────── */

/**
 * Percorre a estrutura iterativamente (sem recursão → sem stack overflow em JSONs profundos).
 * Reporta progresso a cada N nós.
 */
export async function computeStats(root, { onProgress, isCancelled, yieldEvery = 200_000, yieldFn } = {}) {
  const stats = {
    objects: 0,
    arrays: 0,
    properties: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    maxDepth: 0,
    totalNodes: 0,
    maxArrayLength: 0,
    maxObjectKeys: 0,
    longestString: 0,
    depthHistogram: [],
    topKeys: [],
  }
  const keyFreq = new Map()
  const stack = [[root, 0]]
  let visited = 0

  while (stack.length) {
    const [v, depth] = stack.pop()
    visited++
    stats.totalNodes++
    if (depth > stats.maxDepth) stats.maxDepth = depth
    stats.depthHistogram[depth] = (stats.depthHistogram[depth] ?? 0) + 1

    if (v === null) stats.nulls++
    else if (Array.isArray(v)) {
      stats.arrays++
      if (v.length > stats.maxArrayLength) stats.maxArrayLength = v.length
      for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], depth + 1])
    } else if (typeof v === 'object') {
      stats.objects++
      const keys = keysOf(v)
      stats.properties += keys.length
      if (keys.length > stats.maxObjectKeys) stats.maxObjectKeys = keys.length
      for (const k of keys) {
        keyFreq.set(k, (keyFreq.get(k) ?? 0) + 1)
        stack.push([v[k], depth + 1])
      }
    } else if (typeof v === 'string') {
      stats.strings++
      if (v.length > stats.longestString) stats.longestString = v.length
    } else if (typeof v === 'number') stats.numbers++
    else if (typeof v === 'boolean') stats.booleans++

    if (visited % yieldEvery === 0) {
      onProgress?.(stats.totalNodes)
      if (yieldFn) await yieldFn()
      if (isCancelled?.()) throw Object.assign(new Error('Cancelado'), { cancelled: true })
    }
  }

  for (let i = 0; i < stats.depthHistogram.length; i++) stats.depthHistogram[i] ??= 0
  stats.topKeys = [...keyFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([key, count]) => ({ key, count }))
  stats.uniqueKeys = keyFreq.size
  return stats
}

/* ───────────────────────── Busca ───────────────────────── */

/**
 * Busca por chaves e/ou valores. Retorna até `limit` resultados com o caminho completo.
 * mode: 'all' | 'keys' | 'values'
 */
export async function searchJson(root, query, { mode = 'all', caseSensitive = false, regex = false, limit = 500, isCancelled, yieldFn, onProgress } = {}) {
  let test
  if (regex) {
    const re = new RegExp(query, caseSensitive ? '' : 'i')
    test = (s) => re.test(s)
  } else {
    const q = caseSensitive ? query : query.toLowerCase()
    test = (s) => (caseSensitive ? s : s.toLowerCase()).includes(q)
  }

  const results = []
  let total = 0
  let visited = 0
  // pilha guarda [valor, path]; o path só é materializado quando há match
  const stack = [[root, []]]
  while (stack.length) {
    const [v, path] = stack.pop()
    visited++
    if (v !== null && typeof v === 'object') {
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], [...path, i]])
      } else {
        const keys = keysOf(v)
        for (let i = keys.length - 1; i >= 0; i--) {
          const k = keys[i]
          const childPath = [...path, k]
          if (mode !== 'values' && test(k)) {
            total++
            if (results.length < limit) results.push({ path: childPath, match: 'key', preview: previewOf(v[k], 80), type: typeOf(v[k]) })
          }
          stack.push([v[k], childPath])
        }
      }
    } else if (mode !== 'keys' && path.length) {
      const s = v === null ? 'null' : String(v)
      if (test(s)) {
        total++
        if (results.length < limit) results.push({ path, match: 'value', preview: previewOf(v, 80), type: typeOf(v) })
      }
    }
    if (visited % 100_000 === 0) {
      onProgress?.(visited)
      if (yieldFn) await yieldFn()
      if (isCancelled?.()) throw Object.assign(new Error('Cancelado'), { cancelled: true })
    }
  }
  return { results, total, truncated: total > results.length, visited }
}

/* ───────────────────────── JSONPath ───────────────────────── */

/**
 * Avaliador de JSONPath (subconjunto amplo):
 *   $  .chave  ['chave']  [n]  [-n]  [*]  .*  ..chave  ..*  [a,b]  [ini:fim:passo]
 *   filtros: [?(@.preco > 10)]  [?(@.ativo)]  [?(@.nome == 'Ana')]  [?(@.tags.length > 2)]
 */
export function tokenizeJsonPath(expr) {
  const s = expr.trim()
  if (!s.startsWith('$')) throw new Error('JSONPath deve começar com $')
  const tokens = []
  let i = 1
  while (i < s.length) {
    const c = s[i]
    if (c === '.') {
      if (s[i + 1] === '.') {
        i += 2
        if (s[i] === '*') {
          tokens.push({ type: 'descendant', key: '*' })
          i++
        } else if (s[i] === '[') {
          tokens.push({ type: 'descendant', key: null })
        } else {
          const m = s.slice(i).match(/^[^.[\]]+/)
          if (!m) throw new Error(`Nome esperado após ".." na posição ${i}`)
          tokens.push({ type: 'descendant', key: m[0] })
          i += m[0].length
        }
        continue
      }
      i++
      if (s[i] === '*') {
        tokens.push({ type: 'wildcard' })
        i++
        continue
      }
      const m = s.slice(i).match(/^[^.[\]]+/)
      if (!m) throw new Error(`Nome de propriedade esperado na posição ${i}`)
      tokens.push({ type: 'key', keys: [m[0]] })
      i += m[0].length
      continue
    }
    if (c === '[') {
      const close = findBracketEnd(s, i)
      const inner = s.slice(i + 1, close).trim()
      i = close + 1
      if (inner === '*') tokens.push({ type: 'wildcard' })
      else if (inner.startsWith('?')) tokens.push({ type: 'filter', expr: inner.replace(/^\?\s*\(?/, '').replace(/\)\s*$/, '') })
      else if (/^-?\d*\s*:\s*-?\d*(\s*:\s*-?\d+)?$/.test(inner)) {
        const [a, b, st] = inner.split(':').map((x) => (x.trim() === '' ? null : Number(x)))
        tokens.push({ type: 'slice', start: a, end: b, step: st ?? 1 })
      } else {
        const parts = splitUnion(inner).map((p) => {
          const t = p.trim()
          if (/^-?\d+$/.test(t)) return Number(t)
          const q = t.match(/^(['"])(.*)\1$/)
          if (q) return q[2].replace(/\\(.)/g, '$1')
          throw new Error(`Seletor inválido: [${inner}]`)
        })
        tokens.push({ type: 'key', keys: parts })
      }
      continue
    }
    throw new Error(`Caractere inesperado "${c}" na posição ${i}`)
  }
  return tokens
}

function findBracketEnd(s, start) {
  let depth = 0
  let quote = null
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  throw new Error('Colchete "[" sem fechamento')
}

function splitUnion(inner) {
  const parts = []
  let cur = ''
  let quote = null
  for (const c of inner) {
    if (quote) {
      cur += c
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      cur += c
    } else if (c === ',') {
      parts.push(cur)
      cur = ''
    } else cur += c
  }
  parts.push(cur)
  return parts
}

function compileFilter(expr) {
  // Suporta: @.a.b OP literal | @.a.b (truthy) | !@.a | combinações com && e ||
  const orParts = expr.split('||').map((p) => p.split('&&').map((x) => x.trim()))
  const getRel = (obj, rel) => {
    if (rel === '@') return obj
    let cur = obj
    for (const seg of rel.replace(/^@\.?/, '').split('.')) {
      if (seg === 'length' && (Array.isArray(cur) || typeof cur === 'string')) return cur.length
      if (cur === null || typeof cur !== 'object') return undefined
      cur = cur[seg]
    }
    return cur
  }
  const parseLit = (raw) => {
    const t = raw.trim()
    const q = t.match(/^(['"])(.*)\1$/)
    if (q) return q[2]
    if (t === 'true') return true
    if (t === 'false') return false
    if (t === 'null') return null
    if (!Number.isNaN(Number(t)) && t !== '') return Number(t)
    throw new Error(`Valor inválido no filtro: ${t}`)
  }
  const conds = orParts.map((ands) =>
    ands.map((cond) => {
      const m = cond.match(/^(@[\w.$]*)\s*(==|!=|>=|<=|>|<|=~)\s*(.+)$/)
      if (m) {
        const [, rel, op, rawLit] = m
        if (op === '=~') {
          const rm = rawLit.trim().match(/^\/(.*)\/([a-z]*)$/)
          if (!rm) throw new Error('Use =~ /regex/')
          const re = new RegExp(rm[1], rm[2])
          return (o) => re.test(String(getRel(o, rel)))
        }
        const lit = parseLit(rawLit)
        return (o) => {
          const v = getRel(o, rel)
          switch (op) {
            case '==':
              return v === lit
            case '!=':
              return v !== lit
            case '>':
              return v > lit
            case '<':
              return v < lit
            case '>=':
              return v >= lit
            default:
              return v <= lit
          }
        }
      }
      const neg = cond.startsWith('!')
      const rel = cond.replace(/^!/, '').trim()
      if (!rel.startsWith('@')) throw new Error(`Filtro inválido: ${cond}`)
      return (o) => {
        const v = getRel(o, rel)
        const truthy = v !== undefined && v !== null && v !== false
        return neg ? !truthy : truthy
      }
    }),
  )
  return (o) => conds.some((ands) => ands.every((f) => f(o)))
}

export function evaluateJsonPath(root, expr, { limit = 1000 } = {}) {
  const tokens = tokenizeJsonPath(expr)
  let current = [{ value: root, path: [] }]
  const MAX_INTERMEDIATE = 2_000_000

  const childrenOf = (node) => {
    const { value, path } = node
    if (Array.isArray(value)) return value.map((v, i) => ({ value: v, path: [...path, i] }))
    if (value !== null && typeof value === 'object') return keysOf(value).map((k) => ({ value: value[k], path: [...path, k] }))
    return []
  }

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti]
    const next = []
    if (tok.type === 'key') {
      for (const node of current) {
        const v = node.value
        if (v === null || typeof v !== 'object') continue
        for (let k of tok.keys) {
          if (typeof k === 'number' && Array.isArray(v) && k < 0) k = v.length + k
          if (Array.isArray(v) ? typeof k === 'number' && k < v.length : Object.prototype.hasOwnProperty.call(v, k))
            next.push({ value: v[k], path: [...node.path, k] })
        }
      }
    } else if (tok.type === 'wildcard') {
      for (const node of current) next.push(...childrenOf(node))
    } else if (tok.type === 'slice') {
      for (const node of current) {
        if (!Array.isArray(node.value)) continue
        const len = node.value.length
        const norm = (x, d) => (x === null ? d : x < 0 ? Math.max(0, len + x) : Math.min(len, x))
        const start = norm(tok.start, 0)
        const end = norm(tok.end, len)
        const step = tok.step || 1
        for (let i = start; i < end; i += step) next.push({ value: node.value[i], path: [...node.path, i] })
      }
    } else if (tok.type === 'filter') {
      const pred = compileFilter(tok.expr)
      for (const node of current) for (const child of childrenOf(node)) if (pred(child.value)) next.push(child)
    } else if (tok.type === 'descendant') {
      // coleta todos os descendentes (incluindo o próprio nó) e aplica o seletor
      const all = []
      const stack = [...current]
      while (stack.length) {
        const n = stack.pop()
        all.push(n)
        if (all.length > MAX_INTERMEDIATE) throw new Error('Consulta muito ampla — refine o JSONPath')
        const ch = childrenOf(n)
        for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i])
      }
      if (tok.key === '*') {
        for (const n of all) if (n !== current[0] || current.length > 1) next.push(...childrenOf(n))
      } else if (tok.key === null) {
        next.push(...all)
      } else {
        for (const n of all) {
          const v = n.value
          if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, tok.key))
            next.push({ value: v[tok.key], path: [...n.path, tok.key] })
        }
      }
    }
    if (next.length > MAX_INTERMEDIATE) throw new Error('Consulta muito ampla — refine o JSONPath')
    current = next
  }

  return {
    total: current.length,
    truncated: current.length > limit,
    results: current.slice(0, limit).map((n) => ({ path: n.path, ...summarize(n.path[n.path.length - 1] ?? '$', n.value) })),
  }
}

/* ───────────────────────── Gráficos: detecção de datasets ───────────────────────── */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

function classify(values) {
  let num = 0
  let date = 0
  let bool = 0
  let str = 0
  const distinct = new Set()
  for (const v of values) {
    if (v === null || v === undefined) continue
    if (typeof v === 'number' && Number.isFinite(v)) num++
    else if (typeof v === 'boolean') bool++
    else if (typeof v === 'string') {
      if (ISO_DATE.test(v) && !Number.isNaN(Date.parse(v))) date++
      else str++
      if (distinct.size < 1000) distinct.add(v)
    }
  }
  const total = num + date + bool + str
  if (!total) return null
  if (num / total >= 0.8) return 'number'
  if (date / total >= 0.8) return 'date'
  if (bool / total >= 0.8) return 'boolean'
  if (str / total >= 0.5) return 'category'
  return null
}

/** Lista campos (inclusive 1 nível aninhado: "endereco.cidade") de um array de objetos. */
function fieldsOf(arr) {
  const sample = arr.length > 400 ? Array.from({ length: 400 }, (_, i) => arr[Math.floor((i * arr.length) / 400)]) : arr
  const names = new Map()
  for (const item of sample) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    for (const k of keysOf(item)) {
      const v = item[k]
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        for (const k2 of keysOf(v)) names.set(`${k}.${k2}`, true)
      } else if (!Array.isArray(v)) names.set(k, true)
      if (names.size > 60) break
    }
  }
  const fields = []
  for (const name of names.keys()) {
    const vals = sample.map((it) => readField(it, name))
    const kind = classify(vals)
    if (kind) {
      const distinct = new Set(vals.filter((v) => v !== undefined && v !== null)).size
      fields.push({ name, kind, distinct })
    }
  }
  return fields
}

export function readField(item, name) {
  if (name === '#') return undefined
  if (item === null || typeof item !== 'object') return name === '@valor' ? item : undefined
  if (!name.includes('.')) return item[name]
  let cur = item
  for (const seg of name.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[seg]
  }
  return cur
}

export function findChartCandidates(root, { maxNodes = 300_000, maxCandidates = 25 } = {}) {
  const out = []
  const stack = [[root, []]]
  let visited = 0
  while (stack.length && visited < maxNodes && out.length < maxCandidates) {
    const [v, path] = stack.pop()
    visited++
    if (Array.isArray(v)) {
      if (v.length >= 2) {
        const first = v.find((x) => x !== null && x !== undefined)
        if (typeof first === 'number') {
          out.push({ path, pathLabel: pathToString(path), length: v.length, itemKind: 'numbers', fields: [{ name: '@valor', kind: 'number', distinct: null }] })
        } else if (first && typeof first === 'object' && !Array.isArray(first)) {
          const fields = fieldsOf(v)
          if (fields.some((f) => f.kind === 'number' || f.kind === 'date' || f.kind === 'category'))
            out.push({ path, pathLabel: pathToString(path), length: v.length, itemKind: 'objects', fields })
        }
      }
      // explora só os primeiros itens: arrays homogêneos repetem a mesma forma
      const lim = Math.min(v.length, 3)
      for (let i = lim - 1; i >= 0; i--) stack.push([v[i], [...path, i]])
    } else if (v !== null && typeof v === 'object') {
      const keys = keysOf(v)
      for (let i = keys.length - 1; i >= 0; i--) stack.push([v[keys[i]], [...path, keys[i]]])
    }
  }
  return out.sort((a, b) => b.length - a.length)
}

/* ───────────────────────── Gráficos: séries ───────────────────────── */

function toNumber(v, kind) {
  if (kind === 'date') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v ? 1 : 0
  return null
}

function aggregate(values, agg) {
  if (agg === 'count') return values.length
  const nums = values.filter((x) => x !== null)
  if (!nums.length) return 0
  switch (agg) {
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'min':
      return Math.min(...nums)
    case 'max':
      return Math.max(...nums)
    default:
      return nums.reduce((a, b) => a + b, 0)
  }
}

function dateBucket(ts, span) {
  const d = new Date(ts)
  if (span > 1000 * 60 * 60 * 24 * 400) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  return d.toISOString().slice(0, 10)
}

/**
 * Gera os dados do gráfico a partir do dataset escolhido.
 * spec: { path, chart: bar|line|pie|scatter|histogram, x, y, xKind, yKind, agg, bins }
 */
export function buildChartData(root, spec) {
  const arr = getAt(root, spec.path)
  if (!Array.isArray(arr)) throw new Error('O caminho selecionado não é um array')
  const { chart, x, y, xKind, yKind, agg = 'sum' } = spec
  const get = (item, field, i) => (field === '#' ? i : field === '@valor' ? item : readField(item, field))

  const preview = arr.slice(0, 8).map((item, i) => ({ x: fmtCell(get(item, x, i)), y: y ? fmtCell(get(item, y, i)) : undefined }))

  if (chart === 'histogram') {
    const vals = []
    for (let i = 0; i < arr.length; i++) {
      const n = toNumber(get(arr[i], x, i), xKind)
      if (n !== null) vals.push(n)
    }
    if (!vals.length) throw new Error('Nenhum valor numérico encontrado no campo escolhido')
    let min = Infinity
    let max = -Infinity
    for (const v of vals) {
      if (v < min) min = v
      if (v > max) max = v
    }
    const binCount = spec.bins || Math.min(40, Math.max(5, Math.ceil(Math.log2(vals.length) + 1)))
    const width = (max - min) / binCount || 1
    const bins = Array.from({ length: binCount }, (_, i) => ({ x0: min + i * width, x1: min + (i + 1) * width, count: 0 }))
    for (const v of vals) bins[Math.min(binCount - 1, Math.floor((v - min) / width))].count++
    return { chart, bins, points: vals.length, skipped: arr.length - vals.length, preview, xKind }
  }

  if (chart === 'scatter') {
    const pts = []
    let skipped = 0
    const stride = Math.max(1, Math.floor(arr.length / 5000))
    for (let i = 0; i < arr.length; i += stride) {
      const xv = toNumber(get(arr[i], x, i), xKind)
      const yv = toNumber(get(arr[i], y, i), yKind)
      if (xv === null || yv === null) skipped++
      else pts.push([xv, yv])
    }
    if (!pts.length) throw new Error('Nenhum par (x, y) numérico encontrado')
    return { chart, points: pts, sampled: stride > 1, total: arr.length, skipped, preview, xKind }
  }

  if (chart === 'line') {
    // x numérico/data/índice → ordena; categorias viram ordem de aparição
    const groups = new Map()
    let skipped = 0
    for (let i = 0; i < arr.length; i++) {
      const raw = get(arr[i], x, i)
      const xv = xKind === 'category' ? null : toNumber(raw, xKind)
      const key = xKind === 'category' ? String(raw) : xv
      if (key === null || key === undefined) {
        skipped++
        continue
      }
      const yv = agg === 'count' ? 1 : toNumber(get(arr[i], y, i), yKind)
      if (yv === null && agg !== 'count') {
        skipped++
        continue
      }
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(yv)
    }
    let series = [...groups.entries()].map(([k, vals]) => [k, aggregate(vals, agg)])
    if (xKind !== 'category') series.sort((a, b) => a[0] - b[0])
    // downsampling por média em blocos para no máx. 1500 pontos
    const MAX = 1500
    let sampled = false
    if (series.length > MAX) {
      sampled = true
      const size = series.length / MAX
      const reduced = []
      for (let b = 0; b < MAX; b++) {
        const slice = series.slice(Math.floor(b * size), Math.floor((b + 1) * size))
        if (!slice.length) continue
        reduced.push([slice[0][0], slice.reduce((a, p) => a + p[1], 0) / slice.length])
      }
      series = reduced
    }
    if (!series.length) throw new Error('Nenhum ponto válido para o gráfico de linhas')
    return { chart, points: series, sampled, skipped, preview, xKind }
  }

  // bar / pie: agrupa por categoria
  const groups = new Map()
  let skipped = 0
  let span = 0
  if (xKind === 'date') {
    let mn = Infinity
    let mx = -Infinity
    for (let i = 0; i < arr.length; i++) {
      const t = toNumber(get(arr[i], x, i), 'date')
      if (t !== null) {
        if (t < mn) mn = t
        if (t > mx) mx = t
      }
    }
    span = mx - mn
  }
  for (let i = 0; i < arr.length; i++) {
    const raw = get(arr[i], x, i)
    if (raw === undefined) {
      skipped++
      continue
    }
    let key
    if (xKind === 'date') {
      const t = toNumber(raw, 'date')
      if (t === null) {
        skipped++
        continue
      }
      key = dateBucket(t, span)
    } else key = raw === null ? '(null)' : String(raw)
    const yv = agg === 'count' ? 1 : toNumber(get(arr[i], y, i), yKind)
    if (yv === null && agg !== 'count') {
      skipped++
      continue
    }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(yv)
    if (groups.size > 50_000) throw new Error('Categorias demais para agrupar — escolha outro campo para o eixo X')
  }
  let cats = [...groups.entries()].map(([label, vals]) => ({ label, value: aggregate(vals, agg) }))
  if (xKind === 'date') cats.sort((a, b) => (a.label < b.label ? -1 : 1))
  else cats.sort((a, b) => b.value - a.value)

  const limit = chart === 'pie' ? 7 : 30
  let otherCount = 0
  if (cats.length > limit) {
    const rest = cats.slice(limit)
    otherCount = rest.length
    const restValue = agg === 'avg' ? rest.reduce((a, c) => a + c.value, 0) / rest.length : rest.reduce((a, c) => a + c.value, 0)
    cats = cats.slice(0, limit)
    if (chart === 'pie' || xKind !== 'date') cats.push({ label: `Outros (${rest.length})`, value: restValue, other: true })
  }
  if (!cats.length) throw new Error('Nenhuma categoria encontrada para o eixo X')
  return { chart, categories: cats, totalGroups: groups.size, otherCount, skipped, preview, xKind }
}

/** Primeiras linhas do dataset com os campos escolhidos — a "prévia" antes de gerar o gráfico. */
export function previewRows(root, path, fields, limit = 8) {
  const arr = getAt(root, path)
  if (!Array.isArray(arr)) return []
  return arr.slice(0, limit).map((item, i) => fields.map((f) => fmtCell(f === '#' ? i : f === '@valor' ? item : readField(item, f))))
}

function fmtCell(v) {
  if (v === undefined) return '—'
  if (v === null) return 'null'
  if (typeof v === 'object') return Array.isArray(v) ? `[${v.length}]` : '{…}'
  const s = String(v)
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

/* ───────────────────────── Dados de teste ───────────────────────── */

/** Gera um JSON de teste grande (claramente identificado como dado sintético de entrada). */
export function generateTestDataset(count) {
  const cidades = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Recife', 'Salvador', 'Goiânia']
  const status = ['ativo', 'inativo', 'pendente']
  const deptos = ['Engenharia', 'Produto', 'Dados', 'Infraestrutura', 'Design', 'Comercial']
  let seed = 42
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const base = Date.UTC(2024, 0, 1)
  const registros = new Array(count)
  for (let i = 0; i < count; i++) {
    registros[i] = {
      id: i + 1,
      nome: `Registro ${i + 1}`,
      departamento: deptos[Math.floor(rand() * deptos.length)],
      status: status[Math.floor(rand() * status.length)],
      salario: Math.round(3000 + rand() * 17000),
      idade: 18 + Math.floor(rand() * 47),
      admissao: new Date(base + Math.floor(rand() * 730) * 86400000).toISOString().slice(0, 10),
      endereco: { cidade: cidades[Math.floor(rand() * cidades.length)], uf: 'BR' },
      tags: ['dev', 'tools', 'json'].slice(0, 1 + Math.floor(rand() * 3)),
      ativo: rand() > 0.3,
    }
  }
  return { gerado: '__dataset_de_teste__', total: count, registros }
}
