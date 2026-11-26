import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import type { ConversationMessage } from '../../services/conversation/conversationType'
import { ChatPanel } from './ChatPanel'

const messages: ConversationMessage[] = [
  { id: '1', text: 'Hey, can you summarize my morning?', isUser: true, timestamp: 1 },
  {
    id: '2',
    text: 'Good morning! You have a standup at 9:30 and a design review at 11.',
    isUser: false,
    timestamp: 2
  },
  { id: '3', text: 'Move the design review to the afternoon.', isUser: true, timestamp: 3 },
  {
    id: '4',
    text: 'Done — the design review is now at 2:00pm and everyone has been notified.',
    isUser: false,
    timestamp: 4
  }
]

const meta = {
  title: 'Chat/ChatPanel',
  component: ChatPanel,
  parameters: { layout: 'fullscreen' },
  args: { messages }
} satisfies Meta<typeof ChatPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Conversation: Story = {}

export const Empty: Story = {
  args: { messages: [] }
}

/** Presses Tab from the top of the page, as a keyboard user would, and returns what took focus. */
const tabThrough = async (presses = 6): Promise<Element[]> => {
  ;(document.activeElement as HTMLElement | null)?.blur()
  const reached: Element[] = []
  for (let press = 0; press < presses; press++) {
    await userEvent.tab()
    if (document.activeElement && document.activeElement !== document.body) reached.push(document.activeElement)
  }
  return reached
}

/**
 * The toggle collapses the panel. Open, Tab reaches the history, so a keyboard user can scroll it.
 * Collapsed, the history is out of sight and Tab never lands on it. The story ends collapsed, so axe
 * checks that state too.
 */
export const CollapsesOnToggle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const log = canvas.getByRole('region', { name: 'Chat log' })
    await expect(await tabThrough()).toContain(log)

    await userEvent.click(canvas.getByRole('button', { name: 'Hide Chat' }))
    await expect(canvas.getByRole('button', { name: 'Show Chat' })).toBeInTheDocument()
    await expect(await tabThrough()).not.toContain(log)
  }
}
