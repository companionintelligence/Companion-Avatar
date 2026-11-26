import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Tooltip } from './Tooltip'

const meta = {
  title: 'Common/Tooltip',
  component: Tooltip,
  args: {
    content: 'Connection settings',
    delay: 0,
    children: <button style={{ padding: '0.5rem 1rem' }}>Hover me</button>
  }
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Top: Story = { args: { position: 'top' } }
export const Right: Story = { args: { position: 'right' } }

/**
 * Hovering the trigger shows the tip and leaving hides it. The story ends with the tip shown, so
 * axe checks the open tip as well.
 */
export const ShowsOnHover: Story = {
  args: { position: 'top' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Hover me' })
    const tip = canvas.getByText('Connection settings')
    await expect(tip).toHaveStyle({ opacity: '0' })

    await userEvent.hover(trigger)
    await waitFor(() => expect(tip).toHaveStyle({ opacity: '1' }))
    await userEvent.unhover(trigger)
    await waitFor(() => expect(tip).toHaveStyle({ opacity: '0' }))

    await userEvent.hover(trigger)
    await waitFor(() => expect(tip).toHaveStyle({ opacity: '1' }))
  }
}
