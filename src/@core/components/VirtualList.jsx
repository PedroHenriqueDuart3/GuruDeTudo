import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

/**
 * Lista virtualizada de altura de linha fixa.
 * Renderiza apenas as linhas visíveis (+ overscan): funciona com milhões de linhas.
 *
 * Props:
 *  - count: total de linhas
 *  - rowHeight: altura fixa em px
 *  - renderRow(index, style): JSX da linha (aplique `style` no elemento raiz)
 *  - overscan: linhas extras acima/abaixo
 * Ref: { scrollToIndex(index, align='center'), element }
 */
const VirtualList = forwardRef(function VirtualList(
  { count, rowHeight, renderRow, overscan = 12, className, style, onScroll, ...rest },
  ref,
) {
  const containerRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const handleScroll = useCallback(
    (e) => {
      setScrollTop(e.currentTarget.scrollTop)
      onScroll?.(e)
    },
    [onScroll],
  )

  useImperativeHandle(
    ref,
    () => ({
      element: containerRef.current,
      scrollToIndex(index, align = 'center') {
        const el = containerRef.current
        if (!el) return
        const top = index * rowHeight
        let target = top
        if (align === 'center') target = top - el.clientHeight / 2 + rowHeight / 2
        else if (align === 'auto') {
          if (top >= el.scrollTop && top + rowHeight <= el.scrollTop + el.clientHeight) return
          target = top < el.scrollTop ? top : top - el.clientHeight + rowHeight
        }
        el.scrollTop = Math.max(0, target)
      },
    }),
    [rowHeight],
  )

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan)

  const rows = []
  for (let i = start; i < end; i++) {
    rows.push(
      renderRow(i, {
        position: 'absolute',
        top: i * rowHeight,
        left: 0,
        right: 0,
        height: rowHeight,
      }),
    )
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: 'auto', position: 'relative', ...style }}
      onScroll={handleScroll}
      {...rest}
    >
      <div style={{ height: count * rowHeight, position: 'relative', minWidth: '100%' }}>{rows}</div>
    </div>
  )
})

export default VirtualList
