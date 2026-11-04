import { useCallback, useEffect, useRef, useState } from 'react'

export const keyOf = (path) => JSON.stringify(path)

/**
 * Estado de uma árvore JSON carregada sob demanda a partir do worker.
 *  - expanded: Set de chaves (JSON do path) expandidas
 *  - cache: Map chave → { offset, items, total } (janela de filhos carregada)
 *
 * Nada é carregado até o usuário expandir: um array com 1 milhão de itens só traz
 * `pageSize` resumos por vez.
 */
export function useLazyTree(client, root, version, { pageSize = 500, initialDepth = 1 } = {}) {
  const [expanded, setExpanded] = useState(() => new Set())
  const [cache, setCache] = useState(() => new Map())
  const [loading, setLoading] = useState(() => new Set())
  const cacheRef = useRef(cache)
  const expandedRef = useRef(expanded)
  cacheRef.current = cache
  expandedRef.current = expanded

  const load = useCallback(
    async (path, { offset = 0, around, append = false } = {}) => {
      const k = keyOf(path)
      setLoading((s) => new Set(s).add(k))
      try {
        const res = await client.call('children', { path, offset, limit: pageSize, around })
        setCache((prev) => {
          const next = new Map(prev)
          const old = prev.get(k)
          if (append && old && res.offset === old.offset + old.items.length) {
            next.set(k, { offset: old.offset, items: [...old.items, ...res.items], total: res.total })
          } else next.set(k, res)
          cacheRef.current = next
          return next
        })
        return res
      } finally {
        setLoading((s) => {
          const n = new Set(s)
          n.delete(k)
          return n
        })
      }
    },
    [client, pageSize],
  )

  // Ao carregar uma nova versão do documento: limpa o cache e restaura os nós que
  // estavam expandidos (se ainda existirem); na primeira carga expande os níveis iniciais.
  useEffect(() => {
    const previous = [...expandedRef.current]
    setCache(new Map())
    cacheRef.current = new Map()
    if (!root || root.size === 0) {
      setExpanded(new Set())
      return
    }
    let alive = true
    ;(async () => {
      const exp = new Set([keyOf([])])
      await load([])
      if (previous.length > 1) {
        const paths = previous
          .map((k) => JSON.parse(k))
          .filter((p) => p.length > 0)
          .sort((a, b) => a.length - b.length)
          .slice(0, 80)
        for (const p of paths) {
          if (!alive) return
          const res = await load(p).catch(() => null)
          if (res && res.total > 0) exp.add(keyOf(p))
        }
        if (alive) setExpanded(exp)
        return
      }
      if (initialDepth > 1) {
        const first = cacheRef.current.get(keyOf([]))
        for (const item of first?.items.slice(0, 12) ?? []) {
          if (!alive) return
          if (item.size > 0) {
            await load([item.key])
            exp.add(keyOf([item.key]))
          }
        }
      }
      if (alive) setExpanded(exp)
    })().catch(() => {})
    return () => {
      alive = false
    }
  }, [root, version, load, initialDepth])

  const toggle = useCallback(
    async (path, force) => {
      const k = keyOf(path)
      const isOpen = expandedRef.current.has(k)
      const open = force ?? !isOpen
      if (open === isOpen) return
      if (open && !cacheRef.current.has(k)) await load(path)
      setExpanded((s) => {
        const n = new Set(s)
        if (open) n.add(k)
        else n.delete(k)
        return n
      })
    },
    [load],
  )

  const loadMore = useCallback(
    (path) => {
      const entry = cacheRef.current.get(keyOf(path))
      if (!entry) return load(path)
      return load(path, { offset: entry.offset + entry.items.length, append: true })
    },
    [load],
  )

  const loadPrev = useCallback(
    (path) => {
      const entry = cacheRef.current.get(keyOf(path))
      if (!entry) return
      const offset = Math.max(0, entry.offset - pageSize)
      // recarrega a janela anterior + atual (mantém o usuário no mesmo lugar)
      return load(path, { offset }).then(() => load(path, { offset: offset + pageSize, append: true }))
    },
    [load, pageSize],
  )

  /** Expande todos os ancestrais de `path` e garante que cada passo esteja carregado. */
  const reveal = useCallback(
    async (path) => {
      const toExpand = []
      for (let i = 0; i < path.length; i++) {
        const prefix = path.slice(0, i)
        const k = keyOf(prefix)
        const entry = cacheRef.current.get(k)
        const target = path[i]
        const present = entry?.items.some((it) => it.key === target)
        if (!present) await load(prefix, { around: target })
        toExpand.push(k)
      }
      setExpanded((s) => {
        const n = new Set(s)
        toExpand.forEach((k) => n.add(k))
        return n
      })
    },
    [load],
  )

  const collapseAll = useCallback(() => setExpanded(new Set([keyOf([])])), [])

  /** Expande os filhos já carregados até `depth` níveis (limitado para não explodir a tela). */
  const expandLevels = useCallback(
    async (depth = 2, maxNodes = 200) => {
      const exp = new Set([keyOf([])])
      const queue = [[[], 0]]
      let count = 0
      while (queue.length && count < maxNodes) {
        const [p, d] = queue.shift()
        if (d >= depth) continue
        let entry = cacheRef.current.get(keyOf(p))
        if (!entry) entry = await load(p)
        exp.add(keyOf(p))
        for (const it of entry.items.slice(0, 50)) {
          if (it.size > 0) {
            queue.push([[...p, it.key], d + 1])
            count++
          }
        }
      }
      setExpanded(exp)
    },
    [load],
  )

  return { expanded, cache, loading, toggle, loadMore, loadPrev, reveal, collapseAll, expandLevels, load }
}
