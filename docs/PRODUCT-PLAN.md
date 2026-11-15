# Spatial Companion — Product Improvement & Launch Plan

> Part of the public Companion-Avatar repository, under its PolyForm Noncommercial License 1.0.0.
> Owner: Liam Broza · Drafted 2026-07-04 · Horizon: H2 2026 → 2027

---

## 1. Executive summary

**Spatial Companion** (`CI-Spatial-Companion-WebXR`) is Companion Intelligence's embodied,
voice-first client: a lip-synced 3D VRM avatar you talk to, rendered in AR/VR on Meta Quest and
Apple Vision Pro, and in any WebGPU/WebGL browser or iPad. It is the **face** of the CI platform —
the surface where the appliance's private memory and local models become a person you can look at
and speak with.

This plan takes the app from "impressive demo" to a trusted virtual-being platform in four moves:

1. **Code foundation present; product gate incomplete.** Runtime-configurable LLM connection, a
   same-origin BFF, canonical CI branding, a native animation pipeline, and a broad automated test
   suite are in the current source. The strict embodied journey, memory contract, privacy controls,
   and sustained XR evidence are not yet release-ready.
2. **Trustworthy Companion Loop (Q3 2026).** Connect CI-Server (Companion Memory), make continuity
   explainable and deletable, and prove that voice, interruption, face, body, and recovery work in
   the canonical web/XR journey.
3. **Perception & presence (Q4 2026 → 2027).** Add grounded vision, gaze, locomotion, and in-world
   interaction only after the trust loop passes its alpha gates.
4. **Safe agency and scale (2027).** Add typed tools, consented multi-step actions, personalization,
   and cross-channel distribution behind visible receipts, cancellation, and performance gates.

The strategic bet: **the companion is the product; trust is the moat.** Everyone can ship a chat
avatar. CI can ship one that runs on the owner's device, remembers with evidence and control, and
lives reliably in the owner's space.

---

## 2. Where we are today (post-rework baseline)

**Present in the current code baseline:**

| Area | State |
|------|-------|
| Rendering | VRM avatar (three.js r182 / R3F 9 / three-vrm 3.5), WebGL default + opt-in WebGPU MToon |
| Voice | STT + VAD + TTS with viseme lip-sync, barge-in |
| Animation | Native `crossFadeTo` + additive scaffolding + event-driven cycling |
| LLM | Local (Ollama/WebLLM) + **new same-origin BFF proxy** (multi-upstream, streaming, abortable) |
| Config | **Runtime `/config.json`** + in-app Settings; no rebuild to repoint |
| XR | WebXR AR + VR sessions (Quest / Vision Pro / XREAL) + browser/iPad fallback |
| Brand | Canonical CI phthalo-mist tokens + Manrope |
| Distribution | GHCR images + **CI-Marketplace manifest** (runtipi) |
| Quality | 41 test files / 632 passing tests on the gauntlet branch; L3/L5 harness coverage; curated L6 demo media; strict L4 embodiment assertions still skipped |

**What is still missing or unproven:** the canonical client does not yet have CI-Server memory
wiring or memory provenance/forget controls; the BFF has no launched tool registry; the vanilla
client's memory/perception/tools are a separate reference surface; strict canonical-app embodiment
assertions are skipped; and there is no release-gated 20-turn browser soak or sustained on-device XR
performance run. The current source already includes important liveness corrections, including a
continuous render loop and guarded TTS barge-in; the older animation review must be reconciled with
source before it is used as a current defect list.

---

## 3. Product vision & positioning

**Vision.** A companion that is *present* — embodied in your space, aware of your world through
sight and voice, grounded in a private memory of your life, and useful because it can act. Inspired
by Google Astra and Meta AI, but **local-first and yours**.

**Positioning.**

> *"The AI companion that lives on your device, in your space, and only in your trust."*

| Axis | Spatial Companion | Cloud avatars (e.g. hosted VTubers, character apps) |
|------|-------------------|------------------------------------------------------|
| Where it runs | Your appliance / device (local models) | Someone else's cloud |
| What it remembers | Your private CI memory, on-prem | Their servers |
| Where it appears | AR/VR in your room + browser | 2D app window |
| Who owns the data | You | The vendor |

**Platform role.** Spatial Companion is the **Client-layer flagship**: Capture → Portal → **Server
(memory)** ← Hub ← Marketplace, with Spatial Companion as the human-facing embodiment of Server +
Hub inference. It is the demo that sells the appliance.

---

## 4. Target users & use cases

1. **Appliance owners (primary).** People who bought into CI for private, local AI. The companion is
   the "wow" that justifies the box. Use: daily check-ins, hands-free Q&A over their own memory,
   ambient presence.
2. **Vision Pro / Quest early adopters.** Spatial-computing enthusiasts who want a resident AI
   character. Use: an in-room companion, spatial dashboards, voice control.
3. **Developers / integrators.** The BFF and the staged vanilla client make it a reference
   embodiment for CI apps; the canonical tool registry remains a Phase 3 deliverable.
4. **Prospects / demos (GTM).** The browser build at a public URL is the top-of-funnel proof.

---

## 5. Improvement roadmap (phased)

Ratings: **P0** must-have · **P1** high-value · **P2** differentiator.

### Phase 0 — Foundation & evidence alignment (code present; product gate incomplete)

Runtime config, BFF, branding, animation refactor, marketplace packaging, unit coverage, and the
visual harness are present. A curated L6 demo now records the canonical web activation/response
journey and the avatar harness media, while remaining explicit about demo-only boundaries. Before calling this phase done, reconcile
`docs/ANIMATION-SYSTEM-REVIEW.md` and `docs/TESTING-PIPELINE.md` with the current source, and add
the missing canonical-app embodiment probe. The gauntlet branch currently passes 41 test files / 632
tests and the recursive build; that is strong foundation and demo evidence, not a complete Being Test pass.

### Phase 1 — Trustworthy Companion Loop (Q3 2026) — "it knows me and doesn't pretend"

- **P0 · CI-Server memory contract.** Implement the `ci-server` BFF adapter (session/auth, chat,
  retrieval, timeout, and streaming) from the stub in `apps/proxy/src/upstreams/ciServer.ts`.
  Every memory-grounded claim must carry a source identifier and confidence/uncertainty state.
- **P0 · Connection and five-minute activation.** Ship a first-run wizard, `/api/health` diagnostics,
  provider/model guidance, microphone consent, and a "say hi" moment. Measure p90 install → first
  grounded spoken answer, not install → generic chat.
- **P0 · Connection truth surface.** Test chat, TTS, and CI-Server separately before the first
  answer; show reachable/unreachable, memory empty/grounded, and the next recovery action in the
  onboarding/settings flow. The health endpoint must drive a user decision, not sit as an unused
  diagnostic route. Model this as an explicit activation state machine — `unverified`, `demo-only`,
  `chat-only`, or `memory-ready` — and carry the state into the first response.
- **P0 · Demo/production separation.** Keep scripted responses for deterministic demos and tests,
  but do not silently use `llm_provider: 'script'` or directed fallback responses as evidence of a
  connected private-memory companion. Label `demo-only` explicitly, never count it as grounded
  activation, and make a failed proxy turn a visible recoverable connection state.
- **P0 · Embodied recovery gate.** Keep the current continuous render and TTS barge-in fixes under
  regression coverage; add canonical-app assertions for active clip, emotion, viseme activity,
  interruption, avatar switching, and recovery. Resolve the highest-impact remaining gaze, face
  reset, and avatar-switch defects before adding more animation features.
- **P0 · Memory privacy controls.** Make retention explicit; let the owner inspect why a memory was
  used, see uncertainty, approve or reject retention, stop a turn/tool request, and forget/delete a
  memory. Telemetry opt-out is a separate control and does not satisfy this requirement.
- **P0 · Reliability evidence.** Run a 20-turn browser soak and a sustained Quest/XR session with
  no frozen animation, dead speech, stale identity, runaway memory, unsafe request, or unbounded
  client cost. Keep the existing 72-FPS Quest target as a release gate.
- **P1 · Spatial audio and response pacing.** Position TTS at the avatar's head in XR and expose
  latency/interruptibility behavior as a tested policy.
- **Exit criteria:** p90 first grounded spoken answer ≤ 5 minutes; 50/50 interruption trials stop
  audio and mouth motion without orphaned speech; 20 turns complete with source-labelled memory
  claims; delete is observable in the next follow-up; canonical browser and target XR pass the
  release evidence run.

### Phase 2 — Perception & Presence (Q4 2026) — "it sees and shares my space"

- **P1 · Grounded passthrough vision.** Quest passthrough / WebXR camera access → local VLM through
  the BFF, with visible capture state, evidence/uncertainty, refusal when the frame is unusable, and
  a deletion boundary for captured frames. “What am I looking at?” must be a real turn, not a mode
  switch that strands the user in a demo.
- **P1 · Gaze & attention.** Extend `emote/gazeService` to eye/head tracking input and cover GLB
  and VRM rig contracts with real-app tests; the avatar should look where the user looks and recover
  when tracking is lost.
- **P1 · Locomotion & richer animation.** Add walk/turn clips and retargeting only with the same
  interruption, body-state, and performance gates as speech.
- **P1 · In-world XR chat panel & scene actions.** Recenter/scale/enter already exist; make the
  chat, consent, privacy, and action-result controls spatial and legible.
- **Exit criteria:** on Quest 3 passthrough, a seeded desk task returns a grounded answer with an
  evidence indicator; unsupported views are acknowledged; the avatar faces the user after tracking
  changes; and the target device sustains the agreed frame-rate gate.

### Phase 3 — Safe Agency & Personalization (Q1–Q2 2027) — "it can act and it's mine"

- **P0 · Typed tool registry & action receipts.** Let the companion call CI apps/tools through a
  versioned BFF registry only after user confirmation for side effects. Show a plan, scope, progress,
  cancellation, timeout, and visible result receipt; never convert a text suggestion into a hidden
  side effect.
- **P1 · Cross-channel memory policy.** Extend the Phase 1 source/consent/delete model across Hub,
  browser, and XR clients; preserve provenance when context moves between channels.
- **P2 · Avatar personalization.** Swap VRM models, outfits, voices, and personality presets only
  after the identity/continuity tests prove that a model change does not strand memory or embodiment.
- **P1 · Agent modes & prompt templates.** Task-scoped behaviors with explicit boundaries and a
  visible return to companion mode.
- **Exit criteria:** the companion completes a seeded multi-step task with confirmation before each
  side effect, produces a visible receipt, recovers from a tool failure, and lets the user change
  face/voice without stale identity or lost controls.

### Phase 4 — Performance & Scale (cross-cutting from Q3 2026)

- **P1 · Runtime quality slider + auto-throttle**, **foveated rendering + LOD**, **performance HUD**,
  and **release regression tests**. These are not a late cleanup: they gate every browser/XR alpha
  and every new perception/tool capability.

---

## 6. Technical foundation & platform integration

- **BFF is the integration spine.** Every capability above (memory, vision, tools) is a new
  `UpstreamAdapter` or route in `apps/proxy` — one seam, uniformly tested and streamed. Prioritize
  auth/session boundaries, timeouts, cancellation, retries, safe tool receipts, and observability
  before piling features on.
- **CI-Server contract.** Define and version the Server chat/retrieval/memory API with source ids,
  confidence/uncertainty, retention consent, forget/delete, and post-delete behavior. The companion
  is its first serious consumer; coordinate the contract through CI-Engineering.
- **Conversation event contract.** Extend the normalized BFF request/event types beyond
  messages/chunk/done/error to carry owner/session context, memory evidence, uncertainty,
  retention decisions, and action-confirmation requirements. A successful UI turn must mean a
  connected provider answered, not that a demo fallback rendered text.
- **Canonical versus vanilla client.** `apps/vanilla-client` currently contains a useful independent
  memory/perception/tool prototype. Share contracts before promoting those capabilities to the
  canonical React/BFF product; until then, label it as a reference surface rather than counting it
  as shipped platform functionality.
- **Two-image container.** Keep the SPA + proxy split; add a healthcheck and later a VLM route, with
  explicit data-retention boundaries for audio, camera frames, prompts, and memory events.
- **Testing debt to retire next:** reconcile stale animation/testing docs; add a non-production
  embodiment debug contract; cover avatar switching, gaze, face reset, interruption recovery, and
  real-app L4 assertions; then add a 20-turn browser soak, Quest/AVP device matrix, and performance
  regression gates.
- **Known cleanups:** source-level liveness fixes are present, but the old review still reports them
  as defects. Documentation drift is a release blocker until the evidence ledger and current source
  agree.

---

## 7. Launch plan (go-to-market)

### 7.1 Distribution channels (in priority order)
1. **CI-Marketplace (appliance)** — *primary.* One-click install on the owner's box; the companion
   ships as the flagship app. Manifest + images ready; needs the screenshot gate + Server memory to
   be truly compelling.
2. **Public web build (Cloudflare Pages)** — top-of-funnel demo live at `avatar.ci.computer`.
   Bring-your-own-Ollama via the Settings panel; zero install.
3. **Apple Vision Pro (App Store)** — via the existing WebSpatial packaging (`apps/vision-pro`).
   High-signal credibility channel; gated on App Review + a privacy policy.
4. **Meta Quest (App Lab → Store)** — WebXR PWA / packaged; the standalone-headset audience.

### 7.2 Launch phases
| Stage | When | Gate | Audience |
|-------|------|------|----------|
| **Private alpha** | Now → end Q3 2026 | Trustworthy Companion Loop: memory contract, controls, embodied recovery, 20-turn/XR evidence | Owner + insiders on the fleet |
| **Marketplace** | Q4 2026 | Screenshot gate, diagnostics, privacy controls, spatial audio, release evidence | CI appliance owners |
| **Public web demo** | Q4 2026 | Perf pass, brand polish | Prospects, spatial-computing community |
| **Vision Pro / Quest** | Q1–Q2 2027 | Store review, privacy policy, perf | XR early adopters |
| **GA across channels** | 2027 | Tools + personalization | All CI users |

### 7.3 Positioning & messaging
- **Hook:** "Your AI, embodied — private, in your space."
- **Proof points after the relevant gates pass:** runs locally (no cloud claim unless the deployment
  proves it), remembers *your* life with sources and control, sees your room with visible grounding,
  and lives in AR/VR and the browser without losing voice or identity.
- **Assets:** a 30–60s spatial demo reel (Quest passthrough + Vision Pro), a browser try-it link, a
  one-pager, and marketplace screenshots. The current evidence package includes a roughly 20s silent
  canonical web demo plus avatar motion stills/clips; it must not be marketed as memory-grounded
  until the Phase 1 trust contract passes. (Route through the `ci-marketing` skills / CI brand kit.)

### 7.4 Metrics / KPIs
- **Activation:** p90 install → first grounded spoken answer (≤ 5 min target); zero cases where a
  scripted fallback is counted as connected activation.
- **Continuity trust:** % of memory claims with source/uncertainty labels; seeded contradiction rate;
  post-delete recurrence rate (target zero).
- **Retention:** weekly returning companions per appliance.
- **Presence:** XR-session share vs. browser; median session length in XR.
- **Embodiment:** interruption success across 50 trials; orphaned mouth-motion count; recovery time;
  L4 canonical-app pass rate.
- **Performance:** sustained Quest 3 FPS (target ≥ 72) and AVP; TTS first-breath and stop latency;
  20-turn browser/XR soak failure rate.
- **Agency safety:** confirmation rate before side effects, visible receipt rate, cancellation success,
  and tool timeout recovery.
- **Funnel:** web-demo → appliance-owner conversions.

### 7.5 Pre-launch checklist (per channel)
- [ ] CI-Server memory adapter live and demoable (Phase 1)
- [ ] Source ids, confidence/uncertainty, consent, inspect, forget/delete, and post-delete behavior verified
- [ ] Canonical-app embodiment assertions live; no strict Being Test is hidden behind `test.skip`
- [ ] 50 interruption trials plus 20-turn browser and sustained XR soak recorded
- [ ] Current animation/testing docs reconciled with the source and test results
- [ ] Canonical BFF tool registry has confirmation, cancellation, timeout, and visible result receipts
- [ ] Marketplace screenshot gate captured on a CI OS device (fleet QA)
- [ ] Both GHCR images published + pinned
- [ ] Privacy policy URL (mic + camera + memory data handling)
- [ ] Perf pass on target headsets
- [ ] Demo reel + try-it link + one-pager
- [ ] App Store / App Lab metadata + review submission

---

## 8. Milestones & timeline

| Quarter | Milestone |
|---------|-----------|
| **Q3 2026** | Foundation/evidence alignment · CI-Server trust contract · onboarding + controls · **private alpha gate** |
| **Q4 2026** | Spatial audio · on-device perf evidence · **Marketplace** · **public web demo** · grounded-vision spike |
| **Q1 2027** | Confirmed tool registry · gaze + locomotion · **Vision Pro submission** · personalization v1 |
| **Q2 2027** | Quest Store · cross-channel memory policy · safe agency hardening · **cross-channel GA** |

---

## 9. Risks & mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| CI-Server memory API not ready | Blocks the core differentiator | Prioritize the Server contract now; ship provider-config value in parallel |
| Product claims outrun evidence | Users experience a demo, not a being | Make the six Being Tests and source-linked evidence the alpha release gate |
| Stale review/test documentation | A fixed path looks broken while real gaps stay hidden | Reconcile docs in the same change as every critical fix and record the command/result |
| Divergent vanilla and canonical clients | Memory/tools behave differently by surface | Share versioned contracts or label the vanilla client experimental until convergence |
| Standalone-headset performance | XR feels bad → churn | Phase 4 perf work early; quality slider + auto-throttle; test on-device |
| WebXR passthrough-camera limits | Vision feature slips | Spike early; fall back to device-native camera bridges where WebXR can't |
| App Store review (privacy, mic/camera) | Delays AVP/Quest launch | Privacy policy + on-device story up front; TestFlight/App Lab first |
| Model RAM on appliances | Crashes on install | Default to small models (gemma3:1b); RAM-aware model picker; clear guidance |
| Scope creep across 4 phases | Nothing ships | Ship the Trustworthy Companion Loop first; make vision/tools prove the same gates |

---

## 10. Immediate next actions (next 2–4 weeks)

1. **Reconcile the evidence docs** with the current source: close stale C1/C2/H2 claims, record remaining
   gaze/face/avatar-switch risks, and make the L4 gap explicit.
2. **Spec the CI-Server trust contract** with CI-Engineering; implement `ciServer.ts` with provenance,
   uncertainty, consent, forget/delete, cancellation, and health diagnostics.
3. **Build the connection wizard + activation state** over `/api/health`, then run the seeded
   five-minute first-conversation journey in the canonical browser surface. The first response must
   expose whether it is demo-only, chat-only, or memory-ready.
4. **Add canonical embodiment instrumentation and gates:** avatar switch, gaze/face recovery,
   interruption, 20-turn soak, and Quest/XR performance evidence.
5. **Only after the loop passes,** capture the Marketplace screenshot/demo reel and publish the public
   try-it story; do not market unverified memory, vision, or tool behavior as shipped.

> The companion is closer than it looks: the hard infrastructure (embodiment, voice, local LLM,
> runtime config, distribution) now exists. The remaining work is **making trust observable and
> recoverable, connecting it to memory with control, then giving it sight and safe agency** — and
> telling only the part of that story the release evidence can support.
