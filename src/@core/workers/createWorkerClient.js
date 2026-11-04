/**
 * RPC mínimo sobre Web Workers.
 *
 * Protocolo:
 *   main → worker : { id, method, params }
 *   worker → main : { id, progress }               (opcional, 0..1 + mensagem)
 *                   { id, result } | { id, error }
 *
 * Cada chamada retorna uma Promise; `onProgress` recebe atualizações.
 * `cancel(id)` avisa o worker para abandonar a tarefa (ex.: busca antiga).
 */
export function createWorkerClient(factory) {
  let worker = null
  let seq = 0
  const pending = new Map()

  function ensure() {
    if (worker) return worker
    worker = factory()
    worker.onmessage = (event) => {
      const { id, progress, result, error } = event.data
      const entry = pending.get(id)
      if (!entry) return
      if (progress !== undefined) {
        entry.onProgress?.(progress)
        return
      }
      pending.delete(id)
      if (error) entry.reject(Object.assign(new Error(error.message), error))
      else entry.resolve(result)
    }
    worker.onerror = (event) => {
      const err = new Error(event.message || 'Erro no worker')
      for (const entry of pending.values()) entry.reject(err)
      pending.clear()
    }
    return worker
  }

  function call(method, params, { onProgress, transfer } = {}) {
    const id = ++seq
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress })
    })
    ensure().postMessage({ id, method, params }, transfer ?? [])
    promise.id = id
    return promise
  }

  function cancel(id) {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    worker?.postMessage({ id, method: '__cancel' })
    entry.reject(Object.assign(new Error('Cancelado'), { cancelled: true }))
  }

  function terminate() {
    worker?.terminate()
    worker = null
    // `terminated` permite que quem chamou ignore o erro (ex.: componente desmontado)
    for (const entry of pending.values()) entry.reject(Object.assign(new Error('Worker encerrado'), { terminated: true }))
    pending.clear()
  }

  return { call, cancel, terminate }
}

/**
 * Lado do worker: registra handlers e responde ao protocolo acima.
 * Handlers recebem (params, ctx) onde ctx = { progress(value, message), isCancelled() }.
 */
export function exposeWorker(handlers) {
  const cancelled = new Set()

  self.onmessage = async (event) => {
    const { id, method, params } = event.data
    if (method === '__cancel') {
      cancelled.add(id)
      return
    }
    const handler = handlers[method]
    if (!handler) {
      self.postMessage({ id, error: { message: `Método desconhecido: ${method}` } })
      return
    }
    let lastProgress = 0
    const ctx = {
      progress(value, message) {
        const now = performance.now()
        if (now - lastProgress < 60 && value < 1) return
        lastProgress = now
        self.postMessage({ id, progress: { value, message } })
      },
      isCancelled: () => cancelled.has(id),
    }
    try {
      const result = await handler(params, ctx)
      if (!cancelled.has(id)) self.postMessage({ id, result })
    } catch (err) {
      if (!cancelled.has(id)) {
        self.postMessage({
          id,
          error: { message: err?.message ?? String(err), ...(err?.details ?? {}) },
        })
      }
    } finally {
      cancelled.delete(id)
    }
  }
}

/** Cede o event loop do worker (permite receber cancelamentos em loops longos). */
export const yieldToLoop = () => new Promise((r) => setTimeout(r, 0))
