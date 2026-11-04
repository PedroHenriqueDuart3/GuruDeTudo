/**
 * Ícone SVG a partir de um path do @mdi/js (Material Design Icons — o mesmo
 * conjunto usado no ReservaSalas, mas tree-shakeable: só os ícones usados entram no bundle).
 */
export default function Icon({ path, size = 18, className, title, style, spin = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0, animation: spin ? 'dtw-spin 0.8s linear infinite' : undefined, ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={path} fill="currentColor" />
    </svg>
  )
}
