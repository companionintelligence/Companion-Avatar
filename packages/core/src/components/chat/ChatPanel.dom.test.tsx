import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ChatPanel } from './ChatPanel'
import type { ConversationMessage } from '../../services/conversation/conversationType'

const originalWidth = window.innerWidth

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

afterEach(() => setViewportWidth(originalWidth))

const message = (id: string, text: string, isUser: boolean): ConversationMessage =>
  ({ id, text, isUser, timestamp: 0 }) as ConversationMessage

describe('ChatPanel', () => {
  it('is a right-hand rail on desktop', () => {
    setViewportWidth(1440)
    const { container } = render(<ChatPanel messages={[]} />)
    const panel = container.firstElementChild as HTMLElement
    expect(panel.style.right).toBe('0px')
    expect(panel.style.width).toBe('17.5rem')
  })

  /**
   * Regression: the 200 px right-hand rail was ported to phones unchanged. It
   * cut the avatar's face down the middle along a hard vertical seam, it slid
   * under the centred logo so the "Chat Log" header read out from behind it,
   * and every bubble wrapped to three or four words. Below the tablet
   * breakpoint it is a full-width sheet docked under the logo instead.
   */
  it('becomes a full-width sheet docked below the logo on a phone', () => {
    setViewportWidth(360)
    const { container } = render(<ChatPanel messages={[]} />)
    const panel = container.firstElementChild as HTMLElement
    expect(panel.style.left).toBe('0px')
    expect(panel.style.right).toBe('0px')
    // Clear of the logo overlay, which is centred at the top of the surface, and of the
    // status bar and Dynamic Island above it on an iPhone.
    expect(panel.style.top).toBe('calc(5rem + env(safe-area-inset-top))')
    // A sheet is bounded by height, not by width — and sized by its content up
    // to that bound, so an empty log does not park 40% of the screen over the
    // avatar's face.
    expect(panel.style.height).toBe('auto')
    expect(panel.style.maxHeight).toBe('40%')
  })

  // An empty glass panel labelled "Chat Log" reads as a failed load, not as a
  // conversation that has not started.
  it('says something in the empty state', () => {
    setViewportWidth(1440)
    render(<ChatPanel messages={[]} activationState="chat-only" />)
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Session: Chat-only')
  })

  it('drops the empty state as soon as there is a turn to show', () => {
    setViewportWidth(1440)
    render(<ChatPanel messages={[message('1', 'Where do my messages go?', true)]} />)
    expect(screen.queryByText(/Nothing here yet/i)).toBeNull()
  })
})
