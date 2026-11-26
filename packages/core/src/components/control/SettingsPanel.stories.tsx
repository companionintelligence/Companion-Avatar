import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SettingsPanel } from './SettingsPanel'

const meta = {
  title: 'Control/SettingsPanel',
  component: SettingsPanel,
  parameters: { layout: 'fullscreen' },
  args: { isOpen: true, onClose: fn() }
} satisfies Meta<typeof SettingsPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}

/** Cancel closes the dialog. A click inside the card, here on its title, does not. */
export const CancelCloses: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText('Settings'))
    await expect(args.onClose).not.toHaveBeenCalled()

    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    await expect(args.onClose).toHaveBeenCalledTimes(1)
  }
}
