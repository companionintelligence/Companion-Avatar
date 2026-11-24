# `assets/` — shared avatar/environment media (single source of truth)

Heavy binary media served under `/assets/*` lives **here, once**, and is packed into
each app's `public/` at build time. This is the only committed copy.

```
assets/
├── avatars/       # .glb (RPM/CI/HumGen) + vrm/*.vrm (VRoid/Reallusion/Mixamo)
├── animations/    # shared body-animation clips (.glb / .vrma)
├── props/         # environment set dressing (.glb) — e.g. the 1970s datacenter diorama
└── environments/  # the studio's HDRI (.hdr): the image the scene is lit by
```

## How it gets into a build

Each app runs [`scripts/pack-assets.mjs`](../scripts/pack-assets.mjs) on `predev`,
`prebuild`, and `prepreview` (wired in each `apps/*/package.json`). The script:

1. **Gates the build** — every file referenced by
   [`AvatarOptions.ts`](../packages/core/src/components/scene/avatar/AvatarOptions.ts),
   [`DioramaProps.ts`](../packages/core/src/components/scene/environment/DioramaProps.ts) or
   [`StudioEnvironment.tsx`](../packages/core/src/components/scene/environment/StudioEnvironment.tsx)
   must resolve to a file here, or the build fails before Vite runs. The marketplace
   image can never ship a catalog that 404s.
2. Copies `assets/{avatars,animations,props,environments}` →
   `apps/<app>/public/assets/{avatars,animations,props,environments}`.
3. Warns about orphans (files here not referenced by a catalog).

The per-app `public/assets/{avatars,animations,props,environments}` dirs are **gitignored** —
regenerated, never committed, so there is zero duplication or drift across `web` /
`vision-pro`, and `pnpm --filter @ci-avatar/web build` (the marketplace container build)
always packages the full, current set.

## Adding an avatar

1. Drop the `.glb` (or `vrm/*.vrm`) into `assets/avatars/`.
2. Add an entry to `AvatarOptions.ts`.

That's it — `pack-assets` validates and packages it on the next build. New avatars from
the Blender/HumGen pipeline (`pipeline/`) land here automatically.

## Adding an environment prop

1. Drop the `.glb` into `assets/props/`.
2. Add an entry to
   [`DioramaProps.ts`](../packages/core/src/components/scene/environment/DioramaProps.ts).
3. Place it in
   [`DatacenterDiorama.tsx`](../packages/core/src/components/scene/environment/DatacenterDiorama.tsx)'s
   `PROP_LAYOUT` (position/rotation/scale).

See [`docs/DIORAMA.md`](../docs/DIORAMA.md) for the source-asset pipeline (FBX/.blend →
GLB via headless Blender) and the full prop catalog.

## The studio lighting

`environments/studio_small_03_1k.hdr` is the image the scene is lit by: "Studio Small 03" by
Greg Zaal, from Poly Haven, CC0 (credited in
[`scripts/third-party/assets.mjs`](../scripts/third-party/assets.mjs) and [`NOTICE.md`](../NOTICE.md)).
[`StudioEnvironment.tsx`](../packages/core/src/components/scene/environment/StudioEnvironment.tsx)
names it (`STUDIO_HDRI_URL`), which is how `pack-assets` knows to gate it.

It ships with every app so the scene needs no network to light itself. It used to be fetched
from raw.githack.com, and when that host failed on 2026-11-24 the page went blank. If the file
ever fails to load anyway, the same component lights the scene with generated lighting instead
of throwing.

To change it: replace the file, then update `STUDIO_HDRI_URL`, the credit, and
`StudioEnvironment.dom.test.tsx` (which pins the file's bytes), and look at an avatar again: the
generated fallback was tuned against this image's brightness.
