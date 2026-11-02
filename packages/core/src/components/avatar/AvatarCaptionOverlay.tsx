import type { CSSProperties } from 'react'

export interface AvatarCaptionOverlayProps {
  text?: string
  visible?: boolean
  speaker?: 'user' | 'avatar'
  style?: CSSProperties
}

/** A readable caption surface for spoken or interim transcript text. */
export function AvatarCaptionOverlay({ text, visible = true, speaker = 'avatar', style }: AvatarCaptionOverlayProps) {
  if (!visible || !text?.trim()) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={(speaker === 'user' ? 'You' : 'Avatar') + ' caption'}
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
        transform: 'translateX(-50%)',
        width: 'min(42rem, calc(100% - 2rem))',
        padding: '0.65rem 0.9rem',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '0.8rem',
        color: '#f8fafc',
        background: 'rgba(7,14,18,0.78)',
        backdropFilter: 'blur(14px)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.24)',
        textAlign: 'center',
        fontSize: '0.82rem',
        lineHeight: 1.45,
        zIndex: 19,
        pointerEvents: 'none',
        ...style
      }}
    >
      <span style={{ color: speaker === 'user' ? '#67e8f9' : '#99f6e4', marginRight: '0.35rem', fontWeight: 700 }}>
        {speaker === 'user' ? 'You' : 'Avatar'}
      </span>
      {text}
    </div>
  )
}
