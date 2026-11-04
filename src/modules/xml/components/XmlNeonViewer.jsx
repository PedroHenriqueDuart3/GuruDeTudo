import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { mdiChevronRight } from '@mdi/js'
import Icon from '@core/components/Icon'
import VirtualList from '@core/components/VirtualList'
import { cn, formatNumber } from '@core/utils'

const ROW_H = 24
const INDENT = 18
const TEXT_MAX = 400

/**
 * Visualizador XML com identidade neon:
 *  - abertura e fechamento de cada elemento na MESMA cor (cor por nível de profundidade)
 *  - guias verticais ligando pai → filhos, na cor do ancestral
 *  - hover destaca simultaneamente abertura, fechamento e a guia do elemento
 *  - linhas virtualizadas (milhares de linhas sem custo de DOM)
 */
const XmlNeonViewer = forwardRef(function XmlNeonViewer(
  { data, visible, collapsed, onToggle, hovered, onHover, selected, onSelect, hits, activeHit, entering },
  ref,
) {
  const listRef = useRef(null)
  const { nodes, lines } = data

  useImperativeHandle(ref, () => ({
    scrollToVisibleIndex: (i) => listRef.current?.scrollToIndex(i, 'center'),
  }))

  // posição de cada linha visível (para animar a entrada dos filhos recém-expandidos)
  const enterRange = useMemo(() => {
    if (!entering) return null
    const openVis = visible.findIndex((li) => lines[li].kind === 'open' && lines[li].node === entering.node)
    if (openVis < 0) return null
    const closeLine = lines[visible[openVis]].pair
    let end = openVis
    while (end + 1 < visible.length && visible[end + 1] < closeLine) end++
    return [openVis + 1, end]
  }, [entering, visible, lines])

  const chainOf = (nodeId) => {
    const chain = []
    let p = nodes[nodeId].parent
    while (p >= 0) {
      chain.unshift(p)
      p = nodes[p].parent
    }
    return chain
  }

  const renderRow = (vi, style) => {
    const li = visible[vi]
    const line = lines[li]
    const nd = nodes[line.node]
    const depth = line.depth
    const color = `var(--depth-${depth % 6})`
    const elementId = nd.type === 'element' ? nd.id : nd.parent
    const chain = chainOf(nd.id)
    const isCollapsed = line.kind === 'open' && collapsed.has(nd.id)
    const pairActive = hovered !== null && hovered === nd.id && nd.type === 'element'
    const inHovered = hovered !== null && chain.includes(hovered)
    const isHit = hits?.has(nd.id)
    const enteringDelay = enterRange && vi >= enterRange[0] && vi <= enterRange[1] ? Math.min(vi - enterRange[0], 30) * 14 : null

    return (
      <div
        key={li}
        style={{ ...style, '--el-color': color, animationDelay: enteringDelay !== null ? `${enteringDelay}ms` : undefined }}
        className={cn(
          'xv-row',
          `xv-row--${line.kind}`,
          pairActive && 'is-pair',
          inHovered && 'is-inside',
          selected === nd.id && 'is-selected',
          isHit && 'is-hit',
          activeHit === nd.id && 'is-active-hit',
          enteringDelay !== null && 'is-entering',
        )}
        onMouseEnter={() => onHover(elementId >= 0 ? elementId : null)}
        onClick={() => onSelect(nd.id)}
      >
        <span className="xv-ln">{li + 1}</span>
        <span className="xv-fold">
          {line.kind === 'open' && (
            <button
              type="button"
              className={cn('xv-chevron', !isCollapsed && 'is-open')}
              onClick={(e) => {
                e.stopPropagation()
                onToggle(nd.id)
              }}
              aria-label={isCollapsed ? `Expandir <${nd.name}>` : `Recolher <${nd.name}>`}
              aria-expanded={!isCollapsed}
            >
              <Icon path={mdiChevronRight} size={14} />
            </button>
          )}
        </span>
        <span className="xv-code" style={{ paddingLeft: depth * INDENT }}>
          {chain.map((anc, d) => (
            <span
              key={anc}
              className={cn('xv-guide', anc === hovered && 'is-lit')}
              style={{ left: d * INDENT + 6, '--guide-color': `var(--depth-${d % 6})` }}
            />
          ))}
          <LineContent nd={nd} line={line} nodes={nodes} collapsed={isCollapsed} />
        </span>
      </div>
    )
  }

  return (
    <VirtualList
      ref={listRef}
      count={visible.length}
      rowHeight={ROW_H}
      renderRow={renderRow}
      className="xv"
      onMouseLeave={() => onHover(null)}
      role="tree"
      aria-label="Visualizador XML"
    />
  )
})

function Attrs({ attrs }) {
  return attrs.map(([k, v], i) => (
    <span key={i}>
      {' '}
      <span className="xv-attr">{k}</span>
      <span className="xv-punct">=</span>
      <span className="xv-val">"{v.length > 120 ? `${v.slice(0, 120)}…` : v}"</span>
    </span>
  ))
}

function OpenTag({ nd, self = false }) {
  return (
    <>
      <span className="xv-bracket">&lt;</span>
      <span className="xv-tag">{nd.name}</span>
      <Attrs attrs={nd.attrs} />
      <span className="xv-bracket">{self ? '/>' : '>'}</span>
    </>
  )
}

function CloseTag({ name }) {
  return (
    <>
      <span className="xv-bracket">&lt;/</span>
      <span className="xv-tag">{name}</span>
      <span className="xv-bracket">&gt;</span>
    </>
  )
}

function clip(t) {
  const s = t.trim().replace(/\s+/g, ' ')
  return s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX)}…` : s
}

function LineContent({ nd, line, nodes, collapsed }) {
  switch (line.kind) {
    case 'open':
      return (
        <>
          <OpenTag nd={nd} />
          {collapsed && (
            <>
              <span className="xv-collapsed">
                {formatNumber(nd.children.length)} filho{nd.children.length === 1 ? '' : 's'}
              </span>
              <CloseTag name={nd.name} />
            </>
          )}
        </>
      )
    case 'close':
      return <CloseTag name={nd.name} />
    case 'self':
      return <OpenTag nd={nd} self />
    case 'inline': {
      const child = nodes[nd.children[0]]
      return (
        <>
          <OpenTag nd={nd} />
          <span className={child.type === 'cdata' ? 'xv-cdata' : 'xv-text'}>{child.type === 'cdata' ? `<![CDATA[${clip(child.text)}]]>` : clip(child.text)}</span>
          <CloseTag name={nd.name} />
        </>
      )
    }
    case 'text':
      return <span className="xv-text">{clip(nd.text)}</span>
    case 'comment':
      return <span className="xv-comment">&lt;!--{clip(nd.text)}--&gt;</span>
    case 'cdata':
      return <span className="xv-cdata">&lt;![CDATA[{clip(nd.text)}]]&gt;</span>
    case 'pi':
      return <span className="xv-pi">&lt;?{nd.text}?&gt;</span>
    case 'doctype':
      return <span className="xv-pi">&lt;!{clip(nd.text)}&gt;</span>
    default:
      return null
  }
}

export default XmlNeonViewer
