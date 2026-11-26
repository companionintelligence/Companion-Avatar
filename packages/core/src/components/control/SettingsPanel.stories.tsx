import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { AppConfigState } from '../../app/appConfig'
import { clearLocalOverrides, readLocalOverrides, writeLocalOverrides } from '../../config/appConfigService'
import { LLMSettingsState } from '../../config/settingsStore'
import type { LLMConfig } from '../../services/llm/config/llmConfig'
import { SettingsPanel } from './SettingsPanel'

const meta = {
  title: 'Control/SettingsPanel',
  component: SettingsPanel,
  parameters: { layout: 'fullscreen' },
  args: { isOpen: true, onClose: fn() }
} satisfies Meta<typeof SettingsPanel>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The panel writes to shared stores and to localStorage. A story that changes them puts them back
 * when it ends, so the next story starts from the same settings.
 */
const keepSettings = () => {
  const settings = LLMSettingsState.get()
  const appConfig = AppConfigState.get()
  const overrides = readLocalOverrides()
  return () => {
    clearLocalOverrides()
    if (Object.keys(overrides).length > 0) writeLocalOverrides(overrides)
    LLMSettingsState.set(settings)
    AppConfigState.set(appConfig)
  }
}

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

/** Each behaviour switch turns its setting over on every click. */
export const SwitchesFlip: Story = {
  beforeEach: keepSettings,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const name of ['Barge-in', 'Auto-submit']) {
      const toggle = canvas.getByRole('switch', { name })
      const before = toggle.getAttribute('aria-checked')
      await userEvent.click(toggle)
      await expect(toggle).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
      await userEvent.click(toggle)
      await expect(toggle).toHaveAttribute('aria-checked', before)
    }
  }
}

/** Save keeps what the form shows, here a provider and its model, and closes the dialog. */
export const SaveKeepsTheForm: Story = {
  beforeEach: keepSettings,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.selectOptions(canvas.getByLabelText('LLM provider'), 'ollama')
    const model = canvas.getByLabelText('Model')
    await userEvent.clear(model)
    await userEvent.type(model, 'story-model')
    await expect(args.onClose).not.toHaveBeenCalled()

    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(args.onClose).toHaveBeenCalledTimes(1)
    const saved = { llm_provider: 'ollama', ollama_model: 'story-model' }
    await expect(LLMSettingsState.get()).toMatchObject(saved)
    await expect(readLocalOverrides()).toMatchObject(saved)
  }
}

/** Reset drops the saved settings, then closes the dialog. On a narrow card it reads "Reset". */
export const ResetDropsSaved: Story = {
  beforeEach: () => {
    const restore = keepSettings()
    const saved: Partial<LLMConfig> = { llm_provider: 'ollama', ollama_model: 'story-model' }
    writeLocalOverrides(saved)
    LLMSettingsState.set((prev) => ({ ...prev, ...saved }))
    return restore
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Model')).toHaveValue('story-model')

    await userEvent.click(canvas.getByRole('button', { name: /^Reset/ }))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1))
    await expect(readLocalOverrides()).toEqual({})
    await expect(LLMSettingsState.get().ollama_model).not.toBe('story-model')
  }
}
