import { DOW_PT, FIELD_DEFS, FORMATS, MONTHS_PT } from './cronSpec.js'

const pad = (n) => String(n).padStart(2, '0')

function joinPt(list) {
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`
}

const isSingle = (f) => !f.any && f.values.length === 1 && !Object.keys(f.special).length
const stepOf = (f) => (f.items.length === 1 && f.items[0].type === 'step' && f.items[0].from === null ? f.items[0].step : null)
const rangeOf = (f) => (f.items.length === 1 && (f.items[0].type === 'range' || f.items[0].type === 'rangeStep') ? f.items[0] : null)

function isContiguous(values) {
  return values.length > 2 && values.every((v, i) => i === 0 || v === values[i - 1] + 1)
}

function dowPlural(d) {
  // "às segundas-feiras", "aos sábados", "aos domingos"
  if (d === 0) return 'domingos'
  if (d === 6) return 'sábados'
  return DOW_PT[d].replace('-feira', 's-feiras')
}

/* ───────────────────────── Horário ───────────────────────── */

function describeTime(f, format) {
  const sec = f.second
  const min = f.minute
  const hour = f.hour
  const hasSeconds = format !== 'unix'
  const secStep = stepOf(sec)
  const minStep = stepOf(min)
  const hourStep = stepOf(hour)
  const secZero = isSingle(sec) && sec.values[0] === 0

  // Frequências baseadas em segundos
  if (hasSeconds && sec.any && min.any && hour.any) return 'A cada segundo'
  if (hasSeconds && secStep && min.any && hour.any) return `A cada ${secStep} segundos`
  if (hasSeconds && !secZero && !sec.any && min.any && hour.any && !secStep)
    return `Uma vez por minuto, aos ${joinPt(sec.values.map(String))} segundos`

  const secSuffix = hasSeconds && !secZero ? (sec.any ? ', a cada segundo' : secStep ? `, a cada ${secStep} segundos` : `, aos ${joinPt(sec.values.map(String))}s`) : ''

  const hourWindow = () => {
    const r = rangeOf(hour)
    if (r && r.type === 'range') return `, das ${pad(r.from)}:00 às ${pad(r.to)}:59`
    if (hourStep) return `, a cada ${hourStep} horas`
    if (!hour.any) {
      if (isContiguous(hour.values)) return `, das ${pad(hour.values[0])}:00 às ${pad(hour.values[hour.values.length - 1])}:59`
      return `, nas horas ${joinPt(hour.values.map((h) => `${pad(h)}h`))}`
    }
    return ''
  }

  if (min.any) return `A cada minuto${hourWindow()}${secSuffix}`
  if (minStep) return `A cada ${minStep} minutos${hourWindow()}${secSuffix}`

  if (isSingle(min)) {
    const m = min.values[0]
    if (hour.any) return `No minuto ${m} de cada hora${secSuffix}`
    if (hourStep) {
      const hours = hour.values.slice(0, 4).map((h) => `${pad(h)}:${pad(m)}`)
      return `A cada ${hourStep} horas, no minuto ${pad(m)} (${hours.join(', ')}${hour.values.length > 4 ? ', …' : ''})${secSuffix}`
    }
    const r = rangeOf(hour)
    if (r && r.type === 'rangeStep') return `A cada ${r.step} horas, das ${pad(r.from)}:${pad(m)} às ${pad(hour.values[hour.values.length - 1])}:${pad(m)}${secSuffix}`
    if (hour.values.length <= 6) {
      const s = hasSeconds && isSingle(sec) && !secZero ? `:${pad(sec.values[0])}` : ''
      const times = hour.values.map((h) => `${pad(h)}:${pad(m)}${s}`)
      const base = times.length === 1 ? `Às ${times[0]}` : `Às ${joinPt(times)}`
      return s ? base : `${base}${secSuffix}`
    }
    if (isContiguous(hour.values))
      return `No minuto ${pad(m)} de cada hora, das ${pad(hour.values[0])}:${pad(m)} às ${pad(hour.values[hour.values.length - 1])}:${pad(m)}${secSuffix}`
  }

  // Lista pequena de minutos com hora fixa
  if (!min.any && min.values.length <= 6 && isSingle(hour)) {
    return `Às ${joinPt(min.values.map((m) => `${pad(hour.values[0])}:${pad(m)}`))}${secSuffix}`
  }

  // Fallback genérico, campo a campo
  const minText = min.values.length > 8 ? `${min.values.length} minutos por hora` : `nos minutos ${joinPt(min.values.map(String))}`
  const hourText = hour.any ? 'de todas as horas' : `das ${joinPt(hour.values.map((h) => `${pad(h)}h`))}`
  return `${minText.charAt(0).toUpperCase()}${minText.slice(1)} ${hourText}${secSuffix}`
}

/* ───────────────────────── Dias ───────────────────────── */

function describeDom(dom) {
  const parts = []
  const sp = dom.special
  if (sp.last === 0) parts.push('no último dia do mês')
  else if (sp.last) parts.push(`${sp.last} dia${sp.last > 1 ? 's' : ''} antes do último dia do mês`)
  if (sp.lastWeekday) parts.push('no último dia útil do mês')
  if (sp.nearestWeekday) parts.push(`no dia útil mais próximo do dia ${joinPt(sp.nearestWeekday.map(String))}`)
  if (!dom.any && dom.values.length) {
    const step = stepOf(dom)
    const r = rangeOf(dom)
    if (step) parts.push(`a cada ${step} dias do mês (dias ${joinPt(dom.values.slice(0, 5).map(String))}${dom.values.length > 5 ? '…' : ''})`)
    else if (r && r.type === 'range') parts.push(`do dia ${r.from} ao dia ${r.to} do mês`)
    else if (dom.values.length === 1) parts.push(`no dia ${dom.values[0]} do mês`)
    else parts.push(`nos dias ${joinPt(dom.values.map(String))} do mês`)
  }
  return joinPt(parts)
}

function describeDow(dow) {
  const parts = []
  const sp = dow.special
  if (sp.lastDow) parts.push(`na última ${joinPt(sp.lastDow.map((d) => DOW_PT[d]))} do mês`)
  if (sp.nth) {
    const ord = ['', 'primeira', 'segunda', 'terceira', 'quarta', 'quinta']
    const ordM = ['', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto']
    parts.push(
      joinPt(sp.nth.map((n) => `no${n.dow === 0 || n.dow === 6 ? '' : 'a'} ${(n.dow === 0 || n.dow === 6 ? ordM : ord)[n.n]} ${DOW_PT[n.dow]} do mês`)),
    )
  }
  if (!dow.any && dow.values.length) {
    const v = dow.values
    if (v.length === 5 && v.join() === '1,2,3,4,5') parts.push('de segunda a sexta-feira')
    else if (v.length === 2 && v.join() === '0,6') parts.push('aos sábados e domingos')
    else if (isContiguous(v)) parts.push(`de ${DOW_PT[v[0]]} a ${DOW_PT[v[v.length - 1]]}`)
    else parts.push(joinPt(v.map((d) => `${d === 0 || d === 6 ? 'aos' : 'às'} ${dowPlural(d)}`)))
  }
  return joinPt(parts)
}

function describeMonth(month) {
  if (month.any) return ''
  const v = month.values
  const step = stepOf(month)
  if (step) return `a cada ${step} meses (${joinPt(v.map((m) => MONTHS_PT[m - 1]))})`
  if (v.length === 1) return `em ${MONTHS_PT[v[0] - 1]}`
  if (isContiguous(v)) return `de ${MONTHS_PT[v[0] - 1]} a ${MONTHS_PT[v[v.length - 1] - 1]}`
  return `em ${joinPt(v.map((m) => MONTHS_PT[m - 1]))}`
}

/** Frase completa em português descrevendo quando a expressão executa. */
export function describeCron(parsed) {
  if (!parsed?.ok) return ''
  const f = parsed.fields
  const time = describeTime(f, parsed.format)
  const domActive = !f.dom.any || Object.keys(f.dom.special).length > 0
  const dowActive = !f.dow.any || Object.keys(f.dow.special).length > 0
  const pieces = [time]

  let dayText = ''
  if (parsed.format === 'quartz') {
    dayText = f.dom.question ? describeDow(f.dow) : describeDom(f.dom)
  } else if (domActive && dowActive) {
    dayText = `${describeDom(f.dom)} ou ${describeDow(f.dow)}`
  } else if (domActive) dayText = describeDom(f.dom)
  else if (dowActive) dayText = describeDow(f.dow)

  if (dayText) pieces.push(dayText)
  else if (!f.hour.any && !stepOf(f.hour)) pieces.push('todos os dias')

  const monthText = describeMonth(f.month)
  if (monthText) pieces.push(monthText)
  if (!f.year.any) pieces.push(f.year.values.length === 1 ? `em ${f.year.values[0]}` : `nos anos ${joinPt(f.year.values.map(String))}`)

  return `${pieces.join(', ')}.`
}

/* ───────────────────────── Explicação por campo ───────────────────────── */

function itemText(item, def, key) {
  const name = (v) => (key === 'month' ? MONTHS_PT[v - 1] : key === 'dow' ? DOW_PT[v] : String(v))
  switch (item.type) {
    case 'all':
      return `qualquer ${def.unit}`
    case 'value':
      return name(item.value)
    case 'range':
      return `de ${name(item.from)} a ${name(item.to)}`
    case 'rangeStep':
      return `de ${name(item.from)} a ${name(item.to)}, a cada ${item.step}`
    case 'step':
      return item.from === null ? `a cada ${item.step} ${item.step === 1 ? def.unit : def.unitPlural}` : `a cada ${item.step}, começando em ${name(item.from)}`
    case 'special':
      return specialText(item.text, key)
    default:
      return ''
  }
}

function specialText(text, key) {
  if (key === 'dom') {
    if (text === 'L') return 'último dia do mês'
    if (text === 'LW') return 'último dia útil do mês'
    if (text.startsWith('L-')) return `${text.slice(2)} dia(s) antes do último dia`
    if (text.endsWith('W')) return `dia útil mais próximo do dia ${text.slice(0, -1)}`
  }
  if (key === 'dow') {
    if (text.includes('#')) {
      const [d, n] = text.split('#')
      return `${n}ª ocorrência do dia ${d} no mês`
    }
    if (text.endsWith('L')) return `última ocorrência do dia ${text.slice(0, -1) || '7'} no mês`
  }
  return text
}

/**
 * Lista de campos com papel, valor bruto, significado e valores ativos
 * (usada na explicação animada e no construtor).
 */
export function explainFields(parsed) {
  if (!parsed?.format) return []
  const spec = FORMATS[parsed.format]
  return spec.fields
    .map((key, index) => {
      const field = parsed.fields[key]
      const def = FIELD_DEFS[key]
      const raw = parsed.parts[index] ?? (key === 'year' ? '*' : '')
      if (key === 'year' && parsed.parts[index] === undefined) return null
      let meaning
      if (!field) meaning = 'inválido'
      else if (field.question) meaning = 'sem valor específico (definido pelo outro campo de dia)'
      else meaning = field.items.map((it) => itemText(it, def, key)).join(' · ')
      const range = key === 'dow' ? (parsed.format === 'quartz' ? '1–7 (1 = dom)' : '0–7 (0/7 = dom)') : key === 'month' ? '1–12 ou JAN–DEC' : `${def.min}–${def.max}`
      return {
        key,
        index,
        label: def.label,
        raw,
        meaning,
        range,
        values: field?.values ?? [],
        any: field?.any ?? false,
        special: field ? Object.keys(field.special).length > 0 : false,
        min: key === 'dow' ? 0 : def.min,
        max: key === 'dow' ? 6 : key === 'year' ? def.min + 30 : def.max,
      }
    })
    .filter(Boolean)
}
