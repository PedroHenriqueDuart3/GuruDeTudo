import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { mdiChevronRight, mdiContentCopy, mdiDotsHorizontal, mdiFormatListBulletedSquare } from '@mdi/js'
import Icon from '@core/components/Icon'
import VirtualList from '@core/components/VirtualList'
import { cn, formatNumber } from '@core/utils'
import { pathToString } from '../lib/jsonEngine'
import { keyOf } from '../hooks/useLazyTree'

const ROW_H = 26

/**
 * Tree View virtualizada: só as linhas visíveis existem no DOM e os filhos são
 * buscados no worker quando o nó é expandido.
 * Teclado: ↑ ↓ navegam · → expande/entra · ← recolhe/sobe · Enter alterna.
 */
const JsonTreeView = forwardRef(function JsonTreeView({ tree, root, onSelect, onCopyPath, onCopyValue, highlightQuery }, ref) {
  const listRef = useRef(null)
  const [selected, setSelected] = useState(null)
  const [pendingScroll, setPendingScroll] = useState(null)

  const rows = useMemo(() => {
    const out = []
    if (!root) return out
    const walk = (path, summary, depth) => {
      const k = keyOf(path)
      const isContainer = summary.type === 'object' || summary.type === 'array'
      const open = isContainer && tree.expanded.has(k)
      out.push({ kind: 'node', path, k, summary, depth, open, isContainer })
      if (!open) return
      const entry = tree.cache.get(k)
      if (!entry) {
        out.push({ kind: 'loading', k: `${k}:loading`, depth: depth + 1 })
        return
      }
      if (entry.offset > 0) out.push({ kind: 'prev', k: `${k}:prev`, path, depth: depth + 1, count: entry.offset })
      for (const item of entry.items) walk([...path, item.key], item, depth + 1)
      const shown = entry.offset + entry.items.length
      if (shown < entry.total)
        out.push({ kind: 'more', k: `${k}:more`, path, depth: depth + 1, remaining: entry.total - shown, loading: tree.loading.has(k) })
    }
    walk([], root, 0)
    return out
  }, [root, tree.expanded, tree.cache, tree.loading])

  const indexByKey = useMemo(() => {
    const m = new Map()
    rows.forEach((r, i) => r.kind === 'node' && m.set(r.k, i))
    return m
  }, [rows])

  useEffect(() => {
    if (!pendingScroll) return
    const idx = indexByKey.get(pendingScroll)
    if (idx !== undefined) {
      listRef.current?.scrollToIndex(idx, 'center')
      setPendingScroll(null)
    }
  }, [pendingScroll, indexByKey])

  const select = useCallback(
    (row) => {
      setSelected(row.k)
      onSelect?.(row.path, row.summary)
    },
    [onSelect],
  )

  useImperativeHandle(ref, () => ({
    async revealPath(path) {
      await tree.reveal(path)
      const k = keyOf(path)
      setSelected(k)
      setPendingScroll(k)
    },
  }))

  const onKeyDown = (e) => {
    const idx = selected ? indexByKey.get(selected) : -1
    const row = rows[idx]
    const move = (to) => {
      let i = to
      while (rows[i] && rows[i].kind !== 'node') i += to > idx ? 1 : -1
      if (rows[i]) {
        select(rows[i])
        listRef.current?.scrollToIndex(i, 'auto')
      }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(idx < 0 ? 0 : idx + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(Math.max(0, idx - 1))
    } else if (e.key === 'ArrowRight' && row) {
      e.preventDefault()
      if (row.isContainer && !row.open) tree.toggle(row.path, true)
      else if (row.open) move(idx + 1)
    } else if (e.key === 'ArrowLeft' && row) {
      e.preventDefault()
      if (row.open) tree.toggle(row.path, false)
      else if (row.path.length) {
        const parentKey = keyOf(row.path.slice(0, -1))
        const pi = indexByKey.get(parentKey)
        if (pi !== undefined) {
          select(rows[pi])
          listRef.current?.scrollToIndex(pi, 'auto')
        }
      }
    } else if (e.key === 'Enter' && row?.isContainer) {
      e.preventDefault()
      tree.toggle(row.path)
    }
  }

  const q = highlightQuery?.trim().toLowerCase()

  const renderRow = (i, style) => {
    const row = rows[i]
    const indent = { paddingLeft: 10 + row.depth * 16 }
    const guides = Array.from({ length: row.depth }, (_, d) => (
      <span key={d} className="jt-guide" style={{ left: 17 + d * 16, '--guide-color': `var(--depth-${d % 6})` }} />
    ))
    if (row.kind === 'loading')
      return (
        <div key={row.k} style={{ ...style, ...indent }} className="jt-row jt-row--meta">
          {guides}
          <span className="btn__spinner" /> carregando…
        </div>
      )
    if (row.kind === 'more' || row.kind === 'prev')
      return (
        <div key={row.k} style={{ ...style, ...indent }} className="jt-row jt-row--meta">
          {guides}
          <button
            type="button"
            className="jt-more"
            onClick={() => (row.kind === 'more' ? tree.loadMore(row.path) : tree.loadPrev(row.path))}
            disabled={row.loading}
          >
            <Icon path={mdiDotsHorizontal} size={14} />
            {row.kind === 'more'
              ? `carregar mais (${formatNumber(row.remaining)} restantes)`
              : `mostrar anteriores (${formatNumber(row.count)} ocultos)`}
          </button>
        </div>
      )

    const { summary, path } = row
    const keyLabel = path.length === 0 ? '$' : path[path.length - 1]
    const isIndex = typeof keyLabel === 'number'
    const hit =
      q && (String(keyLabel).toLowerCase().includes(q) || (!row.isContainer && String(summary.preview).toLowerCase().includes(q)))
    return (
      <div
        key={row.k}
        id={`jt-${i}`}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-expanded={row.isContainer ? row.open : undefined}
        aria-selected={selected === row.k}
        style={{ ...style, ...indent }}
        className={cn('jt-row', selected === row.k && 'is-selected', hit && 'is-hit', row.open && 'is-open')}
        onClick={() => {
          select(row)
          if (row.isContainer) tree.toggle(path)
        }}
      >
        {guides}
        <span className={cn('jt-chevron', !row.isContainer && 'is-leaf', row.open && 'is-open')}>
          {row.isContainer && <Icon path={mdiChevronRight} size={16} />}
        </span>
        <span className={cn('jt-key', isIndex && 'is-index')}>{isIndex ? keyLabel : path.length ? `"${keyLabel}"` : '$'}</span>
        <span className="jt-colon">:</span>
        {row.isContainer ? (
          <span className="jt-container">
            <span className="jt-brace">{summary.type === 'array' ? '[' : '{'}</span>
            <span className="jt-count">
              {formatNumber(summary.size)} {summary.type === 'array' ? (summary.size === 1 ? 'item' : 'itens') : summary.size === 1 ? 'chave' : 'chaves'}
            </span>
            <span className="jt-brace">{summary.type === 'array' ? ']' : '}'}</span>
            {!row.open && summary.type === 'object' && summary.preview && <span className="jt-peek">{summary.preview}</span>}
          </span>
        ) : (
          <span className={`jt-val jt-val--${summary.type}`}>{summary.type === 'string' ? `"${summary.preview}"` : summary.preview}</span>
        )}
        <span className="jt-actions">
          <button type="button" title="Copiar caminho" aria-label="Copiar caminho" onClick={(e) => (e.stopPropagation(), onCopyPath?.(path))}>
            <Icon path={mdiFormatListBulletedSquare} size={14} />
          </button>
          <button type="button" title="Copiar valor" aria-label="Copiar valor" onClick={(e) => (e.stopPropagation(), onCopyValue?.(path))}>
            <Icon path={mdiContentCopy} size={14} />
          </button>
        </span>
      </div>
    )
  }

  return (
    <div className="jt" role="tree" aria-label="Árvore JSON" tabIndex={0} onKeyDown={onKeyDown}>
      <VirtualList ref={listRef} count={rows.length} rowHeight={ROW_H} renderRow={renderRow} className="jt-scroll" />
      {selected && (
        <div className="jt-status mono">
          {(() => {
            const r = rows[indexByKey.get(selected)]
            return r ? pathToString(r.path) : ''
          })()}
        </div>
      )}
    </div>
  )
})

export default JsonTreeView
