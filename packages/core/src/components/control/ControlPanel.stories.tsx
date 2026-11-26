import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ControlPanel } from './ControlPanel'
import { initialAppConfig } from '../../app/appConfig'

const meta = {
  title: 'Control/ControlPanel',
  component: ControlPanel,
  parameters: { layout: 'fullscreen' },
  args: {
    config: initialAppConfig,
    isRecording: false,
    isVisible: true,
    handleAppStateChange: fn(),
    onOpenSettings: fn()
  }
} satisfies Meta<typeof ControlPanel>

export default meta
type Story = StoryObj<typeof meta>

/** The minimal desktop bar: mic + settings. */
export const Default: Story = {}

/** The full XR-capable bar with entry, recenter and scale actions. */
export const AllActions: Story = {
  args: {
    onEnterVRMode: fn(),
    onEnterARMode: fn(),
    onExitXR: fn(),
    onRecenter: fn(),
    onScaleUp: fn(),
    onScaleDown: fn(),
    xrCanEnterVR: true,
    xrCanEnterAR: true
  }
}

/** Mic active + VAD detecting: the mic flips to a "Listening" state. */
export const Listening: Story = {
  args: { isRecording: true, vadDetecting: true }
}

/** Each action on the full bar calls its own handler, once, and leaves the mic alone. */
export const ActionsFireOnClick: Story = {
  args: AllActions.args,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const actions = [
      ['Enter VR', args.onEnterVRMode],
      ['Enter AR', args.onEnterARMode],
      ['Exit XR', args.onExitXR],
      ['Recenter', args.onRecenter],
      ['Smaller', args.onScaleDown],
      ['Larger', args.onScaleUp],
      ['Settings', args.onOpenSettings]
    ] as const
    for (const [name, handler] of actions) {
      await userEvent.click(canvas.getByRole('button', { name }))
      await expect(handler).toHaveBeenCalledTimes(1)
    }
    await expect(args.handleAppStateChange).not.toHaveBeenCalled()
  }
}

/** Clicking the mic toggles the microphone config via its handler. */
export const MicTogglesOnClick: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Mic' }))
    await expect(args.handleAppStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ microphone: true })
    )
  }
}
