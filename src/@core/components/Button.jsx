import { forwardRef } from 'react'
import { cn } from '@core/utils'
import Icon from './Icon'

/**
 * Botão base — mesma API conceitual do Button.vue do ReservaSalas:
 * variant: default | outlined | text | danger | ghost
 * size: sm | md
 */
const Button = forwardRef(function Button(
  {
    variant = 'default',
    size = 'md',
    icon,
    appendIcon,
    loading = false,
    disabled = false,
    block = false,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', loading && 'btn--loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="btn__spinner" aria-hidden /> : icon && <Icon path={icon} size={size === 'sm' ? 16 : 18} />}
      {children && <span className="btn__label">{children}</span>}
      {appendIcon && !loading && <Icon path={appendIcon} size={size === 'sm' ? 16 : 18} />}
    </button>
  )
})

export default Button

/** Botão apenas com ícone — exige `label` para leitores de tela e tooltip. */
export const IconButton = forwardRef(function IconButton(
  { icon, label, active = false, size = 'md', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn('icon-btn', `icon-btn--${size}`, active && 'is-active', className)}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      {...rest}
    >
      <Icon path={icon} size={size === 'sm' ? 16 : 20} />
    </button>
  )
})
