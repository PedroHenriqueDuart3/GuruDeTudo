/**
 * Exportação do diagrama:
 *  - SVG / PNG (a partir do SVG renderizado, com estilos e variáveis CSS resolvidos)
 *  - DBML (editável no dbdiagram.io e ferramentas compatíveis)
 *  - Mermaid erDiagram (Markdown, GitHub, GitLab, Notion…)
 *  - JSON (modelo + posições, para versionar o layout)
 */

const q = (s) => (/^[A-Za-z_][\w]*$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`)

export function toDBML(schema) {
  const lines = []
  for (const t of schema.tables) {
    const name = t.schema && !['dbo', 'public'].includes(t.schema) ? `${q(t.schema)}.${q(t.name)}` : q(t.name)
    lines.push(`Table ${name} {`)
    for (const c of t.columns) {
      const settings = []
      if (c.pk && t.pk.length === 1) settings.push('pk')
      if (c.identity) settings.push('increment')
      if (c.notNull && !c.pk) settings.push('not null')
      if (c.unique) settings.push('unique')
      if (c.default) settings.push(`default: \`${c.default.replace(/`/g, '')}\``)
      lines.push(`  ${q(c.name)} ${q(c.type.replace(/\s+/g, '_'))}${settings.length ? ` [${settings.join(', ')}]` : ''}`)
    }
    if (t.pk.length > 1 || t.uniques.some((u) => u.length > 1)) {
      lines.push('', '  indexes {')
      if (t.pk.length > 1) lines.push(`    (${t.pk.map(q).join(', ')}) [pk]`)
      for (const u of t.uniques.filter((u) => u.length > 1)) lines.push(`    (${u.map(q).join(', ')}) [unique]`)
      lines.push('  }')
    }
    lines.push('}', '')
  }
  const byId = new Map(schema.tables.map((t) => [t.id, t]))
  for (const r of schema.relations) {
    const from = byId.get(r.from.table)
    const to = byId.get(r.to.table)
    const op = r.cardinality.kind === 'one-to-one' ? '-' : '>'
    const cols = (t, cs) => (cs.length > 1 ? `${q(t.name)}.(${cs.map(q).join(', ')})` : `${q(t.name)}.${q(cs[0])}`)
    const opts = []
    if (r.onDelete) opts.push(`delete: ${r.onDelete.toLowerCase()}`)
    if (r.onUpdate) opts.push(`update: ${r.onUpdate.toLowerCase()}`)
    lines.push(`Ref ${q(r.name)}: ${cols(from, r.from.columns)} ${op} ${cols(to, r.to.columns)}${opts.length ? ` [${opts.join(', ')}]` : ''}`)
  }
  return `${lines.join('\n').trim()}\n`
}

export function toMermaid(schema) {
  const safe = (s) => s.replace(/[^\w]/g, '_')
  const lines = ['erDiagram']
  const byId = new Map(schema.tables.map((t) => [t.id, t]))
  for (const r of schema.relations) {
    const from = byId.get(r.from.table)
    const to = byId.get(r.to.table)
    const parentEnd = r.cardinality.parentOptional ? '|o' : '||'
    const childEnd = r.cardinality.kind === 'one-to-one' ? 'o|' : 'o{'
    lines.push(`    ${safe(to.name)} ${parentEnd}--${childEnd} ${safe(from.name)} : "${r.from.columns.join(', ')}"`)
  }
  for (const t of schema.tables) {
    lines.push(`    ${safe(t.name)} {`)
    for (const c of t.columns) {
      const keys = [c.pk && 'PK', c.fk && 'FK', c.unique && !c.pk && 'UK'].filter(Boolean).join(',')
      lines.push(`        ${safe(c.type.split('(')[0])} ${safe(c.name)}${keys ? ` ${keys}` : ''}`)
    }
    lines.push('    }')
  }
  return `${lines.join('\n')}\n`
}

export function toJSON(schema, positions) {
  return JSON.stringify(
    {
      formato: 'devtools-workspace/db-diagram@1',
      geradoEm: new Date().toISOString(),
      tabelas: schema.tables.map((t) => ({
        nome: t.name,
        schema: t.schema,
        posicao: positions.get(t.id) ?? null,
        chavePrimaria: t.pk,
        colunas: t.columns.map((c) => ({ nome: c.name, tipo: c.type, pk: c.pk, fk: c.fk, unique: c.unique, notNull: c.notNull, identity: c.identity, default: c.default })),
      })),
      relacionamentos: schema.relations.map((r) => ({
        nome: r.name,
        de: { tabela: r.from.table, colunas: r.from.columns },
        para: { tabela: r.to.table, colunas: r.to.columns },
        cardinalidade: r.cardinality.kind,
        onDelete: r.onDelete,
        onUpdate: r.onUpdate,
      })),
    },
    null,
    2,
  )
}

/* ───────── SVG / PNG ───────── */

const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing']

/**
 * Clona o SVG do diagrama "achatando" os estilos computados (as variáveis CSS do tema
 * não existem fora da página) e enquadra o conteúdo.
 */
export function serializeDiagramSvg(svgEl, contentEl, background) {
  const bbox = contentEl.getBBox()
  const pad = 40
  const clone = svgEl.cloneNode(true)
  const srcNodes = svgEl.querySelectorAll('*')
  const dstNodes = clone.querySelectorAll('*')
  srcNodes.forEach((src, i) => {
    const dst = dstNodes[i]
    const cs = getComputedStyle(src)
    // transform via CSS (usado para animar o layout) vira atributo SVG no arquivo exportado
    if (src.style?.transform && cs.transform && cs.transform !== 'none') dst.setAttribute('transform', cs.transform)
    dst.setAttribute('style', STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'))
    dst.removeAttribute('class')
  })
  clone.querySelector('[data-zoom-layer]')?.removeAttribute('transform')
  const g = clone.querySelector('[data-export-root]')
  g.setAttribute('transform', `translate(${-bbox.x + pad}, ${-bbox.y + pad})`)
  const w = Math.ceil(bbox.width + pad * 2)
  const h = Math.ceil(bbox.height + pad * 2)
  clone.setAttribute('width', w)
  clone.setAttribute('height', h)
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.removeAttribute('style')
  clone.querySelectorAll('[data-export-hide]').forEach((el) => el.remove())
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('width', '100%')
  bg.setAttribute('height', '100%')
  bg.setAttribute('fill', background)
  clone.insertBefore(bg, clone.firstChild)
  return { markup: new XMLSerializer().serializeToString(clone), width: w, height: h }
}

export function svgToPngBlob(markup, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const max = 16000
      const s = Math.min(scale, max / width, max / height)
      canvas.width = Math.round(width * s)
      canvas.height = Math.round(height * s)
      const ctx = canvas.getContext('2d')
      ctx.scale(s, s)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar PNG'))), 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Falha ao renderizar o SVG'))
    }
    img.src = url
  })
}
