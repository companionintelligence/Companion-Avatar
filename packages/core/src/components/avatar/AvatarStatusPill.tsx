import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'

export type AvatarConversationStatus = 'loading' | 'idle' | 'listening' | 'thinking' | 'speaking'

export interface AvatarStatusPillProps {
  status: AvatarConversationStatus
  accentColor?: string
  analyser?: AnalyserNode
  onPillClick?: () => void
  onStopClick?: () => void
  micError?: string | null
  engineWarning?: string | null
  loadingLabel?: string
  loadingPct?: number
  /** Draw the live waveform while listening or speaking. Turn it off where the pill has to share a narrow row. */
  showWaveform?: boolean
  style?: CSSProperties
}

const STATUS_LABELS: Record<AvatarConversationStatus, string> = {
  loading: 'Initializing voice session',
  idle: 'Tap to listen',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking'
}

/**
 * Compact, dependency-free voice state indicator inspired by the reference
 * avatar's status pill. It owns only presentation; callers remain in control of
 * VAD/STT/TTS and can mount it in a DOM overlay or XR-safe shell.
 */
export function AvatarStatusPill({
  status,
  accentColor = '#2dd4bf',
  analyser,
  onPillClick,
  onStopClick,
  micError,
  engineWarning,
  loadingLabel,
  loadingPct,
  showWaveform = true,
  style
}: AvatarStatusPillProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !analyser || (status !== 'listening' && status !== 'speaking')) return
    const context = canvas.getContext('2d')
    if (!context) return

    const data = new Uint8Array(analyser.fftSize)
    let animationFrame = 0
    const draw = () => {
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.strokeStyle = accentColor
      context.lineWidth = 1.5
      context.beginPath()
      if (reducedMotion) {
        context.moveTo(0, canvas.height / 2)
        context.lineTo(canvas.width, canvas.height / 2)
      } else {
        analyser.getByteTimeDomainData(data)
        const width = canvas.width / Math.max(1, data.length - 1)
        for (let index = 0; index < data.length; index += 1) {
          const x = index * width
          const y = (data[index] / 255) * canvas.height
          if (index === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        }
      }
      context.stroke()
      if (!reducedMotion) animationFrame = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(animationFrame)
  }, [accentColor, analyser, reducedMotion, status])

  const label =
    micError ? 'Microphone permission needed' :
    status === 'loading' && loadingLabel && loadingPct !== undefined && loadingPct > 0
      ? 'Loading ' + loadingLabel + ' (' + Math.round(loadingPct) + '%)'
      : status === 'loading' && loadingLabel
        ? 'Initializing ' + loadingLabel
        : STATUS_LABELS[status]
  const dotColor = micError ? '#f87171' : status === 'loading' ? '#fbbf24' : status === 'listening' ? '#fb7185' : accentColor
  const isActionable = status !== 'loading'

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isActionable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    if (status === 'idle') onPillClick?.()
    else onStopClick?.()
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      onClick={() => {
        if (!isActionable) return
        if (status === 'idle') onPillClick?.()
        else onStopClick?.()
      }}
      onKeyDown={handleKeyDown}
      tabIndex={isActionable ? 0 : -1}
      style={{
        position: 'absolute',
        left: '1.25rem',
        bottom: '1.25rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.7rem',
        minHeight: '2.75rem',
        padding: '0.6rem 0.85rem',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: '999px',
        color: '#f8fafc',
        background: 'rgba(11, 20, 24, 0.82)',
        backdropFilter: 'blur(18px)',
        boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
        fontFamily: 'inherit',
        cursor: isActionable ? 'pointer' : 'wait',
        userSelect: 'none',
        zIndex: 20,
        ...style
      }}
    >
      <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, boxShadow: '0 0 12px ' + dotColor }} />
      <span style={{ display: 'grid', gap: '0.15rem' }}>
        <strong style={{ fontSize: '0.78rem', letterSpacing: '0.02em' }}>{label}</strong>
        {engineWarning && <span style={{ fontSize: '0.68rem', color: '#fde68a' }}>{engineWarning}</span>}
        {status === 'loading' && loadingPct !== undefined && loadingPct > 0 && (
          <span aria-hidden style={{ width: '7rem', height: 3, overflow: 'hidden', borderRadius: 99, background: 'rgba(255,255,255,0.16)' }}>
            <span style={{ display: 'block', width: Math.min(100, Math.max(4, loadingPct)) + '%', height: '100%', background: '#fbbf24' }} />
          </span>
        )}
      </span>
      {showWaveform && (status === 'listening' || status === 'speaking') && (
        <canvas ref={canvasRef} width={64} height={20} aria-hidden style={{ display: 'block', opacity: 0.9 }} />
      )}
      {status !== 'idle' && status !== 'loading' && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onStopClick?.()
          }}
          style={{
            border: '1px solid rgba(248,113,113,0.55)',
            borderRadius: '999px',
            padding: '0.25rem 0.55rem',
            color: '#fecaca',
            background: 'rgba(127,29,29,0.32)',
            font: 'inherit',
            fontSize: '0.68rem',
            cursor: 'pointer'
          }}
        >
          Stop
        </button>
      )}
    </div>
  )
}
