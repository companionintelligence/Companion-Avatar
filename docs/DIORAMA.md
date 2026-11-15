# The 1970s Research-Datacenter Diorama

An opt-in environment the companion stands inside: a quarter-century of computing history
(1956–1982) arranged as the room of a mind that grew up among these machines. Design
source: the Metahermit GDD (`ci-metahermit/Docs/GDD.md`, §2 "The Set") — this is the
web-native realization of that set.

## Using it

- **URL:** append `?env=datacenter-1970s` to the web app.
- **Code:** pass `sceneConfig` with `environment: 'datacenter-1970s'` to `Viewport3D`/`Scene3D`,
  or render `<DatacenterDiorama />` directly inside any R3F scene (set `showShell={false}`
  to composite over your own room).
- Default remains the plain studio viewport (`environment: 'none'` / unset) — no existing
  caller changes behavior.

## The catalog

GLBs live in `/assets/props/` (single source of truth; packed into each app's
`public/assets/props/` by `scripts/pack-assets.mjs`, which fails the build if any
`DioramaProps.ts` entry has no file). Each GLB is exported pre-normalized: floor-aligned
at its own origin, centered in X/Y, and scaled so its largest dimension equals the
real machine's, so placements in `DatacenterDiorama.tsx` need no per-prop correction.

| Prop | Year | Target max dim | Source |
|---|---|---|---|
| IBM RAMAC 305 | 1956 | 1.70 m | `ibm-ramac-305-first-hard-drive-1956` (FBX) |
| IBM 1401 Mainframe | 1959 | 1.70 m | `ibm-1401-mainframe-date-1959` (FBX) |
| IBM 1401 CPU | 1959 | 1.70 m | `ibm-1401-central-processing-unit` (.blend) |
| Engelbart Mouse | 1963 | 0.15 m | `first-mouse-douglas-engelbart-date1963` (FBX) |
| Plugboard | — | 0.90 m | `plugboard-ancient-coding` (FBX) |
| KENBAK-1 | 1971 | 0.48 m | `kenbak-1-first-personal-computer` (FBX) |
| Xerox Alto | 1973 | 1.20 m | `xerox-alto-son-of-douglas-engelbart-1973` (FBX) |
| IBM 3350 Disk | 1975 | 1.50 m | `ibm-3350-madrid` (.blend) |
| Commodore PET | 1977 | 0.50 m | `commodore-pet` (FBX) |
| IBM 3178 Terminal | 1979 | 0.50 m | `ibm-3178` (.blend) |
| IBM 2401 Tape | — | 1.83 m | `ibm-2401` (.blend) |
| Prológica CP-500 | 1982 | 0.55 m | `cp-500-prologica-trs-80-model-iii-clone` (FBX) |

## Export pipeline

Headless Blender (5.1) script (`fbx2glb.py`, kept with the source asset archive at
`llm-metahuman/scene/`): imports the FBX or opens the `.blend` directly, relinks each
image to the texture files actually shipped with the asset (matched by basename — many
Sketchfab exports carry dead absolute paths), drops orphaned non-mesh backdrop objects,
normalizes to the real-world target dimension above, floor-aligns, exports GLB
(Y-up, no Draco). Re-run it if a source asset is replaced; then update the table here.

### Where the pipeline did not finish

Three of the twelve shipped without it. Measure any prop with
`node scripts/prop-glb.mjs` (world bounds from the GLB header, full TRS chain) or
`node scripts/prop-glb.mjs --nodes <file>` for a per-mesh-node breakdown.

- **`ibm-1401-mainframe.glb` — repaired at source, no Blender needed.** The file held
  two unrelated coordinate clusters: 29 nodes forming a 0.59 × 0.93 × 1.03 m cabinet
  (the 1401, already at real scale) and 240 nodes forming a 184 × 44 × 160 unit set of
  floor and ceiling slabs and structural ironwork — the Sketchfab source's backdrop,
  which the "drops orphaned backdrop objects" step above did not drop. That backdrop is
  the whole reason the file measured 184 m. `scripts/prop-glb.mjs --repair` prunes it
  from the scene graph and recentres the cabinet on its origin. Rigid, verified against
  the re-measured result, binary chunk copied through byte for byte. The pruned meshes'
  buffer views are still in the BIN chunk, so the file is still 5.9 MB for 0.4 MB of
  geometry — a real re-export would fix that too.
- **`kenbak-1.glb` and `ibm-3178-terminal.glb` — still need the source archive.** See
  `PROP_NEEDS_REEXPORT` in `DioramaProps.ts` for the measurements and why rescaling them
  is not a fix. The diorama leaves them out until they are re-exported; deleting the
  entry there puts them back with no other change.

### The relink step drops every texture on `.blend` sources

The export step above "relinks each image to the texture files actually shipped with the
asset (matched by basename — many Sketchfab exports carry dead absolute paths)". A basename
match finds loose texture files sitting next to an FBX. It finds **nothing** for a `.blend`,
whose images are packed inside the file or referenced by an absolute path from the author's
machine — and the export then writes a GLB with no image at all, silently, for a material
that renders as a flat 0.8 grey.

Measured on the shipped files' JSON chunks against the source collection's public metadata
(`api.sketchfab.com/v3/models/<uid>` reports a per-model texture count):

| Prop | Source | Source textures | Shipped images |
|---|---|---|---|
| IBM 1401 CPU | `.blend` | 1 | **0** |
| IBM 2401 Tape | `.blend` | 4 | **0** |
| IBM 3178 Terminal | `.blend` | 4 | **0** |
| IBM 3350 Disk | `.blend` | 4 | **0** |
| every other prop | FBX | 1–6 | 1–6 ✓ |

Four for four. It is the source format, not the individual asset.

This is most of why the room reads as white plastic boxes: the 1401 CPU's one lost texture is
its entire identity — a charcoal cabinet in a pale blue-grey frame with the machine's control
panel on it — and that prop is **instanced sixteen times** as the machine ranks.

**The re-export, when the source archive is to hand.** Open each `.blend` directly rather than
importing it, `bpy.ops.file.unpack_all(method='USE_LOCAL')` so packed images land on disk, and
then **fail the export** if any material references an image whose `filepath` does not resolve,
instead of exporting a blank. A silent partial export is what produced this.

The source models are `sketchfab.com/hegemonbill`, collection `metahuman` — all eleven CC-BY
and flagged downloadable, but the download API needs the account, so this is an owner task.
(`plugboard` is not in that collection; its source is elsewhere.)

Two things a re-export will **not** fix, so nobody goes looking: nothing in this set has a
normal, metallic-roughness or occlusion map — upstream or here — and the props are baseColour
only across the board. Surface response is handled at runtime instead, by `SURFACE_FINISH` /
`PROP_SURFACE` in `DioramaProps.ts` and the generated detail map in `detailSurface.ts`. The
two jobs are separate; recovering the albedo does not make the material table redundant.

`DioramaProps.node.test.ts` pins the four at zero images, so a good re-export fails the test
and the failure is the instruction to delete the entry from `PROP_TEXTURES_LOST` and re-grade
`PROP_TINT` against a prop that finally has an albedo.

## Look and lighting

- **Environment map.** `MachineRoomEnvironment.tsx` generates the IBL from the room itself —
  a dark shell with the four ceiling troffers, the desk practical and the teal rim in it —
  rather than loading drei's `studio` HDRI. One cube render at mount, then a PMREM prefilter,
  then nothing per frame; and no CDN in the path. The studio preset stays for the default
  (`environment: 'none'`) viewport, where a white lightbox is the right key for a bust.
- **Surface finish.** `SURFACE_FINISH` in `DioramaProps.ts` is the metalness / roughness /
  `envMapIntensity` table, keyed per prop and per GLB material name. Glass drive windows,
  bare metal and paper are called out individually; everything else is painted steel.
- **Detail map.** `detailSurface.ts` generates one small tiling normal + roughness map. It is
  surface only — grain and orange peel. It carries **no markings of any kind**: no logos, no
  labels, no model numbers. Those live in the lost textures above, and the only honest way to
  get them back is the re-export, not a canvas.
- **Occlusion.** `ContactShadows` inside the diorama seats the machines on the floor (rendered
  for the first 90 frames, then free), and `N8AO` in the post chain darkens the panel gaps and
  door seams. AO is opt-in per environment — the default viewport has nothing to occlude.

## Layout rationale (from the GDD)

- **Back wall — big iron**, oldest→newest left to right (RAMAC → 1401 → 1401 CPU →
  3350 → 2401): the machines "the resident never had room to throw out."
- **Side desk — small artifacts** (KENBAK-1, Engelbart mouse, plugboard) at desk height
  (+0.74 m), within the resident's arm's reach.
- **Terminal row** (Alto, PET, 3178, CP-500) angled toward the camera: where the
  resident actually works.
- Nothing occludes the default camera framing (camera `[0, 1.6, 3]` → origin); the
  avatar spawns at the origin inside the set.
- Lighting follows the GDD's **"diegetic warm, chrome cool"** rule: tungsten-amber
  practicals (`#e8a24a`) on the hardware, CI teal/aqua (`#00a9a7`) rim off the metal,
  mint (`#58ebbf`) reserved for "live" indicator lamps.

## Licensing

The props are Sketchfab-sourced models of real, trademarked hardware; keep the depiction
nominative and historical. On 2026-11-14 the owner confirmed that Companion Intelligence has
permission to redistribute them, and the native builds ship all twelve. Matching the source
names above against Sketchfab the same day found CC BY 4.0 models by museudocomputador and
maxdragon for eleven of them (the IBM 3178 and CP-500 names also match a second upload, noted in
`NOTICE.md`); the Commodore PET's author is unknown, because several models share its name. CC BY
needs visible attribution, which `NOTICE.md` gives. Record the author and licence here when a prop
is added or replaced.
