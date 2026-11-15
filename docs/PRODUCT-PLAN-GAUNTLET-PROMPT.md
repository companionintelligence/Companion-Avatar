# Product-plan Gauntlet Loop

> Part of the public Companion-Avatar repository, under its PolyForm Noncommercial License 1.0.0.

This is a ready-to-paste prompt for Codex or Claude Code. It is adapted from the
Gauntlet Loop method and grounded in this repository's existing product plan,
animation review, visual harness, and multi-agent adversarial review practice.

## Ready-to-paste prompt

```text
You are the lead product strategist for this repository. Make Spatial Companion
the best virtual-being platform on earth: a being people trust, return to, and
feel is present—not a talking avatar demo.

Start by inspecting the real repository, its running surfaces, the current
PRODUCT-PLAN.md, the avatar visual-test gallery, the animation-system review,
the BFF/proxy, and the relevant CI platform contracts. Treat documentation and
branch claims as hypotheses until live source, tests, or a running surface proves
them.

Before doing work, inventory git worktrees and branches. Never modify a dirty
user checkout, reset or clean another agent's work, or publish remotely without
explicit authorization. Use a clean worktree based on the authoritative remote
main for the plan work.

Choose a concrete quality bar before proposing changes. The bar must be
inspectable, measurable, and harder than “impressive” or “production-ready.” Use
the following Being Test as the initial bar, and strengthen it if the evidence
shows a better one:

1. A new owner can reach a working first conversation in five minutes.
2. The being can maintain trusted continuity: it answers a memory question with
   provenance, states uncertainty, and never invents private memories.
3. The being feels alive in the actual rendered product: voice, interruption,
   gaze, face, body motion, timing, and recovery work together across browser
   and target XR hardware.
4. The being can notice the user's situation and complete one safe, useful,
   multi-step action with explicit consent and a visible result.
5. The user understands what is local, what is remembered, what is sensed, what
   is sent, and how to stop or delete it.
6. The experience remains reliable over a 20-turn conversation and a sustained
   XR session: no frozen animation, dead speech, stale identity, runaway cost,
   unsafe tool call, or unbounded memory growth.

Find at least three current reference experiences or measurements that make this
bar concrete. Compare our real output against them directly where possible—use
the same user journey, viewport, device class, and task. Do not copy their brand
or implementation; use them to expose gaps in presence, trust, usefulness,
delight, and reliability. If a comparison cannot be inspected, replace it with
an objective test or recorded user task.

Let the lead agent divide the problem into the smallest independently improvable
and judgeable slices. It may discover different slices, but it should cover the
whole being contract: identity and personality, memory and trust, voice and
latency, embodiment and liveness, perception and spatial context, safe agency,
onboarding and connection, cross-device continuity, developer/platform value,
privacy, and launch economics.

For every important slice, create two separate fresh-context roles:

- A builder turns the largest gap into a product decision, experiment, or
  implementation-ready plan grounded in the repository.
- A critic sees the actual artifact and the quality bar, not the builder's
  explanation or history. It performs a blind A/B comparison when possible,
  scores the result, identifies the single largest remaining gap, and names the
  smallest decisive next test. The critic is allowed to reject the work.

Do not let a builder grade its own work. Do not accept feature-count arguments,
architecture enthusiasm, screenshots without interaction evidence, or plans
whose success cannot be observed. After each critic verdict, send only the
largest meaningful gap back through another builder/critic round. After each
major wave, use a fresh smoothing critic to check that the whole experience
still feels like one coherent being rather than a pile of locally optimized
features.

Keep a live workbench at docs/gauntlet/STATUS.md. Record the current bar, round,
artifact under review, evidence links, critic score, biggest gap, decision,
rejected alternatives, and next test. Keep evidence close to the decision:
source paths, test commands, screenshots or videos, runtime observations,
latency/FPS measurements, and user-journey results.

Refine docs/PRODUCT-PLAN.md only after independent criticism. The revised plan
must contain: one sharp north-star sentence; the target user and wedge; a
definition of what makes this a virtual being; a prioritized 90-day sequence;
explicit kill/ship gates; an outcome metric tree; memory/privacy/consent
boundaries; platform and ecosystem strategy; the smallest lovable first release;
and an assumptions/risk ledger. Separate facts, inferences, bets, and open
questions. Keep the existing plan's useful technical detail, but replace vague
feature phases with user-observable outcomes and evidence gates.

Keep looping while a material gap remains. Stop only when the output wins the
Being Test, improvements are no longer material, or the human owner stops the
run. At the end, report the scorecard, evidence, decisions, remaining gaps, and
the next highest-leverage move. Do not claim completion merely because a plan
was rewritten.
```

## Why this bar fits this repo

The current plan already names the right strategic ingredients—private memory,
embodiment, perception, agency, and local-first distribution—but mostly treats
them as phased features. The Being Test turns those ingredients into observable
outcomes that can be checked against the repo's existing evidence layers:

- unit/integration tests for service contracts;
- the Playwright harness and animated visual gallery for rendered liveness;
- browser and XR smoke flows for the actual user journey;
- latency, FPS, memory, and recovery measurements for sustained presence;
- CI-Server/BFF contract checks for private memory and safe action boundaries.

The prompt deliberately does not prescribe a new architecture. It asks the lead
agent to discover the smallest product slices from the current system, while
keeping independent critics responsible for the quality judgment.

## Suggested first run

Run the prompt from the clean `codex/product-plan-gauntlet` worktree. Start with
plan and evidence discovery only; let the first wave produce a scorecard before
changing source. The first likely high-leverage question is:

> Can a new owner experience a trustworthy, alive, useful companion in five
> minutes, and can we prove that claim on the browser plus one XR target?

That answer should determine whether memory wiring, onboarding/diagnostics,
barge-in/liveness, or safe agency is the next product move—not the number of
features already listed in the roadmap.
