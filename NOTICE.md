# NOTICE

This file records attribution that the licences of our dependencies and
upstream projects legally require us to reproduce. It is not a full dependency
list — see [THIRD_PARTY.md](THIRD_PARTY.md) for that, and [CREDITS.md](CREDITS.md)
for acknowledgements.

## Copyleft and reciprocal-licence dependencies

None. Every third-party dependency in this repository is under a permissive
licence (MIT, Apache-2.0, ISC, BSD or similar).

## Bundled avatars, animations and props

The PolyForm Noncommercial license covers Companion Intelligence's own code and
assets only. The avatars, animation clips and props under `assets/` were made
with or obtained from third parties and keep the terms they came with.

**Distribution decision, 2026-11-14.** The owner, LifeScope Inc. (DBA Companion
Intelligence), confirmed on 2026-11-14 that it has permission to redistribute
these files, and decided that the desktop and Android apps ship all of
`assets/` as it is. That permission is the owner's: it does not let anyone else
extract or reuse the files outside this repository's own builds. For that, ask
their authors.

The credits below cover every file the apps bundle. Embedded terms were read
from the files' own metadata (VRM `meta`, glTF `asset`) on 2026-11-14.

### Ready Player Me avatars

Avatars made with Ready Player Me. Copyright Ready Player Me. Licensed under the
Creative Commons Attribution-NonCommercial 4.0 International licence
([CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)).

`assets/avatars/25-1-3_CI_model_*.glb` (nine files), `LiamCES.glb`,
`LiamCES2.glb`, `unbranded-woman-short-hair.glb` and `rpm-mixamo-t-posed.glb`.
Twelve carry the glTF copyright "Ready Player Me". `rpm-mixamo-t-posed.glb` was
re-exported with Blender with a Mixamo animation track added.

### VRM avatars

| File | Author | Embedded terms |
| --- | --- | --- |
| `casualman.vrm` | moop | Redistribution prohibited; author only; commercial use disallowed |
| `casualperson.vrm` | moop | VRM 1.0 license; author only; personal non-profit use only; credit required; no redistribution |
| `workboy.vrm` | moop | VRM 1.0 license; author only; personal non-profit use only; credit required; no redistribution |
| `sportboy.vrm` | moop | Redistribution prohibited; author only; commercial use disallowed |
| `sportwoman.vrm` | moop | Redistribution prohibited; author only; commercial use disallowed |
| `erik.vrm` | not stated | Redistribution prohibited; author only; commercial use disallowed |
| `maya.vrm` | not stated | Redistribution prohibited; author only; commercial use disallowed |
| `scout.vrm` | not stated | Redistribution prohibited; author only; commercial use disallowed |
| `kenji.vrm` | not stated | VRoid Hub terms (credit necessary; redistribution disallowed; no commercial use) |
| `yuki.vrm` | not stated | VRoid Hub terms (credit necessary; redistribution allowed; no commercial use) |

`assets/avatars/humgen-aria-01.vrm` is Companion Intelligence's own avatar
(authors: Companion Intelligence), made with Human Generator 3D under the Human
Generator Asset License. Its embedded VRM 1.0 terms: author only, personal
non-profit use, credit required, no redistribution, no modification.

### Animation clips

- **Mixamo**: the 39 clips `assets/animations/*.glb` are Adobe Mixamo
  animations (each holds the track `Armature|mixamo.com|Layer0`), used under the
  Adobe Mixamo terms.
- **Ready Player Me Animation Library**: the 7 clips in
  `assets/animations/rpm/feminine/`. Copyright (c) 2023 Ready Player Me OÜ,
  [Ready Player Me Animation Library License](https://github.com/readyplayerme/animation-library/blob/master/LICENSE.md).
- **VRMA**: `dance_move`, `finger_gun`, `pose`, `spin_dance`, `squat`,
  `surprise_greet` and `victory_sign` in `assets/animations/vrm/`. Their source
  is not recorded; they appear to be VRoid Project's (pixiv Inc.) VRM animation
  set of 7, <https://booth.pm/ja/items/5512385>.
- **ChatVRM**: `assets/animations/vrm/idle_loop.vrma` and its copy
  `idle_loop copy.vrma` are `public/idle_loop.vrma` from
  [pixiv/ChatVRM](https://github.com/pixiv/ChatVRM), MIT License, Copyright (c)
  2023 pixiv Inc. The licence text follows this list.
- `assets/animations/neutral.json` is a three.js animation clip whose source and
  author are not recorded.

<details>
<summary>MIT License (pixiv/ChatVRM)</summary>

```
MIT License

Copyright (c) 2023 pixiv Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

### Diorama props

The 1970s-datacenter props in `assets/props/` are Sketchfab models under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), converted to GLB,
rescaled and centred (`ibm-1401-mainframe.glb` also lost its backdrop). The
repository recorded only each model's source name (`docs/DIORAMA.md`); the
authors were found by matching those names on Sketchfab on 2026-11-14.

| File | Sketchfab model | Author |
| --- | --- | --- |
| `ibm-ramac-305.glb` | [IBM RAMAC 305 - FIRST HARD DRIVE - 1956](https://sketchfab.com/3d-models/ibm-ramac-305-first-hard-drive-1956-03f81005695944cca90ab1aecc11975a) | museudocomputador |
| `ibm-1401-mainframe.glb` | [IBM 1401 - MAINFRAME - Date: 1959](https://sketchfab.com/3d-models/ibm-1401-mainframe-date-1959-0d5ead7d38c84a5c916b214c50ca0a77) | museudocomputador |
| `ibm-1401-cpu.glb` | [IBM 1401 Central Processing Unit](https://sketchfab.com/3d-models/ibm-1401-central-processing-unit-62a34be60e0548bf938b52989f86136d) | maxdragon |
| `engelbart-mouse.glb` | [First Mouse - Douglas Engelbart - Date:1963](https://sketchfab.com/3d-models/first-mouse-douglas-engelbart-date1963-8f4a2b1d7fb6420191a77042bb275d15) | museudocomputador |
| `plugboard.glb` | [Plugboard - "Ancient" Coding](https://sketchfab.com/3d-models/plugboard-ancient-coding-b483e91712804a7bb387969c6d054870) | museudocomputador |
| `kenbak-1.glb` | [Kenbak-1 // First Personal Computer](https://sketchfab.com/3d-models/kenbak-1-first-personal-computer-bd931bcaf2094846a7708a5106ffd294) | museudocomputador |
| `xerox-alto.glb` | [Xerox Alto - Son of Douglas Engelbart - 1973](https://sketchfab.com/3d-models/xerox-alto-son-of-douglas-engelbart-1973-fc49263ee9b94ea98caa11c65e663a90) | museudocomputador |
| `ibm-3350-disk.glb` | [IBM 3350 "Madrid"](https://sketchfab.com/3d-models/ibm-3350-madrid-6d1b6c37642a44388c06992e0923f990) | maxdragon |
| `ibm-2401-tape.glb` | [IBM 2401](https://sketchfab.com/3d-models/ibm-2401-61f8ce78c76b46dfade5ccc7ad020a1b) | maxdragon |
| `ibm-3178-terminal.glb` | [IBM 3178](https://sketchfab.com/3d-models/ibm-3178-891ae8149d8547a5971381237d13e2e6) | probably maxdragon; mixlabshadow also has a model of that name (also CC BY 4.0) |
| `prologica-cp500.glb` | [CP-500 - Prologica - TRS 80 Model III Clone](https://sketchfab.com/3d-models/cp-500-prologica-trs-80-model-iii-clone-63ac1d69330b4d0a9629b62b30a14c9b) | probably museudocomputador; a later upload of the same name by another account is under Sketchfab's Standard licence |
| `commodore-pet.glb` | Commodore PET | unknown: several Sketchfab models share the name, so the author and licence are not known |

The props depict historical, trademarked hardware; the names belong to their
owners.

## First-party code

Except as noted above, the contents of this repository are
Copyright (c) LifeScope INC, DBA Companion Intelligence (<https://ci.computer>),
licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).

Required Notice: Copyright LifeScope INC, DBA Companion Intelligence (https://ci.computer)

---

_Generated by [`scripts/generate-attribution.mjs`](https://github.com/companionintelligence/CI-Engineering/blob/main/scripts/generate-attribution.mjs) for `CI-Spatial-Agent-Web`. Regenerate rather than editing generated sections by hand._
