/**
 * Realce de sintaxe do código gerado, sem dependências extras: um tokenizador simples
 * (StreamLanguage do CodeMirror) configurado por linguagem. Cobre o que as models usam:
 * palavras-chave, tipos, textos, números, comentários e anotações/atributos.
 */
import { StreamLanguage } from '@codemirror/language'
import { json as jsonLang } from '@codemirror/lang-json'

const set = (s) => new Set(s.split(' '))

const CONFIG = {
  csharp: {
    keywords: set('using namespace public private protected internal class record struct interface get set init new return this null true false static readonly partial sealed abstract override virtual'),
    types: set('int long short byte bool decimal double float string object char DateTime DateOnly TimeOnly DateTimeOffset Guid List'),
    lineComment: '//',
    annotation: /^\[[^\]\n]*\]/,
  },
  java: {
    keywords: set('package import public private protected class record interface implements extends return this new null true false static final void if instanceof'),
    types: set('int long short byte boolean double float char Integer Long Short Byte Boolean Double Float String Object BigDecimal LocalDate LocalDateTime LocalTime OffsetDateTime UUID List Serializable'),
    lineComment: '//',
    annotation: /^@[\w.]+/,
  },
  kotlin: {
    keywords: set('package import class data val var fun return null true false object override'),
    types: set('Int Long Short Byte Boolean Double Float String Any BigDecimal LocalDate LocalDateTime LocalTime OffsetDateTime UUID ByteArray List Serializable'),
    lineComment: '//',
    annotation: /^@[\w.:]+/,
  },
  python: {
    keywords: set('from import class def return pass None True False as'),
    types: set('int str float bool bytes Decimal date datetime time UUID Any Optional List Mapped BaseModel'),
    lineComment: '#',
    annotation: /^@[\w.]+/,
  },
  typescript: {
    keywords: set('export import from interface type class const extends readonly null true false typeof'),
    types: set('string number boolean unknown any Date'),
    lineComment: '//',
    annotation: /^@[\w.]+/,
  },
  go: {
    keywords: set('package import type struct func return map chan interface var const'),
    types: set('string bool int int8 int16 int32 int64 uint8 uint16 uint32 uint64 float32 float64 byte any'),
    lineComment: '//',
    annotation: null,
  },
}

function mode(cfg) {
  return {
    name: 'model',
    startState: () => ({ block: false }),
    token(stream, state) {
      if (state.block) {
        if (stream.match(/^.*?\*\//)) state.block = false
        else stream.skipToEnd()
        return 'comment'
      }
      if (stream.eatSpace()) return null
      if (stream.match(cfg.lineComment)) {
        stream.skipToEnd()
        return 'comment'
      }
      if (stream.match('/*')) {
        state.block = !stream.match(/^.*?\*\//)
        if (state.block) stream.skipToEnd()
        return 'comment'
      }
      if (cfg.annotation && stream.match(cfg.annotation)) return 'attributeName'
      if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/) || stream.match(/^`[^`]*`?/)) return 'string'
      if (stream.match(/^\d+(\.\d+)?/)) return 'number'
      const w = stream.match(/^[A-Za-z_$][\w$]*/)
      if (w) {
        const word = w[0]
        if (cfg.keywords.has(word)) return word === 'null' || word === 'None' ? 'null' : word === 'true' || word === 'false' || word === 'True' || word === 'False' ? 'bool' : 'keyword'
        if (cfg.types.has(word) || /^[A-Z]/.test(word)) return 'typeName'
        return null
      }
      stream.next()
      return 'punctuation'
    },
  }
}

const cache = new Map()

export async function loadLanguage(lang) {
  if (lang === 'json') return jsonLang()
  if (!CONFIG[lang]) return []
  if (!cache.has(lang)) cache.set(lang, StreamLanguage.define(mode(CONFIG[lang])))
  return cache.get(lang)
}
