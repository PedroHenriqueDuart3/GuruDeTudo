import { useId } from 'react'

/** Marca do DevTools Workspace: chevrons de código com núcleo neon. */
export default function Logo({ size = 32 }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo-mark">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6190BD" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="var(--surface-2)" />
      <rect x="2" y="2" width="60" height="60" rx="14" fill="none" stroke={`url(#${id}-g)`} strokeWidth="3" />
      <path d="M22 22 L12 32 L22 42" fill="none" stroke={`url(#${id}-g)`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M42 22 L52 32 L42 42" fill="none" stroke={`url(#${id}-g)`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="32" r="4" fill="#64B5F6" className="logo-mark__core" />
    </svg>
  )
}
