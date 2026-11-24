/**
 * Cue tags in a streamed reply: `[gesture:NAME]` and `[emote:NAME]`.
 *
 * A tag is never spoken. It becomes a cue whose offset is the number of speakable characters
 * before it, counted over the whole reply, so the cue can be timed against the word after it.
 * The parser is pure and streams: text that could still become a tag is held until a later
 * fragment settles it, and finish() releases whatever is left as literal text.
 */

export type CueKind = 'gesture' | 'emote'

export interface CueEvent {
  /** Speakable characters before the tag, counted from the start of the reply. */
  offset: number
  kind: CueKind
  /** The catalog spelling for a known name, or the name as written for an unknown one. */
  name: string
}

/** The names a tag may use, for each kind. */
export type CueNames = Partial<Record<CueKind, readonly string[]>>

export interface CueParseResult {
  /** Speakable text that is safe to emit now. */
  text: string
  /** Tags with a known name, in the order they appear. */
  cues: CueEvent[]
  /** Tags with a name that is not known. They are removed from the speech and never fired. */
  unknown: CueEvent[]
}

export interface CueParser {
  push: (fragment: string) => CueParseResult
  /** Ends the stream. A tag that never closed is returned as literal text. */
  finish: () => CueParseResult
}

/** A name is letters, digits, `_` or `-`, up to this many characters. Anything else stays text. */
const MAX_NAME_LENGTH = 64
const NAME_CHAR = /[A-Za-z0-9_-]/
const KINDS: readonly CueKind[] = ['gesture', 'emote']

type TagScan = { status: 'tag'; kind: CueKind; name: string; length: number } | { status: 'partial' | 'none' }

/** Reads the tag that `source` starts with, if it starts with one. `source` begins at a `[`. */
const scanTag = (source: string): TagScan => {
  for (const kind of KINDS) {
    const opener = `[${kind}:`
    if (!source.startsWith(opener)) {
      // The text so far could still grow into this opener, so the tag is not settled yet.
      if (opener.startsWith(source)) return { status: 'partial' }
      continue
    }

    let end = opener.length
    while (end < source.length && NAME_CHAR.test(source[end])) end++
    const name = source.slice(opener.length, end)
    if (name.length > MAX_NAME_LENGTH) return { status: 'none' }
    if (end === source.length) return { status: 'partial' }
    if (source[end] === ']' && name.length > 0) return { status: 'tag', kind, name, length: end + 1 }
    return { status: 'none' }
  }
  return { status: 'none' }
}

/**
 * Creates a parser for one reply. Names match the known ones case-insensitively, and a cue carries
 * the spelling from `knownNames`. When a removed tag has a space on both sides, one of them is dropped,
 * so "Sure, [gesture:wave] let me" speaks as "Sure, let me".
 */
export const createCueParser = (knownNames: CueNames = {}): CueParser => {
  const catalog = new Map<CueKind, Map<string, string>>()
  for (const kind of KINDS) {
    const byLowerName = new Map<string, string>()
    for (const name of knownNames[kind] ?? []) {
      const key = name.toLowerCase()
      if (!byLowerName.has(key)) byLowerName.set(key, name)
    }
    catalog.set(kind, byLowerName)
  }

  // Source text that began a tag but has not finished it yet.
  let held = ''
  // Speakable characters emitted by earlier calls.
  let emitted = 0
  let lastChar: string | undefined
  // Set after a tag is removed: the next space, if it comes first, is the one that goes.
  let dropSpace = false

  const run = (source: string, final: boolean): CueParseResult => {
    let text = ''
    const cues: CueEvent[] = []
    const unknown: CueEvent[] = []

    const emit = (char: string) => {
      if (dropSpace && char === ' ') {
        dropSpace = false
        return
      }
      dropSpace = false
      text += char
      lastChar = char
    }

    let index = 0
    while (index < source.length) {
      const bracket = source.indexOf('[', index)
      const stop = bracket < 0 ? source.length : bracket
      for (; index < stop; index++) emit(source[index])
      if (bracket < 0) break

      const scan = scanTag(source.slice(bracket))
      if (scan.status === 'tag') {
        const event = { offset: emitted + text.length, kind: scan.kind, name: scan.name }
        const known = catalog.get(scan.kind)?.get(scan.name.toLowerCase())
        if (known) cues.push({ ...event, name: known })
        else unknown.push(event)
        dropSpace = lastChar === undefined || lastChar === ' '
        index = bracket + scan.length
      } else if (scan.status === 'partial' && !final) {
        held = source.slice(bracket)
        break
      } else {
        emit('[')
        index = bracket + 1
      }
    }

    emitted += text.length
    return { text, cues, unknown }
  }

  return {
    push(fragment) {
      const source = held + fragment
      held = ''
      return run(source, false)
    },
    finish() {
      const source = held
      held = ''
      return run(source, true)
    }
  }
}
