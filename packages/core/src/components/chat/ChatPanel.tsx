import { useEffect, useRef, useState } from 'react'
import { useXRLayout } from '../../utils/useXRLayout'

import type { ConversationMessage } from '../../services/conversation/conversationType'
import { activationStateLabel, type ActivationState } from '../../services/connection/connectionHealth'
import { ToggleButton } from '../common/ToggleButton'
import { ChatBubble } from './ChatBubble'

interface ChatPanelProps {
  messages: ConversationMessage[]
  activationState?: ActivationState
}

export const ChatPanel = ({ messages, activationState = 'unverified' }: ChatPanelProps) => {
  const isMobile = window.innerWidth <= 768
  const { isXR } = useXRLayout()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const [isVisible, setVisible] = useState(true)

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (scrollContainerRef.current && isVisible) {
      const scrollContainer = scrollContainerRef.current

      const scrollToBottom = () => {
        // Ensure we scroll to the very bottom
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }

      // Use a small delay to ensure DOM is fully updated
      const timeoutId = setTimeout(scrollToBottom, 50)

      // Also try with requestAnimationFrame for immediate updates
      requestAnimationFrame(scrollToBottom)

      return () => clearTimeout(timeoutId)
    }
  }, [messages, isVisible])

  // Additional effect to handle visibility changes
  useEffect(() => {
    if (isVisible && scrollContainerRef.current) {
      const scrollContainer = scrollContainerRef.current
      // Scroll to bottom when panel becomes visible
      setTimeout(() => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }, 100)
    }
  }, [isVisible])

  /*
   * A side rail is a desktop shape. Ported to a 360 px phone unchanged it was a
   * 200 px slab pinned to the right edge from `top: 1rem` down 80% of the
   * screen: it cut the avatar's face in half along a hard vertical seam, it
   * slid under the centred logo (the logo box spans roughly x=114..246, the
   * panel starts at x=160, so "Chat Log" read out from behind it), and every
   * bubble wrapped to three or four words. Below the tablet breakpoint the panel
   * becomes a top sheet instead — full width, docked under the logo, 40% tall —
   * which is the same information in a shape a phone actually has room for.
   */
  const sheetStyle = isMobile
    ? {
        top: 'calc(5rem + env(safe-area-inset-top))',
        left: 0,
        right: 0,
        // Sized by what is in it, capped at 40% of the surface. A fixed-height
        // sheet spends its full budget even when the conversation is one line,
        // and on a phone that budget lands squarely over the avatar's face —
        // the one thing the frame is of. Animating max-height rather than
        // height keeps the open/close transition while letting the content set
        // the resting size.
        height: 'auto',
        maxHeight: isVisible ? '40%' : '0',
        width: 'auto',
        borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
        transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }
    : {
        top: isXR ? '2rem' : '1rem',
        right: 0,
        height: '80%',
        width: isVisible ? (isXR ? '22rem' : '17.5rem') : '0',
        borderRadius: 'var(--radius-lg) 0 0 var(--radius-lg)',
        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }

  return (
    <>
      <div
        style={{
          position: 'absolute',
          ...sheetStyle,
          zIndex: 999,
          background: 'var(--xr-glass-bg)',
          backdropFilter: 'blur(var(--xr-glass-blur))',
          border: '0.0625rem solid var(--xr-glass-border)',
          overflow: 'hidden',
          boxShadow: '0 0.125rem 0.25rem rgba(0,0,0,0.04)',
          margin: '0'
        }}
      >
        {/* Chat History Content */}
        <div
          style={{
            opacity: isVisible ? 1 : 0,
            transition: 'opacity 0.3s ease',
            height: isMobile ? 'auto' : '100%',
            maxHeight: '100%',
            paddingTop: isXR ? '3rem' : isMobile ? '0.75rem' : '3.75rem',
            paddingLeft: isXR ? '1.5rem' : isMobile ? '0.75rem' : '1.25rem',
            paddingRight: isXR ? '1.5rem' : isMobile ? '0.75rem' : '1.25rem',
            paddingBottom: isXR ? '1.5rem' : isMobile ? '0.75rem' : '1.25rem',
            overflow: 'hidden',
            pointerEvents: isVisible ? 'auto' : 'none',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Chat Log Header */}
          <div
            style={{
              marginBottom: isXR ? '1.25rem' : isMobile ? '0.75rem' : '1.25rem',
              paddingBottom: isXR ? '0.75rem' : isMobile ? '0.5rem' : '0.75rem',
              borderBottom: '0.0625rem solid rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <div
              style={{
                width: isXR ? '0.6rem' : isMobile ? '0.375rem' : '0.5rem',
                height: isXR ? '0.6rem' : isMobile ? '0.375rem' : '0.5rem',
                borderRadius: '50%',
                background: 'linear-gradient(45deg, var(--primary), var(--ring))',
                boxShadow: '0 0 0.5rem var(--primary)'
              }}
            />
            <span
              style={{
                color: 'white',
                fontSize: isXR ? '1rem' : isMobile ? '0.75rem' : '0.875rem',
                fontWeight: '600',
                letterSpacing: '0.03125rem'
              }}
            >
              Chat Log
            </span>
            <span
              role="status"
              aria-label={`Session: ${activationStateLabel(activationState)}`}
              style={{
                marginLeft: 'auto',
                color: 'var(--muted-foreground)',
                fontSize: isXR ? '0.78rem' : '0.68rem',
                fontWeight: '500',
                whiteSpace: 'nowrap'
              }}
            >
              Session: {activationStateLabel(activationState)}
            </span>
          </div>

          <div
            ref={scrollContainerRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              color: '#FFFFFF',
              fontFamily:
                "var(--font-sans, 'Manrope', system-ui, sans-serif)",
              fontSize: isXR ? '1rem' : '0.875rem',
              paddingRight: isXR ? '0.75rem' : '0.5rem',
              // Custom scrollbar styling
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255, 255, 255, 0.2) transparent',
              // Smooth scrolling
              scrollBehavior: 'smooth',
              // Ensure proper scroll margins
              scrollMarginBottom: '1rem'
            }}
            className="custom-scrollbar"
          >
            {messages.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  color: 'var(--muted-foreground)',
                  fontSize: isXR ? '0.95rem' : '0.8125rem',
                  lineHeight: 1.5
                }}
              >
                Nothing here yet. Say hello, or type below — the whole
                conversation stays on this machine.
              </p>
            ) : (
              messages.map((message) => <ChatBubble key={message.id} message={message} />)
            )}
            {/* Keeps the last bubble clear of the rail's bottom edge. On the
                auto-sized mobile sheet it would just be 5rem of empty glass. */}
            {!isMobile && <div style={{ height: '5rem' }} />}
          </div>
        </div>
      </div>

      <ToggleButton
        isVisible={isVisible}
        onToggle={() => setVisible(!isVisible)}
        label="Chat"
        position="right"
        isMobile={isMobile}
        panelWidth={{ mobile: '2.625rem', desktop: isXR ? '22rem' : '17.5rem' }}
        size={isXR ? 44 : 32}
      />
    </>
  )
}
