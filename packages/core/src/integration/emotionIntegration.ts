import type { ConversationMessage } from '../services/conversation/conversationType'
import type { EmotionType, PerformanceData } from '../services/emote/emoteTypes'

const TOKEN_PATTERN = /[a-z]+(?:'[a-z]+)*|[.,!?;:]/g
const NEGATORS = ['not', 'no', 'never']
const NEGATION_WINDOW = 4
const PUNCTUATION = new Set(['.', ',', '!', '?', ';', ':'])

// "not", "no", "never" and any contraction ending in n't (don't, can't) negate a keyword.
const isNegator = (token: string): boolean => NEGATORS.includes(token) || token.endsWith('n\'t')

/**
 * Forms a keyword word can take in running text: the word itself and its common
 * inflections (hurts, crying, loved, lovely, greatly, sadness). Whole tokens only, so
 * "encrypted" does not match "cry" and "made" does not match "mad".
 */
const inflectionsOf = (word: string): Set<string> => {
  const stem = word.endsWith('e') ? word.slice(0, -1) : word
  const forms = new Set([word, `${word}s`, `${word}es`, `${word}d`, `${word}ed`, `${stem}ing`, `${word}ly`, `${word}ness`, `${word}ful`])
  // A final y becomes i before -ness, -er, -ly, -ed and -es: happiness, happier, happily, cried, cries.
  if (word.endsWith('y')) {
    const iStem = `${word.slice(0, -1)}i`
    for (const suffix of ['ness', 'er', 'ly', 'ed', 'es']) forms.add(`${iStem}${suffix}`)
  }
  return forms
}

/**
 * True when a negator is among the NEGATION_WINDOW tokens before `start`, with no punctuation
 * in between. A comma or full stop ends the negation, so "No, I am happy" is not negated.
 */
const isNegated = (tokens: string[], start: number): boolean => {
  for (let i = start - 1; i >= Math.max(0, start - NEGATION_WINDOW); i--) {
    if (PUNCTUATION.has(tokens[i])) return false
    if (isNegator(tokens[i])) return true
  }
  return false
}

/**
 * True when the keyword (one or more words) appears in the tokens and is not negated (see isNegated).
 */
const hasKeyword = (tokens: string[], keyword: string): boolean => {
  const forms = keyword.split(' ').map(inflectionsOf)
  return tokens.some((_, start) => {
    if (!forms.every((set, offset) => set.has(tokens[start + offset]))) return false
    return !isNegated(tokens, start)
  })
}

/**
 * Simple emotion detection based on keywords and patterns in text
 * In a production system, this could be replaced with a more sophisticated
 * emotion analysis service or AI model
 */
export const detectEmotionFromText = (text: string): EmotionType => {
  // Curly apostrophes are normalized so that "don't" with a typographic apostrophe is read as a negation.
  const lowerText = text.toLowerCase().replace(/’/g, '\'')
  const tokens = lowerText.match(TOKEN_PATTERN) ?? []

  // Happy indicators
  if (
    hasKeyword(tokens, 'happy') ||
    hasKeyword(tokens, 'joy') ||
    hasKeyword(tokens, 'excited') ||
    hasKeyword(tokens, 'great') ||
    hasKeyword(tokens, 'wonderful') ||
    hasKeyword(tokens, 'amazing') ||
    hasKeyword(tokens, 'fantastic') ||
    hasKeyword(tokens, 'excellent') ||
    hasKeyword(tokens, 'love') ||
    hasKeyword(tokens, 'celebrate') ||
    lowerText.includes('😊') ||
    lowerText.includes('😄') ||
    lowerText.includes('🎉') ||
    lowerText.includes('👍')
  ) {
    return 'happy'
  }

  // Sad indicators. A bare "sorry" is an apology rather than sadness, so only sympathy phrases count.
  if (
    hasKeyword(tokens, 'sad') ||
    hasKeyword(tokens, 'disappointed') ||
    hasKeyword(tokens, 'unfortunate') ||
    hasKeyword(tokens, 'regret') ||
    hasKeyword(tokens, 'cry') ||
    hasKeyword(tokens, 'tears') ||
    hasKeyword(tokens, 'hurt') ||
    hasKeyword(tokens, 'sorry to hear') ||
    hasKeyword(tokens, 'sorry for your loss') ||
    hasKeyword(tokens, 'sorry you') ||
    hasKeyword(tokens, 'so sorry') ||
    hasKeyword(tokens, 'sorry about your') ||
    lowerText.includes('😢') ||
    lowerText.includes('😭') ||
    lowerText.includes('💔')
  ) {
    return 'sad'
  }

  // Angry indicators
  if (
    hasKeyword(tokens, 'angry') ||
    hasKeyword(tokens, 'mad') ||
    hasKeyword(tokens, 'furious') ||
    hasKeyword(tokens, 'annoying') ||
    hasKeyword(tokens, 'irritated') ||
    hasKeyword(tokens, 'frustrated') ||
    hasKeyword(tokens, 'outrageous') ||
    hasKeyword(tokens, 'ridiculous') ||
    lowerText.includes('😠') ||
    lowerText.includes('😡') ||
    lowerText.includes('🤬')
  ) {
    return 'angry'
  }

  // Fear indicators
  if (
    hasKeyword(tokens, 'scared') ||
    hasKeyword(tokens, 'afraid') ||
    hasKeyword(tokens, 'frightened') ||
    hasKeyword(tokens, 'terrified') ||
    hasKeyword(tokens, 'nervous') ||
    hasKeyword(tokens, 'worried') ||
    hasKeyword(tokens, 'anxious') ||
    hasKeyword(tokens, 'panic') ||
    lowerText.includes('😨') ||
    lowerText.includes('😰') ||
    lowerText.includes('😱')
  ) {
    return 'fear'
  }

  // Disgust indicators
  if (
    hasKeyword(tokens, 'disgusting') ||
    hasKeyword(tokens, 'gross') ||
    hasKeyword(tokens, 'yuck') ||
    hasKeyword(tokens, 'revolting') ||
    hasKeyword(tokens, 'nasty') ||
    hasKeyword(tokens, 'awful') ||
    hasKeyword(tokens, 'terrible') ||
    lowerText.includes('🤢') ||
    lowerText.includes('🤮') ||
    lowerText.includes('😷')
  ) {
    return 'disgust'
  }

  // Love/affection indicators
  if (
    hasKeyword(tokens, 'love you') ||
    hasKeyword(tokens, 'adore') ||
    hasKeyword(tokens, 'cherish') ||
    hasKeyword(tokens, 'romantic') ||
    hasKeyword(tokens, 'sweetheart') ||
    hasKeyword(tokens, 'darling') ||
    hasKeyword(tokens, 'beloved') ||
    lowerText.includes('💕') ||
    lowerText.includes('💖') ||
    lowerText.includes('💗') ||
    lowerText.includes('❤️') ||
    lowerText.includes('😍')
  ) {
    return 'love'
  }

  // Default to neutral
  return 'neutral'
}

/**
 * Analyze message for special actions or behaviors
 */
export const analyzeMessageForActions = (message: ConversationMessage): string | undefined => {
  const lowerText = message.text.toLowerCase()

  // Detect greeting behaviors
  if (
    lowerText.includes('hello') ||
    lowerText.includes('to meet you') ||
    lowerText.includes('hi there') ||
    lowerText.includes('good morning') ||
    lowerText.includes('good afternoon') ||
    lowerText.includes('good evening')
  ) {
    return 'greeting'
  }

  // Detect farewell behaviors
  if (
    lowerText.includes('goodbye') ||
    lowerText.includes('bye') ||
    lowerText.includes('see you later') ||
    lowerText.includes('take care') ||
    lowerText.includes('farewell')
  ) {
    return 'farewell'
  }

  // Detect agreement
  if (
    lowerText.includes('yes') ||
    lowerText.includes('absolutely') ||
    lowerText.includes('definitely') ||
    lowerText.includes('agreed') ||
    lowerText.includes('exactly')
  ) {
    return 'agreement'
  }

  // Detect disagreement
  if (
    lowerText.includes('no way') ||
    lowerText.includes('disagree') ||
    lowerText.includes('absolutely not') ||
    lowerText.includes('never') ||
    lowerText.includes('refuse')
  ) {
    return 'disagreement'
  }

  return undefined
}

/**
 * Create performance data based on a conversation message
 */
export const createPerformanceFromMessage = (
  message: ConversationMessage,
  messageIndex: number = 0
): PerformanceData => {
  const emotion = detectEmotionFromText(message.text)

  return {
    emotion,
    //action,
    bcounter: messageIndex, // Used for gaze behavior
    whisper: message.visemeData as { words?: string[]; wtimes?: number[]; wdurations?: number[] } | undefined // If available from TTS
  }
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Whole-word match, so 'listen' does not match 'listening' and 'stop' does not match 'stopwatch'.
const containsWholePhrase = (text: string, phrase: string): boolean =>
  new RegExp(`\\b${escapeRegExp(phrase)}\\b`).test(text)

// "wait" interrupts only when it opens the utterance or follows an interjection or filler, and not when it is
// a noun ("the wait time", "wait list").
const LEADING_WAIT = /^(?:(?:oh|okay|ok|hey|um|uh|no|yes|actually|hmm|well|so|sorry|yeah)[,.!]*\s+)*wait\b(?!\s+(?:times?|lists?|lines?|rooms?)\b)/

/**
 * Determine if a message should trigger barge-in behavior
 */
export const shouldTriggerBargeIn = (message: ConversationMessage): boolean => {
  // Improved heuristic for barge-in detection:
  // - User message
  // - Contains strong interruptive keywords or phrases
  // - Short, imperative, or urgent tone
  if (!message.isUser || !message.text) return false

  const lowerText = message.text.toLowerCase().trim()

  // List of interruptive keywords/phrases
  const bargeInPhrases = [
    'stop',
    'hold on',
    'pause',
    'enough',
    'that\'s enough',
    'quiet',
    'be quiet',
    'shut up',
    'cancel',
    'interrupt',
    'let me speak',
    'let me talk',
    'listen',
    'no more',
    'please stop',
    'please wait'
  ]

  // Check for presence of barge-in phrases anywhere in the message, matched as whole words
  if (bargeInPhrases.some(phrase => containsWholePhrase(lowerText, phrase))) return true

  // "Wait!" and "Okay, wait" interrupt; "what's the wait time?" does not
  return LEADING_WAIT.test(lowerText)
}

/**
 * Get emotion intensity based on message content
 * Returns a value between 0 and 1
 */
export const getEmotionIntensity = (text: string): number => {
  const lowerText = text.toLowerCase()

  // High intensity indicators
  const highIntensityWords = [
    'extremely',
    'incredibly',
    'absolutely',
    'completely',
    'totally',
    'amazing',
    'fantastic',
    'terrible',
    'awful',
    'furious',
    'thrilled'
  ]

  // Medium intensity indicators
  const mediumIntensityWords = ['very', 'really', 'quite', 'pretty', 'rather', 'good', 'bad', 'nice', 'great', 'okay']

  // Count intensity markers
  const highCount = highIntensityWords.reduce((count, word) => (lowerText.includes(word) ? count + 1 : count), 0)

  const mediumCount = mediumIntensityWords.reduce((count, word) => (lowerText.includes(word) ? count + 1 : count), 0)

  if (highCount > 0) return 0.8 + Math.min(highCount, 3) * 0.067 // 0.8 to 1.0
  if (mediumCount > 0) return 0.5 + Math.min(mediumCount, 3) * 0.1 // 0.5 to 0.8

  return 0.3 // Default low intensity
}

/**
 * Integration service for connecting chat messages to emote system
 */
export const emotionIntegrationService = {
  detectEmotionFromText,
  analyzeMessageForActions,
  createPerformanceFromMessage,
  shouldTriggerBargeIn,
  getEmotionIntensity
}
