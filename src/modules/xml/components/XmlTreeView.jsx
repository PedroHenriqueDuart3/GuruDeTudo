import { useMemo, useState } from 'react'
import { mdiChevronRight, mdiCodeTags, mdiCommentTextOutline, mdiFormatText } from '@mdi/js'
import Icon from '@core/components/Icon'
import VirtualList from '@core/components/VirtualList'
import { cn, formatNumber } from '@core/utils'

const ROW_H = 28

/**
 * Árvore estrutural do XML: navega por elementos, atributos e valores sem percorrer o texto.
 * Recolhida por padrão a partir do 2º nível; virtualizada.
 */
export default function XmlTreeView({ data, selected, onSelect, hits }) {
  const { nodes } = data
  const rootIds = useMemo(() => nodes.filter((n) => n.parent === -1 && n.type === 'element').map((n) => n.id), [nodes])
  const [expanded, setExpanded] = useState(() => new Set(rootIds))

  const rows = useMemo(() => {
    const out = []
    const stack = [...rootIds].reverse().map((id) => id)
    while (stack.length) {
      const id = stack.pop()
      const nd = nodes[id]
      out.push(id)
      if (nd.type === 'element' && expanded.has(id)) {
        const kids = nd.children.filter((c) => {
          const t = nodes[c].type
          return t === 'element' || ((t === 'text' || t === 'cdata') && nd.children.length > 1) || t === 'comment'
        })
        for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k])
      }
    }
    return out
  }, [nodes, rootIds, expanded])

  const toggle = (id) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const renderRow = (i, style) => {
    const nd = nodes[rows[i]]
    const color = `var(--depth-${nd.depth % 6})`
    const elementKids = nd.type === 'element' ? nd.children.filter((c) => nodes[c].type === 'element').length : 0
    const textChild = nd.type === 'element' && nd.children.length === 1 && nodes[nd.children[0]].type !== 'element' ? nodes[nd.children[0]] : null
    const canExpand = nd.type === 'element' && nd.children.length > (textChild ? 1 : 0)
    const open = expanded.has(nd.id)
    return (
      <div
        key={nd.id}
        style={{ ...style, paddingLeft: 8 + nd.depth * 18, '--el-color': color }}
        className={cn('xt-row', selected === nd.id && 'is-selected', hits?.has(nd.id) && 'is-hit')}
        role="treeitem"
        aria-level={nd.depth + 1}
        aria-expanded={canExpand ? open : undefined}
        aria-selected={selected === nd.id}
        onClick={() => onSelect(nd.id)}
      >
        <button
          type="button"
          className={cn('xt-chevron', open && 'is-open', !canExpand && 'is-hidden')}
          onClick={(e) => {
            e.stopPropagation()
            toggle(nd.id)
          }}
          tabIndex={-1}
          aria-hidden={!canExpand}
        >
          <Icon path={mdiChevronRight} size={14} />
        </button>
        {nd.type === 'element' ? (
          <>
            <span className="xt-icon">
              <Icon path={mdiCodeTags} size={14} />
            </span>
            <span className="xt-name">{nd.name}</span>
            {nd.attrs.slice(0, 3).map(([k, v]) => (
              <span key={k} className="xt-attr">
                <span className="xv-attr">{k}</span>=<span className="xv-val">{v.length > 24 ? `${v.slice(0, 24)}…` : v}</span>
              </span>
            ))}
            {nd.attrs.length > 3 && <span className="xt-more">+{nd.attrs.length - 3}</span>}
            {textChild && <span className="xt-text">{textChild.text.trim().slice(0, 80)}</span>}
            {elementKids > 0 && <span className="xt-count">{formatNumber(elementKids)}</span>}
          </>
        ) : (
          <>
            <Icon path={nd.type === 'comment' ? mdiCommentTextOutline : mdiFormatText} size={14} className="subtle" />
            <span className={nd.type === 'comment' ? 'xv-comment' : 'xt-text'}>{nd.text.trim().slice(0, 120)}</span>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="xt">
      <div className="xt-actions">
        <button type="button" className="btn btn--text btn--sm" onClick={() => setExpanded(new Set(nodes.filter((n) => n.type === 'element' && n.depth < 3).map((n) => n.id)))}>
          Expandir 3 níveis
        </button>
        <button type="button" className="btn btn--text btn--sm" onClick={() => setExpanded(new Set(rootIds))}>
          Recolher
        </button>
        <span className="grow" />
        <span className="subtle">{formatNumber(rows.length)} itens visíveis</span>
      </div>
      <VirtualList count={rows.length} rowHeight={ROW_H} renderRow={renderRow} className="xt-scroll" role="tree" aria-label="Árvore XML" />
    </div>
  )
}
