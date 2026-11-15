# Automated Avatar Asset Pipeline (Blender)

> Design for a headless HumGen3D + RPM-animation-library → GLB/VRM pipeline that emits avatars
> satisfying the app's [rig contract](AVATAR-PIPELINE.md#2-the-rig-contract-what-every-avatar-must-expose).
> Drafted 2026-07-04. Status: **designed, not yet built.**

## 1. What's on this machine (verified)

| Component | Status | Location |
|---|---|---|
| **Blender 4.5.6 LTS** (pin this) | ✅ | `/Applications/Blender 4.5.app/Contents/MacOS/Blender` |
| Blender 5.0.1 | ✅ (don't target — addon-compat risk) | `/Applications/Blender 5.app/…` |
| **BlenderMCP addon v1.2** | ✅ in both | `~/Library/Application Support/Blender/{4.5,5.0}/scripts/addons/`; MCP server at `HUB/CI-Marketplace/apps/blender-mcp` |
| **HumGen3D v4.0.27** | ⚠️ **not installed** — zip + ~4 GB `.hgpack` packs in Drive | see [DRIVE-ASSETS.md](DRIVE-ASSETS.md) |
| **VRM Addon for Blender** | ⚠️ not installed | fetch `saturday06/VRM-Addon-for-Blender` |
| **RPM animation library** (238 GLB clips, RPM/Mixamo skeleton) | ✅ | `/Users/liam/devel/3d/animation-library-master` |
| **Auto-Rig Pro / Better FBX / SimpleBake** (retarget/bake) | ✅ owned | Drive — [DRIVE-ASSETS.md](DRIVE-ASSETS.md) |

## 2. The core decision — skeleton strategy

A HumGen3D human ships with its **own Rigify-derived rig**, not the RPM/Mixamo skeleton — that's the
central mismatch. Two resolutions:

- **Strategy D — re-skin the HumGen mesh onto the RPM skeleton (recommended).** Import the RPM T-pose
  armature (`Masculine_TPose.glb`/`Feminine_TPose.glb` — already the exact rig), transfer the HumGen
  body weights to it, reparent, delete HumGen's rig. **Result: all 238 RPM clips + the app's existing
  GLB clips play natively with zero per-clip retargeting**, and the output matches
  `rpm-mixamo-t-posed.glb` bone-for-bone — exactly what the GLB path, head-bone finder, and gaze
  service expect. One-time rigging complexity, then trivial per avatar.
- **Strategy R — retarget clips onto the HumGen rig** (Auto-Rig Pro Remap or Rokoko). More per-clip
  work and you'd still hand-author the head/neck/eye bones the app looks up.

**→ Strategy D.**

## 3. End-to-end flow (headless)

```
HumGen3D generate human (from_preset / randomize body+face+skin+hair+clothing)
  → re-skin body → RPM skeleton (import T-pose, transfer weights, reparent, drop HG rig)   [Strategy D]
  → rename/bind face morphs to the app's names (viseme_* + ARKit-52 for GLB; VRM expression presets)
  → (GLB) bake procedural skin → textures → export_scene.gltf → apps/web/public/assets/avatars/<name>.glb
  → (VRM) configure VRM humanoid + expressions → export_scene.vrm → .../avatars/vrm/<name>.vrm
```

Body animations are **not** embedded per-avatar — they stay the shared RPM clip library (how the app
already loads external animations); the pipeline just guarantees the skeleton matches.

## 4. Invocation

```bash
"/Applications/Blender 4.5.app/Contents/MacOS/Blender" \
  --background --factory-startup --python pipeline/generate_avatar.py -- \
  --seed 42 --gender male --name Aria --emit glb,vrm \
  --out apps/web/public/assets/avatars
```

Author interactively with **BlenderMCP** (poke the HumGen API, confirm real shape-key/bone names, see
exports); ship with **`blender --background`** (reproducible, batchable, CI). Same script both ways.

## 5. `pipeline/` dir to add

```
pipeline/
  README.md                 # install HumGen zip + packs into headless Blender; install VRM addon
  install_addons.py         # enable HumGen3D + io_scene_vrm, set content path, save userpref
  generate_avatar.py        # main entry (args after --)
  lib/{humgen,skeleton,facemorphs,vrm_export,glb_export}.py
  mappings.py               # RPM_TO_VRM_HUMANBONES, HUMGEN_TO_OCULUS_VISEME, HUMGEN_TO_ARKIT, expression binds
  presets/ci_default.json   # per-persona seeds (gender/height/skin/hair/clothing)
  batch.sh                  # loop presets → blender --background per avatar
  validate_avatar.mjs       # CI gate: load exported GLB/VRM (three.js) → assert viseme_*, ARKit morphs, RPM bones
  register_avatar.mjs       # append to AvatarOptions.ts / emit avatars.manifest.json
```

`validate_avatar.mjs` is the fail-fast gate: assert the rig contract (viseme_* prefix set, ARKit-52
morph names, RPM bones `Hips/Spine/Spine1/Spine2/Neck/Head/LeftEye/RightEye`) before an avatar ships.

## 6. Gaps / risks (before building)

1. **HumGen rig ≠ RPM/VRM humanoid** — the weight-transfer (Strategy D) is the highest-effort/risk
   step; clean face/hand weights or you get deformation artifacts.
2. **Viseme/ARKit morph names are unverified on the real product.** HumGen advertises FACS/ARKit
   shape keys, but the exact names won't match `viseme_aa`…`viseme_U` / ARKit-52 spellings —
   `facemorphs.py` needs a rename/bind table built by inspecting the *installed* HumGen mesh. Biggest
   unknown; author it via BlenderMCP against the real addon.
3. **Headless HumGen** runs under `--background` but hard-requires the `.hgpack` packs installed + a
   content path set; some UI-only ops need `bpy.context.temp_override`. Pre-seed `userpref.blend`.
4. **HumGen3D v4 API signatures approximate** — verify `Human`, `.randomize()`, `finish_creation_phase()`,
   export calls against `help.humgen3d.com/api` + the installed source.
5. **VRM `vrm_addon_extension` paths differ VRM0 vs VRM1 / by addon version** — target **VRM1** and
   adjust the app's `rotateVRM0` hack accordingly.
6. **Pin Blender 4.5 LTS** — HumGen 4.0.27 + VRM addon are far more likely validated there; glTF/VRM
   operator options drift 4.x→5.x.
7. **Licensing** — HumGen has a separate "Human Generator Asset License" (PDF in Drive) governing
   commercial use of generated humans. RPM library is free but "intended for RPM avatars" —
   Strategy D keeps outputs on the RPM skeleton (the intended use). For the files already in
   `assets/` (humgen-aria-01 and the RPM clips included), the owner confirmed permission to
   redistribute them on 2026-11-14, and the native builds ship them; `NOTICE.md` credits them. A
   new generated avatar or clip still needs its licence checked before it is added.
8. **App bugs the pipeline surfaces** — the inverted `.glb` filter and VRMA-only `ANIMATION_CLIPS`
   ([ANIMATION-PIPELINE.md](ANIMATION-PIPELINE.md)) must be fixed for GLB avatars to use GLB/RPM clips.

## 7. Toolchain (owned plugins)

`HumGen3D` (generate) → `SpeedRetopo`/`UV Packmaster` (clean) → `Auto-Rig Pro` (rig + retarget, if
Strategy R) → `SimpleBake` (8K skin → web atlas) → `Better FBX`/glTF exporter (export). See
[DRIVE-ASSETS.md](DRIVE-ASSETS.md) for the exact owned versions + Drive IDs.
