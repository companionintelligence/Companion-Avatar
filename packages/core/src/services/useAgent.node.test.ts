import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LLMResponse } from './llm/llmTypes'
import type { WhisperData } from './tts/ttsConfig'
import { useAgent, type AgentService } from './useAgent'

/**
 * M5: a reply's facial emote and body gesture fire once per assistant message, not once
 * per LLM breath. A body gesture is queued behind the clip that is playing, so it is not
 * gated by a wall-clock interval.
 *
 * useAgent is a React hook. React's hooks are stubbed and each service it composes is
 * mocked, so the hook body runs as plain code and its onResponse handler is exercised
 * without rendering React.
 */

const spies = vi.hoisted(() => ({
  onResponse: undefined as undefined | ((response: LLMResponse) => void),
  onSpeechStart: undefined as undefined | ((text: string, whisperData: WhisperData) => void),
  agent: undefined as undefined | AgentService,
  speak: vi.fn(),
  emotePerform: vi.fn(),
  bodyPerform: vi.fn()
}))

vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => [initial, () => {}]
}))

vi.mock('./llm/llmService', () => ({
  useLLMService: ({ onResponse }: { onResponse: (response: LLMResponse) => void }) => {
    spies.onResponse = onResponse
    return { state: { ready: true, loading: false, thinking: false, messages: [] }, actions: {} }
  }
}))

vi.mock('./tts/ttsService', () => ({
  useTTSService: (options: { onSpeechStart?: (text: string, whisperData: WhisperData) => void }) => {
    spies.onSpeechStart = options.onSpeechStart
    return {
      state: { isSpeaking: false, audioQueue: 0 },
      actions: { speak: spies.speak, stopSpeaking: vi.fn(), playAudioBuffer: vi.fn(), getQueueStatus: vi.fn() }
    }
  }
}))

vi.mock('./emote/useEmoteService', () => ({
  useEmoteService: () => ({
    state: {},
    actions: { performAction: spies.emotePerform, reset: vi.fn(), onBargeIn: vi.fn() }
  })
}))

vi.mock('./animation/useAnimationService', () => ({
  useAnimationService: () => ({
    state: {},
    actions: { performAction: spies.bodyPerform, clearQueue: vi.fn() }
  })
}))

vi.mock('./conversation/useConversationService', () => ({
  useConversationService: () => ({
    state: { messages: [] },
    actions: { addMessage: vi.fn(), streamMessage: vi.fn(), clearAllMessages: vi.fn(), getMessagebyId: vi.fn() }
  })
}))

vi.mock('./visemes/useVisemeService', () => ({
  useVisemeService: () => ({ state: {}, actions: { generateSequence: vi.fn(), reset: vi.fn() } })
}))

vi.mock('./vad/vadService', () => ({
  useVADService: () => ({ state: { isListening: false, isDetecting: false }, actions: {} })
}))

vi.mock('./stt/sttService', () => ({
  useSTTService: () => ({ state: { isListening: false, allowed: false, desired: false }, actions: {} })
}))

const chunk = (breath: string, final: boolean, interrupt: number): LLMResponse => ({
  text: breath,
  breath,
  ready: true,
  final,
  interrupt
})

const startAgent = () => {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- React is stubbed above; the hook runs as plain code
  spies.agent = useAgent()
  if (!spies.onResponse) throw new Error('useLLMService was not called')
  return spies.onResponse
}

/** Stands in for TTS starting the utterance that the agent queued with `text`. */
const speechStarts = (text: string, whisperData: WhisperData = {}) => {
  if (!spies.onSpeechStart) throw new Error('useTTSService was not called')
  spies.onSpeechStart(text, whisperData)
}

describe('useAgent reply reactions (M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reacts once per reply, from the whole reply, however many breaths it has', () => {
    const onResponse = startAgent()

    onResponse(chunk('That is great! ', false, 1))
    onResponse(chunk('Sorry about the delay.', false, 1))
    onResponse(chunk('', true, 1))

    // Every breath is still spoken as it arrives.
    expect(spies.speak).toHaveBeenCalledTimes(2)
    expect(spies.emotePerform).toHaveBeenCalledTimes(1)
    expect(spies.emotePerform).toHaveBeenCalledWith(expect.objectContaining({ emotion: 'happy' }))
    expect(spies.bodyPerform).toHaveBeenCalledTimes(1)
    expect(spies.bodyPerform).toHaveBeenCalledWith(expect.objectContaining({ category: 'gesture', immediate: false }))
  })

  it('keeps replies separate: a reply cut off by a barge-in does not leak into the next', () => {
    const onResponse = startAgent()

    // Reply 1 is interrupted before its final chunk.
    onResponse(chunk('That is great!', false, 1))
    // Reply 2 is a separate assistant message.
    onResponse(chunk('I am sad about the delay.', true, 2))

    expect(spies.emotePerform).toHaveBeenCalledTimes(1)
    expect(spies.emotePerform).toHaveBeenCalledWith(expect.objectContaining({ emotion: 'sad' }))
  })

  it('does not drop a body gesture to a wall-clock gap; the animation queue paces it', () => {
    const onResponse = startAgent()

    onResponse(chunk('That is great!', true, 1))
    onResponse(chunk('Wonderful news.', true, 2))

    expect(spies.bodyPerform).toHaveBeenCalledTimes(2)
    for (const [data] of spies.bodyPerform.mock.calls) {
      expect(data).toMatchObject({ immediate: false })
    }
  })
})

describe('useAgent cue tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('speaks the reply without its tag and fires the gesture once, when the word after it is spoken', () => {
    const onResponse = startAgent()
    onResponse(chunk('Sure, [gesture:Waving] let me check.', false, 1))
    onResponse(chunk('', true, 1))

    expect(spies.speak.mock.calls).toEqual([['Sure, let me check.']])
    expect(spies.bodyPerform).not.toHaveBeenCalled()

    // "let" begins 300 ms into the utterance, so the gesture waits for it.
    speechStarts('Sure, let me check.', { words: ['Sure,', 'let', 'me', 'check.'], wtimes: [0, 300, 450, 700] })
    vi.advanceTimersByTime(299)
    expect(spies.bodyPerform).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(spies.bodyPerform).toHaveBeenCalledTimes(1)
    expect(spies.bodyPerform).toHaveBeenCalledWith(
      expect.objectContaining({ clip: expect.objectContaining({ name: 'Waving' }), immediate: true })
    )

    vi.runAllTimers()
    expect(spies.bodyPerform).toHaveBeenCalledTimes(1)
  })

  it('fires an emote tag through the emote service when its word is spoken', () => {
    const onResponse = startAgent()
    onResponse(chunk('Oh [emote:sad] no.', true, 1))

    expect(spies.speak).toHaveBeenCalledWith('Oh no.')
    expect(spies.emotePerform).not.toHaveBeenCalledWith({ emotion: 'sad' })

    speechStarts('Oh no.', { words: ['Oh', 'no.'], wtimes: [0, 400] })
    vi.advanceTimersByTime(400)
    expect(spies.emotePerform).toHaveBeenCalledWith({ emotion: 'sad' })
    vi.runAllTimers()
    expect(spies.emotePerform.mock.calls.filter(([data]) => data.emotion === 'sad')).toHaveLength(1)
  })

  it('fires a tag at the start of its breath when TTS reports no word timings', () => {
    const onResponse = startAgent()
    onResponse(chunk('Sure, [gesture:Waving] let me check.', true, 1))

    speechStarts('Sure, let me check.')
    vi.runOnlyPendingTimers()

    expect(spies.bodyPerform).toHaveBeenCalledTimes(1)
  })

  it('keeps a tag split across two breaths and fires it once, at its own word', () => {
    const onResponse = startAgent()
    onResponse(chunk('Sure, [gesture:Wa', false, 1))
    onResponse(chunk('ving] let me check.', true, 1))

    expect(spies.speak.mock.calls).toEqual([['Sure, '], ['let me check.']])

    speechStarts('Sure, ', { words: ['Sure,'], wtimes: [0] })
    vi.runAllTimers()
    expect(spies.bodyPerform).not.toHaveBeenCalled()

    speechStarts('let me check.', { words: ['let', 'me', 'check.'], wtimes: [0, 200, 400] })
    vi.runAllTimers()
    expect(spies.bodyPerform).toHaveBeenCalledTimes(1)
  })

  it('a barge-in cancels cues that have not fired yet', () => {
    const onResponse = startAgent()
    onResponse(chunk('Sure, [gesture:Waving] let me check.', true, 1))
    speechStarts('Sure, let me check.', { words: ['Sure,', 'let'], wtimes: [0, 300] })

    spies.agent?.actions.triggerBargein()
    vi.runAllTimers()

    expect(spies.bodyPerform).not.toHaveBeenCalled()
  })

  it('a response with a new interrupt cancels the cues of the reply it cuts off', () => {
    const onResponse = startAgent()
    onResponse(chunk('Sure, [gesture:Waving] let me check.', false, 1))
    onResponse(chunk('', true, 1))
    speechStarts('Sure, let me check.', { words: ['Sure,', 'let'], wtimes: [0, 300] })

    onResponse(chunk('Okay.', true, 2))
    vi.runAllTimers()

    expect(spies.bodyPerform).not.toHaveBeenCalled()
  })

  it('drops an unknown tag from the speech, logs it, and fires nothing for it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const onResponse = startAgent()
      onResponse(chunk('Hello [gesture:Nope] there.', true, 1))

      expect(spies.speak).toHaveBeenCalledWith('Hello there.')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('gesture:Nope'))
      speechStarts('Hello there.', { words: ['Hello', 'there.'], wtimes: [0, 300] })
      vi.runAllTimers()

      expect(spies.bodyPerform).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('does not fire a looping clip such as the idle, which would never end', () => {
    const onResponse = startAgent()
    onResponse(chunk('Okay [gesture:idle-stable] then.', true, 1))
    speechStarts('Okay then.', { words: ['Okay', 'then.'], wtimes: [0, 300] })
    vi.runAllTimers()

    expect(spies.bodyPerform).not.toHaveBeenCalled()
  })

  it('fires a tag at the end of the reply at the time of the last word', () => {
    const onResponse = startAgent()
    onResponse(chunk('All done. [gesture:Waving]', true, 1))

    expect(spies.speak).toHaveBeenCalledWith('All done. ')
    speechStarts('All done. ', { words: ['All', 'done.'], wtimes: [0, 500] })

    vi.advanceTimersByTime(499)
    expect(spies.bodyPerform).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(spies.bodyPerform).toHaveBeenCalledTimes(1)
  })

  it('a reply without tags is spoken as before and leaves no cue timers behind', () => {
    const onResponse = startAgent()
    onResponse(chunk('That is great! ', false, 1))
    onResponse(chunk('Sorry about the delay.', false, 1))
    onResponse(chunk('', true, 1))

    expect(spies.speak.mock.calls).toEqual([['That is great! '], ['Sorry about the delay.']])
    expect(vi.getTimerCount()).toBe(0)

    speechStarts('That is great! ', { words: ['That'], wtimes: [0] })
    expect(vi.getTimerCount()).toBe(0)
  })
})
