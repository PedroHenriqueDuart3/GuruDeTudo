/**
 * Conversão de nomes entre convenções. Entende PascalCase (CodigoEmpresa), snake_case
 * (codigo_empresa), kebab, espaços e siglas (XMLData). Nomes todos em maiúsculas sem
 * separador (CODCOLIGADA, padrão TOTVS) viram uma palavra só: não há como adivinhar onde
 * cortar sem dicionário. Por isso a opção "manter nomes originais" existe.
 */

export function words(name) {
  const s = String(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .trim()
  return s ? s.split(/\s+/) : []
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()

export const toPascal = (name) => words(name).map(cap).join('') || 'Campo'
export const toCamel = (name) => {
  const p = toPascal(name)
  return p.charAt(0).toLowerCase() + p.slice(1)
}
export const toSnake = (name) => words(name).map((w) => w.toLowerCase()).join('_') || 'campo'

/** Mantém o nome original, só tornando-o um identificador válido (sem acentos/espaços). */
export const toSafe = (name) => {
  const s = String(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return s || 'campo'
}

const GO_INITIALISMS = new Set(['Id', 'Url', 'Uri', 'Api', 'Http', 'Json', 'Xml', 'Sql', 'Uuid', 'Ip', 'Html', 'Cpu'])
export const toGoName = (name) =>
  words(name)
    .map(cap)
    .map((w) => (GO_INITIALISMS.has(w) ? w.toUpperCase() : w))
    .join('') || 'Campo'

/** Singular simples (pt-BR e inglês) para nomear a classe dos itens de um array JSON. */
export function singular(name) {
  const n = String(name)
  const rules = [
    [/ies$/i, 'y'],
    [/sses$/i, 'ss'],
    [/oes$/i, 'ao'],
    [/aes$/i, 'ao'],
    [/ns$/i, 'm'],
    [/ais$/i, 'al'],
    [/eis$/i, 'el'],
    [/ois$/i, 'ol'],
    [/res$/i, 'r'],
    [/zes$/i, 'z'],
    [/([^s])s$/i, '$1'],
  ]
  for (const [re, rep] of rules) if (re.test(n)) return n.replace(re, rep)
  return `${n}Item`
}

export const RESERVED = {
  csharp: new Set('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while'.split(' ')),
  java: new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null record var yield'.split(' ')),
  kotlin: new Set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(' ')),
  python: new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' ')),
  typescript: new Set('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with'.split(' ')),
  go: new Set('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'.split(' ')),
}

/** Garante identificador válido e não reservado na linguagem. */
export function safeIdent(name, lang) {
  let n = /^[0-9]/.test(name) ? `_${name}` : name
  if (RESERVED[lang]?.has(n)) {
    if (lang === 'csharp') n = `@${n}`
    else if (lang === 'kotlin') n = `\`${n}\``
    else n = `${n}_`
  }
  return n
}

/** Evita nomes repetidos dentro da mesma classe (Nome / NOME → Nome, Nome2). */
export function uniqueNamer() {
  const used = new Map()
  return (n) => {
    const key = n.toLowerCase()
    const c = used.get(key) ?? 0
    used.set(key, c + 1)
    return c ? `${n}${c + 1}` : n
  }
}
