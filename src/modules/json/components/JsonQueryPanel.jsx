import { useState } from 'react'
import { mdiClose, mdiCodeJson, mdiMagnify, mdiRegex } from '@mdi/js'
import { IconButton } from '@core/components/Button'
import Icon from '@core/components/Icon'
import { Segmented, Tag } from '@core/components/ui'
import { cn, formatNumber } from '@core/utils'
import { pathToString } from '../lib/jsonEngine'

/**
 * Busca por chaves/valores e consultas JSONPath — executadas no worker,
 * com cancelamento da consulta anterior quando o usuário dispara outra.
 */
export default function JsonQueryPanel({ client, disabled, onReveal }) {
  const [mode, setMode] = useState('search')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('all')
  const [regex, setRegex] = useState(false)
  const [state, setState] = useState({ status: 'idle' })
  const [active, setActive] = useState(-1)
  const [pending, setPending] = useState(null)

  const run = async (e) => {
    e?.preventDefault()
    if (!query.trim()) return
    if (pending) client.cancel(pending.id)
    setState({ status: 'loading', message: 'Consultando…' })
    setActive(-1)
    const p =
      mode === 'search'
        ? client.call('search', { query, mode: scope, regex }, { onProgress: (pr) => setState({ status: 'loading', message: pr.message }) })
        : client.call('jsonpath', { expr: query })
    setPending(p)
    try {
      const res = await p
      setState({ status: 'done', ...res })
    } catch (err) {
      if (!err.cancelled) setState({ status: 'error', message: err.message })
    } finally {
      setPending(null)
    }
  }

  const clear = () => {
    if (pending) client.cancel(pending.id)
    setQuery('')
    setState({ status: 'idle' })
  }

  return (
    <div className="jq">
      <form className="jq__bar" onSubmit={run}>
        <Segmented
          size="sm"
          value={mode}
          onChange={(m) => {
            setMode(m)
            setState({ status: 'idle' })
            if (m === 'path' && !query.startsWith('$')) setQuery('$.')
          }}
          ariaLabel="Modo de consulta"
          options={[
            { value: 'search', label: 'Buscar', icon: mdiMagnify },
            { value: 'path', label: 'JSONPath', icon: mdiCodeJson },
          ]}
        />
        <div className="jq__input">
          <input
            className="mono"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'search' ? 'Propriedade ou valor…' : "$.colaboradores[?(@.salario > 12000)].nome"}
            aria-label={mode === 'search' ? 'Buscar propriedades e valores' : 'Expressão JSONPath'}
            disabled={disabled}
          />
          {query && <IconButton size="sm" icon={mdiClose} label="Limpar" onClick={clear} />}
        </div>
        {mode === 'search' && (
          <>
            <select className="input select jq__scope" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Escopo da busca">
              <option value="all">Chaves e valores</option>
              <option value="keys">Só chaves</option>
              <option value="values">Só valores</option>
            </select>
            <IconButton size="sm" icon={mdiRegex} label="Usar expressão regular" active={regex} onClick={() => setRegex((r) => !r)} />
          </>
        )}
        <button type="submit" className="btn btn--default btn--sm" disabled={disabled || !query.trim()}>
          {state.status === 'loading' ? <span className="btn__spinner" /> : <Icon path={mdiMagnify} size={16} />}
          <span className="btn__label">Executar</span>
        </button>
      </form>

      {state.status !== 'idle' && (
        <div className="jq__results">
          {state.status === 'loading' && <div className="jq__meta">{state.message}</div>}
          {state.status === 'error' && <div className="jq__meta jq__meta--error">{state.message}</div>}
          {state.status === 'done' && (
            <>
              <div className="jq__meta">
                <Tag variant={state.total ? 'info' : 'neutral'} dot>
                  {formatNumber(state.total)} resultado{state.total === 1 ? '' : 's'}
                </Tag>
                {state.truncated && <span className="subtle">exibindo os primeiros {formatNumber(state.results.length)}</span>}
                <span className="grow" />
                <IconButton size="sm" icon={mdiClose} label="Fechar resultados" onClick={() => setState({ status: 'idle' })} />
              </div>
              <ul className="jq__list">
                {state.results.map((r, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={cn('jq__item', active === i && 'is-active')}
                      onClick={() => {
                        setActive(i)
                        onReveal(r.path)
                      }}
                    >
                      <span className="mono jq__path">{pathToString(r.path)}</span>
                      <span className={`mono jt-val jt-val--${r.type}`}>{r.type === 'string' ? `"${r.preview}"` : r.preview}</span>
                      {r.match && <Tag variant={r.match === 'key' ? 'violet' : 'cyan'}>{r.match === 'key' ? 'chave' : 'valor'}</Tag>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
