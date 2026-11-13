import { test, expect } from '@playwright/test'
import {
  bootApp,
  sendAndAwaitReply,
  sendAndAwaitReplyStart,
  bargeIn,
  serveDirectedReplies,
  assistantBubbleCount,
  canvasFramesDiffer,
  type DirectedTriggerGroup
} from './_scenario'

/**
 * L4 · Education vertical — tutor turn-taking + barge-in.
 * docs/TESTING-PIPELINE.md: multiple turns; expression changes between turns;
 * barge-in stops mid-utterance.
 *
 * Real app, offline directed-responses mode. Hard assertions: a short multi-turn Q&A
 * (each turn adds an assistant bubble) and a barge-in turn ("wait", routed through
 * shouldTriggerBargeIn → agent.actions.triggerBargein()) sent while a reply is still
 * streaming, which the app answers, cuts the reply off at, and survives. The strict
 * "barge-in halts the speech and visemes mid-flight" and "facial expression changes
 * between turns" assertions live in the skipped test — they read ref-held service
 * state the app never surfaces.
 */

/**
 * The barge-in needs a reply that is still streaming when "wait" lands. The directed
 * adapter streams one sentence every 200 ms, and the stock replies are at most three
 * sentences, so they finish ~400 ms after they start: too tight to barge into
 * reliably. This lesson streams for ~2 s, and the barge-in gets a known answer.
 */
const LESSON_PROMPT = 'Walk me through the lesson'
const LESSON_LAST_SENTENCE = 'That is the whole lesson.'
const BARGE_IN_REPLY = 'Of course, we can pause the lesson here.'
const LESSON_SCRIPT: DirectedTriggerGroup[] = [
  {
    triggers: [LESSON_PROMPT.toLowerCase()],
    responses: [
      {
        id: 'l4-lesson',
        response: [
          'First, we read the question.',
          'Then we underline the key words.',
          'Then we list what we already know.',
          'Then we pick a method.',
          'Then we work through it one step at a time.',
          'Then we check each step.',
          'Then we write down the answer.',
          'Then we check that it answers the question.',
          'Finally, we explain it in our own words.',
          LESSON_LAST_SENTENCE
        ].join(' ')
      }
    ]
  },
  // "wait" is also a barge-in phrase (shouldTriggerBargeIn).
  { triggers: ['wait'], responses: [{ id: 'l4-barge-in', response: BARGE_IN_REPLY }] }
]

test.describe('L4 · education (tutor turn-taking + barge-in)', () => {
  test('handles multiple tutoring turns, each adding a reply', async ({ page }) => {
    const { errors } = await bootApp(page)

    const turns = ['Hello', 'Can you help me?', 'How are you?']
    let prevCount = 0
    for (const turn of turns) {
      const reply = await sendAndAwaitReply(page, turn)
      expect(reply.length, `reply for "${turn}" should have text`).toBeGreaterThan(0)

      const count = await assistantBubbleCount(page)
      expect(count, 'each turn should add an assistant bubble').toBeGreaterThan(prevCount)
      prevCount = count
    }

    // Observational only (never fails the test).
    console.log('[education] canvas frames differed during Q&A:', await canvasFramesDiffer(page))

    expect(errors, `uncaught page errors:\n${errors.join('\n')}`).toEqual([])
  })

  test('accepts a barge-in turn without breaking the conversation', async ({ page }) => {
    await serveDirectedReplies(page, LESSON_SCRIPT)
    const { errors } = await bootApp(page)

    // Start the lesson, then barge in while it is still streaming. "wait" is both a
    // barge-in phrase and a directed trigger, so the turn interrupts and gets a reply.
    await sendAndAwaitReplyStart(page, LESSON_PROMPT)
    const transcript = await bargeIn(page, 'wait')

    // The barge-in was answered, and the lesson stopped streaming where it was cut off.
    expect(transcript, 'app did not answer the barge-in turn').toContain(BARGE_IN_REPLY)
    expect(transcript, 'the lesson kept streaming after the barge-in').not.toContain(LESSON_LAST_SENTENCE)

    // Conversation is still alive: a follow-up turn still gets a reply of its own.
    const followUp = await sendAndAwaitReply(page, 'Thank you')
    expect(followUp.length).toBeGreaterThan(0)

    expect(errors, `uncaught page errors:\n${errors.join('\n')}`).toEqual([])
  })

  // TODO: assert barge-in actually STOPS the in-progress utterance (TTS isSpeaking flips
  // false, visemes reset) and that facial EXPRESSION changes between turns. Both live in
  // ref-held service state (useTTSService / useEmoteService) the app never surfaces on
  // `window`, and frameloop="demand" defeats screenshot frame-diffing (see
  // canvasFramesDiffer). Wire once the app exposes an agent-debug surface; until then this
  // stays skipped rather than a false pass.
  test.skip('barge-in halts the in-progress utterance and expression changes between turns', async () => {
    // Intentionally skipped — see TODO above.
  })
})
