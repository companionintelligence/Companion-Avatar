import { describe, expect, it } from 'vitest'

import { createCueParser, type CueEvent, type CueNames } from './inlineCues'

const names: CueNames = {
  gesture: ['Waving', 'Pointing-Forward', 'idle_loop'],
  emote: ['happy', 'sad', 'neutral']
}

/** Feeds every fragment in order, then finish(), and returns all the speakable text and cues. */
const run = (fragments: string[], known: CueNames = names) => {
  const parser = createCueParser(known)
  let text = ''
  const cues: CueEvent[] = []
  const unknown: CueEvent[] = []
  for (const fragment of fragments) {
    const step = parser.push(fragment)
    text += step.text
    cues.push(...step.cues)
    unknown.push(...step.unknown)
  }
  const tail = parser.finish()
  text += tail.text
  cues.push(...tail.cues)
  unknown.push(...tail.unknown)
  return { text, cues, unknown }
}

describe('createCueParser', () => {
  it('takes a gesture tag out of the speech and records the offset of the word after it', () => {
    expect(run(['Sure, [gesture:Waving] let me check.'])).toEqual({
      text: 'Sure, let me check.',
      cues: [{ offset: 6, kind: 'gesture', name: 'Waving' }],
      unknown: []
    })
  })

  it('parses a tag split across streamed chunks, with no text lost or duplicated', () => {
    const reply = 'Sure, [gesture:Waving] let me check.'
    const expected = {
      text: 'Sure, let me check.',
      cues: [{ offset: 6, kind: 'gesture', name: 'Waving' }],
      unknown: []
    }

    expect(run(['Sure, [ges', 'ture:Wav', 'ing] let me check.'])).toEqual(expected)
    expect(run([...reply])).toEqual(expected)
    for (let cut = 1; cut < reply.length; cut++) {
      expect(run([reply.slice(0, cut), reply.slice(cut)])).toEqual(expected)
    }
  })

  it('removes an unknown name from the speech and records it without firing it', () => {
    expect(run(['Hi [gesture:Nope] there.'])).toEqual({
      text: 'Hi there.',
      cues: [],
      unknown: [{ offset: 3, kind: 'gesture', name: 'Nope' }]
    })
  })

  it('keeps a bracket that never closes as literal text at finish()', () => {
    const parser = createCueParser(names)
    const first = parser.push('Count [gesture:Waving')
    expect(first).toEqual({ text: 'Count ', cues: [], unknown: [] })

    expect(parser.finish()).toEqual({ text: '[gesture:Waving', cues: [], unknown: [] })
    expect(run(['Count [gesture:Waving'])).toEqual({ text: 'Count [gesture:Waving', cues: [], unknown: [] })
  })

  it('does not hold a bracket that cannot start a tag', () => {
    const parser = createCueParser(names)
    expect(parser.push('see array[0] and [x')).toEqual({ text: 'see array[0] and [x', cues: [], unknown: [] })
    expect(parser.finish()).toEqual({ text: '', cues: [], unknown: [] })
  })

  it('holds a partial opener until the next chunk resolves it', () => {
    const parser = createCueParser(names)
    expect(parser.push('ok [')).toEqual({ text: 'ok ', cues: [], unknown: [] })
    expect(parser.push('gesture:Waving] yes')).toEqual({
      text: 'yes',
      cues: [{ offset: 3, kind: 'gesture', name: 'Waving' }],
      unknown: []
    })
  })

  it('reads several tags, each with its own offset', () => {
    expect(run(['A [emote:happy] B [gesture:Waving] C.'])).toEqual({
      text: 'A B C.',
      cues: [
        { offset: 2, kind: 'emote', name: 'happy' },
        { offset: 4, kind: 'gesture', name: 'Waving' }
      ],
      unknown: []
    })
  })

  it('keeps offsets cumulative across chunks', () => {
    const parser = createCueParser(names)
    const first = parser.push('One two. ')
    const second = parser.push('[emote:sad]Three.')
    expect(first.text).toBe('One two. ')
    expect(second).toEqual({ text: 'Three.', cues: [{ offset: 9, kind: 'emote', name: 'sad' }], unknown: [] })
  })

  it('matches names case-insensitively and reports the spelling from the catalog', () => {
    expect(run(['[gesture:WAVING] ok'])).toEqual({
      text: 'ok',
      cues: [{ offset: 0, kind: 'gesture', name: 'Waving' }],
      unknown: []
    })
    expect(run(['Fine. [emote:Happy]']).cues).toEqual([{ offset: 6, kind: 'emote', name: 'happy' }])
  })

  it('checks each kind against its own names', () => {
    expect(run(['[emote:Waving] [gesture:happy]'])).toEqual({
      text: '',
      cues: [],
      unknown: [
        { offset: 0, kind: 'emote', name: 'Waving' },
        { offset: 0, kind: 'gesture', name: 'happy' }
      ]
    })
  })

  it('removes a tag at the start of the reply without leaving a leading space', () => {
    expect(run(['[gesture:Waving] Hello.'])).toEqual({
      text: 'Hello.',
      cues: [{ offset: 0, kind: 'gesture', name: 'Waving' }],
      unknown: []
    })
  })

  it('places a tag at the end of the reply after the last spoken character', () => {
    expect(run(['Bye. [emote:sad]'])).toEqual({
      text: 'Bye. ',
      cues: [{ offset: 5, kind: 'emote', name: 'sad' }],
      unknown: []
    })
  })

  it('keeps text that is not in the tag syntax, even when it has a bracket', () => {
    for (const reply of [
      '[gesture: Waving] ok',
      '[gesture:] ok',
      '[gesture:Wa ving] ok',
      '[Gesture:Waving] ok',
      `[gesture:${'a'.repeat(65)}] ok`
    ]) {
      expect(run([reply])).toEqual({ text: reply, cues: [], unknown: [] })
    }
  })

  it('is an identity for a reply with no tags, however it is chunked', () => {
    const replies = [
      'Plain text, with punctuation! And a question?',
      'See array[0] and [x], then [ok.',
      'Brackets [[ and ]] and ( ) { } * # % -',
      ''
    ]
    for (const reply of replies) {
      for (let size = 1; size <= 4; size++) {
        const fragments: string[] = []
        for (let i = 0; i < reply.length; i += size) fragments.push(reply.slice(i, i + size))
        expect(run(fragments)).toEqual({ text: reply, cues: [], unknown: [] })
      }
    }
  })
})
