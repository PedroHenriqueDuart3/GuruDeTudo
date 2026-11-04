/**
 * Parser XML próprio (sem DOMParser → funciona em Web Worker e informa posições).
 *
 * Produz uma lista PLANA de nós (eficiente para documentos grandes):
 *   { id, type: 'element'|'text'|'comment'|'cdata'|'pi'|'doctype',
 *     name, attrs: [[nome, valor]], parent, depth, children: [ids], start, end, selfClosing, text }
 * e valida a boa formação (tags pareadas, raiz única, atributos, etc.).
 */

const NAME_START = /[A-Za-z_:À-￿]/
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/

export class XmlSyntaxError extends Error {
  constructor(message, pos) {
    super(message)
    this.pos = pos
  }
}

export function lineStarts(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

export function posToLineCol(starts, pos) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, col: pos - starts[lo] + 1 }
}

export function parseXml(text, { onProgress } = {}) {
  const nodes = []
  const stack = [] // ids de elementos abertos
  let rootId = null
  let i = 0
  const n = text.length
  let lastReport = 0

  const add = (node) => {
    node.id = nodes.length
    node.parent = stack.length ? stack[stack.length - 1] : -1
    node.depth = stack.length
    if (node.parent >= 0) nodes[node.parent].children.push(node.id)
    nodes.push(node)
    return node
  }

  const fail = (message, pos = i) => {
    throw new XmlSyntaxError(message, pos)
  }

  const readName = () => {
    const s = i
    if (!NAME_START.test(text[i] ?? '')) fail(`Nome de tag inválido${text[i] ? ` começando com "${text[i]}"` : ''}`)
    i++
    while (i < n && NAME_CHAR.test(text[i])) i++
    return text.slice(s, i)
  }

  const skipWs = () => {
    while (i < n) {
      const c = text.charCodeAt(i)
      if (c === 32 || c === 9 || c === 10 || c === 13) i++
      else break
    }
  }

  try {
    while (i < n) {
      if (onProgress && i - lastReport > 2_000_000) {
        lastReport = i
        onProgress(i / n)
      }
      const lt = text.indexOf('<', i)
      // ── Texto ──
      if (lt !== i) {
        const end = lt === -1 ? n : lt
        const raw = text.slice(i, end)
        if (raw.trim()) {
          if (!stack.length) fail(rootId === null ? 'Texto antes do elemento raiz' : 'Texto após o fim do elemento raiz', i + raw.search(/\S/))
          if (raw.includes('&')) checkEntities(raw, i)
          add({ type: 'text', text: raw, start: i, end, children: [] })
        }
        i = end
        if (lt === -1) break
        continue
      }
      // ── Comentário ──
      if (text.startsWith('<!--', i)) {
        const close = text.indexOf('-->', i + 4)
        if (close === -1) fail('Comentário não fechado (falta "-->")')
        add({ type: 'comment', text: text.slice(i + 4, close), start: i, end: close + 3, children: [] })
        i = close + 3
        continue
      }
      // ── CDATA ──
      if (text.startsWith('<![CDATA[', i)) {
        if (!stack.length) fail('CDATA fora do elemento raiz')
        const close = text.indexOf(']]>', i + 9)
        if (close === -1) fail('Seção CDATA não fechada (falta "]]>")')
        add({ type: 'cdata', text: text.slice(i + 9, close), start: i, end: close + 3, children: [] })
        i = close + 3
        continue
      }
      // ── DOCTYPE ──
      if (text.startsWith('<!DOCTYPE', i) || text.startsWith('<!doctype', i)) {
        if (rootId !== null) fail('DOCTYPE deve vir antes do elemento raiz')
        let j = i + 9
        let depth = 0
        while (j < n && !(text[j] === '>' && depth === 0)) {
          if (text[j] === '[') depth++
          else if (text[j] === ']') depth--
          j++
        }
        if (j >= n) fail('DOCTYPE não fechado')
        add({ type: 'doctype', text: text.slice(i + 2, j), start: i, end: j + 1, children: [] })
        i = j + 1
        continue
      }
      // ── Instrução de processamento (<?xml ... ?>) ──
      if (text.startsWith('<?', i)) {
        const close = text.indexOf('?>', i + 2)
        if (close === -1) fail('Instrução de processamento não fechada (falta "?>")')
        const body = text.slice(i + 2, close)
        if (/^xml\s/i.test(body) && i !== 0 && text.slice(0, i).trim()) fail('A declaração <?xml ?> deve ser a primeira coisa do documento')
        add({ type: 'pi', name: body.split(/\s/)[0], text: body, start: i, end: close + 2, children: [] })
        i = close + 2
        continue
      }
      // ── Tag de fechamento ──
      if (text[i + 1] === '/') {
        const start = i
        i += 2
        const name = readName()
        skipWs()
        if (text[i] !== '>') fail(`Esperado ">" ao fechar </${name}`)
        i++
        if (!stack.length) fail(`Tag de fechamento </${name}> sem abertura correspondente`, start)
        const openId = stack[stack.length - 1]
        const open = nodes[openId]
        if (open.name !== name) {
          const lc = open.name
          fail(`Tag </${name}> fecha <${lc}> — esperado </${lc}>`, start)
        }
        open.end = i
        open.closeStart = start
        stack.pop()
        continue
      }
      // ── Tag de abertura ──
      const start = i
      i++
      if (!stack.length && rootId !== null) fail('Documento com mais de um elemento raiz', start)
      const name = readName()
      const attrs = []
      const seen = new Set()
      while (true) {
        const before = i
        skipWs()
        if (text[i] === '>' || text.startsWith('/>', i)) break
        if (i >= n) fail(`Tag <${name}> não fechada`, start)
        if (before === i) fail(`Esperado espaço antes do atributo em <${name}>`)
        const aStart = i
        const aName = readName()
        skipWs()
        if (text[i] !== '=') fail(`Atributo "${aName}" sem valor (use ${aName}="…")`, aStart)
        i++
        skipWs()
        const q = text[i]
        if (q !== '"' && q !== "'") fail(`Valor do atributo "${aName}" deve estar entre aspas`)
        const close = text.indexOf(q, i + 1)
        if (close === -1) fail(`Valor do atributo "${aName}" sem aspas de fechamento`)
        const value = text.slice(i + 1, close)
        if (value.includes('<')) fail(`Caractere "<" não é permitido no valor do atributo "${aName}"`, i + 1 + value.indexOf('<'))
        if (seen.has(aName)) fail(`Atributo "${aName}" duplicado em <${name}>`, aStart)
        seen.add(aName)
        attrs.push([aName, value])
        i = close + 1
      }
      const selfClosing = text[i] === '/'
      i += selfClosing ? 2 : 1
      const el = add({ type: 'element', name, attrs, start, end: i, selfClosing, openEnd: i, children: [] })
      if (rootId === null) rootId = el.id
      if (!selfClosing) stack.push(el.id)
    }
    if (stack.length) {
      const open = nodes[stack[stack.length - 1]]
      throw new XmlSyntaxError(`Tag <${open.name}> não foi fechada (falta </${open.name}>)`, open.start)
    }
    if (rootId === null) throw new XmlSyntaxError(text.trim() ? 'Nenhum elemento raiz encontrado' : 'Documento vazio', 0)
    return { nodes, rootId, error: null }
  } catch (err) {
    if (!(err instanceof XmlSyntaxError)) throw err
    // fecha virtualmente o que ficou aberto para ainda permitir visualizar o trecho válido
    while (stack.length) nodes[stack.pop()].end = text.length
    return { nodes, rootId, error: { message: err.message, pos: err.pos } }
  }
}

function checkEntities(raw, offset) {
  const re = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g
  const m = re.exec(raw)
  if (m) throw new XmlSyntaxError('"&" solto: use &amp; ou uma entidade válida (&lt; &gt; &quot; &apos;)', offset + m.index)
}

/* ═════════════════════ Estatísticas ═════════════════════ */

export function xmlStats(nodes) {
  const s = { elements: 0, attributes: 0, texts: 0, comments: 0, cdata: 0, maxDepth: 0, tagNames: new Map() }
  for (const nd of nodes) {
    if (nd.type === 'element') {
      s.elements++
      s.attributes += nd.attrs.length
      s.tagNames.set(nd.name, (s.tagNames.get(nd.name) ?? 0) + 1)
      if (nd.depth > s.maxDepth) s.maxDepth = nd.depth
    } else if (nd.type === 'text') s.texts++
    else if (nd.type === 'comment') s.comments++
    else if (nd.type === 'cdata') s.cdata++
  }
  const top = [...s.tagNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  return { ...s, uniqueTags: s.tagNames.size, topTags: top.map(([name, count]) => ({ name, count })), tagNames: undefined }
}

/* ═════════════════════ Linhas formatadas (visualizador) ═════════════════════ */

const INLINE_MAX = 100

/**
 * Gera as linhas do visualizador a partir dos nós.
 * Cada linha: { node, kind: 'open'|'close'|'inline'|'self'|'text'|'comment'|'cdata'|'pi'|'doctype', depth, pair }
 *   pair → índice da linha de fechamento (em 'open') ou abertura (em 'close')
 */
export function buildLines(nodes) {
  const lines = []
  const top = nodes.filter((nd) => nd.parent === -1)
  const stack = top.map((nd) => ({ id: nd.id, phase: 0 })).reverse()
  while (stack.length) {
    const frame = stack.pop()
    const nd = nodes[frame.id]
    if (nd.type !== 'element') {
      lines.push({ node: nd.id, kind: nd.type, depth: nd.depth })
      continue
    }
    if (frame.phase === 1) {
      const openIdx = frame.openIdx
      lines.push({ node: nd.id, kind: 'close', depth: nd.depth, pair: openIdx })
      lines[openIdx].pair = lines.length - 1
      continue
    }
    if (nd.selfClosing || nd.children.length === 0) {
      lines.push({ node: nd.id, kind: 'self', depth: nd.depth })
      continue
    }
    if (nd.children.length === 1) {
      const only = nodes[nd.children[0]]
      if ((only.type === 'text' || only.type === 'cdata') && !only.text.includes('\n') && only.text.trim().length <= INLINE_MAX) {
        lines.push({ node: nd.id, kind: 'inline', depth: nd.depth })
        continue
      }
    }
    lines.push({ node: nd.id, kind: 'open', depth: nd.depth })
    stack.push({ id: nd.id, phase: 1, openIdx: lines.length - 1 })
    for (let k = nd.children.length - 1; k >= 0; k--) stack.push({ id: nd.children[k], phase: 0 })
  }
  return lines
}

/* ═════════════════════ Serialização ═════════════════════ */

const escAttr = (v) => v.replace(/"/g, '&quot;')

export function serialize(nodes, { indent = '  ', minify = false } = {}) {
  const out = []
  const nl = minify ? '' : '\n'
  const pad = (d) => (minify ? '' : indent.repeat(d))
  const attrs = (nd) => nd.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')
  const write = (id) => {
    const nd = nodes[id]
    switch (nd.type) {
      case 'text': {
        const t = nd.text.trim()
        if (t) out.push(`${pad(nd.depth)}${minify ? t : t.replace(/\s*\n\s*/g, `\n${pad(nd.depth)}`)}${nl}`)
        return
      }
      case 'comment':
        out.push(`${pad(nd.depth)}<!--${nd.text}-->${nl}`)
        return
      case 'cdata':
        out.push(`${pad(nd.depth)}<![CDATA[${nd.text}]]>${nl}`)
        return
      case 'pi':
        out.push(`<?${nd.text}?>${nl}`)
        return
      case 'doctype':
        out.push(`<!${nd.text}>${nl}`)
        return
      default:
        break
    }
    if (nd.selfClosing || !nd.children.length) {
      out.push(`${pad(nd.depth)}<${nd.name}${attrs(nd)}/>${nl}`)
      return
    }
    const only = nd.children.length === 1 ? nodes[nd.children[0]] : null
    if (only && (only.type === 'text' || only.type === 'cdata') && !only.text.trim().includes('\n')) {
      const inner = only.type === 'text' ? only.text.trim() : `<![CDATA[${only.text}]]>`
      out.push(`${pad(nd.depth)}<${nd.name}${attrs(nd)}>${inner}</${nd.name}>${nl}`)
      return
    }
    out.push(`${pad(nd.depth)}<${nd.name}${attrs(nd)}>${nl}`)
    for (const c of nd.children) write(c)
    out.push(`${pad(nd.depth)}</${nd.name}>${nl}`)
  }
  // iterativo seria mais seguro para profundidades extremas; documentos XML reais raramente passam de ~100 níveis
  for (const nd of nodes) if (nd.parent === -1) write(nd.id)
  return out.join('')
}

/** Caminho estilo XPath do nó: /Colaborador/Empresa[1]/Nome */
export function xpathOf(nodes, id) {
  const parts = []
  let cur = nodes[id]
  while (cur && cur.parent !== undefined) {
    if (cur.type === 'element') {
      const parent = cur.parent >= 0 ? nodes[cur.parent] : null
      let suffix = ''
      if (parent) {
        const same = parent.children.filter((c) => nodes[c].type === 'element' && nodes[c].name === cur.name)
        if (same.length > 1) suffix = `[${same.indexOf(cur.id) + 1}]`
      }
      parts.unshift(`${cur.name}${suffix}`)
    } else if (cur.type === 'text') parts.unshift('text()')
    if (cur.parent < 0) break
    cur = nodes[cur.parent]
  }
  return `/${parts.join('/')}`
}
