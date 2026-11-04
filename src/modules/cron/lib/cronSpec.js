/**
 * Formatos de CRON suportados.
 *
 *  unix    — 5 campos  · minuto hora dia-mês mês dia-semana      (crontab, Vixie, GitHub Actions, k8s)
 *  seconds — 6 campos  · segundo minuto hora dia-mês mês dia-semana (node-cron, Spring @Scheduled)
 *  quartz  — 6/7 campos· segundo minuto hora dia-mês mês dia-semana [ano]  (Quartz, AWS EventBridge*)
 *            usa '?' em dia-mês OU dia-semana, dia-semana 1-7 (1 = domingo), suporta L, W e #.
 *
 * Internamente o dia da semana é sempre normalizado para 0-6 (0 = domingo).
 */

export const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const MONTHS_PT_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const DOW_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
export const DOW_PT_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export const FIELD_DEFS = {
  second: { key: 'second', label: 'Segundo', min: 0, max: 59, unit: 'segundo', unitPlural: 'segundos' },
  minute: { key: 'minute', label: 'Minuto', min: 0, max: 59, unit: 'minuto', unitPlural: 'minutos' },
  hour: { key: 'hour', label: 'Hora', min: 0, max: 23, unit: 'hora', unitPlural: 'horas' },
  dom: { key: 'dom', label: 'Dia do mês', min: 1, max: 31, unit: 'dia', unitPlural: 'dias' },
  month: { key: 'month', label: 'Mês', min: 1, max: 12, unit: 'mês', unitPlural: 'meses', names: MONTH_NAMES },
  dow: { key: 'dow', label: 'Dia da semana', min: 0, max: 6, unit: 'dia da semana', unitPlural: 'dias da semana', names: DOW_NAMES },
  year: { key: 'year', label: 'Ano', min: 1970, max: 2199, unit: 'ano', unitPlural: 'anos' },
}

export const FORMATS = {
  unix: {
    id: 'unix',
    label: 'Unix (5 campos)',
    short: '5 campos',
    fields: ['minute', 'hour', 'dom', 'month', 'dow'],
    hint: 'crontab, GitHub Actions, Kubernetes CronJob',
    dowRange: [0, 7], // 0 e 7 = domingo
  },
  seconds: {
    id: 'seconds',
    label: 'Com segundos (6 campos)',
    short: '6 campos',
    fields: ['second', 'minute', 'hour', 'dom', 'month', 'dow'],
    hint: 'node-cron, Spring @Scheduled',
    dowRange: [0, 7],
  },
  quartz: {
    id: 'quartz',
    label: 'Quartz (6–7 campos)',
    short: 'Quartz',
    fields: ['second', 'minute', 'hour', 'dom', 'month', 'dow', 'year'],
    optionalLast: true, // o ano é opcional
    hint: 'Quartz Scheduler, Hangfire*, EventBridge* — usa ? e dia-semana 1-7',
    dowRange: [1, 7], // 1 = domingo
  },
}

export const MACROS = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}
