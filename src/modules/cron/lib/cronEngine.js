import { FIELD_DEFS, FORMATS, MACROS } from './cronSpec.js'

/* ═════════════════════════ Detecção de formato ═════════════════════════ */

export function splitFields(expr) {
  return expr.trim().split(/\s+/).filter(Boolean)
}

/** Identifica o formato provável a partir da quantidade e do conteúdo dos campos. */
export function detectFormat(expr) {
  const t = expr.trim()
  if (t.startsWith('@')) return 'unix'
  const parts = splitFields(t)
  if (parts.length === 5) return 'unix'
  if (parts.length === 7) return 'quartz'
  if (parts.length === 6) {
    if (parts.some((p) => p === '?' || /[LW#]/i.test(p))) return 'quartz'
    return 'seconds'
  }
  return null
}

/* ═════════════════════════ Parser ═════════════════════════ */

class CronFieldError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CronFieldError'
  }
}

function resolveNumber(token, def, format) {
  const up = token.toUpperCase()
  if (def.names) {
    const idx = def.names.indexOf(up)
    if (idx >= 0) return def.key === 'month' ? idx + 1 : idx
  }
  if (!/^\d+$/.test(token)) throw new CronFieldError(`"${token}" não é um valor válido para ${def.label.toLowerCase()}`)
  let n = Number(token)
  if (def.key === 'dow') {
    const [lo, hi] = FORMATS[format].dowRange
    if (n < lo || n > hi) throw new CronFieldError(`Dia da semana ${n} fora do intervalo ${lo}–${hi}${format === 'quartz' ? ' (Quartz: 1 = domingo)' : ' (0 ou 7 = domingo)'}`)
    n = format === 'quartz' ? n - 1 : n % 7
    return n
  }
  if (n < def.min || n > def.max) throw new CronFieldError(`${def.label} ${n} fora do intervalo ${def.min}–${def.max}`)
  return n
}

/**
 * Converte um campo (ex.: "1-5", "*\/15", "MON,WED", "L", "15W", "6#3") numa estrutura:
 * { raw, any, question, values: number[], items: [...], special: {...} }
 */
export function parseField(raw, key, format) {
  const def = FIELD_DEFS[key]
  const field = { key, def, raw, any: false, question: false, items: [], values: [], special: {} }
  if (raw === '?') {
    if (format !== 'quartz' || (key !== 'dom' && key !== 'dow')) throw new CronFieldError(`"?" só é permitido em dia do mês ou dia da semana no formato Quartz`)
    field.any = true
    field.question = true
    field.values = range(def.min, def.max, 1)
    return field
  }
  const set = new Set()
  for (const part of raw.split(',')) {
    if (part === '') throw new CronFieldError('Lista com item vazio (vírgula sobrando)')
    // ── Especiais (somente Quartz) ──
    const up = part.toUpperCase()
    if (key === 'dom' && /^(L(-\d+)?|LW|\d+W)$/.test(up)) {
      requireQuartz(format, part)
      if (up === 'L') field.special.last = 0
      else if (up === 'LW') field.special.lastWeekday = true
      else if (up.startsWith('L-')) {
        const off = Number(up.slice(2))
        if (off > 30) throw new CronFieldError('Deslocamento de L-n deve ser até 30')
        field.special.last = off
      } else {
        const d = Number(up.slice(0, -1))
        if (d < 1 || d > 31) throw new CronFieldError(`Dia ${d}W fora do intervalo 1–31`)
        ;(field.special.nearestWeekday ??= []).push(d)
      }
      field.items.push({ type: 'special', text: up })
      continue
    }
    if (key === 'dow' && /^([A-Z]{3}|\d)L$|^L$/.test(up)) {
      requireQuartz(format, part)
      const base = up === 'L' ? '7' : up.slice(0, -1)
      const d = resolveNumber(base, def, format)
      ;(field.special.lastDow ??= []).push(d)
      field.items.push({ type: 'special', text: up })
      continue
    }
    if (key === 'dow' && /^([A-Z]{3}|\d)#\d$/.test(up)) {
      requireQuartz(format, part)
      const [d, n] = up.split('#')
      const nth = Number(n)
      if (nth < 1 || nth > 5) throw new CronFieldError('Em "d#n", n deve estar entre 1 e 5')
      ;(field.special.nth ??= []).push({ dow: resolveNumber(d, def, format), n: nth })
      field.items.push({ type: 'special', text: up })
      continue
    }
    if (/[LW#]/i.test(part) && !/^[A-Z]{3}$/i.test(part)) {
      if (format !== 'quartz') throw new CronFieldError(`"${part}": L, W e # só existem no formato Quartz`)
      throw new CronFieldError(`"${part}" não é válido em ${def.label.toLowerCase()}`)
    }

    // ── Padrão: base[/passo] ──
    const [base, stepStr, extra] = part.split('/')
    if (extra !== undefined) throw new CronFieldError(`"${part}" tem mais de uma barra`)
    let step = 1
    if (stepStr !== undefined) {
      if (!/^\d+$/.test(stepStr) || Number(stepStr) === 0) throw new CronFieldError(`Incremento inválido em "${part}" (use um inteiro maior que zero)`)
      step = Number(stepStr)
    }
    const lo = key === 'dow' ? 0 : def.min
    const hi = key === 'dow' ? 6 : def.max
    let from
    let to
    if (base === '*') {
      from = lo
      to = hi
      if (stepStr === undefined) {
        field.any = true
        field.items.push({ type: 'all' })
      } else field.items.push({ type: 'step', from: null, to: null, step })
    } else if (base.includes('-')) {
      const [a, b] = base.split('-')
      if (!a || !b) throw new CronFieldError(`Intervalo incompleto "${base}"`)
      from = resolveNumber(a, def, format)
      to = resolveNumber(b, def, format)
      // dia da semana: "5-7" no Unix significa sex→dom (7 vira 0)
      if (key === 'dow' && to < from && format !== 'quartz' && b === '7') to = 7
      if (to < from) throw new CronFieldError(`Intervalo "${base}": o início é maior que o fim`)
      field.items.push({ type: stepStr ? 'rangeStep' : 'range', from, to: to % (key === 'dow' ? 7 : Infinity), step })
    } else {
      from = resolveNumber(base, def, format)
      to = stepStr !== undefined ? hi : from
      field.items.push(stepStr !== undefined ? { type: 'step', from, to: null, step } : { type: 'value', value: from })
    }
    for (let v = from; v <= to; v += step) set.add(key === 'dow' ? v % 7 : v)
  }
  field.values = [...set].sort((a, b) => a - b)
  if (field.any) field.values = range(key === 'dow' ? 0 : def.min, key === 'dow' ? 6 : def.max, 1)
  return field
}

function requireQuartz(format, part) {
  if (format !== 'quartz') throw new CronFieldError(`"${part}": L, W e # só existem no formato Quartz`)
}

function range(a, b, s) {
  const out = []
  for (let i = a; i <= b; i += s) out.push(i)
  return out
}

/**
 * Valida e interpreta a expressão.
 * Retorna { ok, format, fields: {minute: {...}, ...}, parts, errors: [{ index, key, message }] }
 */
export function parseCron(expression, requestedFormat = 'auto') {
  let expr = expression.trim().replace(/\s+/g, ' ')
  const result = { ok: false, input: expression, expression: expr, format: null, fields: {}, parts: [], errors: [], warnings: [], macro: null }
  if (!expr) {
    result.errors.push({ index: -1, message: 'Expressão vazia' })
    return result
  }
  if (expr.startsWith('@')) {
    const m = MACROS[expr.toLowerCase()]
    if (!m) {
      result.errors.push({ index: -1, message: `Macro desconhecida "${expr}". Use @yearly, @monthly, @weekly, @daily ou @hourly` })
      return result
    }
    result.macro = expr
    expr = m
    if (requestedFormat !== 'auto' && requestedFormat !== 'unix') {
      result.warnings.push('Macros (@daily, @hourly…) pertencem ao formato Unix; a expressão foi interpretada como Unix.')
    }
    requestedFormat = 'unix'
  }

  const parts = splitFields(expr)
  const detected = detectFormat(expr)
  const format = requestedFormat === 'auto' ? detected : requestedFormat
  result.parts = parts
  if (!format) {
    result.errors.push({ index: -1, message: `${parts.length} campo${parts.length === 1 ? '' : 's'} encontrado${parts.length === 1 ? '' : 's'}: use 5 (Unix), 6 (com segundos / Quartz) ou 7 (Quartz com ano)` })
    return result
  }
  result.format = format
  const spec = FORMATS[format]
  const expected = spec.fields.length
  const okCount = parts.length === expected || (spec.optionalLast && parts.length === expected - 1)
  if (!okCount) {
    const want = spec.optionalLast ? `${expected - 1} ou ${expected}` : `${expected}`
    let msg = `O formato ${spec.label} espera ${want} campos, mas a expressão tem ${parts.length}.`
    if (detected && detected !== format) msg += ` Ela parece estar no formato ${FORMATS[detected].label}.`
    result.errors.push({ index: -1, message: msg, suggestFormat: detected })
    return result
  }

  spec.fields.forEach((key, index) => {
    const raw = parts[index] ?? (key === 'year' ? '*' : undefined)
    try {
      result.fields[key] = parseField(raw, key, format)
      result.fields[key].index = index
      result.fields[key].implicit = parts[index] === undefined
    } catch (err) {
      result.errors.push({ index, key, message: err.message })
    }
  })
  if (!spec.fields.includes('second')) result.fields.second = parseField('0', 'second', 'seconds')
  if (!spec.fields.includes('year')) result.fields.year = parseField('*', 'year', 'seconds')

  if (format === 'quartz' && !result.errors.length) {
    const domQ = result.fields.dom.question
    const dowQ = result.fields.dow.question
    if (domQ && dowQ) result.errors.push({ index: 3, key: 'dom', message: 'Quartz: apenas um entre dia do mês e dia da semana pode ser "?"' })
    else if (!domQ && !dowQ) result.errors.push({ index: 5, key: 'dow', message: 'Quartz exige "?" em dia do mês ou em dia da semana (ex.: "0 0 12 ? * MON" ou "0 0 12 1 * ?")' })
  }

  // Avisos semânticos úteis
  if (!result.errors.length) {
    const f = result.fields
    if (format !== 'quartz' && !f.dom.any && !f.dow.any)
      result.warnings.push('Dia do mês e dia da semana restritos ao mesmo tempo: no cron Unix a execução ocorre quando QUALQUER um dos dois coincidir (lógica OU).')
    for (const k of ['second', 'minute', 'hour']) {
      const stepItem = f[k].items.find((i) => i.type === 'step' && i.from === null)
      const size = FIELD_DEFS[k].max + 1
      if (stepItem && size % stepItem.step !== 0)
        result.warnings.push(`*/${stepItem.step} em ${FIELD_DEFS[k].label.toLowerCase()} não divide ${size}: o intervalo reinicia a cada ciclo e fica irregular na virada.`)
    }
    const domItem = f.dom.items.find((i) => i.type === 'step')
    if (domItem) result.warnings.push(`*/${domItem.step} no dia do mês reinicia em todo mês: não é um intervalo fixo de ${domItem.step} dias.`)
    if (f.dom.values.length && !f.dom.any && Math.min(...f.dom.values) > 28 && f.month.values.includes(2) && f.month.values.length === 1)
      result.warnings.push('Fevereiro não tem esse dia: a expressão nunca executará.')
  }

  result.ok = result.errors.length === 0
  return result
}

/* ═════════════════════════ Fuso horário ═════════════════════════ */

const dtfCache = new Map()
function formatter(tz) {
  let f = dtfCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    dtfCache.set(tz, f)
  }
  return f
}

/** Componentes de data/hora de um instante no fuso `tz`. */
export function zonedParts(ts, tz) {
  const parts = formatter(tz).formatToParts(new Date(ts))
  const get = (t) => Number(parts.find((p) => p.type === t).value)
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') }
}

function tzOffset(ts, tz) {
  const p = zonedParts(ts, tz)
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000
}

/** Converte um horário "de parede" no fuso para instante UTC. Retorna null se o horário não existe (salto de horário de verão). */
export function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  const o1 = tzOffset(guess, tz)
  let t = guess - o1
  const o2 = tzOffset(t, tz)
  if (o2 !== o1) t = guess - o2
  const p = zonedParts(t, tz)
  if (p.y !== y || p.mo !== mo || p.d !== d || p.h !== h || p.mi !== mi) return null
  return t
}

/* ═════════════════════════ Próximas execuções ═════════════════════════ */

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const dowOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay()

function matchDom(field, y, m, d) {
  const dim = daysInMonth(y, m)
  const sp = field.special
  if (field.values.includes(d) && !field.any) return true
  if (field.any) return true
  if (sp.last !== undefined && d === dim - sp.last) return true
  if (sp.lastWeekday) {
    let last = dim
    while ([0, 6].includes(dowOf(y, m, last))) last--
    if (d === last) return true
  }
  if (sp.nearestWeekday) {
    for (const target0 of sp.nearestWeekday) {
      const target = Math.min(target0, dim)
      const wd = dowOf(y, m, target)
      let actual = target
      if (wd === 6) actual = target === 1 ? 3 : target - 1
      else if (wd === 0) actual = target === dim ? target - 2 : target + 1
      if (d === actual) return true
    }
  }
  return false
}

function matchDow(field, y, m, d) {
  if (field.any) return true
  const wd = dowOf(y, m, d)
  if (field.values.includes(wd)) return true
  const sp = field.special
  if (sp.lastDow?.includes(wd) && d + 7 > daysInMonth(y, m)) return true
  if (sp.nth?.some((n) => n.dow === wd && Math.ceil(d / 7) === n.n)) return true
  return false
}

function hasSpecial(field) {
  return Object.keys(field.special).length > 0
}

function dayMatches(parsed, y, m, d) {
  const { dom, dow } = parsed.fields
  const domRestricted = !dom.any || hasSpecial(dom)
  const dowRestricted = !dow.any || hasSpecial(dow)
  const domSet = { ...dom, any: dom.any && !hasSpecial(dom) }
  const dowSet = { ...dow, any: dow.any && !hasSpecial(dow) }
  if (parsed.format === 'quartz') {
    if (dom.question) return matchDow(dowSet, y, m, d)
    return matchDom(domSet, y, m, d)
  }
  if (domRestricted && dowRestricted) return matchDom(domSet, y, m, d) || matchDow(dowSet, y, m, d)
  if (domRestricted) return matchDom(domSet, y, m, d)
  if (dowRestricted) return matchDow(dowSet, y, m, d)
  return true
}

const nextIn = (values, cur) => values.find((v) => v >= cur)

/**
 * Calcula as próximas `count` execuções após `from` (Date ou timestamp) no fuso `tz`.
 * Percorre o calendário "de parede" do fuso e converte cada candidato para UTC,
 * pulando horários inexistentes no início do horário de verão.
 */
export function nextRuns(parsed, { from = Date.now(), count = 5, tz = 'UTC', maxYears = 8 } = {}) {
  if (!parsed.ok) return []
  const f = parsed.fields
  const out = []
  const start = typeof from === 'number' ? from : from.getTime()
  let p = zonedParts(start + 1000, tz)
  let { y, mo, d, h, mi, s } = p
  const limitYear = y + maxYears
  let guard = 0

  const resetFrom = (level) => {
    if (level <= 1) mo = f.month.values[0]
    if (level <= 2) d = 1
    if (level <= 3) h = f.hour.values[0]
    if (level <= 4) mi = f.minute.values[0]
    if (level <= 5) s = f.second.values[0]
  }

  while (out.length < count && guard++ < 500_000) {
    if (y > limitYear) break
    if (!f.year.any) {
      const ny = nextIn(f.year.values, y)
      if (ny === undefined) break
      if (ny !== y) {
        y = ny
        resetFrom(1)
        continue
      }
    }
    if (!f.month.values.includes(mo)) {
      const nm = nextIn(f.month.values, mo)
      if (nm === undefined) {
        y++
        resetFrom(1)
      } else {
        mo = nm
        resetFrom(2)
      }
      continue
    }
    if (d > daysInMonth(y, mo) || !dayMatches(parsed, y, mo, d)) {
      d++
      if (d > daysInMonth(y, mo)) {
        mo++
        if (mo > 12) {
          mo = 1
          y++
        }
        d = 1
      }
      resetFrom(3)
      continue
    }
    if (!f.hour.values.includes(h)) {
      const nh = nextIn(f.hour.values, h)
      if (nh === undefined) {
        d++
        resetFrom(3)
      } else {
        h = nh
        resetFrom(4)
      }
      continue
    }
    if (!f.minute.values.includes(mi)) {
      const nmi = nextIn(f.minute.values, mi)
      if (nmi === undefined) {
        h++
        resetFrom(4)
        if (h > 23) {
          d++
          resetFrom(3)
        }
      } else {
        mi = nmi
        resetFrom(5)
      }
      continue
    }
    if (!f.second.values.includes(s)) {
      const ns = nextIn(f.second.values, s)
      if (ns === undefined) {
        mi++
        resetFrom(5)
        if (mi > 59) {
          h++
          resetFrom(4)
          if (h > 23) {
            d++
            resetFrom(3)
          }
        }
      } else s = ns
      continue
    }
    const ts = zonedToUtc(y, mo, d, h, mi, s, tz)
    if (ts !== null && ts > start && (!out.length || ts > out[out.length - 1])) out.push(ts)
    // avança 1 segundo e continua a busca
    s++
    if (s > 59) {
      s = 0
      mi++
      if (mi > 59) {
        mi = 0
        h++
        if (h > 23) {
          h = 0
          d++
        }
      }
    }
  }
  return out.map((t) => new Date(t))
}

/* ═════════════════════════ Montagem por formato ═════════════════════════ */

/**
 * Monta a expressão no formato desejado a partir de campos "canônicos"
 * (dia da semana no padrão Unix 0-6, domingo = 0).
 * canonical: { second, minute, hour, dom, month, dow, year }
 */
export function assemble(canonical, format) {
  const c = { second: '0', minute: '*', hour: '*', dom: '*', month: '*', dow: '*', year: '*', ...canonical }
  if (format === 'unix') return [c.minute, c.hour, c.dom, c.month, c.dow].join(' ')
  if (format === 'seconds') return [c.second, c.minute, c.hour, c.dom, c.month, c.dow].join(' ')
  // Quartz: '?' em um dos campos de dia + dia da semana 1-7
  const dowQ = c.dow === '*' || c.dow === '?' ? '?' : shiftDowToQuartz(c.dow)
  const domQ = dowQ !== '?' ? '?' : c.dom === '?' ? '*' : c.dom
  const parts = [c.second, c.minute, c.hour, domQ, c.month, dowQ]
  if (c.year && c.year !== '*') parts.push(c.year)
  return parts.join(' ')
}

/**
 * "1-5" (Unix) → "2-6" (Quartz); nomes (MON) ficam iguais.
 * Só desloca números que são dias (início, após "," ou "-"), nunca o passo "/n" nem o "#n".
 */
export function shiftDowToQuartz(dow) {
  return dow.replace(/(^|[,-])(\d+)/g, (_, sep, n) => `${sep}${(Number(n) % 7) + 1}`)
}

export function shiftDowFromQuartz(dow) {
  return dow.replace(/(^|[,-])(\d+)/g, (_, sep, n) => `${sep}${(Number(n) + 6) % 7}`)
}

/** Converte uma expressão válida de um formato para outro (quando possível). */
export function convertFormat(parsed, toFormat) {
  if (!parsed.ok) return null
  const parts = parsed.parts
  const idx = (k) => FORMATS[parsed.format].fields.indexOf(k)
  const get = (k) => (idx(k) >= 0 ? parts[idx(k)] ?? '*' : k === 'second' ? '0' : '*')
  let dow = get('dow')
  if (parsed.format === 'quartz') {
    if (dow === '?') dow = '*'
    else if (/[L#]/i.test(dow)) return { error: 'Dia da semana com L/# não existe fora do Quartz' }
    else dow = shiftDowFromQuartz(dow)
  }
  let dom = get('dom')
  if (dom === '?') dom = '*'
  if (toFormat !== 'quartz' && /[LW]/i.test(dom)) return { error: 'Dia do mês com L/W não existe fora do Quartz' }
  const canonical = { second: get('second'), minute: get('minute'), hour: get('hour'), dom, month: get('month'), dow, year: get('year') }
  if (toFormat === 'unix' && canonical.second !== '0') return { error: 'O formato Unix não possui segundos', expression: assemble(canonical, toFormat) }
  return { expression: assemble(canonical, toFormat) }
}
