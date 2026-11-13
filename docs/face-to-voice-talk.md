# Talk live (face-to-voice character agent)

An optional feature: a visitor talks with the companion out loud. It is **off by default** and needs no live services to
build or test. Nothing in it has been run against a live LiveKit server or a live agent yet; see [Unverified](#unverified).

## What is integrated

The LiveKit character agent from [face-to-voice](https://github.com/OliverA100/face-to-voice), pinned at
`f26e6f34fb20` (MIT). A visitor who turns on "Talk live" joins a LiveKit room with a microphone. The agent answers in an
ElevenLabs voice, and that audio plays through the page's shared audio graph.

- `apps/proxy/src/routes/talk.ts`: `POST /api/talk/token` mints a 60-second join token for a new room and dispatches the
  agent into it. The dispatch metadata carries the voice, instructions, greeting and length cap. The response carries the
  join details (URL, token, room, identity and length), never the API secret.
- `apps/proxy/src/talk/`: the built-in persona, and the check the dispatch metadata passes before it is signed.
- `packages/core/src/services/talk/`: joins the room, publishes the microphone, routes the agent's audio into the shared
  audio graph, and ends the session when the agent sets `ftv.end`, when the agent leaves the room, or when the room drops.
  The states are `idle`, `connecting`, `live`, `ended` and `error`. `ended` and `error` carry a fixed reason code, never
  error text.
- `ControlOverlay`: a "Talk live" control, rendered only when `VITE_TALK_ENABLED=true`.

## What is not integrated

- **The GNM head** (face-to-voice's 3D head model): not vendored, not imported.
- **The 223 HairCS hair styles**: CC BY-NC 4.0, so non-commercial only. Not imported.
- **The beard guides**: the upstream NOTICE flags a licence conflict (the pack page says CC0, the file headers say
  AGPL-3.0). Not imported.
- **Upstream code**: none is vendored. The mood table and the safety rules are adapted, with attribution below.
- **Lip-sync during a live reply**: wired. `AvatarModel` reads `ttsService.actions.getAnalyser()`, which is set only while
  TTS is playing, and falls back to `talkAnalyser()` from `services/talk/talkService` while a conversation is live. The
  mouth follows the agent's voice in code. Not yet checked against a live agent.

## Environment variables

Names and purpose only. Values belong in the deployment's secret store, never in this repository or in these docs.

Server (`apps/proxy`):

| Variable | Purpose |
|---|---|
| `APP_TALK_ENABLED` | `true` turns talk on. Any other value leaves it off, and the route answers 503 `talk_disabled`. |
| `APP_LIVEKIT_URL` | The LiveKit server's URL, which the browser joins. It must be `wss://`. |
| `APP_LIVEKIT_API_KEY` | Identifies the LiveKit project that signs the join tokens. |
| `APP_LIVEKIT_API_SECRET` | Signs the join tokens. A secret: never returned or logged. |
| `APP_TALK_VOICE_ID` | The ElevenLabs voice the agent speaks with. Required when talk is on. |
| `APP_TALK_AGENT_NAME` | The agent the job is dispatched to. Default `ftv-character`, the name the upstream agent registers under. |
| `APP_TALK_MAX_SECONDS` | Length of one conversation. Default 180, capped at 300. |
| `APP_TALK_MAX_CONCURRENT` | Tokens admitted per five minutes. Default 2. Approximate; see [Limits](#safety-rules-and-limits). |
| `APP_TALK_INSTRUCTIONS` | Optional. Replaces the built-in companion instructions, rules included. At most 12,000 characters. |

Web build (`packages/core`):

| Variable | Purpose |
|---|---|
| `VITE_TALK_ENABLED` | `true` shows the "Talk live" control. |
| `VITE_API_BASE` | Native and desktop shells only: the proxy's origin, so `/api/talk/token` is reached. The proxy must list the shell's origin in `APP_ALLOWED_ORIGINS`. |

When `APP_TALK_ENABLED=true`, startup refuses to proceed if a required variable is missing or malformed. The error names the
variable and never its value.

## Running the upstream agent

Run the agent at the pinned commit, following its `agent/README.md` at that commit. Point it at the same LiveKit project as
`APP_LIVEKIT_URL`.

- The agent registers as `ftv-character`, the name in its code (`AGENT_NAME` in `agent/src/main.ts`). Leave
  `APP_TALK_AGENT_NAME` at its default unless the agent is changed to register under another name.
- It reads `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. It also needs `ELEVENLABS_API_KEY` and
  `ANTHROPIC_API_KEY`. The optional names are `CLAUDE_MODEL_TALK` and `TTS_MODEL_TALK`. These are the upstream's own
  settings, separate from this app's keys.
- It needs Node 24 or later and pnpm, and it runs its TypeScript directly.
- A worker registers with the whole LiveKit project, so a worker on a laptop can take conversations meant for the live
  site. Use a separate LiveKit project for development.
- For a run with no paid calls, the upstream has a canned agent (`FTV_MOCK_AGENT=1`) that works against a local
  `livekit-server --dev`.
- The upstream sets `record: false` in its session options (`agent/src/main.ts`), so LiveKit does not record the session.
  This app does not check that setting.

## Safety rules and limits

The default instructions (used unless `APP_TALK_INSTRUCTIONS` is set) tell the character to:

- say plainly that it is an AI when sincerely asked;
- never claim to be, or imitate, a real or famous person;
- stay family-friendly, and refuse harmful, sexual, hateful, dangerous or illegal requests;
- not ask for personal details;
- give no medical, legal or financial advice beyond common sense.

Limits, enforced by this server and by the agent:

- The token is valid for 60 seconds, which is enough to join. Its grant allows one microphone and nothing else: no camera,
  no screen, no data channel.
- The room holds two participants. It closes 30 seconds after it is created if nobody joins, and 10 seconds after the
  last participant leaves.
- A conversation runs at most `APP_TALK_MAX_SECONDS`, and never more than 300. The agent says goodbye before the end.
- At most `APP_TALK_MAX_CONCURRENT` tokens are issued in any five-minute window. This is approximate by design: it counts
  tokens rather than live conversations, and it is kept per process, so each replica counts separately.

This app keeps nothing from a conversation. The proxy holds only the times of recent token requests, in memory. The
browser keeps no audio or transcript; its talk state lives in memory for the page only.

## Attribution

Adapted from face-to-voice (https://github.com/OliverA100/face-to-voice), MIT License, Copyright (c) 2026 Oliver Hassan.

- `apps/proxy/src/talk/persona.ts`: the mood table is adapted from `web/src/lib/server/emotion.ts`, and the safety rules
  follow `docs/responsible-ai.md` and `web/src/lib/server/characterPrompt.ts`.
- `apps/proxy/src/talk/metadata.ts`: the job-metadata shape follows `agent/src/metadata.ts`.

The full MIT notice is in the upstream `LICENSE` file at the pinned commit.

## Unverified

- No live LiveKit run has happened. Token claims are checked by decoding them in tests. The upstream agent has not been run.
- The proxy image runs under Deno, and `livekit-server-sdk` is now one of its dependencies. The token path was smoke-tested
  under Deno 2.9.7 with a flat copy of the same package versions. The image now installs them from `pnpm-lock.yaml`
  with `pnpm deploy`; that install has not been run in a container build.
- Browser audio routing is tested with fakes for `livekit-client` and the audio graph. It has not been heard in a real
  browser.
- Lip-sync is not wired (see above).
- If the agent never joins, the visitor stays in the live state until they press "End talk". There is no join timeout yet.
- The "Talk live" control has not been checked visually. It is hidden unless `VITE_TALK_ENABLED=true`.
- The concurrency limit is approximate, by design.
