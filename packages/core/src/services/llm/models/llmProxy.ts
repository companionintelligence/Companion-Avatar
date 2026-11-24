/**
 * Backend-proxy LLM implementation.
 *
 * Streams from the same-origin BFF (`/api/chat`) which brokers to a
 * server-configured upstream (Ollama / OpenAI-compatible / CI-Server). The proxy
 * emits normalized SSE events `{"type":"chunk"|"done"|"error", ...}`; this reader
 * reassembles partial SSE lines across chunk boundaries and feeds content through
 * the same "breath" chunking as the direct-Ollama path for TTS.
 *
 * Unlike llmOllama (which only cooperatively stops reading), this uses a real
 * AbortController so a barge-in actually cancels the upstream generation.
 */

import { readLatestInterrupt } from '../llmInterrupt'
import type { LLMParams, LLMResult } from '../llmTypes'
import { createBreathSplitter } from './breathSplit'

export async function llmProxy(params: LLMParams): Promise<LLMResult> {
  const {
    userMessage,
    interrupt,
    messages,
    llmUrl = '/api/chat',
    llmModel,
    latestInterrupt,
    responseCallback,
    updateMessages,
    setThinking
  } = params

  // Re-read on every guard so a newer user turn cancels this stream mid-flight.
  const latest = () => readLatestInterrupt(latestInterrupt)

  setThinking?.(true)

  const rcounter = 1000
  let fragmentCounter = 0
  let fullResponse = ''
  const splitter = createBreathSplitter()

  const emitBreath = (breath: string) => {
    responseCallback?.({
      text: fullResponse,
      breath,
      ready: true,
      final: false,
      interrupt,
      rcounter,
      bcounter: fragmentCounter
    })
    fragmentCounter++
  }

  const breathHelper = (fragment: string | null = null, finished = false) => {
    if (latest() > interrupt) {
      return
    }

    if (fragment) {
      const breath = splitter.push(fragment)
      if (breath !== null) emitBreath(breath)
    }

    if (finished) {
      // The buffered tail is the reply's last breath, so it is spoken before the final chunk.
      const leftover = splitter.finish()
      if (leftover !== null) emitBreath(leftover)

      if (fullResponse.length && responseCallback) {
        responseCallback({
          text: fullResponse,
          breath: '',
          ready: true,
          final: true,
          interrupt
        })
      }
    }
  }

  const controller = new AbortController()

  try {
    const allMessages = [...messages, { role: 'user' as const, content: userMessage }]

    const response = await fetch(llmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
        model: llmModel || undefined
      }),
      signal: controller.signal
    })

    if (!response.ok || !response.body) {
      setThinking?.(false)
      return { success: false, error: new Error(`Proxy responded ${response.status}`) }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let aborted = false

    while (true) {
      if (latest() > interrupt) {
        controller.abort()
        aborted = true
        break
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line; each frame has `data:` lines.
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)

        for (const line of frame.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (!data) continue

          let event: { type?: string; content?: string; message?: string }
          try {
            event = JSON.parse(data)
          } catch {
            continue
          }

          if (event.type === 'chunk' && event.content) {
            fullResponse += event.content
            breathHelper(event.content, false)
          } else if (event.type === 'error') {
            setThinking?.(false)
            return { success: false, error: new Error(event.message || 'proxy error') }
          } else if (event.type === 'done') {
            aborted = false
          }
        }
      }
    }

    updateMessages?.(userMessage, fullResponse)
    setThinking?.(false)
    breathHelper(null, true)

    if (aborted) return { success: false, error: new Error('interrupted') }
    return { success: true, fullResponse }
  } catch (err) {
    setThinking?.(false)
    if ((err as Error).name === 'AbortError') {
      return { success: false, error: new Error('interrupted') }
    }
    console.error('LLM: Proxy reasoning error', err)
    return { success: false, error: err as Error }
  }
}
