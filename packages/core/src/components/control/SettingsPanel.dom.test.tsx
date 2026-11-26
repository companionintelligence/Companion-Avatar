import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SettingsPanel } from './SettingsPanel'

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Regression cover for the settings dialog's scroll structure.
 *
 * The card used to scroll as one block: `maxHeight` + `overflowY: auto` on the
 * card itself. That kept Save *reachable* but not *visible* — on a 360x640
 * phone the card filled the screen, the fold landed mid-sentence in the
 * Graphics section, and the committed product screenshot showed a settings
 * dialog with no commit button in it at all. Header and footer are now pinned
 * and only the field list moves.
 */
describe('SettingsPanel layout', () => {
  it('pins the footer so Save and Cancel are never scrolled out of the card', () => {
    render(<SettingsPanel isOpen onClose={vi.fn()} />)

    const save = screen.getByRole('button', { name: 'Save' })
    const footer = save.closest('div')?.parentElement as HTMLElement
    expect(footer).toBeTruthy()
    // A pinned footer must not be allowed to shrink, and must not live inside
    // the scroll box.
    expect(footer.style.flexShrink).toBe('0')

    const card = screen.getByRole('dialog').firstElementChild as HTMLElement
    expect(card.style.display).toBe('flex')
    expect(card.style.flexDirection).toBe('column')
    // The card clips; the body scrolls. If the card itself scrolled we would be
    // back to the original defect.
    expect(card.style.overflow).toBe('hidden')
    expect(card.style.overflowY).not.toBe('auto')
  })

  it('gives the field list its own scroll box that can shrink below its content', () => {
    render(<SettingsPanel isOpen onClose={vi.fn()} />)
    const card = screen.getByRole('dialog').firstElementChild as HTMLElement
    // children: [header, scrolling body, footer]
    expect(card.children).toHaveLength(3)
    const body = card.children[1] as HTMLElement
    expect(body.style.overflowY).toBe('auto')
    // Without `min-height: 0` a flex child refuses to shrink under its content
    // and pushes the footer straight back off the card.
    expect(body.style.minHeight).toBe('0px')
  })

  it('renders nothing when closed', () => {
    render(<SettingsPanel isOpen={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('exposes chat, memory, and voice reachability after a health check', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        status: 'degraded',
        upstream: 'ollama',
        model: 'gemma3:1b',
        reachable: true,
        memory: { configured: false, reachable: false },
        tts: {
          upstream: 'cosyvoice',
          model: 'Fun-CosyVoice3-0.5B',
          voice: '中文女',
          reachable: false
        }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SettingsPanel isOpen onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Check connection' })
    expect(screen.getByRole('status')).toHaveTextContent('Not checked yet.')

    // The dialog's own default LLM provider is 'script' (no live backend by
    // design — see the 'demo mode' test below), so exercising the real health
    // fetch means picking a live provider first, same as a user would.
    await userEvent.selectOptions(screen.getByLabelText('LLM provider'), 'proxy')
    screen.getByRole('button', { name: 'Check connection' }).click()

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Chat is reachable, but voice is unavailable.')
    )
    expect(screen.getByRole('status')).toHaveTextContent('Chat: reachable')
    expect(screen.getByRole('status')).toHaveTextContent('Memory: not configured')
    expect(screen.getByRole('status')).toHaveTextContent('TTS: unreachable')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({
        cache: 'no-store',
        headers: { accept: 'application/json' }
      })
    )
  })

  /**
   * Found on an iPhone simulator while pointing the app at a backend: iOS autocorrected the host
   * name in the server address (`ulmer` became `ulcer`), and the field offered no clue. A server
   * address, a model name and an avatar URL are identifiers, so the keyboard must leave them alone.
   */
  it('keeps the phone keyboard from capitalising or correcting server addresses and model names', async () => {
    render(<SettingsPanel isOpen onClose={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText('LLM provider'), 'proxy')

    for (const field of [
      screen.getByLabelText('Proxy URL'),
      screen.getByLabelText('Model'),
      screen.getByLabelText('Custom avatar URL')
    ]) {
      expect(field).toHaveAttribute('autocapitalize', 'off')
      expect(field).toHaveAttribute('autocorrect', 'off')
      expect(field).toHaveAttribute('autocomplete', 'off')
      expect(field).toHaveAttribute('spellcheck', 'false')
    }
    // The address fields also ask for the URL keyboard, with its slash and dot keys.
    expect(screen.getByLabelText('Proxy URL')).toHaveAttribute('inputmode', 'url')
    expect(screen.getByLabelText('Custom avatar URL')).toHaveAttribute('inputmode', 'url')
  })
})

/**
 * DEVICE-QA finding 4: after a text field had focus on iOS, `visualViewport.height` stayed 88 px
 * short of the 874 px layout, and the dialog, centred on the full layout, put Save and Cancel below
 * what the user could see. The overlay now pads away the rows the visual viewport hides.
 */
describe('SettingsPanel and a visual viewport shorter than the layout', () => {
  class FakeVisualViewport extends EventTarget {
    height = 786
    width = 402
    offsetTop = 0
    offsetLeft = 0
    scale = 1
  }

  function layoutRect(height: number): DOMRect {
    return { top: 0, bottom: height, left: 0, right: 402, height, width: 402, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fits the card into the visible part, so the footer stays on screen', () => {
    const viewport = new FakeVisualViewport()
    vi.stubGlobal('visualViewport', viewport)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(layoutRect(874))

    render(<SettingsPanel isOpen onClose={vi.fn()} />)
    const overlay = screen.getByRole('dialog')

    expect(overlay.style.boxSizing).toBe('border-box')
    expect(overlay.style.paddingTop).toBe('0px')
    expect(overlay.style.paddingBottom).toBe('88px')
  })

  it('follows the visual viewport: above the keyboard, then back to full height', async () => {
    const viewport = new FakeVisualViewport()
    viewport.height = 500
    vi.stubGlobal('visualViewport', viewport)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(layoutRect(874))

    render(<SettingsPanel isOpen onClose={vi.fn()} />)
    const overlay = screen.getByRole('dialog')
    expect(overlay.style.paddingBottom).toBe('374px')

    viewport.height = 874
    act(() => {
      viewport.dispatchEvent(new Event('resize'))
    })
    await waitFor(() => expect(overlay.style.paddingBottom).toBe('0px'))
  })

  it('accounts for a visual viewport scrolled down the page', () => {
    const viewport = new FakeVisualViewport()
    viewport.offsetTop = 40
    viewport.height = 600
    vi.stubGlobal('visualViewport', viewport)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(layoutRect(874))

    render(<SettingsPanel isOpen onClose={vi.fn()} />)
    const overlay = screen.getByRole('dialog')
    expect(overlay.style.paddingTop).toBe('40px')
    expect(overlay.style.paddingBottom).toBe('234px')
  })

  it('leaves a pinch-zoomed page alone', () => {
    const viewport = new FakeVisualViewport()
    viewport.scale = 2
    viewport.height = 437
    vi.stubGlobal('visualViewport', viewport)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(layoutRect(874))

    render(<SettingsPanel isOpen onClose={vi.fn()} />)
    expect(screen.getByRole('dialog').style.paddingBottom).toBe('0px')
  })
})
