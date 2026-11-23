import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LLMResponse } from '../llmTypes'
import { createBreathSplitter } from './breathSplit'
import { llmOllama } from './llmOllama'
import { llmProxy } from './llmProxy'

// Canned Ollama stream for the next call, read by the client stub below. Same stub approach
// as llmInterrupt.node.test.ts.
const ollamaStream = vi.hoisted(() => ({ chunks: [] as Array<{ message: { content: string }; done: boolean }> }))

vi.mock('ollama/browser', () => ({
  Ollama: class {
    async chat() {
      const chunks = ollamaStream.chunks
      return (async function* () {
        for (const chunk of chunks) yield chunk
      })()
    }
  }
}))

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const streamOllama = async (fragments: string[]): Promise<LLMResponse[]> => {
  ollamaStream.chunks = [
    ...fragments.map((content) => ({ message: { content }, done: false })),
    { message: { content: '' }, done: true }
  ]
  const responseCallback = vi.fn()

  await llmOllama({
    userMessage: 'hi',
    interrupt: 100,
    messages: [],
    latestInterrupt: () => 100,
    llmUrl: 'http://localhost:11434',
    responseCallback
  })

  return responseCallback.mock.calls.map(([response]) => response as LLMResponse)
}

// Feeds fragments through a fresh splitter the way the adapters do, and collects every breath.
const splitAll = (fragments: string[]): string[] => {
  const splitter = createBreathSplitter()
  const breaths: string[] = []
  for (const fragment of fragments) {
    const breath = splitter.push(fragment)
    if (breath !== null) breaths.push(breath)
  }
  const last = splitter.finish()
  if (last !== null) breaths.push(last)
  return breaths
}

describe('createBreathSplitter', () => {
  it('holds a short reply until finish so it is still spoken', () => {
    expect(splitAll(['I am happy for you!'])).toEqual(['I am happy for you!'])
  })

  it('closes a breath at the first boundary and keeps the rest of that fragment', () => {
    expect(splitAll(['This opening clause is long enough', '. Next comes a second clause, plus more.'])).toEqual([
      'This opening clause is long enough.',
      ' Next comes a second clause, plus more.'
    ])
  })

  it('keeps the last clause of a multi-sentence reply', () => {
    expect(
      splitAll(['Sure thing, I can help with that. ', 'Let me know what you need, and I will look into it.'])
    ).toEqual(['Sure thing, I can help with that. Let me know what you need,', ' and I will look into it.'])
  })

  it('cuts at the boundary even when a newline comes before it in the same fragment', () => {
    expect(splitAll(['A long opening line of text', '\nthen a comma, and the rest'])).toEqual([
      'A long opening line of text\nthen a comma,',
      ' and the rest'
    ])
  })

  it('does not cut at a boundary until the buffer reaches the minimum length', () => {
    const splitter = createBreathSplitter()
    expect(splitter.push('Short.')).toBeNull()
    expect(splitter.push(' Still short, yes')).toBeNull()
    expect(splitter.finish()).toBe('Short. Still short, yes')
  })

  it('returns nothing from finish once the buffer is empty', () => {
    const splitter = createBreathSplitter()
    expect(splitter.finish()).toBeNull()

    splitter.push('Hello there, my friend.')
    expect(splitter.finish()).toBe('Hello there, my friend.')
    expect(splitter.finish()).toBeNull()
  })
})

describe('llmOllama breath output', () => {
  it('speaks a short reply as a breath before the final chunk', async () => {
    const responses = await streamOllama(['I am happy for you!'])

    expect(responses.map((r) => [r.breath, r.final])).toEqual([
      ['I am happy for you!', false],
      ['', true]
    ])
  })

  it('keeps the last clause of a multi-sentence reply', async () => {
    const responses = await streamOllama([
      'Sure thing, I can help with that. ',
      'Let me know what you need, and I will look into it.'
    ])

    expect(responses.filter((r) => !r.final).map((r) => r.breath)).toEqual([
      'Sure thing, I can help with that. Let me know what you need,',
      ' and I will look into it.'
    ])
    expect(responses[responses.length - 1].text).toBe(
      'Sure thing, I can help with that. Let me know what you need, and I will look into it.'
    )
  })
})

describe('llmProxy breath output', () => {
  it('speaks a short reply as a breath before the final chunk', async () => {
    const frames = [{ type: 'chunk', content: 'I am happy for you!' }, { type: 'done' }]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')))
    )
    const responseCallback = vi.fn()

    await llmProxy({
      userMessage: 'hi',
      interrupt: 100,
      messages: [],
      latestInterrupt: () => 100,
      responseCallback
    })

    const responses = responseCallback.mock.calls.map(([response]) => response as LLMResponse)
    expect(responses.map((r) => [r.breath, r.final])).toEqual([
      ['I am happy for you!', false],
      ['', true]
    ])
  })
})
