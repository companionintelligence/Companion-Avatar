import { useSimpleStore } from '@hexafield/simple-store/react'
import { useMemo } from 'react'

import { startTalk, stopTalk, TalkStore, type TalkReason, type TalkState } from './talkService'

export interface TalkControls {
  state: TalkState
  reason: TalkReason | null
  /** Begin a conversation. Never throws: a failure shows up in `state` and `reason`. */
  start: () => void
  /** End the conversation, or cancel one that is still connecting. */
  stop: () => void
}

/** The live-talk state, with controls for a button. Re-renders when the session changes. */
export function useTalkService(): TalkControls {
  const [snapshot] = useSimpleStore(TalkStore)

  return useMemo(
    () => ({
      state: snapshot.state,
      reason: snapshot.reason,
      start: () => {
        startTalk().catch(() => undefined)
      },
      stop: () => {
        void stopTalk()
      }
    }),
    [snapshot]
  )
}
