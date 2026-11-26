interface ChatBubbleProps {
  message: {
    id: string
    text: string
    isUser: boolean
  }
}

export const ChatBubble = ({ message }: ChatBubbleProps) => {
  return (
    // data-chat-message and data-chat-text are what the e2e suite reads a conversation by
    // (tests/agent.spec.ts); the bubbles have no other stable hook.
    <div
      data-chat-message={message.isUser ? 'user' : 'assistant'}
      style={{
        margin: '0.5rem 0',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.5rem',
        flexDirection: message.isUser ? 'row-reverse' : 'row'
      }}
    >
      {/* Profile Picture Placeholder */}
      <div
        style={{
          width: '2rem',
          height: '2rem',
          borderRadius: '50%',
          background: message.isUser
            ? 'linear-gradient(135deg, var(--primary), var(--ring))'
            : 'linear-gradient(135deg, var(--accent), var(--primary))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.75rem',
          fontWeight: '600',
          color: 'white',
          flexShrink: 0,
          boxShadow: '0 0.125rem 0.25rem rgba(0,0,0,0.1)'
        }}
      >
        {message.isUser ? 'U' : 'A'}
      </div>

      {/* Message Content */}
      <div
        style={{
          maxWidth: '70%',
          padding: '0.5rem 0.75rem',
          borderRadius: '0.75rem',
          background: message.isUser
            ? 'linear-gradient(135deg, rgba(0,131,145,0.25) 0%, rgba(0,131,145,0.12) 100%)'
            : 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
          border: message.isUser ? '0.0625rem solid rgba(255,255,255,0.08)' : '0.0625rem solid rgba(255,255,255,0.06)',
          boxShadow: '0 0.125rem 0.25rem rgba(0,0,0,0.07)',
          fontSize: '1em',
          lineHeight: '1.4'
        }}
      >
        <div style={{ marginBottom: '0.125rem', fontSize: '0.75em', opacity: 0.7 }}>
          {message.isUser ? 'You' : 'Assistant'}
        </div>
        <div data-chat-text>{message.text}</div>
      </div>
    </div>
  )
}
