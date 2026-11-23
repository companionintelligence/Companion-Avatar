/**
 * Ollama LLM Implementation
 *
 * This module provides local LLM processing using the Ollama JavaScript library.
 * Handles breath chunking for TTS integration with streaming support.
 */

import { Ollama } from 'ollama/browser'

import { readLatestInterrupt } from '../llmInterrupt'
import type { LLMParams, LLMResult } from '../llmTypes'
import { createBreathSplitter } from './breathSplit'

export async function llmOllama(params: LLMParams): Promise<LLMResult> {
  const {
    userMessage,
    interrupt,
    messages,
    llmUrl,
    llmModel = 'llama3.2',
    latestInterrupt,
    responseCallback,
    updateMessages,
    setThinking
  } = params

  // Re-read on every guard so a newer user turn cancels this stream mid-flight.
  const latest = () => readLatestInterrupt(latestInterrupt)

  if (!llmUrl) {
    return { success: false, error: new Error('Ollama URL is required') }
  }

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
      console.log('LLM: skipping - work is old', interrupt)
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

  try {
    const ollama = new Ollama({
      host: llmUrl
    })

    const allMessages = [...messages, { role: 'user' as const, content: userMessage }]

    const requestMessages = allMessages.map((msg) => ({
      role: msg.role,
      content: msg.content
    }))

    console.log('LLM - sending Ollama request to', llmUrl, 'with model', llmModel)

    const response = await ollama.chat({
      model: llmModel,
      messages: requestMessages,
      stream: true
    })

    for await (const chunk of response) {
      if (latest() > interrupt) {
        // `break` alone leaves the model GENERATING on the other end: the
        // async iterator stops being read, but nothing tells Ollama to stop
        // producing. On a local box that is the GPU busy for the rest of a reply
        // nobody will hear, and it delays the turn the user actually wants.
        // `abort()` cancels the in-flight generation for real.
        try {
          ollama.abort()
        } catch {
          // Older clients have no abort(); breaking out is still correct.
        }
        console.log('LLM: Ollama request outdated, stopping')
        break
      }

      if (chunk.message?.content) {
        const content = chunk.message.content
        fullResponse += content
        breathHelper(content)
      }
    }

    updateMessages?.(userMessage, fullResponse)
    setThinking?.(false)

    breathHelper(null, true)

    return { success: true, fullResponse }
  } catch (err) {
    console.error('LLM: Ollama reasoning error', err)
    setThinking?.(false)
    return { success: false, error: err as Error }
  }
}
