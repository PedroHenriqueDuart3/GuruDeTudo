import { useEffect, useMemo } from 'react'
import { createWorkerClient } from '@core/workers/createWorkerClient'

/** Um worker por instância da página; encerrado ao sair do módulo (libera a memória do JSON). */
export function useJsonWorker() {
  const client = useMemo(
    () => createWorkerClient(() => new Worker(new URL('./json.worker.js', import.meta.url), { type: 'module' })),
    [],
  )
  useEffect(() => () => client.terminate(), [client])
  return client
}
