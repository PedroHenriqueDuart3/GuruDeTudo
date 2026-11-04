import { useMemo } from 'react'
import { nextRuns, parseCron } from './lib/cronEngine'
import { describeCron, explainFields } from './lib/describe'

/** Interpretação completa de uma expressão: validação, descrição, campos e próximas execuções. */
export function useCronAnalysis(expression, format, tz, count = 8) {
  return useMemo(() => analyzeCron(expression, format, tz, count), [expression, format, tz, count])
}

export function analyzeCron(expression, format, tz, count = 8) {
  const parsed = parseCron(expression ?? '', format)
  let runs = []
  let runError = null
  if (parsed.ok) {
    try {
      runs = nextRuns(parsed, { tz, count })
    } catch (err) {
      runError = err.message
    }
  }
  return {
    parsed,
    description: parsed.ok ? describeCron(parsed) : '',
    fields: explainFields(parsed),
    runs,
    runError,
  }
}

const fmtCache = new Map()
export function formatRun(date, tz, withSeconds) {
  const key = `${tz}|${withSeconds}`
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: withSeconds ? '2-digit' : undefined,
    })
    fmtCache.set(key, f)
  }
  return f.format(date)
}

export function relativeTime(date) {
  const diff = date.getTime() - Date.now()
  const s = Math.round(diff / 1000)
  if (s < 60) return `em ${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `em ${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `em ${h} h`
  const d = Math.round(h / 24)
  return `em ${d} dias`
}
