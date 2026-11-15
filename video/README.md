# Spatial Companion — product video

> Part of the public Companion-Avatar repository, under its PolyForm Noncommercial License 1.0.0 ([`LICENSE`](../LICENSE)).

Generates a **16:9 desktop cut** and a **9:16 mobile cut** of Spatial Companion's FTUE and major
screens, from this repo's own UI. Both are produced from [`storyboard.json`](storyboard.json).

## Making one

Product videos are built **on a developer machine, on demand**. Nothing in CI builds them, and the
MP4s are not stored anywhere — no artifacts, no committed `.mp4`, no release assets. A cut is a
build output: regenerate it when you need one, then delete it.

One command, from a CI-Engineering checkout:

```bash
node tools/make-videos.mjs spatial-companion
```

Both cuts land in `~/Movies/CI-Product-Videos/spatial-companion/`, outside every repo. It needs
`CI-Common` cloned beside the other repos (the render kit is run straight off disk, so there is no
registry and no token), `ffmpeg` + `ffprobe` on `PATH`, and Node 22+.

Two things worth knowing before you use it here:

- It renders from the screenshots under `assets/shots/`, so it needs nothing running and takes
  about ninety seconds.
- It exports `video/` from `origin/main`, not from your working tree. A storyboard edit you have
  not pushed will not appear in the render — iterate with the in-repo commands below, then push.

All eight screen shots are committed (`first-run`, `hud-shell`, `chat-typed`, `chat-turn`,
`controls-collapsed`, `settings-panel`, `settings-on-device`, `datacenter-diorama`,
`datacenter-quiet`, × desktop and mobile), so a fresh checkout renders a real cut. `ci-video status`
is the authority on that; when it reports a shot missing, `build` substitutes a branded "capture
pending" slate, `check` fails on it unless you pass `--allow-slates`, and the render is a cut of
slates. Re-shoot before you render anything you intend to show anyone.

Spatial Companion has no scripted stage in the cross-product runner, so its `--capture` falls back
to render-only. Re-shooting is the in-repo path: `video/make.sh` stands the app up and drives the
capture in one command (see [Re-shooting and iterating](#re-shooting-and-iterating)).

## The stage

This app has **one route**; every filmable state is an overlay composed in
`apps/web/src/App.tsx`. Boot it exactly the way this repo's own capture harness does
(`playwright.config.capture.ts`), on **port 5178** — not 5173:

```bash
# from the repo root, in a separate terminal
corepack enable
pnpm install --frozen-lockfile
PORT=5178 pnpm --filter @ci-avatar/web dev
```

`predev` runs `scripts/pack-assets.mjs` first, which copies **~210 MB** of avatars,
animations and props into `apps/web/public/assets` (gitignored). First boot is slow;
capturing before it finishes gives you an empty scene and 404s on every GLB.

The app needs no backend for any of these shots: with no `/config.json` and no
`VITE_LLM_PROVIDER` it falls back to the offline `script` provider, and
[`capture.config.mjs`](capture.config.mjs) pins that explicitly and stubs the
response set so the transcript is fixed.

## Re-shooting and iterating

The runner above is the way to *get* a video. These are the commands to change what is in one —
re-shoot a screen, try a storyboard edit, or check a cut before pushing.

```bash
npm install
npx playwright install --with-deps chromium
npm run doctor        # verify node / ffmpeg / playwright / hyperframes / fonts

# with the app's dev server running on :5178 (see "The stage" above):
npm run capture       # drive the real UI -> assets/shots/*.png (both viewports)
npm run build         # storyboard.json -> build/{landscape,portrait}/index.html
npm run check         # HyperFrames gate: lint, runtime, layout, motion, contrast
npm run render        # -> out/ci-spatial-companion-webxr-landscape.mp4 and out/ci-spatial-companion-webxr-portrait.mp4
```

## Editing the video

Everything editorial lives in [`storyboard.json`](storyboard.json) — scene order, durations,
captions, narration, and which screens appear. The **capture spec for each shot lives in the same
file**, so the script and the screenshots cannot drift apart.

Adding a beat is: add a scene, add its shot's `capture` block, `npm run capture -- --only <id>`,
then `npm run build && npm run render`.

## Media

Drop prepared media into `assets/media/` and point `media.music` at it. Per-scene voiceover is
picked up automatically from `assets/audio/<sceneId>.mp3`; regenerate it from the storyboard's
`narration` fields with `npm run narrate`.

## What is committed

`assets/shots/*.png` and `assets/audio/*.mp3` are meant to **be** committed — they are the record
of what the product looked like, and they are *inputs*: keeping them means anyone can render a cut
without standing this app up at all. When a screen moves, the new shot shows up as a reviewable
diff. Neither path is gitignored.

Both sets are committed and current: twelve `assets/audio/*.mp3`, one per scene, and eighteen
`assets/shots/*.png` — nine screens × desktop and mobile.

An mp3 is stale the moment its scene's `narration` string changes, and nothing detects that:
`narrate` only fills in files that are *missing*, so an edited line keeps its old recording and the
cut says one thing while the caption says another. Delete the scene's mp3 and re-run `narrate`
after any narration edit.

`build/` and `out/` are not committed, and no MP4 is stored anywhere else either. Only the videos
are ephemeral.

**Byte-stability does not hold in this repo.** Every shot contains a live WebGL avatar whose
render loop never stops (`Scene3D.tsx` keeps `frameloop` at `"always"` deliberately), and
`capture.config.mjs` does not mask the canvas because the avatar is the product. Compare these
shots perceptually, not with an exact-match gate — the full reasoning, and every other
determinism hazard found in this app, is written up at the top of
[`capture.config.mjs`](capture.config.mjs).

See [CI-Engineering `projects/product-video-pipeline/`](https://github.com/companionintelligence/CI-Engineering/tree/main/projects/product-video-pipeline)
for the full contract.

## Why Playwright is pinned exactly

`video/package.json` pins `playwright` to an exact version, not a range.

Captures are byte-stable — that is what makes committing the shots worthwhile, because a UI change
then lands as a reviewable image diff instead of noise. But that property only holds **within one
Chromium build**. A `^1.58.0` range resolved to 1.62.1 on one machine and rewrote every committed
shot in a repo by 0.07–0.47% of pixels: pure text antialiasing, no layout change, and completely
indistinguishable from a real UI change in review.

So the range is gone. Re-pin deliberately when you want the newer browser, and re-capture the whole
shot set in the same commit.
