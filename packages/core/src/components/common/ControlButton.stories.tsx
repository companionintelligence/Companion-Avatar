import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn, expect, userEvent, within } from 'storybook/test'
import { LoaderCircle, Mic, MicOff } from 'lucide-react'

import { ControlButton } from './ControlButton'

const meta = {
  title: 'Common/ControlButton',
  component: ControlButton,
  args: { onClick: fn(), children: <Mic size={20} aria-hidden />, size: 48 }
} satisfies Meta<typeof ControlButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { tooltipContent: 'Enable voice' } }
export const Active: Story = { args: { isActive: true, tooltipContent: 'Listening' } }
export const Disabled: Story = { args: { disabled: true, tooltipContent: 'Unavailable' } }

/** Off state — a distinct glyph communicates the muted mic. */
export const Muted: Story = {
  args: { children: <MicOff size={20} aria-hidden />, tooltipContent: 'Muted' }
}

/**
 * Loading state — a spinner glyph stands in for an in-flight action. The button
 * is disabled while busy so it can't be re-triggered.
 */
export const Loading: Story = {
  args: {
    disabled: true,
    tooltipContent: 'Connecting…',
    children: (
      <LoaderCircle
        size={20}
        aria-hidden
        style={{ animation: 'spin 1s linear infinite' }}
      />
    )
  }
}

/** Larger, glove-friendly XR hit target. */
export const XrSize: Story = { args: { size: 64, tooltipContent: 'Enable voice' } }

/** Clicking an enabled button fires its handler. */
export const FiresOnClick: Story = {
  args: { tooltipContent: 'Enable voice' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button'))
    await expect(args.onClick).toHaveBeenCalled()
  }
}

/** A disabled button, such as one that is busy connecting, ignores clicks. */
export const DisabledIgnoresClick: Story = {
  args: { disabled: true, tooltipContent: 'Unavailable' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Unavailable' })
    await expect(button).toBeDisabled()
    await userEvent.click(button)
    await expect(args.onClick).not.toHaveBeenCalled()
  }
}
