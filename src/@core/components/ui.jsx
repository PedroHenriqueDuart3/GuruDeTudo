import { useId, useState } from 'react'
import { motion } from 'motion/react'
import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiInformationOutline, mdiTrayArrowUp } from '@mdi/js'
import { cn } from '@core/utils'
import Icon from './Icon'

/* ───────── Card ───────── */
export function Card({ title, subtitle, icon, actions, children, className, bodyClassName, glow = false, ...rest }) {
  return (
    <section className={cn('card', glow && 'card--glow', className)} {...rest}>
      {(title || actions) && (
        <header className="card__header">
          {icon && (
            <span className="card__icon">
              <Icon path={icon} size={18} />
            </span>
          )}
          <div className="grow">
            {title && <h3 className="card__title">{title}</h3>}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className={cn('card__body', bodyClassName)}>{children}</div>
    </section>
  )
}

/* ───────── StatCard (mesma estrutura do StatCard.vue do ReservaSalas) ───────── */
export function StatCard({ label, value, sublabel, icon, accent = 'primary' }) {
  return (
    <div className={cn('stat-card', `stat-card--${accent}`)}>
      <div className="stat-card__header">
        <p className="stat-card__label">{label}</p>
        {icon && <Icon path={icon} size={20} className="stat-card__icon" />}
      </div>
      <div className="stat-card__value">{value}</div>
      {sublabel && <span className="stat-card__sublabel">{sublabel}</span>}
    </div>
  )
}

/* ───────── Tag (pill com borda, como Tag.vue) ───────── */
export function Tag({ children, variant = 'neutral', icon, dot = false, className, ...rest }) {
  return (
    <span className={cn('tag', `tag--${variant}`, className)} {...rest}>
      {dot && <span className="tag__dot" />}
      {icon && !dot && <Icon path={icon} size={14} />}
      {children}
    </span>
  )
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>
}

/* ───────── Segmented / Tabs com indicador animado ───────── */
export function Segmented({ value, onChange, options, size = 'md', ariaLabel, layoutId }) {
  const autoId = useId()
  const indicatorId = layoutId ?? `seg-${autoId}`
  return (
    <div className={cn('segmented', `segmented--${size}`)} role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn('segmented__item', active && 'is-active')}
            onClick={() => onChange(opt.value)}
            disabled={opt.disabled}
            title={opt.title}
          >
            {active && (
              <motion.span
                layoutId={indicatorId}
                className="segmented__indicator"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="segmented__content">
              {opt.icon && <Icon path={opt.icon} size={16} />}
              {opt.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ───────── Campos ───────── */
export function Field({ label, hint, error, children, htmlFor, className }) {
  return (
    <div className={cn('field', error && 'field--error', className)}>
      {label && (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  )
}

export function TextField({ label, hint, error, icon, className, id, mono = false, ...rest }) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fieldId} className={className}>
      <div className={cn('input-wrap', icon && 'input-wrap--icon')}>
        {icon && <Icon path={icon} size={16} className="input-wrap__icon" />}
        <input id={fieldId} className={cn('input', mono && 'mono')} aria-invalid={!!error || undefined} {...rest} />
      </div>
    </Field>
  )
}

export function Select({ label, hint, options, className, id, ...rest }) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <Field label={label} hint={hint} htmlFor={fieldId} className={className}>
      <select id={fieldId} className="input select" {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function Switch({ checked, onChange, label, description }) {
  const id = useId()
  return (
    <label className="switch" htmlFor={id}>
      <span className="grow">
        <span className="switch__label">{label}</span>
        {description && <span className="switch__desc">{description}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden>
        <span className="switch__thumb" />
      </span>
    </label>
  )
}

/* ───────── Progresso / estados ───────── */
export function ProgressBar({ value, indeterminate = false, label }) {
  return (
    <div
      className={cn('progress', indeterminate && 'progress--indeterminate')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round((value ?? 0) * 100)}
    >
      <div className="progress__bar" style={indeterminate ? undefined : { width: `${(value ?? 0) * 100}%` }} />
    </div>
  )
}

const ALERT_ICONS = {
  info: mdiInformationOutline,
  success: mdiCheckCircleOutline,
  warning: mdiAlertCircleOutline,
  error: mdiAlertCircleOutline,
}

export function Alert({ kind = 'info', title, children, action, className }) {
  return (
    <div className={cn('alert', `alert--${kind}`, className)} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon path={ALERT_ICONS[kind]} size={18} className="alert__icon" />
      <div className="grow">
        {title && <div className="alert__title">{title}</div>}
        {children && <div className="alert__body">{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="empty-state">
      {icon && (
        <div className="empty-state__icon">
          <Icon path={icon} size={30} />
        </div>
      )}
      <h4>{title}</h4>
      {description && <p className="muted">{description}</p>}
      {action}
    </div>
  )
}

/** Overlay de processamento (estado de carregamento) com progresso real vindo do worker. */
export function BusyOverlay({ busy, progress, message }) {
  if (!busy) return null
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-overlay__box">
        <span className="btn__spinner btn__spinner--lg" aria-hidden />
        <span>{progress?.message ?? message ?? 'Processando…'}</span>
        {typeof progress?.value === 'number' && <ProgressBar value={progress.value} label="Progresso" />}
      </div>
    </div>
  )
}

/** Área de soltar arquivos (drag & drop) envolvendo qualquer conteúdo. */
export function DropZone({ onFile, accept, children, className, label = 'Solte o arquivo para importar' }) {
  const [over, setOver] = useState(false)
  return (
    <div
      className={cn('dropzone', over && 'is-over', className)}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const file = e.dataTransfer.files?.[0]
        if (!file) return
        if (accept && !accept.split(',').some((ext) => file.name.toLowerCase().endsWith(ext.trim()))) {
          onFile(file, new Error(`Formato não suportado. Use ${accept}`))
          return
        }
        onFile(file)
      }}
    >
      {children}
      {over && (
        <div className="dropzone__overlay">
          <Icon path={mdiTrayArrowUp} size={36} />
          <span>{label}</span>
        </div>
      )}
    </div>
  )
}

/** Barra de ferramentas com agrupamento visual. */
export function Toolbar({ children, className }) {
  return (
    <div className={cn('toolbar', className)} role="toolbar">
      {children}
    </div>
  )
}

export function ToolbarDivider() {
  return <span className="toolbar__divider" aria-hidden />
}
