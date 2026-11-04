/**
 * Model Generator: SQL (T-SQL) ou JSON → classes em C#, Java, Kotlin, Python, TypeScript e Go.
 */
import { generate, LANGUAGES } from './generators.js'
import { jsonToModel } from './jsonSource.js'
import { sqlToModel } from './sqlSource.js'

export { LANGUAGES }

export function detectSource(text) {
  return /^\s*[[{]/.test(text) ? 'json' : 'sql'
}

export function generateModels(input, { source = 'auto', language = 'csharp', style, rootName, detectDates = true, ...opts } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const src = source === 'auto' ? detectSource(input) : source
  const model = src === 'json' ? jsonToModel(input, { rootName, detectDates }) : sqlToModel(input)
  const files = generate(model, language, { style, ...opts })
  const fields = model.classes.reduce((n, c) => n + c.fields.length, 0)
  return {
    source: src,
    files,
    classes: model.classes.map((c) => ({ name: c.name, kind: c.kind, origin: c.origin, fields: c.fields.length, unknown: c.fields.filter((f) => f.type.base === 'unknown').length })),
    warnings: model.warnings,
    stats: { classes: model.classes.length, fields, ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0 },
  }
}
