/**
 * Layout automático de diagramas ER (inspirado em Sugiyama):
 *   1. separa componentes conexos (tabelas relacionadas ficam agrupadas)
 *   2. distribui em camadas: tabelas referenciadas (pais) à esquerda, filhas à direita
 *   3. ordena cada camada por baricentro (várias varreduras) para reduzir cruzamentos
 *   4. posiciona com espaçamento consistente e alinha filhos aos pais
 *   5. empacota componentes e tabelas isoladas em linhas
 */

export const TABLE_W_MIN = 220
export const HEADER_H = 40
export const ROW_H = 24
const GAP_X = 120
const GAP_Y = 40
const COMPONENT_GAP = 140

export function tableSize(table, collapsed) {
  const cols = collapsed ? table.columns.filter((c) => c.pk || c.fk) : table.columns
  const longest = Math.max(table.name.length * 8.5 + 70, ...table.columns.map((c) => c.name.length * 7.4 + c.type.length * 6.6 + 90))
  const extra = collapsed && cols.length < table.columns.length ? 1 : 0
  return { w: Math.max(TABLE_W_MIN, Math.min(420, Math.ceil(longest))), h: HEADER_H + Math.max(1, cols.length + extra) * ROW_H + 8 }
}

export function autoLayout(tables, relations, { sizes, pinned = new Map(), maxRowWidth = 2600 } = {}) {
  const ids = tables.map((t) => t.id)
  const size = (id) => sizes.get(id)
  const parents = new Map(ids.map((id) => [id, new Set()]))
  const children = new Map(ids.map((id) => [id, new Set()]))
  for (const r of relations) {
    if (r.selfRef || !parents.has(r.from.table) || !parents.has(r.to.table)) continue
    parents.get(r.from.table).add(r.to.table)
    children.get(r.to.table).add(r.from.table)
  }

  // 1) componentes conexos
  const comp = new Map()
  const components = []
  for (const id of ids) {
    if (comp.has(id)) continue
    const list = []
    const stack = [id]
    comp.set(id, components.length)
    while (stack.length) {
      const cur = stack.pop()
      list.push(cur)
      for (const nb of [...parents.get(cur), ...children.get(cur)]) {
        if (!comp.has(nb)) {
          comp.set(nb, components.length)
          stack.push(nb)
        }
      }
    }
    components.push(list)
  }

  const positions = new Map()
  const blocks = []
  const singletons = []

  for (const list of components) {
    if (list.length === 1) {
      singletons.push(list[0])
      continue
    }
    blocks.push(layoutComponent(list))
  }

  function layoutComponent(list) {
    // 2) camadas por caminho mais longo (pais à esquerda), quebrando ciclos
    const layer = new Map()
    const visiting = new Set()
    const depthOf = (id) => {
      if (layer.has(id)) return layer.get(id)
      if (visiting.has(id)) return 0 // ciclo: ignora a aresta de volta
      visiting.add(id)
      let d = 0
      for (const p of parents.get(id)) d = Math.max(d, depthOf(p) + 1)
      visiting.delete(id)
      layer.set(id, d)
      return d
    }
    list.forEach(depthOf)
    // puxa pais "soltos" para perto dos filhos (evita arestas muito longas)
    for (let pass = 0; pass < 2; pass++) {
      for (const id of list) {
        const kids = [...children.get(id)].filter((k) => k !== id)
        if (!kids.length) continue
        const minKid = Math.min(...kids.map((k) => layer.get(k)))
        if (minKid - 1 > layer.get(id)) layer.set(id, minKid - 1)
      }
    }
    // compacta os índices: o passo acima pode deixar camadas vazias (geraria largura -Infinity)
    const used = [...new Set(list.map((id) => layer.get(id)))].sort((a, b) => a - b)
    const remap = new Map(used.map((l, i) => [l, i]))
    list.forEach((id) => layer.set(id, remap.get(layer.get(id))))
    const layers = Array.from({ length: used.length }, () => [])
    list.forEach((id) => layers[layer.get(id)].push(id))

    // 3) ordenação por baricentro (varreduras alternadas)
    const order = new Map()
    const reindex = () => layers.forEach((l) => l.forEach((id, i) => order.set(id, i)))
    reindex()
    const neighbors = (id) => [...parents.get(id), ...children.get(id)].filter((n) => n !== id && comp.get(n) === comp.get(id))
    const bary = (id, targetLayer) => {
      const ns = neighbors(id).filter((n) => layer.get(n) === targetLayer)
      if (!ns.length) return null
      return ns.reduce((a, n) => a + order.get(n), 0) / ns.length
    }
    let best = layers.map((l) => [...l])
    let bestCross = countCrossings(layers, layer, neighbors, order)
    for (let it = 0; it < 12; it++) {
      const down = it % 2 === 0
      const range = down ? [...layers.keys()].slice(1) : [...layers.keys()].reverse().slice(1)
      for (const li of range) {
        const ref = down ? li - 1 : li + 1
        const l = layers[li]
        const scored = l.map((id, idx) => ({ id, b: bary(id, ref) ?? bary(id, down ? li + 1 : li - 1) ?? idx }))
        scored.sort((a, b) => a.b - b.b)
        layers[li] = scored.map((s) => s.id)
        reindex()
      }
      const c = countCrossings(layers, layer, neighbors, order)
      if (c < bestCross) {
        bestCross = c
        best = layers.map((l) => [...l])
      }
    }
    best.forEach((l, i) => (layers[i] = l))
    reindex()

    // 4) coordenadas: x por camada, y empilhado e alinhado aos vizinhos
    const xs = []
    let x = 0
    for (const l of layers) {
      xs.push(x)
      x += Math.max(...l.map((id) => size(id).w)) + GAP_X
    }
    const ys = new Map()
    const heights = layers.map((l) => l.reduce((a, id) => a + size(id).h, 0) + GAP_Y * (l.length - 1))
    const maxH = Math.max(...heights)
    layers.forEach((l, li) => {
      let y = (maxH - heights[li]) / 2
      for (const id of l) {
        ys.set(id, y)
        y += size(id).h + GAP_Y
      }
    })
    // refinamento: aproxima cada tabela do centro dos vizinhos mantendo ordem e espaçamento
    for (let pass = 0; pass < 4; pass++) {
      for (const l of layers) {
        const desired = l.map((id) => {
          const ns = neighbors(id)
          if (!ns.length) return ys.get(id)
          const c = ns.reduce((a, n) => a + ys.get(n) + size(n).h / 2, 0) / ns.length
          return c - size(id).h / 2
        })
        let prevBottom = -Infinity
        l.forEach((id, i) => {
          const y = Math.max(desired[i] * 0.6 + ys.get(id) * 0.4, prevBottom + GAP_Y)
          ys.set(id, y)
          prevBottom = y + size(id).h
        })
      }
    }
    const minY = Math.min(...list.map((id) => ys.get(id)))
    const local = new Map(list.map((id) => [id, { x: xs[layer.get(id)], y: ys.get(id) - minY }]))
    const w = Math.max(...list.map((id) => local.get(id).x + size(id).w))
    const h = Math.max(...list.map((id) => local.get(id).y + size(id).h))
    return { local, w, h, crossings: bestCross }
  }

  // tabelas isoladas viram um bloco em grade
  if (singletons.length) {
    const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(singletons.length))))
    const local = new Map()
    const colW = Math.max(...singletons.map((id) => size(id).w)) + 60
    const rowHeights = []
    singletons.forEach((id, i) => {
      const r = Math.floor(i / cols)
      rowHeights[r] = Math.max(rowHeights[r] ?? 0, size(id).h)
    })
    singletons.forEach((id, i) => {
      const r = Math.floor(i / cols)
      const y = rowHeights.slice(0, r).reduce((a, b) => a + b + GAP_Y, 0)
      local.set(id, { x: (i % cols) * colW, y })
    })
    blocks.push({
      local,
      w: Math.min(cols, singletons.length) * colW - 60,
      h: rowHeights.reduce((a, b) => a + b + GAP_Y, -GAP_Y),
      crossings: 0,
    })
  }

  // 5) empacotamento em prateleiras (maiores primeiro)
  blocks.sort((a, b) => b.local.size - a.local.size)
  let cx = 0
  let cy = 0
  let rowH = 0
  let crossings = 0
  for (const b of blocks) {
    if (cx > 0 && cx + b.w > maxRowWidth) {
      cx = 0
      cy += rowH + COMPONENT_GAP
      rowH = 0
    }
    for (const [id, p] of b.local) positions.set(id, { x: p.x + cx, y: p.y + cy })
    cx += b.w + COMPONENT_GAP
    rowH = Math.max(rowH, b.h)
    crossings += b.crossings
  }
  for (const [id, p] of pinned) if (positions.has(id)) positions.set(id, p)
  return { positions, crossings }
}

/** Conta cruzamentos entre camadas adjacentes (métrica de qualidade do layout). */
function countCrossings(layers, layer, neighbors, order) {
  let total = 0
  for (let li = 0; li < layers.length - 1; li++) {
    const edges = []
    for (const id of layers[li]) for (const n of neighbors(id)) if (layer.get(n) === li + 1) edges.push([order.get(id), order.get(n)])
    for (let a = 0; a < edges.length; a++)
      for (let b = a + 1; b < edges.length; b++) {
        const [a1, a2] = edges[a]
        const [b1, b2] = edges[b]
        if ((a1 - b1) * (a2 - b2) < 0) total++
      }
  }
  return total
}
