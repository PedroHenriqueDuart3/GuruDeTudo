import { assemble } from './cronEngine.js'
import { DOW_PT } from './cronSpec.js'

/**
 * Interpretador de agendamentos em português → CRON.
 * Baseado em regras (roda 100% no navegador). Quando a frase é ambígua, retorna
 * `clarifications` para o usuário escolher antes de gerar a expressão definitiva.
 *
 * interpretNatural(texto, { format, answers }) → {
 *   status: 'ok' | 'clarify' | 'unsupported' | 'unknown',
 *   canonical, expression, format, understood[], notes[], warnings[], clarifications[], alternatives[]
 * }
 */

const NUM_WORDS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
}

const DOW_WORDS = [
  ['domingo', 0],
  ['segunda', 1],
  ['terca', 2],
  ['quarta', 3],
  ['quinta', 4],
  ['sexta', 5],
  ['sabado', 6],
]
const DOW_RE = '(domingo|segunda|terca|quarta|quinta|sexta|sabado)s?(?:-feiras?| feiras?)?'

const MONTH_WORDS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MONTH_RE = `(${MONTH_WORDS.join('|')})`

function normalize(text) {
  let t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[“”"'.!;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  t = t.replace(/\b(\d+)\s*(?:a|e|ou)\s*(\d+)\s*(?:vezes)\b/g, '$1 $2')
  // números por extenso → dígitos ("vinte e cinco" → 25)
  t = t.replace(/\b(vinte|trinta|quarenta|cinquenta) e (um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove)\b/g, (_, a, b) => String(NUM_WORDS[a] + NUM_WORDS[b]))
  t = t.replace(new RegExp(`\\b(${Object.keys(NUM_WORDS).join('|')})\\b(?!\\s*(?:-feira|feira))`, 'g'), (w, _m, offset, str) => {
    // "um dia", "uma vez" continuam "1 dia", "1 vez"; mas "segunda" (dia da semana) não é número
    const before = str.slice(Math.max(0, offset - 3), offset)
    if (w === 'um' && /\bd[eo] $/.test(before)) return w
    return String(NUM_WORDS[w])
  })
  return t
}

const pad = (n) => String(n).padStart(2, '0')

export function interpretNatural(input, { format = 'unix', answers = {} } = {}) {
  const res = {
    status: 'ok',
    input,
    format,
    canonical: null,
    expression: '',
    understood: [],
    notes: [],
    warnings: [],
    clarifications: [],
    alternatives: [],
  }
  let t = normalize(input || '')
  if (!t) {
    res.status = 'unknown'
    return res
  }
  const take = (re, as) => {
    const m = t.match(re)
    if (m) {
      res.understood.push({ text: m[0].trim(), as })
      t = t.replace(m[0], ' ')
    }
    return m
  }

  const c = { second: '0', minute: null, hour: null, dom: '*', month: '*', dow: '*', year: '*' }
  let interval = null // { n, unit }
  let window = null // { from, to }
  let explicitDaily = false
  let wantsWeekly = false

  /* ── Janela de horário: "das 8h às 18h", "entre 9 e 17 horas", "horário comercial" ── */
  let m = take(/\b(?:das|entre|de) (\d{1,2})(?:[:h](\d{2}))?\s*(?:h|hs|horas)?\s*(?:as|e|ate|a) (\d{1,2})(?:[:h](\d{2}))?\s*(?:h|hs|horas)?\b/, 'janela de horário')
  if (m) window = { from: Number(m[1]), to: Number(m[3]) }
  else if (take(/\b(?:em |no |durante o )?horario comercial\b/, 'horário comercial (08h–18h)')) window = { from: 8, to: 18 }
  m = !window && take(/\ba partir d[ao]s? (\d{1,2})(?:[:h](\d{2}))?\s*(?:h|horas)?\b/, 'início do intervalo')
  if (m) window = { from: Number(m[1]), to: 23, open: true }
  if (window && (window.from > 23 || window.to > 23 || window.from > window.to)) {
    res.status = 'unsupported'
    res.warnings.push(`Janela de horário inválida (${window.from}h–${window.to}h). Use horas entre 0 e 23, com início menor que o fim.`)
    return res
  }

  /* ── Intervalos: "a cada 15 minutos", "de 2 em 2 horas", "a cada meia hora" ── */
  if (take(/\ba cada meia hora\b|\bde meia em meia hora\b/, 'intervalo de 30 minutos')) interval = { n: 30, unit: 'minute' }
  if (!interval && take(/\bde hora em hora\b|\bhora a hora\b/, 'a cada hora')) interval = { n: 1, unit: 'hour' }
  if (!interval && take(/\bminuto a minuto\b/, 'a cada minuto')) interval = { n: 1, unit: 'minute' }
  if (!interval) {
    m = take(/\b(?:a cada|cada|de) (\d+)? ?(?:em \d+ )?(segundos?|minutos?|min|horas?|h|dias?|semanas?|mes|meses)\b/, 'intervalo')
    if (m) {
      const unitWord = m[2]
      const unit = /^seg/.test(unitWord) ? 'second' : /^min/.test(unitWord) ? 'minute' : /^h/.test(unitWord) ? 'hour' : /^dia/.test(unitWord) ? 'day' : /^sem/.test(unitWord) ? 'week' : 'month'
      interval = { n: m[1] ? Number(m[1]) : 1, unit }
      if (interval.n === 0) {
        res.status = 'unsupported'
        res.warnings.push('Intervalo zero não é válido.')
        return res
      }
    }
  }
  if (!interval && take(/\bde (\d+) em \1 (minutos|horas)\b/, 'intervalo')) {
    /* coberto acima, mantido por clareza */
  }

  /* ── Frequências por palavra ── */
  if (take(/\b(diariamente|todos os dias|todo dia(?! \d)|todo o dia|cada dia)\b/, 'todos os dias')) explicitDaily = true
  if (take(/\b(semanalmente|toda semana|todas as semanas|1 vez por semana|uma vez por semana)\b/, 'semanalmente')) wantsWeekly = true
  if (take(/\b(trimestralmente|trimestral|a cada trimestre)\b/, 'trimestral')) interval = { n: 3, unit: 'month' }
  if (take(/\b(semestralmente|semestral)\b/, 'semestral')) interval = { n: 6, unit: 'month' }
  let monthly = !!take(/\b(mensalmente|todo mes|todos os meses|1 vez por mes|uma vez por mes|de cada mes|cada mes|do mes)\b/, 'mensal')
  const yearly = !!take(/\b(anualmente|todo ano|todos os anos|1 vez por ano|uma vez por ano|anual)\b/, 'anual')
  const biweekly = !!take(/\bquinzenalmente|quinzenal\b/, 'quinzenal')

  /* ── Dia do mês ── */
  if (take(/\b(?:no )?primeiro dia util(?: do mes| de cada mes)?\b/, 'primeiro dia útil')) {
    if (format === 'quartz') c.dom = '1W'
    else {
      res.status = 'unsupported'
      res.warnings.push('"Primeiro dia útil" só é representável no formato Quartz (1W). No Unix, agende para os dias 1–3 e filtre o dia útil no script.')
      res.alternatives.push({ label: 'Quartz', expression: assemble({ ...c, dom: '1W', minute: '0', hour: '0' }, 'quartz') })
    }
  } else if (take(/\b(?:no )?ultimo dia util(?: do mes| de cada mes)?\b/, 'último dia útil')) {
    if (format === 'quartz') c.dom = 'LW'
    else {
      res.status = 'unsupported'
      res.warnings.push('"Último dia útil" só existe no formato Quartz (LW).')
    }
  } else if (take(/\b(?:no )?ultimo dia(?: do mes| de cada mes)?\b/, 'último dia do mês')) {
    if (format === 'quartz') c.dom = 'L'
    else {
      res.status = 'unsupported'
      res.warnings.push('"Último dia do mês" não é representável no cron Unix. Use o formato Quartz (L) ou agende "28-31" e verifique no script se amanhã é dia 1.')
      res.alternatives.push({ label: 'Quartz', expression: assemble({ ...c, dom: 'L', minute: '0', hour: '0' }, 'quartz') })
    }
  } else if (take(/\b(?:no )?(?:primeiro dia|inicio do mes|dia primeiro|dia 1(?!\d))\b/, 'dia 1 do mês')) {
    c.dom = '1'
  } else {
    m = take(/\b(?:todo |nos |no |em )?dias? (\d{1,2})((?:\s*(?:,|e)\s*\d{1,2})*)(?: de cada mes| do mes)?\b/, 'dias do mês')
    if (m) {
      const days = [m[1], ...(m[2].match(/\d{1,2}/g) ?? [])].map(Number)
      if (days.some((d) => d < 1 || d > 31)) {
        res.status = 'unsupported'
        res.warnings.push('Dia do mês deve estar entre 1 e 31.')
        return res
      }
      c.dom = [...new Set(days)].sort((a, b) => a - b).join(',')
      if (days.some((d) => d > 28)) res.warnings.push('Meses sem esse dia (ex.: fevereiro) serão pulados — o cron não ajusta para o último dia.')
    }
  }
  if (biweekly && c.dom === '*') {
    c.dom = '1,15'
    res.notes.push('"Quinzenal" interpretado como dias 1 e 15 de cada mês (cron não suporta "a cada 14 dias" exatos).')
  }

  /* ── Dias da semana ── */
  if (take(/\b(?:em |nos |aos )?(?:dias uteis|dia util|durante a semana|dias de semana)\b/, 'dias úteis')) c.dow = '1-5'
  else if (take(/\b(?:nos |aos |no |em )?(?:fins? de semana|finais de semana|final de semana)\b/, 'fim de semana')) c.dow = '0,6'
  else {
    m = take(new RegExp(`\\bde ${DOW_RE} a ${DOW_RE}`), 'intervalo de dias da semana')
    if (m) {
      const a = DOW_WORDS.find(([w]) => w === m[1])[1]
      const b = DOW_WORDS.find(([w]) => w === m[2])[1]
      c.dow = a <= b ? `${a}-${b}` : `${a}-6,0-${b}`
    } else {
      const found = []
      const re = new RegExp(`\\b${DOW_RE}`, 'g')
      let mm
      while ((mm = re.exec(t))) found.push([mm[0], DOW_WORDS.find(([w]) => w === mm[1])[1]])
      if (found.length) {
        found.forEach(([txt]) => res.understood.push({ text: txt, as: 'dia da semana' }))
        t = t.replace(re, ' ')
        c.dow = [...new Set(found.map((f) => f[1]))].sort((a, b) => a - b).join(',')
      }
    }
  }

  /* ── Meses ── */
  m = take(new RegExp(`\\bde ${MONTH_RE} a ${MONTH_RE}\\b`), 'intervalo de meses')
  if (m) {
    c.month = `${MONTH_WORDS.indexOf(m[1]) + 1}-${MONTH_WORDS.indexOf(m[2]) + 1}`
  } else {
    const months = []
    const re = new RegExp(`\\b${MONTH_RE}\\b`, 'g')
    let mm
    while ((mm = re.exec(t))) months.push(MONTH_WORDS.indexOf(mm[1]) + 1)
    if (months.length) {
      res.understood.push({ text: months.map((x) => MONTH_WORDS[x - 1]).join(', '), as: 'mês' })
      t = t.replace(re, ' ')
      c.month = [...new Set(months)].sort((a, b) => a - b).join(',')
    }
  }

  /* ── Ano (só Quartz) ── */
  m = take(/\b(?:em|no ano de|ano) (20\d{2})\b/, 'ano')
  if (m) {
    if (format === 'quartz') c.year = m[1]
    else res.warnings.push(`O ano (${m[1]}) só pode ser fixado no formato Quartz; foi ignorado.`)
  }

  /* ── Horários ── */
  const times = []
  if (take(/\b(?:a |a )?meia[- ]noite(?: e meia)?\b/, 'meia-noite')) times.push({ h: 0, m: /e meia/.test(input.toLowerCase()) ? 30 : 0, explicit: true })
  if (take(/\b(?:ao )?meio[- ]dia(?: e meia)?\b/, 'meio-dia')) times.push({ h: 12, m: 0, explicit: true })
  const timeRe = /\b(?:as |a |ao |pelas |por volta das )?(\d{1,2})(?:(?::|h)(\d{2})|\s*(h|hs|horas?)(?:\s*e\s*(\d{1,2})\s*(?:min|minutos)?)?|(\s*e\s*meia))?(?:\s*(da manha|da tarde|da noite|da madrugada|am|pm))?\b/g
  let tm
  const consumed = []
  while ((tm = timeRe.exec(t))) {
    const [full, hh, mm1, hWord, mm2, meia, period] = tm
    const hasContext = /\b(as|a|ao|pelas|por volta das)\s/.test(full) || hWord || mm1 !== undefined || period
    if (!hasContext) continue
    let h = Number(hh)
    let mi = mm1 !== undefined ? Number(mm1) : mm2 !== undefined ? Number(mm2) : meia ? 30 : 0
    if (h > 23 || mi > 59) {
      res.status = 'unsupported'
      res.warnings.push(`Horário inválido: ${hh}:${pad(mi)}`)
      return res
    }
    const explicit = !!(hWord || mm1 !== undefined || h === 0 || h >= 12)
    if (period) {
      if (/tarde|noite|pm/.test(period) && h < 12) h += 12
      if (/manha|madrugada|am/.test(period) && h === 12) h = 0
    }
    times.push({ h, m: mi, explicit: explicit || !!period, raw: full.trim() })
    consumed.push(full)
  }
  consumed.forEach((f) => {
    res.understood.push({ text: f.trim(), as: 'horário' })
    t = t.replace(f, ' ')
  })

  // Ambiguidade AM/PM em horas "soltas" de 1 a 11 ("às 8")
  times.forEach((time, i) => {
    if (time.explicit || time.h < 1 || time.h > 11) return
    const id = `ampm-${i}`
    const answer = answers[id]
    if (answer === 'pm') time.h += 12
    else if (answer !== 'am') {
      res.clarifications.push({
        id,
        question: `"${time.raw}" significa ${pad(time.h)}:${pad(time.m)} ou ${pad(time.h + 12)}:${pad(time.m)}?`,
        options: [
          { value: 'am', label: `${pad(time.h)}:${pad(time.m)} (manhã)` },
          { value: 'pm', label: `${pad(time.h + 12)}:${pad(time.m)} (tarde/noite)` },
        ],
      })
    }
  })

  // Semanal sem dia definido → pergunta qual dia
  if ((wantsWeekly || (interval?.unit === 'week' && interval.n === 1)) && c.dow === '*') {
    const answer = answers.weekday
    if (answer !== undefined) c.dow = String(answer)
    else
      res.clarifications.push({
        id: 'weekday',
        question: 'Em qual dia da semana deve executar?',
        options: [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: DOW_PT[d] })),
      })
  }

  /* ── Combina intervalo + horários ── */
  const firstTime = times[0]
  if (interval) {
    const { n, unit } = interval
    if (unit === 'second') {
      if (60 % n !== 0 && n < 60) res.warnings.push(`*/${n} segundos não divide 60: o intervalo fica irregular na virada do minuto.`)
      if (n >= 60) {
        res.status = 'unsupported'
        res.warnings.push('Para intervalos de 60 segundos ou mais, use minutos.')
        return res
      }
      c.second = n === 1 ? '*' : `*/${n}`
      c.minute = '*'
      c.hour = window ? `${window.from}-${window.open ? 23 : Math.max(window.from, window.to - 1)}` : '*'
      if (format === 'unix') {
        res.format = 'seconds'
        res.warnings.push('O formato Unix não tem campo de segundos — a expressão foi gerada no formato de 6 campos.')
      }
    } else if (unit === 'minute') {
      if (n >= 60) {
        if (n % 60 === 0) {
          interval.unit = 'hour'
          interval.n = n / 60
        } else {
          res.status = 'unsupported'
          res.warnings.push(`Intervalos de ${n} minutos não cabem em uma única expressão CRON (o campo de minutos reinicia a cada hora).`)
          return res
        }
      } else {
        if (60 % n !== 0) res.warnings.push(`*/${n} não divide 60: execuções em ${Array.from({ length: Math.ceil(60 / n) }, (_, i) => `:${pad(i * n)}`).join(', ')} e reinício na hora seguinte (intervalo irregular).`)
        c.minute = n === 1 ? '*' : `*/${n}`
        c.hour = window ? `${window.from}-${window.open ? 23 : Math.max(window.from, window.to - 1)}` : '*'
        if (window && !window.open) res.notes.push(`Última execução às ${pad(Math.max(window.from, window.to - 1))}:${pad(60 - n)}; para incluir ${pad(window.to)}:00 exatamente seria necessária uma segunda expressão.`)
      }
    }
    if (interval.unit === 'hour') {
      const hn = interval.n
      if (hn >= 24) {
        if (hn % 24 === 0) {
          interval.unit = 'day'
          interval.n = hn / 24
        } else {
          res.status = 'unsupported'
          res.warnings.push(`Intervalos de ${hn} horas não são representáveis em uma expressão CRON.`)
          return res
        }
      } else {
        if (24 % hn !== 0 && !window) res.warnings.push(`*/${hn} não divide 24: o intervalo fica irregular na virada do dia (última execução às ${pad(Math.floor(23 / hn) * hn)}h, depois 00h).`)
        c.minute = firstTime ? String(firstTime.m) : '0'
        const start = window ? window.from : firstTime ? firstTime.h : null
        if (window) c.hour = hn === 1 ? `${window.from}-${window.to}` : `${window.from}-${window.to}/${hn}`
        else if (start !== null && start !== 0) c.hour = `${start}/${hn}`
        else c.hour = hn === 1 ? '*' : `*/${hn}`
      }
    }
    if (interval.unit === 'day') {
      c.minute = firstTime ? String(firstTime.m) : '0'
      c.hour = firstTime ? String(firstTime.h) : '0'
      if (interval.n === 1) explicitDaily = true
      else {
        c.dom = `*/${interval.n}`
        res.warnings.push(`*/${interval.n} no dia do mês reinicia todo mês (ex.: dia 31 seguido do dia 1). Não é um intervalo exato de ${interval.n} dias.`)
      }
      if (!firstTime) res.notes.push('Horário não informado — assumido 00:00.')
    }
    if (interval.unit === 'week' && interval.n > 1) {
      res.status = 'unsupported'
      res.warnings.push(`CRON não representa "a cada ${interval.n} semanas". Alternativas: agendar semanalmente e controlar a alternância no script, ou usar dias fixos do mês (ex.: dias 1 e 15).`)
      return res
    }
    if (interval.unit === 'month') {
      c.minute = firstTime ? String(firstTime.m) : '0'
      c.hour = firstTime ? String(firstTime.h) : '0'
      if (c.dom === '*') {
        c.dom = '1'
        res.notes.push('Dia não informado — assumido dia 1.')
      }
      if (c.month === '*') c.month = interval.n === 1 ? '*' : `1/${interval.n}`
      if (12 % interval.n !== 0) res.warnings.push(`A cada ${interval.n} meses não divide 12: o ciclo reinicia em janeiro.`)
      if (!firstTime) res.notes.push('Horário não informado — assumido 00:00.')
    }
  }

  if (c.minute === null) {
    // sem intervalo sub-diário: agendamento em horários fixos
    if (!times.length) {
      c.minute = '0'
      c.hour = window ? `${window.from}-${window.to}` : '0'
      if (window) res.notes.push('Janela de horário sem intervalo: interpretado como uma execução por hora dentro da janela.')
      else res.notes.push('Horário não informado — assumido 00:00 (meia-noite).')
    } else {
      const sameMinute = times.every((x) => x.m === times[0].m)
      const sameHour = times.every((x) => x.h === times[0].h)
      if (sameMinute) {
        c.minute = String(times[0].m)
        c.hour = [...new Set(times.map((x) => x.h))].sort((a, b) => a - b).join(',')
      } else if (sameHour) {
        c.hour = String(times[0].h)
        c.minute = [...new Set(times.map((x) => x.m))].sort((a, b) => a - b).join(',')
      } else {
        c.minute = String(times[0].m)
        c.hour = String(times[0].h)
        res.warnings.push('Horários com horas e minutos diferentes exigem uma expressão para cada horário. A expressão principal usa o primeiro; as demais estão em alternativas.')
        times.slice(1).forEach((x) => res.alternatives.push({ label: `${pad(x.h)}:${pad(x.m)}`, expression: assemble({ ...c, minute: String(x.m), hour: String(x.h) }, res.format) }))
      }
    }
  }

  if (yearly && c.month === '*') {
    c.month = '1'
    if (c.dom === '*') c.dom = '1'
    res.notes.push('"Anual" interpretado como 1º de janeiro.')
  }
  if (monthly && c.dom === '*' && c.dow === '*' && !interval) {
    c.dom = '1'
    res.notes.push('"Mensal" sem dia definido — assumido dia 1.')
  }
  monthly = monthly || false

  if (c.dom !== '*' && c.dow !== '*' && format !== 'quartz')
    res.warnings.push('Dia do mês e dia da semana definidos juntos: no cron Unix a execução acontece quando QUALQUER um coincidir.')
  if (c.dom !== '*' && c.dow !== '*' && format === 'quartz') {
    res.warnings.push('Quartz não permite dia do mês e dia da semana ao mesmo tempo; o dia da semana foi mantido.')
    c.dom = '*'
  }

  const recognizedSomething = res.understood.length > 0 || explicitDaily
  if (!recognizedSomething) {
    res.status = 'unknown'
    return res
  }

  // sobras significativas na frase → avisa que parte não foi entendida
  const leftover = t
    .replace(/\b(executar|rodar|disparar|agendar|job|tarefa|script|backup|relatorio|o|a|os|as|de|do|da|dos|das|e|em|no|na|nos|nas|todo|toda|todos|todas|cada|vez|vezes|por|para|ao|aos|sempre|que|um|uma|hora|horas|dia|dias|semana|mes)\b/g, ' ')
    .replace(/[,\s]+/g, ' ')
    .trim()
  if (leftover.length > 2) res.warnings.push(`Trecho não interpretado: "${leftover}". Verifique se a expressão gerada corresponde à intenção.`)

  if (res.clarifications.length) res.status = 'clarify'
  res.canonical = c
  res.expression = assemble(c, res.format)
  return res
}

export const NATURAL_EXAMPLES = [
  'Executar todos os dias às 8 da manhã',
  'Executar a cada 15 minutos',
  'Executar toda segunda-feira às 10 horas',
  'Executar no primeiro dia de cada mês',
  'Executar a cada 2 horas, de segunda a sexta',
  'A cada 30 minutos das 8h às 18h em dias úteis',
  'Todo dia 5 e 20 às 23:30',
  'Às 8 de segunda a sexta',
]
