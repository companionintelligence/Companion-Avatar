import { useCallback, useEffect, useMemo, useRef, useState } from 'react'


import { BoundaryTimeline } from '@ci-avatar/engine'

import { getAudioGraph } from './audioGraph'
import { mark as markLatency } from '../telemetry/latency'

import { cleanText } from './textUtils'
import { createSyntheticSpeechWav } from './syntheticSpeech'
import { type TTSConfig, type WhisperData, defaultTTSConfig } from './ttsConfig'
import { apiUrl } from '../../config/apiBase'

// Workerized TTS using vits-web library
const createTTSWorker = (): Worker => {
  const ttsWorkerString = `
import * as tts from 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm'
self.addEventListener('message', async (e) => {
  const id = e.data.id
  const text = e.data.text || 'please supply some text'
  const voiceId = e.data.voice || 'en_GB-hfc_male-medium'
  console.log('TTS Worker received message:', { id, text, voiceId })
  tts.predict({text, voiceId}).then(audio => {
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(audio)
    }).then(audio => {
      self.postMessage({ audio, id })
    }).catch(error => {
      console.error('TTS Worker Error:', error)
      self.postMessage({ error: error.message, id })
    })
  })
})
`
  return new Worker(URL.createObjectURL(new Blob([ttsWorkerString], { type: 'text/javascript' })), { type: 'module' })
}

declare global {
  interface Window {
    /**
     * Optional host/console override for playback volume (0..1). Never set by the
     * app itself — read here so an embedder can duck TTS without a rebuild.
     */
    globalTTSVolume?: number
  }
}

interface TTSServiceOptions {
  config?: Partial<TTSConfig>
  onSpeechStart?: (text: string, whisperData: WhisperData) => void
  onSpeechEnd?: () => void
}

interface QueuedMessage {
  id: number
  text: string
  status: 'pending' | 'generating' | 'ready' | 'playing' | 'completed' | 'error'
  audio?: ArrayBuffer
  whisperData?: WhisperData
  /** Word/viseme timings from a timing-capable upstream (Tier A). */
  timings?: { words: string[]; wtimes: number[]; wdurations: number[]; visemes?: string[]; vtimes?: number[]; vdurations?: number[] }
  error?: string
}

/**
 * Timings for the utterance currently playing, from whichever engine produced it.
 *
 * This is the single seam the three lip-sync tiers meet at:
 *  - Tier A (HeadTTS/Kokoro) fills `visemes`/`vtimes`/`vdurations` — exact phonetic
 *    shapes with millisecond timing.
 *  - Tier B/C fill only the word arrays; the letter-to-sound rules supply shapes
 *    and these supply the clock.
 *
 * `revision` increments whenever the data changes, so a consumer can rebuild its
 * schedule incrementally instead of diffing arrays every frame. Browser boundary
 * events arrive DURING playback, so this genuinely does change mid-utterance.
 */
export interface SpeechTimings {
  words: string[]
  wtimes: number[]
  wdurations: number[]
  visemes?: string[]
  vtimes?: number[]
  vdurations?: number[]
  revision: number
}

let globalId = 0

export const useTTSService = (options: TTSServiceOptions = {}) => {
  const { config: configPartial = {}, onSpeechStart, onSpeechEnd } = options
  const config = useMemo(() => ({ ...defaultTTSConfig, ...configPartial }), [configPartial])
  const [revision, setRevision] = useState(0)
  const bumpRevision = useCallback(() => setRevision((value) => value + 1), [])
  const isProcessing = useRef(false)
  const messageQueue = useRef<QueuedMessage[]>([])
  const nextExpectedId = useRef(0)
  const workerRef = useRef<Worker | null>(null)
  // Barge-in support. `activeSourceRef`/`activeContextRef` track the audio that is
  // actually playing right now so stopSpeaking can cut it off mid-utterance (H4);
  // clearing the queue alone never interrupted the current sound. `generationRef`
  // is bumped on every stop so a stale queue loop that resumes after its audio is
  // cut can't clobber the freshly-reset cursor/queue and silently drop all future
  // speech (C1).
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const activeContextRef = useRef<AudioContext | null>(null)
  const analyserNodeRef = useRef<AnalyserNode | null>(null)
  const currentSpeechTextRef = useRef<string>('')
  const currentSpeechDurationRef = useRef<number>(0)
  const playbackStartTimeRef = useRef<number>(0)
  const generationRef = useRef(0)
  // Real word timings for the utterance in flight. Populated from browser
  // `boundary` events (Tier C) or from a timing-capable upstream (Tier A).
  const boundaryTimelineRef = useRef(new BoundaryTimeline())
  // `speechSynthesis.getVoices()` returns [] until the engine has enumerated,
  // which on Chromium happens after a `voiceschanged` event — measured at 180
  // voices only after waiting. Reading it synchronously on the first utterance
  // therefore selected no voice at all and silently used the system default.
  const cachedVoicesRef = useRef<SpeechSynthesisVoice[]>([])
  const speechTimingsRef = useRef<SpeechTimings | null>(null)
  const timingRevisionRef = useRef(0)

  /**
   * Publish the timeline's current state. Called on every boundary, so the
   * consumer's schedule is rebuilt incrementally as words land rather than once
   * at the end — by which point the utterance is over.
   */
  const publishTimings = useCallback((timeline: BoundaryTimeline) => {
    const { words, wtimes, wdurations } = timeline.toWordTimings()
    speechTimingsRef.current = { words, wtimes, wdurations, revision: ++timingRevisionRef.current }
  }, [])
  // Once the Pocket TTS server proves unreachable (network-level failure), stop
  // hammering it for every message — degrade to silent text chat with one warning.
  const pocketUnreachable = useRef(false)

  // Initialize worker for local TTS
  const getOrCreateWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = createTTSWorker()
    }
    return workerRef.current
  }, [])

  const playAudioBuffer = useCallback(async (audioBuffer: ArrayBuffer, speechText?: string): Promise<void> => {
    const graph = getAudioGraph()
    if (!graph) return

    const { context: audioContext, analyser } = graph
    // A context created before any user gesture starts suspended; resuming here
    // means the first reply after the user interacts is audible rather than
    // silently scheduled against a stopped clock.
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume()
      } catch {
        // Retried on the next utterance.
      }
    }

    // Bytes are in hand and decodable — everything after this is scheduling.
    markLatency('tts-first-byte')
    const decodedAudio = await audioContext.decodeAudioData(audioBuffer.slice(0))

    return new Promise<void>((resolve) => {
      const source = audioContext.createBufferSource()
      const gainNode = audioContext.createGain()
      gainNode.gain.value = window.globalTTSVolume ?? config.volume

      source.buffer = decodedAudio
      source.connect(gainNode)
      // Route through the SHARED analyser so lip-sync sees every utterance
      // without a new node per chunk. It is already connected to the
      // destination; connecting it again per source would stack gain.
      if (analyser) gainNode.connect(analyser)
      else gainNode.connect(audioContext.destination)

      activeSourceRef.current = source
      activeContextRef.current = audioContext
      analyserNodeRef.current = analyser
      playbackStartTimeRef.current = audioContext.currentTime
      currentSpeechDurationRef.current = decodedAudio.duration
      if (speechText) currentSpeechTextRef.current = speechText
      bumpRevision()

      source.onended = () => {
        try {
          source.disconnect()
          gainNode.disconnect()
        } catch {
          // Already torn down by a barge-in.
        }
        if (activeSourceRef.current === source) {
          activeSourceRef.current = null
          // The shared analyser outlives the source, but nothing is feeding it
          // now — clear the ref so the render loop stops reading a silent node
          // and treating the mouth as still speaking.
          analyserNodeRef.current = null
        }
        resolve()
      }

      source.start(0)
      // The moment sound actually reaches the user.
      markLatency('first-audio')
    })
  }, [bumpRevision, config.volume])

  // Generate audio using browser speech synthesis
  const generateBrowserAudio = useCallback(async (_message: QueuedMessage) => {
    if (!('speechSynthesis' in window)) {
      throw new Error('Speech synthesis not supported')
    }

    // For browser mode, we don't pre-generate audio, we play it directly during playback
    // Just mark as ready
    return Promise.resolve()
  }, [])

  // Deterministic, dependency-free audio for rendered animation tests. It uses
  // the same decoded-buffer/analyser path as remote and local TTS, unlike the
  // legacy harness shortcut that only queued synthetic viseme weights.
  const generateSyntheticAudio = useCallback(
    async (message: QueuedMessage) => {
      message.audio = createSyntheticSpeechWav(message.text)
    },
    []
  )

  // Generate audio using local worker
  const generateLocalAudio = useCallback(
    async (message: QueuedMessage) => {
      return new Promise<void>((resolve, reject) => {
        const worker = getOrCreateWorker()

        const handleWorkerMessage = (event: MessageEvent) => {
          const { audio, id, error } = event.data
          if (error) {
            reject(new Error(error))
            return
          }
          if (id === message.id) {
            message.audio = audio
            worker.removeEventListener('message', handleWorkerMessage)
            worker.removeEventListener('error', handleWorkerError)
            resolve()
          }
        }

        const handleWorkerError = (error: ErrorEvent) => {
          worker.removeEventListener('message', handleWorkerMessage)
          worker.removeEventListener('error', handleWorkerError)
          reject(new Error(`Worker Error: ${error.message}`))
        }

        worker.addEventListener('message', handleWorkerMessage)
        worker.addEventListener('error', handleWorkerError)

        worker.postMessage({
          id: message.id,
          text: message.text,
          voice: config.voice
        })
      })
    },
    [getOrCreateWorker, config.voice]
  )

  // Generate audio via the BFF (`remote` mode → same-origin POST /api/tts).
  //
  // The BFF (apps/proxy) forwards this to a runtime-configured TTS upstream
  // (CosyVoice2 by default) and streams the audio back, so the browser needs no
  // API key or CORS and everything stays local to the appliance. We drain the
  // streamed body into an ArrayBuffer here and hand it to the existing queue /
  // playAudioBuffer path. This upstream carries no word timings, so lip-sync
  // falls to the acoustic tier (FFT energy + letter-to-sound shapes).
  const generateRemoteAudio = useCallback(
    async (message: QueuedMessage) => {
      // Same-origin BFF route. `config.url` may override for non-standard mounts,
      // but the default is /api/tts, prefixed with VITE_API_BASE in a shell build.
      const url = config.url && config.url.startsWith('/') ? apiUrl(config.url) : apiUrl('/api/tts')

      const requestBody = {
        text: message.text,
        voice: config.voice,
        format: 'mp3'
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        throw new Error(`Remote TTS API error: ${response.status} ${response.statusText}`)
      }

      // Consume the streamed audio. arrayBuffer() collects the full chunked
      // body; the stream still lets the first bytes leave the upstream early.
      message.audio = await response.arrayBuffer()
    },
    [config.url, config.voice]
  )

  /**
   * Tier A: same-origin BFF route that returns audio AND the engine's own word +
   * viseme timings (`POST /api/tts/timed`, backed by HeadTTS/Kokoro).
   *
   * This is the only path where the mouth is driven by what the synthesizer
   * actually produced rather than by something inferred after the fact. A 501
   * means the configured upstream cannot report timings; that is a normal
   * outcome, not an error, so we degrade to the plain streaming route and let
   * the acoustic tier take the mouth.
   */
  const generateTimedAudio = useCallback(
    async (message: QueuedMessage) => {
      const response = await fetch(apiUrl('/api/tts/timed'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message.text, voice: config.voice, format: 'wav' })
      })

      if (response.status === 501) {
        throw new Error('TIMED_TTS_UNSUPPORTED')
      }
      if (!response.ok) {
        throw new Error(`Timed TTS API error: ${response.status} ${response.statusText}`)
      }

      const payload = (await response.json()) as {
        audio?: string
        timings?: { words: string[]; wtimes: number[]; wdurations: number[]; visemes?: string[]; vtimes?: number[]; vdurations?: number[] }
      }
      if (!payload.audio) throw new Error('Timed TTS returned no audio')

      const binary = atob(payload.audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      message.audio = bytes.buffer
      message.timings = payload.timings
    },
    [config.voice]
  )

  // Generate audio using Pocket TTS server
  const generatePocketAudio = useCallback(
    async (message: QueuedMessage) => {
      const serverUrl = config.pocketTts?.serverUrl || 'http://localhost:8000'
      const voice = config.pocketTts?.voice || 'marius'

      const formData = new FormData()
      formData.append('text', message.text)
      
      // Check if voice is a URL (http://, https://, or hf://) or a predefined voice name
      if (voice.startsWith('http://') || voice.startsWith('https://') || voice.startsWith('hf://')) {
        formData.append('voice_url', voice)
      } else {
        // Use predefined voice name as voice_url
        formData.append('voice_url', voice)
      }

      if (pocketUnreachable.current) {
        throw new Error('POCKET_TTS_UNREACHABLE')
      }

      let response: Response
      try {
        response = await fetch(`${serverUrl}/tts`, {
          method: 'POST',
          body: formData
        })
      } catch {
        // Network-level failure (server not running / wrong host). Remember it so
        // the rest of the session degrades quietly instead of erroring per message.
        pocketUnreachable.current = true
        console.warn(
          `TTS: Pocket TTS server unreachable at ${serverUrl}; speech is disabled. ` +
            'Run a Pocket TTS server there, set VITE_POCKET_TTS_URL, or set VITE_TTS_MODE=browser.'
        )
        throw new Error('POCKET_TTS_UNREACHABLE')
      }

      if (!response.ok) {
        throw new Error(`Pocket TTS API error: ${response.status} ${response.statusText}`)
      }

      message.audio = await response.arrayBuffer()
    },
    [config.pocketTts?.serverUrl, config.pocketTts?.voice]
  )

  // Generate audio for a specific message
  const generateAudioForMessage = useCallback(
    async (message: QueuedMessage) => {
      message.status = 'generating'
      console.log(`Generating audio for message ${message.id}`)

      try {
        if (config.mode === 'remote') {
          await generateRemoteAudio(message)
        } else if (config.mode === 'browser') {
          await generateBrowserAudio(message)
        } else if (config.mode === 'local') {
          await generateLocalAudio(message)
        } else if (config.mode === 'pocket') {
          await generatePocketAudio(message)
        } else if (config.mode === 'synthetic') {
          await generateSyntheticAudio(message)
        } else if (config.mode === 'headtts') {
          try {
            await generateTimedAudio(message)
          } catch (err) {
            // An upstream with no timing support is a configuration fact, not a
            // failure: fall through to plain streamed audio and let the acoustic
            // tier drive the mouth.
            if ((err as Error).message !== 'TIMED_TTS_UNSUPPORTED') throw err
            console.info('TTS: upstream reports no timings; using the acoustic lip-sync tier.')
            await generateRemoteAudio(message)
          }
        }
        message.status = 'ready'
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : 'Unknown error'
        // The unreachable-server case is already warned about once; don't spam
        // the console for every queued message.
        if (errMessage !== 'POCKET_TTS_UNREACHABLE') {
          console.error(`Error generating audio for message ${message.id}:`, error)
        }
        message.status = 'error'
        message.error = errMessage
      }
    },
    [config.mode, generateRemoteAudio, generateBrowserAudio, generateLocalAudio, generatePocketAudio, generateSyntheticAudio, generateTimedAudio]
  )

  // Process the queue sequentially
  const processQueue = useCallback(async () => {
    if (isProcessing.current) return
    isProcessing.current = true

    // Snapshot the barge-in generation this loop belongs to. If a stop happens
    // while we're awaiting generation/playback below, `generationRef` moves on and
    // every guard makes this stale loop bail without mutating the (now newer) queue
    // state — the root of the "all future speech silently dropped" bug (C1).
    const myGeneration = generationRef.current

    try {
      while (true) {
        if (generationRef.current !== myGeneration) break

        const nextMessage = messageQueue.current.find((msg) => msg.id === nextExpectedId.current)

        if (!nextMessage) {
          // No more messages to process
          break
        }

        // If message is pending, generate audio
        if (nextMessage.status === 'pending') {
          await generateAudioForMessage(nextMessage)
          // A barge-in during (possibly slow) generation invalidates this loop.
          if (generationRef.current !== myGeneration) break
        }

        // If message is not ready after generation, skip for now
        if (nextMessage.status !== 'ready') {
          if (nextMessage.status === 'error') {
            if (nextMessage.error !== 'POCKET_TTS_UNREACHABLE') {
              console.warn(`Skipping message ${nextMessage.id} due to error:`, nextMessage.error)
            }
            messageQueue.current = messageQueue.current.filter((msg) => msg.id !== nextMessage.id)
            nextExpectedId.current = nextMessage.id + 1
            continue
          } else if (nextMessage.status === 'generating') {
            // For local and pocket modes, wait a bit for generation to complete
            if (config.mode === 'local' || config.mode === 'pocket') {
              await new Promise((resolve) => setTimeout(resolve, 100))
              continue
            }
          }
          // For other cases, exit and let it be handled later
          break
        }

        // Play the message
        nextMessage.status = 'playing'
        console.log(`Playing message ${nextMessage.id}`)

        // Announce the utterance. Word timings start EMPTY on purpose: the old
        // code fabricated them here from a 150-WPM guess plus `Math.random()`
        // inter-word pauses, which drifted more than a second across a long
        // sentence. Real timings arrive below — from the engine's own boundary
        // events, or from a timing-capable upstream — and are published through
        // `getSpeechTimings()` as they land.
        speechTimingsRef.current = nextMessage.timings
          ? { ...nextMessage.timings, revision: ++timingRevisionRef.current }
          : null
        if (onSpeechStart) {
          onSpeechStart(nextMessage.text, nextMessage.timings ?? { words: [], wtimes: [], wdurations: [] })
        }

        try {
          // Handle different TTS modes for playback
          if (config.mode === 'browser') {
            await new Promise<void>((resolve, reject) => {
              const utterance = new SpeechSynthesisUtterance(nextMessage.text)
              utterance.rate = config.speed
              utterance.pitch = config.pitch
              // Use global volume if available, otherwise fall back to config volume
              utterance.volume = window.globalTTSVolume ?? config.volume

              // Parse voice gender from config and select appropriate voice
              const voices = cachedVoicesRef.current.length > 0 ? cachedVoicesRef.current : speechSynthesis.getVoices()
              const isMale = config.voice.toLowerCase().includes('male')
              const isFemale = config.voice.toLowerCase().includes('female')

              const findVoiceByLang = (lang: string, isMale?: boolean, name?: string) => {
                let filtered = voices.filter(voice => voice.lang === lang)
                if (typeof isMale === 'boolean') {
                  filtered = filtered.filter(voice =>
                    isMale
                      ? voice.name.toLowerCase().includes('male')
                      : voice.name.toLowerCase().includes('female')
                  )
                }
                if (name) {
                  filtered = filtered.filter(voice =>
                    voice.name.toLowerCase().includes(name.toLowerCase())
                  )
                }
                return filtered[0] || voices.find(voice => voice.lang === lang)
              }

              const preferredLangs = ['en-US', 'en-IN', 'en-GB'];
              let selectedVoice = undefined;

              if (isMale || isFemale) {
                const gender = isMale ? 'male' : 'female';
                selectedVoice = preferredLangs.map(lang => findVoiceByLang(lang, isMale)).find(Boolean)
                  || voices.find(v => v.name.toLowerCase().includes(gender));
                if (selectedVoice) {
                  utterance.voice = selectedVoice;
                  console.log(`TTS: Using ${gender} voice:`, selectedVoice.name, selectedVoice.lang);
                }
              }
              // Tier C lip-sync. `speechSynthesis` exposes no audio graph, so
              // there is no FFT to read — but it does report when each word
              // begins. That is real timing from the engine actually making the
              // sound, and it is what makes the DEFAULT install lip-sync at all.
              const timeline = boundaryTimelineRef.current
              timeline.reset(nextMessage.text)
              publishTimings(timeline)

              // `elapsedTime` units differ between engines; BoundaryTimeline
              // infers the unit for the utterance rather than guessing per event.
              utterance.onboundary = (event: SpeechSynthesisEvent) => {
                timeline.addBoundary(
                  event.charIndex ?? 0,
                  event.elapsedTime ?? 0,
                  (event as SpeechSynthesisEvent & { charLength?: number }).charLength
                )
                publishTimings(timeline)
              }

              utterance.onend = (event) => {
                timeline.finish(event.elapsedTime ?? 0)
                publishTimings(timeline)
                resolve()
              }
              utterance.onerror = (event) => reject(new Error(`Browser TTS Error: ${event.error}`))

              currentSpeechTextRef.current = nextMessage.text
              currentSpeechDurationRef.current = nextMessage.text.length * 0.065
              playbackStartTimeRef.current = performance.now() / 1000

              speechSynthesis.speak(utterance)
            })
          } else if (nextMessage.audio && nextMessage.audio.byteLength > 0) {
            await playAudioBuffer(nextMessage.audio, nextMessage.text)
          }
        } catch (playbackError) {
          console.error(`Error playing message ${nextMessage.id}:`, playbackError)
        }

        // If a barge-in cut in during playback (stopSpeaking stops the active
        // source, which resolves the await above), abandon this loop WITHOUT
        // advancing the cursor or mutating the queue — the newer generation owns
        // that state now. Advancing here is exactly what desynced `nextExpectedId`
        // from newly-enqueued ids and silently dropped all later speech (C1).
        if (generationRef.current !== myGeneration) break

        // Mark as completed and remove from queue
        nextMessage.status = 'completed'
        messageQueue.current = messageQueue.current.filter((msg) => msg.id !== nextMessage.id)
        nextExpectedId.current = nextMessage.id + 1
      }

      // Call onSpeechEnd only when queue is empty (and this loop is still current).
      if (generationRef.current === myGeneration && onSpeechEnd && messageQueue.current.length === 0) {
        currentSpeechTextRef.current = ''
        bumpRevision()
        onSpeechEnd()
      }
    } catch (error) {
      console.error('Queue processing error:', error)
      if (generationRef.current === myGeneration && onSpeechEnd) {
        currentSpeechTextRef.current = ''
        bumpRevision()
        onSpeechEnd()
      }
    } finally {
      // Only the current generation owns the processing flag; a stale loop must not
      // clear it out from under the loop a post-barge-in speak() just started.
      if (generationRef.current === myGeneration) {
        isProcessing.current = false
      }
    }
  }, [
    generateAudioForMessage,
    config.speed,
    config.pitch,
    config.volume,
    config.mode,
    onSpeechStart,
    playAudioBuffer,
    onSpeechEnd,
    bumpRevision
  ])

  // Add message to queue and assign ID
  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return null

      const messageId = globalId++
      const cleanedText = cleanText(text)

      if (!cleanedText.trim()) return messageId

      const queuedMessage: QueuedMessage = {
        id: messageId,
        text: cleanedText,
        status: 'pending'
      }

      messageQueue.current.push(queuedMessage)
      console.log(`Queued message ${messageId}:`, cleanedText.substring(0, 50))

      // For local and pocket modes, start generating all pending messages immediately
      if (config.mode === 'local' || config.mode === 'pocket') {
        const allPendingMessages = messageQueue.current.filter((msg) => msg.status === 'pending')
        allPendingMessages.forEach((message) => {
          generateAudioForMessage(message) // Don't await - let them generate in parallel
        })
      }

      // Start processing if not already running
      if (!isProcessing.current) {
        processQueue()
      }
      bumpRevision()

      return messageId
    },
    [processQueue, config.mode, generateAudioForMessage, bumpRevision]
  )

  const stopSpeaking = useCallback(() => {
    // Invalidate any in-flight queue loop first: its post-await bookkeeping must not
    // run against the queue state we're about to reset (C1).
    generationRef.current++

    if ('speechSynthesis' in window) {
      speechSynthesis.cancel()
    }

    // Actually stop the audio playing right now (pocket/local/remote modes).
    // Clear the ref BEFORE stop() so the source's onended (whether it fires
    // synchronously or later) sees it's no longer active and only resolves its
    // promise — letting the stale queue loop resume and bail cleanly (H4/C1).
    const active = activeSourceRef.current
    activeSourceRef.current = null
    activeContextRef.current = null
    analyserNodeRef.current = null
    currentSpeechTextRef.current = ''
    currentSpeechDurationRef.current = 0
    playbackStartTimeRef.current = 0
    // Drop the schedule too: a stale one would keep shaping the mouth through
    // the words the user just interrupted.
    speechTimingsRef.current = null
    if (active) {
      try {
        active.stop()
      } catch {
        // Not started yet / already stopped — safe to ignore.
      }
      try {
        active.disconnect()
      } catch {
        // ignore
      }
    }

    // Terminate worker if it exists
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }

    // Clear the queue and resync the expected-id cursor to the next id that will be
    // assigned, so a fresh speak() right after a barge-in still matches and plays (C1).
    messageQueue.current = []
    nextExpectedId.current = globalId
    isProcessing.current = false

    // Call speech end callback when speech is stopped
    if (onSpeechEnd) {
      onSpeechEnd()
    }
    bumpRevision()
  }, [bumpRevision, onSpeechEnd])

  // Keep the voice list warm so the first utterance can honour config.voice.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const refresh = () => {
      const voices = speechSynthesis.getVoices()
      if (voices.length > 0) cachedVoicesRef.current = voices
    }
    refresh()
    speechSynthesis.addEventListener?.('voiceschanged', refresh)
    return () => speechSynthesis.removeEventListener?.('voiceschanged', refresh)
  }, [])

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
      }
    }
  }, [])

  const getQueueStatus = useCallback(() => {
    return {
      queueLength: messageQueue.current.length,
      isProcessing: isProcessing.current,
      nextExpectedId: nextExpectedId.current,
      messages: messageQueue.current.map((msg) => ({
        id: msg.id,
        status: msg.status,
        text: msg.text.substring(0, 50) + (msg.text.length > 50 ? '...' : '')
      }))
    }
  }, [])

  const getAnalyser = useCallback((): AnalyserNode | undefined => {
    return analyserNodeRef.current ?? undefined
  }, [])

  /**
   * Timings for the utterance currently playing, or null when nothing is.
   * See SpeechTimings — this is where all three lip-sync tiers meet.
   */
  const getSpeechTimings = useCallback((): SpeechTimings | null => {
    return speechTimingsRef.current
  }, [])

  const getCurrentSpeechInfo = useCallback(() => {
    return {
      text: currentSpeechTextRef.current,
      duration: currentSpeechDurationRef.current,
      startTime: playbackStartTimeRef.current,
      audioContext: activeContextRef.current
    }
  }, [])

  const state = useMemo(() => ({
    isSpeaking: isProcessing.current,
    audioQueue: messageQueue.current.length
  }), [revision])

  const actions = useMemo(
    () => ({
      speak,
      stopSpeaking,
      playAudioBuffer,
      getQueueStatus,
      getAnalyser,
      getCurrentSpeechInfo,
      getSpeechTimings
    }),
    [speak, stopSpeaking, playAudioBuffer, getQueueStatus, getAnalyser, getCurrentSpeechInfo, getSpeechTimings]
  )

  return useMemo(
    () => ({
      state,
      actions
    }),
    [state, actions]
  )
}
