import { useEffect, useRef, useState } from 'react'

/** Valor com atraso — útil para reprocessar entradas pesadas só quando o usuário pausa. */
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/** Observa o tamanho de um elemento (ResizeObserver). */
export function useElementSize() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

/** Media query reativa. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = () => setMatches(mq.matches)
    handler()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return matches
}

/** Executa um callback em intervalo (pausado quando delay = null). */
export function useInterval(callback, delay) {
  const saved = useRef(callback)
  useEffect(() => {
    saved.current = callback
  }, [callback])
  useEffect(() => {
    if (delay === null) return
    const t = setInterval(() => saved.current(), delay)
    return () => clearInterval(t)
  }, [delay])
}

/** Atalho de teclado global (ex.: Ctrl+K). */
export function useHotkey(combo, handler) {
  useEffect(() => {
    const [mod, key] = combo.includes('+') ? combo.split('+') : [null, combo]
    const onKey = (e) => {
      const modOk = !mod || (mod === 'mod' ? e.ctrlKey || e.metaKey : e[`${mod}Key`])
      if (modOk && e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault()
        handler(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [combo, handler])
}
