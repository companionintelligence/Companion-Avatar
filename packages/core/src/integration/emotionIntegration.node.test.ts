import { describe, expect, it } from 'vitest'

import type { ConversationMessage } from '../services/conversation/conversationType'
import {
  detectEmotionFromText,
  getEmotionIntensity,
  shouldTriggerBargeIn
} from './emotionIntegration'

const userMsg = (text: string, isUser = true) =>
  ({ text, isUser } as unknown as ConversationMessage)

describe('detectEmotionFromText', () => {
  it.each([
    ['I am so happy today', 'happy'],
    ['🎉 congrats', 'happy'],
    ['this is sad news', 'sad'],
    ['I am absolutely furious', 'angry'],
    ['I am terrified of that', 'fear'],
    ['that is disgusting', 'disgust'],
    ['I adore them', 'love'],
    ['the weather is fine', 'neutral'],
    ['I made a reservation for you.', 'neutral'],
    ['not happy about this', 'neutral'],
    ['this is cryptic and encrypted', 'neutral'],
    ['that is engrossing', 'neutral'],
    ['I do not love this', 'neutral'],
    ['I don\'t feel sad', 'neutral'],
    ['I can\'t cry', 'neutral'],
    ['I never cry', 'neutral'],
    ['No, I am happy to help', 'happy']
  ])('maps %j → %s', (text, expected) => {
    expect(detectEmotionFromText(text)).toBe(expected)
  })

  it.each([
    ['Sorry about the delay.', 'neutral'],
    ['I am sorry to hear that', 'sad'],
    ['So sorry for your loss', 'sad']
  ])('maps the apology %j → %s', (text, expected) => {
    expect(detectEmotionFromText(text)).toBe(expected)
  })

  it.each([
    ['it hurts so much', 'sad'],
    ['I am crying', 'sad'],
    ['I am sadly alone', 'sad'],
    ['I loved that', 'happy'],
    ['I am loving this', 'happy'],
    ['what a lovely idea', 'happy']
  ])('keeps common inflections of a keyword: %j → %s', (text, expected) => {
    expect(detectEmotionFromText(text)).toBe(expected)
  })

  it('treats a negator within four tokens before a keyword as negating it', () => {
    expect(detectEmotionFromText('I am not very happy')).toBe('neutral')
    expect(detectEmotionFromText('I am unhappy with this')).not.toBe('happy')
    expect(detectEmotionFromText('I never loved it')).toBe('neutral')
    expect(detectEmotionFromText('I am not feeling very happy about that')).toBe('neutral')
  })

  it('stops a negator at a comma or full stop', () => {
    expect(detectEmotionFromText('No, I am happy to help')).toBe('happy')
    expect(detectEmotionFromText('Not really. I am happy')).toBe('happy')
  })

  it('counts the window in tokens: a negator four tokens back still counts, five does not', () => {
    expect(detectEmotionFromText('not feeling very really happy')).toBe('neutral')
    expect(detectEmotionFromText('not a feeling very really happy')).toBe('happy')
  })

  it.each([
    ['Happiness is a warm blanket', 'happy'],
    ['I am happier now', 'happy'],
    ['She answered happily', 'happy'],
    ['I cried all night', 'sad'],
    ['She cries a lot', 'sad']
  ])('keeps the y-to-i forms of a keyword: %j → %s', (text, expected) => {
    expect(detectEmotionFromText(text)).toBe(expected)
  })

  it.each([
    ['I am sorry you had to wait', 'sad'],
    ['So sorry, that is rough', 'sad'],
    ['Sorry about your loss', 'sad'],
    ['Sorry, I was late', 'neutral']
  ])('counts sympathy phrases as sad, not a bare apology: %j → %s', (text, expected) => {
    expect(detectEmotionFromText(text)).toBe(expected)
  })

  it('matches the happy branch before love when "love" appears alone', () => {
    // Documents current precedence: happy checks the `love` keyword first.
    expect(detectEmotionFromText('I love you')).toBe('happy')
  })
})

describe('shouldTriggerBargeIn', () => {
  it('fires on a short interruptive command from the user', () => {
    expect(shouldTriggerBargeIn(userMsg('stop'))).toBe(true)
    expect(shouldTriggerBargeIn(userMsg('please wait a second'))).toBe(true)
  })

  it('does not fire on ordinary user speech', () => {
    expect(shouldTriggerBargeIn(userMsg('tell me more about that'))).toBe(false)
  })

  it('never fires on assistant messages', () => {
    expect(shouldTriggerBargeIn(userMsg('stop', false))).toBe(false)
  })

  it('matches phrases only as whole words', () => {
    expect(shouldTriggerBargeIn(userMsg('I\'ve been listening to podcasts lately'))).toBe(false)
    expect(shouldTriggerBargeIn(userMsg('the stopwatch is broken'))).toBe(false)
    expect(shouldTriggerBargeIn(userMsg('I can\'t wait to hear more'))).toBe(false)
  })

  it('does not treat "wait" as a command when it is a noun mid-sentence', () => {
    expect(shouldTriggerBargeIn(userMsg('what\'s the wait time?'))).toBe(false)
  })

  it('still fires on whole-word commands and on a leading "wait"', () => {
    expect(shouldTriggerBargeIn(userMsg('Stop!'))).toBe(true)
    expect(shouldTriggerBargeIn(userMsg('Wait! I have a question'))).toBe(true)
    expect(shouldTriggerBargeIn(userMsg('Okay, wait'))).toBe(true)
    expect(shouldTriggerBargeIn(userMsg('hold on a moment'))).toBe(true)
  })

  it('fires on "wait" after an interjection or filler', () => {
    expect(shouldTriggerBargeIn(userMsg('Oh wait, can you repeat that?'))).toBe(true)
    expect(shouldTriggerBargeIn(userMsg('Actually, wait a second'))).toBe(true)
  })

  it('does not fire on a noun "wait", even after a filler', () => {
    expect(shouldTriggerBargeIn(userMsg('What is the wait time?'))).toBe(false)
    expect(shouldTriggerBargeIn(userMsg('Oh wait time is long'))).toBe(false)
    expect(shouldTriggerBargeIn(userMsg('Yeah, the wait list is long'))).toBe(false)
  })
})

describe('getEmotionIntensity', () => {
  it('ranks high-intensity language highest', () => {
    expect(getEmotionIntensity('this is extremely good')).toBeGreaterThanOrEqual(0.8)
  })

  it('ranks medium-intensity language in the middle band', () => {
    const v = getEmotionIntensity('this is very nice')
    expect(v).toBeGreaterThan(0.5)
    expect(v).toBeLessThan(0.8)
  })

  it('defaults neutral text to a low floor', () => {
    expect(getEmotionIntensity('the sky')).toBeCloseTo(0.3)
  })
})
