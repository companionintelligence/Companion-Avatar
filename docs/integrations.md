# Integrations: face-to-voice, AIAvatarKit and OpenSourceAvatars

Three outside projects connect to Avatar Companion in different ways. Each one is optional and off by default.

## face-to-voice (live talk)

Already integrated. A visitor can talk with the companion out loud through a LiveKit room, using the character agent from
[face-to-voice](https://github.com/OliverA100/face-to-voice) (MIT). Turn it on with `APP_TALK_ENABLED` on the server and
`VITE_TALK_ENABLED` in the web build. Environment variables, limits and the open items are in
[face-to-voice-talk.md](face-to-voice-talk.md).

- A visitor is live only once the agent is in the room. If the agent does not join within 20 seconds, the conversation
  ends with `agent_absent`.
- Not vendored: face-to-voice's GNM head, its HairCS hair styles (CC BY-NC 4.0), and its beard guides (a licence conflict
  upstream).
- Not yet run against a live LiveKit room or a live agent.

## AIAvatarKit (chat backend)

[AIAvatarKit](https://github.com/uezo/aiavatarkit) (Apache-2.0) can be the chat backend. The proxy calls its
OpenAI-compatible Chat Completions endpoint, `/v1/chat/completions`, as an upstream:

```bash
APP_UPSTREAM=aiavatarkit
APP_AIAVATARKIT_URL=http://aiavatarkit:8000/v1
APP_AIAVATARKIT_TOKEN=<one stable identifier for this deployment>
```

Read these before you use it:

- **The token is an identifier, not a credential.** AIAvatarKit keys its conversation on it and does not check it. The
  proxy sends the same value for every visitor, so all visitors share one conversation. That suits one person running their
  own companion. Several visitors would each need their own stable value, which the app does not send yet.
- **Keep AIAvatarKit private.** Its endpoint has no authentication of its own. Run it on a private network that only the
  proxy can reach.
- **It answers from its own system prompt.** It reads the newest user message and ignores the rest of the history the app
  sends, so the app's persona text has no effect on that path.
- **Text only.** Face and animation requests from AIAvatarKit's other channels do not come through this endpoint.
- **Experimental upstream.** AIAvatarKit's own adapter logs a warning that it should not be used in production.
- **Nothing is copied.** The proxy speaks only the HTTP contract, and no AIAvatarKit code is vendored.

## OpenSourceAvatars (CC0 avatars)

The [OpenSourceAvatars](https://opensourceavatars.com) registry lists VRM avatars. Its
[open-source-avatars](https://github.com/ToxSam/open-source-avatars) repository holds the data, and
[osa-gallery](https://github.com/ToxSam/osa-gallery) is the website. The 100Avatars R1–R3 series is CC0 public domain. Other
collections carry their own licences. The data repository's licence is listed as "Other".

Three avatars from the R1 series are named in `CC0_AVATAR_SOURCES`
(`packages/core/src/components/scene/avatar/cc0Avatars.ts`):

- `osa: Devil`
- `osa: Polydancer`
- `osa: Rose`

Type one of these names into the avatar box in Settings. The browser then fetches the VRM from Arweave. Nothing is bundled,
so each one needs a connection, and the Arweave gateway sees the visitor's address. They are not in the built-in picker.

- Browser loading works for these three: each one answers from `arweave.net` with `Access-Control-Allow-Origin: *`.
- osa-gallery's README says its website code is MIT, but the repository has no LICENSE file. Nothing from that code is used.
  Only the CC0 avatar files are referenced.
