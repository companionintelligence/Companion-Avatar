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

/**
 * The toggle collapses the panel. Open, the history takes keyboard focus so it can be scrolled;
 * collapsed, it is out of sight and out of the tab order. The story ends collapsed, so axe checks
 * that state too.
 */
export const CollapsesOnToggle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const log = canvas.getByRole('region', { name: 'Chat log' })
    log.focus()
    await expect(log).toHaveFocus()

    await userEvent.click(canvas.getByRole('button', { name: 'Hide Chat' }))
    await expect(canvas.getByRole('button', { name: 'Show Chat' })).toBeInTheDocument()
    log.focus()
    await expect(log).not.toHaveFocus()
  }
}
