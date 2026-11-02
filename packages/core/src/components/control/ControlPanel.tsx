import { memo, type ReactNode } from 'react'
import {
  AudioLines,
  Crosshair,
  Headset,
  Mic,
  Minus,
  Plus,
  Settings,
  Smartphone,
  X
} from 'lucide-react'
import { type AppConfig } from '../../app/appConfig'
import { ControlButton } from '../common/ControlButton'
import { useXRLayout } from '../../utils/useXRLayout'

interface ControlPanelProps {
  config: AppConfig
  isRecording: boolean
  handleAppStateChange: (newAppState: AppConfig) => void
  onEnterARMode?: () => void
  onEnterVRMode?: () => void
  onExitXR?: () => void
  onRecenter?: () => void
  onScaleUp?: () => void
  onScaleDown?: () => void
  onOpenSettings?: () => void
  xrStatusText?: string
  xrCanEnterAR?: boolean
  xrCanEnterVR?: boolean
  vadDetecting?: boolean
  ttsActive?: boolean
  isVisible: boolean
}

/**
 * A control action rendered as a lucide icon plus an optional short text label.
 * Labels are the canon's answer to "emoji-only is cryptic": they show on the
 * flat desktop bar and hide in XR (where hit targets grow and text is noisy) and
 * on the compact mobile bar (where horizontal space is tight).
 */
function LabeledControl({
  icon,
  label,
  showLabel,
  size,
  onClick,
  tooltipContent,
  isActive = false,
  disabled = false
}: {
  icon: ReactNode
  label: string
  showLabel: boolean
  size: number
  onClick: () => void
  tooltipContent?: string
  isActive?: boolean
  disabled?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.25rem'
      }}
    >
      <ControlButton
        isActive={isActive}
        size={size}
        onClick={onClick}
        disabled={disabled}
        tooltipContent={tooltipContent}
        ariaLabel={label}
      >
        {icon}
      </ControlButton>
      {showLabel && (
        <span
          style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            lineHeight: 1,
            color: isActive ? 'var(--primary)' : 'var(--muted-foreground)',
            opacity: disabled ? 0.5 : 1,
            whiteSpace: 'nowrap'
          }}
        >
          {label}
        </span>
      )}
    </div>
  )
}

export const ControlPanel = memo(({
  config,
  handleAppStateChange,
  isRecording,
  onEnterARMode,
  onEnterVRMode,
  onExitXR,
  onRecenter,
  onScaleUp,
  onScaleDown,
  onOpenSettings,
  xrStatusText,
  xrCanEnterAR = false,
  xrCanEnterVR = false,
  vadDetecting = false,
  isVisible
}: ControlPanelProps) => {
  const isMobile = window.innerWidth <= 768
  const { isXR } = useXRLayout()

  // Per-surface sizing: larger, glove-friendly hit targets in XR; compact on mobile.
  const controlButtonSize = isXR ? 56 : isMobile ? 44 : 48
  // Under-icon labels help on the roomy desktop bar; hidden where space or context
  // makes them noise (compact mobile bar, immersive XR).
  const showLabels = !isXR && !isMobile
  // Size the glyph to the button; lucide strokes read well around ~45% of the box.
  const iconSize = Math.round(controlButtonSize * 0.45)

  const micIcon = vadDetecting ? (
    <AudioLines size={iconSize} aria-hidden />
  ) : (
    <Mic size={iconSize} aria-hidden />
  )

  // "XR: unavailable" is a diagnostic, not product information: on any desktop
  // browser without a headset it is permanently true, so it sat across the
  // bottom of every frame — under the bar, half over the avatar, one line above
  // the viewport edge — saying nothing a viewer can act on. Surface the status
  // only when there is something to say (a headset is ready, or a session is
  // running), and put it ABOVE the bar so it is never the thing hugging the
  // bottom edge.
  const showXrStatus = Boolean(xrStatusText) && xrStatusText !== 'XR: unavailable'

  return (
    <div
      style={{
        position: 'absolute',
        bottom: `calc(${isXR ? '2rem' : '1.25rem'} + env(safe-area-inset-bottom))`,
        // Span the surface and centre the bar inside it, rather than
        // `left: 50%` + `translateX(-50%)`.
        //
        // An absolutely positioned box with only `left` set is shrink-to-fit
        // against `containing block width - left`, so at `left: 50%` the bar
        // could never be wider than HALF the screen — 180 px on a 360 px phone.
        // `flexWrap` then did what it was told and folded eight 44 px controls
        // into a 2-across, 4-down block ~230 px tall, which climbed straight
        // over the chat input sitting at `bottom: 7.5rem`. The transform reads
        // as the cause because it is the visible half of the trick; the real
        // cause is the width the trick leaves behind.
        left: 0,
        right: 0,
        zIndex: 1000,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        transform: isVisible ? 'translateY(0)' : 'translateY(100%)',
        opacity: isVisible ? 1 : 0,
        visibility: isVisible ? 'visible' : 'hidden',
        pointerEvents: isVisible ? 'auto' : 'none'
      }}
    >
      {showXrStatus && (
        <div
          style={{
            marginBottom: '0.5rem',
            textAlign: 'center',
            fontSize: '0.75rem',
            color: 'var(--muted-foreground)'
          }}
        >
          {xrStatusText}
        </div>
      )}
      <div
        style={{
          background: 'var(--xr-glass-bg)',
          backdropFilter: 'blur(var(--xr-glass-blur))',
          border: '0.0625rem solid var(--xr-glass-border)',
          color: 'var(--card-foreground)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--xr-elevation)',
          display: 'flex',
          justifyContent: 'center',
          padding: isXR ? '1rem 1.5rem' : '0.75rem 1.25rem',
          gap: isXR ? '1rem' : '0.75rem',
          flexWrap: 'wrap',
          minHeight: isXR ? '4.5rem' : '3.5rem',
          alignItems: 'flex-start',
          width: 'fit-content',
          margin: '0 auto',
          // Mobile is capped to exactly four controls per row (4 x 44 px + 3 x
          // 12 px gap + 2 x 20 px padding = 15.75rem), so eight actions land as
          // a tidy 4 + 4 grid instead of a ragged 5 + 3. Two rows is 124 px
          // tall, which is what the mobile chat input is raised to clear.
          maxWidth: isXR ? '38rem' : isMobile ? '15.75rem' : '32rem'
        }}
      >
        <LabeledControl
          icon={micIcon}
          label={vadDetecting ? 'Listening' : isRecording ? 'Mic on' : 'Mic'}
          showLabel={showLabels}
          isActive={isRecording}
          size={controlButtonSize}
          onClick={() => handleAppStateChange({ ...config, microphone: !config.microphone })}
          tooltipContent={
            isRecording
              ? vadDetecting
                ? 'Voice Detected - STT Active'
                : 'VAD Listening - Speak to Start STT'
              : 'Enable Voice Detection'
          }
        />

        {onEnterVRMode && (
          <LabeledControl
            icon={<Headset size={iconSize} aria-hidden />}
            label="Enter VR"
            showLabel={showLabels}
            size={controlButtonSize}
            onClick={onEnterVRMode}
            disabled={!xrCanEnterVR}
            tooltipContent={xrCanEnterVR ? 'Enter VR Mode' : 'VR not supported'}
          />
        )}

        {onEnterARMode && (
          <LabeledControl
            icon={<Smartphone size={iconSize} aria-hidden />}
            label="Enter AR"
            showLabel={showLabels}
            size={controlButtonSize}
            onClick={onEnterARMode}
            disabled={!xrCanEnterAR}
            tooltipContent={xrCanEnterAR ? 'Enter AR Mode' : 'AR not supported'}
          />
        )}

        {onExitXR && (
          <LabeledControl
            icon={<X size={iconSize} aria-hidden />}
            label="Exit XR"
            showLabel={showLabels}
            size={controlButtonSize}
            onClick={onExitXR}
            tooltipContent="Exit XR Session"
          />
        )}

        {onRecenter && (
          <LabeledControl
            icon={<Crosshair size={iconSize} aria-hidden />}
            label="Recenter"
            showLabel={showLabels}
            size={controlButtonSize}
            onClick={onRecenter}
            tooltipContent="Recenter View"
          />
        )}

        {onScaleDown && (
          <LabeledControl
            icon={<Minus size={iconSize} aria-hidden />}
            label="Smaller"
            showLabel={showLabels}
            size={controlButtonSize}
            onClick={onScaleDown}
            tooltipContent="Scale Down"
          />
        )}

        {onScaleUp && (
          <LabeledControl
            icon={<Plus size={iconSize} aria-hidden />}
            label="Larger"
            showLabel={showLabels}
            size={controlButtonSize}
            onClick={onScaleUp}
            tooltipContent="Scale Up"
          />
        )}

        {onOpenSettings && (
          <LabeledControl
            icon={<Settings size={iconSize} aria-hidden />}
            label="Settings"
            showLabel={showLabels}
            size={controlButtonSize}
            onClick={onOpenSettings}
            tooltipContent="Settings"
          />
        )}
      </div>
    </div>
  )
})

ControlPanel.displayName = 'ControlPanel'
