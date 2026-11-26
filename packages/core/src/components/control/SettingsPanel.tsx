import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSimpleStore } from '@hexafield/simple-store/react'
import { MonitorCog, Server, Settings as SettingsIcon, SlidersHorizontal, UserRound } from 'lucide-react'
import { resolveAvatarSource } from '@ci-avatar/engine'

import {
  COMMON_OLLAMA_MODELS,
  defaultLLMConfig,
  type ActivationState,
  type LLMConfig,
  type LLMProvider
} from '../../services/llm/config/llmConfig'
import { useConnectionCheck } from '../../services/connection/useConnectionCheck'
import { ConnectionStatusPanel } from '../common/ConnectionStatusPanel'
import { LLMSettingsState } from '../../config/settingsStore'
import { clearLocalOverrides, resolveLLMConfig, writeLocalOverrides } from '../../config/appConfigService'
import { loadRuntimeConfig } from '../../config/runtimeConfig'
import { AppConfigState } from '../../app/appConfig'
import { useHasWebGPU } from '../../utils/useHasWebGPU'
import { useXRLayout } from '../../utils/useXRLayout'
import { useVisibleViewportInsets } from '../../utils/useVisibleViewportInsets'
import { AvatarOptions } from '../scene/avatar/AvatarOptions'
import { CC0_AVATAR_SOURCES } from '../scene/avatar/cc0Avatars'
import { AvatarState } from '../scene/avatar/avatarState'
import { getActiveFacialRig } from '../../services/face/faceCompositorRegistry'

/**
 * Server addresses and model names are identifiers, not prose. Without these, a phone keyboard
 * capitalises the first letter and "corrects" what it takes for a misspelling: on iOS it turned a word
 * in a host name, `ulmer`, into `ulcer`, and the connection check then failed with no hint why. The
 * chat box keeps the defaults.
 */
const identifierInputProps = {
  autoCapitalize: 'off',
  autoCorrect: 'off',
  autoComplete: 'off',
  spellCheck: false
} as const

const AVATAR_KEYS = Object.keys(AvatarOptions)
/** What the avatar box accepts by name: the built-in models, and CC0 avatars that are fetched when they are chosen. */
const AVATAR_SOURCES = { ...AvatarOptions, ...CC0_AVATAR_SOURCES }

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  activationState?: ActivationState
  onActivationStateChange?: (state: ActivationState) => void
}

/** A labeled on/off switch row, token-styled. */
function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        padding: '0.5rem 0',
        opacity: disabled ? 0.5 : 1
      }}
    >
      <div>
        <div style={{ fontSize: '0.9rem', color: 'var(--card-foreground)' }}>{label}</div>
        {hint && <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>{hint}</div>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          flex: '0 0 auto',
          width: '2.75rem',
          height: '1.5rem',
          borderRadius: '999px',
          border: '0.0625rem solid var(--border)',
          background: checked ? 'var(--primary)' : 'var(--muted)',
          position: 'relative',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s ease',
          padding: 0
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '0.125rem',
            left: checked ? '1.375rem' : '0.125rem',
            width: '1.125rem',
            height: '1.125rem',
            borderRadius: '50%',
            background: checked ? 'var(--primary-foreground)' : 'var(--card-foreground)',
            transition: 'left 0.15s ease'
          }}
        />
      </button>
    </div>
  )
}

const PROVIDERS: { value: LLMProvider; label: string }[] = [
  { value: 'proxy', label: 'Proxy (recommended)' },
  { value: 'ollama', label: 'Ollama (direct)' },
  { value: 'openai', label: 'OpenAI-compatible' },
  { value: 'mlc', label: 'On-device (WebLLM)' },
  { value: 'script', label: 'Scripted' }
]

// Which config keys the URL/model inputs map to, per provider.
const FIELD_MAP: Record<LLMProvider, { urlKey?: keyof LLMConfig; modelKey?: keyof LLMConfig }> = {
  proxy: { urlKey: 'proxy_url', modelKey: 'proxy_model' },
  ollama: { urlKey: 'ollama_url', modelKey: 'ollama_model' },
  openai: { urlKey: 'openai_api_url', modelKey: 'openai_model' },
  mlc: { modelKey: 'mlc_model' },
  script: {}
}

export const SettingsPanel = ({ isOpen, onClose, activationState = 'unverified', onActivationStateChange }: SettingsPanelProps) => {
  const { isXR } = useXRLayout()
  // The rows of the overlay that the keyboard, or an iOS visual viewport left short after it,
  // hides. The overlay pads them away so the card, its footer included, fits what is visible.
  const overlayRef = useRef<HTMLDivElement>(null)
  const hiddenRows = useVisibleViewportInsets(overlayRef, isOpen)
  // Phone-width card: the footer has room for two buttons and a short link, not
  // a sentence. Matches the isMobile breakpoint used across the overlay.
  const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 768
  const [settings] = useSimpleStore(LLMSettingsState)
  const [appConfig] = useSimpleStore(AppConfigState)
  // Avatar selection. The shipping UI previously had none at all — the model was
  // a module constant — so a user could not change or supply an avatar, and the
  // engine's "any GLB/VRM" support was untestable by anyone but a developer.
  const [avatarState] = useSimpleStore(AvatarState)
  const [avatarUrlDraft, setAvatarUrlDraft] = useState('')
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const facialRig = getActiveFacialRig()
  const avatarLabel =
    AVATAR_KEYS.find((key) => AvatarOptions[key as keyof typeof AvatarOptions] === avatarState.selectedModel) ??
    'custom'

  const applyAvatar = useCallback((input: string) => {
    const resolved = resolveAvatarSource(input, AVATAR_SOURCES)
    if (!resolved.ok || !resolved.url) {
      setAvatarError(resolved.message ?? 'Could not load that avatar.')
      return
    }
    setAvatarError(null)
    AvatarState.set((prev) => ({ ...prev, selectedModel: resolved.url! }))
  }, [])

  const hasWebGPU = useHasWebGPU()

  const [provider, setProvider] = useState<LLMProvider>(settings.llm_provider ?? 'proxy')
  const [url, setUrl] = useState('')
  const [model, setModel] = useState('')
  // Check what the form shows, saved or not, so a server can be tried before it is saved.
  const { healthState, health, healthError, checkConnection } = useConnectionCheck(provider, onActivationStateChange, {
    url,
    model
  })

  const fields = FIELD_MAP[provider]

  // Re-hydrate the form whenever it opens or the resolved settings change.
  useEffect(() => {
    if (!isOpen) return
    const p = settings.llm_provider ?? 'proxy'
    setProvider(p)
    const map = FIELD_MAP[p]
    setUrl(map.urlKey ? String(settings[map.urlKey] ?? '') : '')
    setModel(map.modelKey ? String(settings[map.modelKey] ?? '') : '')
  }, [isOpen, settings])

  // When provider changes in the form, reflect that provider's current values.
  const onProviderChange = useCallback(
    (next: LLMProvider) => {
      setProvider(next)
      const map = FIELD_MAP[next]
      setUrl(map.urlKey ? String(settings[map.urlKey] ?? '') : '')
      setModel(map.modelKey ? String(settings[map.modelKey] ?? '') : '')
    },
    [settings]
  )

  const handleSave = useCallback(() => {
    const patch: Partial<LLMConfig> = { llm_provider: provider }
    if (fields.urlKey) patch[fields.urlKey] = url.trim() as never
    if (fields.modelKey) patch[fields.modelKey] = model.trim() as never
    writeLocalOverrides(patch)
    LLMSettingsState.set((prev) => ({ ...prev, ...patch }))
    onClose()
  }, [provider, fields, url, model, onClose])

  const handleReset = useCallback(async () => {
    clearLocalOverrides()
    const runtime = await loadRuntimeConfig()
    LLMSettingsState.set(resolveLLMConfig(runtime, {}))
    onClose()
  }, [onClose])

  const modelOptions = useMemo(() => COMMON_OLLAMA_MODELS, [])

  if (!isOpen) return null

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: isXR ? '0.95rem' : '0.8rem',
    fontWeight: 600,
    marginBottom: '0.35rem',
    color: 'var(--muted-foreground)'
  }
  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: isXR ? '0.75rem' : '0.55rem 0.7rem',
    borderRadius: 'var(--radius-md)',
    border: '0.0625rem solid var(--input)',
    background: 'var(--popover)',
    color: 'var(--popover-foreground)',
    fontSize: isXR ? '1rem' : '0.9rem',
    fontFamily: 'inherit'
  }
  const sectionHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--muted-foreground)',
    margin: '0.5rem 0 0.6rem',
    paddingTop: '0.9rem',
    borderTop: '0.0625rem solid var(--border)'
  }

  const SectionHeader = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
    <div style={sectionHeaderStyle}>
      {icon}
      <span>{children}</span>
    </div>
  )

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Connection settings"
      style={{
        position: 'absolute',
        inset: 0,
        // Centre the card in the visible part only (see useVisibleViewportInsets). With
        // border-box, the card's `maxHeight: calc(100% - 2rem)` is then measured against
        // that part too, so Save and Cancel stay on screen.
        boxSizing: 'border-box',
        paddingTop: hiddenRows?.top ?? 0,
        paddingBottom: hiddenRows?.bottom ?? 0,
        zIndex: 1300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(4, 22, 32, 0.6)',
        backdropFilter: 'blur(6px)'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          // border-box so maxWidth/maxHeight bound the RENDERED card. With the
          // default content-box the 2.8rem of padding sat outside `width`, so a
          // 24rem card actually drew 26.9rem and blew past both caps: on a
          // 360x640 phone it clipped its own title row and Save/Cancel row off
          // the top and bottom of the screen (measured 708px in a 640px
          // viewport), leaving Save unreachable.
          boxSizing: 'border-box',
          width: isXR ? '30rem' : '24rem',
          maxWidth: '92vw',
          // Never taller than the surface it floats on; scroll the overflow
          // instead of clipping it.
          maxHeight: 'calc(100% - 2rem)',
          // Header / scrolling body / pinned footer. Scrolling the WHOLE card
          // kept Save reachable but not visible: on a 360x640 phone the card
          // filled the screen, the fold landed mid-sentence in the Graphics
          // section, and the only thing telling you Save existed was a
          // scrollbar. A settings dialog whose commit button is below the fold
          // is a dialog people abandon. The two rows that matter — what this is
          // and how to leave it — now stay put and only the fields move.
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: isXR ? '1.75rem' : '1.4rem',
          borderRadius: 'var(--radius-xl)',
          background: 'var(--xr-glass-bg)',
          border: '0.0625rem solid var(--xr-glass-border)',
          backdropFilter: 'blur(var(--xr-glass-blur))',
          boxShadow: 'var(--xr-elevation)',
          color: 'var(--card-foreground)'
        }}
      >
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: isXR ? '1.35rem' : '1.15rem',
            fontWeight: 700,
            marginBottom: '1rem'
          }}
        >
          <SettingsIcon size={isXR ? 22 : 18} aria-hidden />
          <span>Settings</span>
        </div>

        <div
          style={{
            // The only part that scrolls. `minHeight: 0` is what lets a flex
            // child actually shrink below its content height instead of pushing
            // the footer off the card.
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            // Room for the footer's top rule without the last field touching it.
            paddingRight: '0.15rem'
          }}
        >
        <div style={{ ...sectionHeaderStyle, paddingTop: 0, borderTop: 'none', marginTop: 0 }}>
          <Server size={13} aria-hidden />
          <span>Connection</span>
        </div>

        <div style={{ marginBottom: '0.9rem' }}>
          <label style={labelStyle} htmlFor="settings-provider">
            LLM provider
          </label>
          <select
            id="settings-provider"
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as LLMProvider)}
            style={inputStyle}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {fields.urlKey && (
          <div style={{ marginBottom: '0.9rem' }}>
            <label style={labelStyle} htmlFor="settings-url">
              {provider === 'proxy' ? 'Proxy URL' : 'Server URL'}
            </label>
            <input
              id="settings-url"
              type="text"
              inputMode="url"
              {...identifierInputProps}
              value={url}
              placeholder={provider === 'proxy' ? '/api/chat' : 'http://localhost:11434'}
              onChange={(e) => setUrl(e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        {fields.modelKey && (
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle} htmlFor="settings-model">
              Model
            </label>
            <input
              id="settings-model"
              type="text"
              {...identifierInputProps}
              list="settings-model-options"
              value={model}
              placeholder={String(defaultLLMConfig[fields.modelKey] ?? '')}
              onChange={(e) => setModel(e.target.value)}
              style={inputStyle}
            />
            <datalist id="settings-model-options">
              {modelOptions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        )}

        <div
          style={{
            marginBottom: '1.25rem',
            padding: '0.75rem',
            borderRadius: 'var(--radius-md)',
            border: '0.0625rem solid var(--border)',
            background: 'color-mix(in srgb, var(--popover) 75%, transparent)'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              marginBottom: '0.45rem'
            }}
          >
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--card-foreground)' }}>
                Connection truth
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
                Check chat, memory, and voice before your first answer.
              </div>
            </div>
            <button
              type="button"
              onClick={() => void checkConnection()}
              disabled={healthState === 'checking'}
              style={{
                flexShrink: 0,
                border: '0.0625rem solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'transparent',
                color: 'var(--card-foreground)',
                padding: '0.45rem 0.6rem',
                fontSize: '0.75rem',
                cursor: healthState === 'checking' ? 'wait' : 'pointer',
                opacity: healthState === 'checking' ? 0.65 : 1
              }}
            >
              {healthState === 'checking' ? 'Checking…' : 'Check connection'}
            </button>
          </div>

          <ConnectionStatusPanel
            activationState={activationState}
            healthState={healthState}
            health={health}
            healthError={healthError}
            textStyle={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}
          />
        </div>

        <SectionHeader icon={<SlidersHorizontal size={13} aria-hidden />}>Behavior</SectionHeader>
        <ToggleRow
          label="Barge-in"
          hint="Interrupt the avatar when you start speaking"
          checked={appConfig.bargeInEnabled}
          onChange={(v) => AppConfigState.set((prev) => ({ ...prev, bargeInEnabled: v }))}
        />
        <ToggleRow
          label="Auto-submit"
          hint="Send your speech automatically after you pause"
          checked={appConfig.autoSubmitEnabled}
          onChange={(v) => AppConfigState.set((prev) => ({ ...prev, autoSubmitEnabled: v }))}
        />

        <SectionHeader icon={<UserRound size={13} aria-hidden />}>Avatar</SectionHeader>
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <label style={labelStyle} htmlFor="settings-avatar">
            Character
          </label>
          <select
            id="settings-avatar"
            style={inputStyle}
            value={AVATAR_KEYS.includes(avatarLabel) ? avatarLabel : 'custom'}
            onChange={(e) => {
              if (e.target.value === 'custom') return
              applyAvatar(e.target.value)
            }}
          >
            {AVATAR_KEYS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
            <option value="custom">Custom URL…</option>
          </select>

          <label style={labelStyle} htmlFor="settings-avatar-url">
            Custom avatar URL
          </label>
          <input
            id="settings-avatar-url"
            inputMode="url"
            {...identifierInputProps}
            style={inputStyle}
            placeholder="https://models.readyplayer.me/….glb  ·  or a .vrm URL"
            value={avatarUrlDraft}
            onChange={(e) => setAvatarUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyAvatar(avatarUrlDraft)
            }}
            onBlur={() => avatarUrlDraft.trim() && applyAvatar(avatarUrlDraft)}
          />
          {avatarError && (
            <div role="alert" style={{ fontSize: 11, color: 'var(--destructive, #f87171)' }}>
              {avatarError}
            </div>
          )}
          {facialRig && (
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              Facial rig: <strong>{facialRig.info.label}</strong> · {facialRig.names.length} channels
              {facialRig.tier === 'none' && ' — body animation only'}
            </div>
          )}
        </div>

        <SectionHeader icon={<MonitorCog size={13} aria-hidden />}>Graphics</SectionHeader>
        <ToggleRow
          label="WebGPU rendering"
          hint={hasWebGPU ? 'Faster rendering where supported' : 'Not supported on this device'}
          checked={appConfig.webGPUEnabled}
          disabled={!hasWebGPU}
          onChange={(v) => AppConfigState.set((prev) => ({ ...prev, webGPUEnabled: v }))}
        />

        </div>

        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: '0.6rem',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '0.0625rem solid var(--border)'
          }}
        >
          <button
            onClick={handleReset}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted-foreground)',
              fontSize: isXR ? '0.95rem' : '0.85rem',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: '0.4rem',
              // "Reset to defaults" + Cancel + Save is about 5 px wider than a
              // 360 px card's footer, so it broke across two lines under the
              // buttons. Never wrap; drop to the short label on a narrow card.
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            {isNarrow ? 'Reset' : 'Reset to defaults'}
          </button>

          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '0.0625rem solid var(--border)',
                color: 'var(--card-foreground)',
                padding: isXR ? '0.7rem 1.1rem' : '0.55rem 0.9rem',
                borderRadius: 'var(--radius-md)',
                fontSize: isXR ? '1rem' : '0.9rem',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              style={{
                background: 'var(--primary)',
                border: '0.0625rem solid var(--primary)',
                color: 'var(--primary-foreground)',
                padding: isXR ? '0.7rem 1.25rem' : '0.55rem 1rem',
                borderRadius: 'var(--radius-md)',
                fontSize: isXR ? '1rem' : '0.9rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
