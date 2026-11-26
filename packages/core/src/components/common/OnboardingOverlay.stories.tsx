import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { OnboardingOverlay } from './OnboardingOverlay'

const meta = {
  title: 'Common/OnboardingOverlay',
  component: OnboardingOverlay,
  parameters: { layout: 'fullscreen' },
  args: { isOpen: true, onEnableMic: fn(), onSkip: fn() }
} satisfies Meta<typeof OnboardingOverlay>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}

export const EnableMicFires: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText('Enable Mic'))
    await expect(args.onEnableMic).toHaveBeenCalled()
  }
}

/** Skip calls onSkip and never onEnableMic, so the mic stays off. */
export const SkipFires: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Skip' }))
    await expect(args.onSkip).toHaveBeenCalledTimes(1)
    await expect(args.onEnableMic).not.toHaveBeenCalled()
  }
}
