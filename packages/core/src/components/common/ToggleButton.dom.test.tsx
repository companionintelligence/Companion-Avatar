import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ToggleButton } from './ToggleButton'

describe('ToggleButton', () => {
  it('shows the label with a "Show" accessible name when collapsed', () => {
    render(<ToggleButton isVisible={false} onToggle={() => {}} label="Controls" position="left" />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveTextContent('Controls')
    expect(btn).toHaveAccessibleName('Show Controls')
    // Renders a lucide chevron (an inline SVG), not a unicode glyph.
    expect(btn.querySelector('svg')).not.toBeNull()
  })

  it('hides the label and flips to a "Hide" accessible name when visible', () => {
    render(<ToggleButton isVisible onToggle={() => {}} label="Controls" position="left" />)
    const btn = screen.getByRole('button')
    expect(btn).not.toHaveTextContent('Controls')
    expect(btn).toHaveAccessibleName('Hide Controls')
    expect(btn.querySelector('svg')).not.toBeNull()
  })

  it('clears the home indicator and the left safe area at the bottom-left', () => {
    render(<ToggleButton isVisible={false} onToggle={() => {}} label="Controls" position="bottom-left" />)
    const btn = screen.getByRole('button')
    expect(btn.style.bottom).toContain('env(safe-area-inset-bottom)')
    expect(btn.style.left).toContain('env(safe-area-inset-left)')
  })

  it('invokes onToggle when clicked', async () => {
    const onToggle = vi.fn()
    render(<ToggleButton isVisible={false} onToggle={onToggle} label="Chat" position="right" />)
    await userEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
