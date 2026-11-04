/**
 * Web Worker do SQL Forge: a formatação (lexer → parser → renderizador → verificação)
 * roda fora da thread principal, então scripts grandes não travam a digitação.
 */
import { exposeWorker } from '@core/workers/createWorkerClient'
import { formatTsql } from './lib/formatter.js'

exposeWorker({
  format({ text, options }) {
    return formatTsql(text, options)
  },
})
