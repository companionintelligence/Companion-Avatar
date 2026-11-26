import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ChatInput } from './ChatInput'

/**
 * ChatInput is a controlled component (its text lives in the parent). The
 * stories host it in a tiny stateful wrapper so typing behaves like it does in
 * the app, while still exercising the real `onSubmit` callback via `fn()`.
 */
const meta = {
  title: 'Chat/ChatInput',
  component: ChatInput,
  parameters: { layout: 'fullscreen' },
  args: {
    message: '',
    onMessageChange: fn(),
    onSubmit: fn(),
    onKeyPress: fn(),
    isRecording: false
  }
} satisfies Meta<typeof ChatInput>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const WithText: Story = {
  args: { message: 'What is on my calendar tomorrow?' }
}

export const Recording: Story = {
  args: { isRecording: true, vadDetecting: true }
}

export const SttListening: Story = {
  args: { isRecording: true, sttListening: true, sttTranscript: 'remind me to' }
}

/**
 * Type into the field and press the send button; assert `onSubmit` fired with
 * the typed text. A stateful wrapper feeds `message` back so the controlled
 * textarea updates as the user types.
 */
const StatefulChatInput = (args: React.ComponentProps<typeof ChatInput>) => {
  const [message, setMessage] = useState(args.message)
  return (
    <ChatInput
      {...args}
      message={message}
      onMessageChange={(value) => {
        args.onMessageChange(value)
        setMessage(value)
      }}
    />
  )
}

/**
 * While the mic is on, the field shows the live transcript and is read-only: typing changes
 * neither the text nor the parent's message.
 */
export const IgnoresTypingWhileRecording: Story = {
  args: { isRecording: true, sttListening: true, sttTranscript: 'remind me to' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByRole('textbox')
    await userEvent.type(textarea, 'hello')
    await expect(textarea).toHaveValue('remind me to')
    await expect(args.onMessageChange).not.toHaveBeenCalled()
  }
}

export const TypeAndSubmit: Story = {
  // Rendered via a real component rather than calling useState inside `render`,
  // which is not a component and so may not call hooks.
  render: (args) => <StatefulChatInput {...args} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByPlaceholderText('Type your message here...')
    await userEvent.type(textarea, 'hello there')
    await userEvent.click(canvas.getByRole('button'))
    await expect(args.onSubmit).toHaveBeenCalledWith('hello there')
  }
}
