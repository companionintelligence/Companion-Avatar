// Every file the desktop and Android apps carry from assets/avatars, assets/animations and
// assets/props, with its author, source and licence. scripts/pack-assets.mjs copies those three
// folders into the web build, so every app build carries all of them.
//
// scripts/third-party-notices.mjs renders this list into THIRD-PARTY-NOTICES.txt, and
// scripts/third-party-notices.test.mjs fails when a file under those folders is not listed here
// exactly once, or when an entry names a file that does not exist. Add the credit with the file.
//
// Facts below were read from the files' own glTF/VRM metadata on 2026-11-14, from
// docs/DIORAMA.md (the props' source names) and from the public pages each entry names. Where the
// repository does not record an author or a licence, the entry says so.

/** The owner's decision that lets the apps ship these files. */
export const ASSET_DECISION =
  'On 2026-11-14 the owner, LifeScope Inc. (DBA Companion Intelligence), confirmed that it has ' +
  'permission to redistribute the avatars, animations and props listed below, and decided that ' +
  'the desktop and Android apps ship all of them as they are. The terms each file came with are ' +
  'recorded here as credit; they are not the terms under which you may reuse a file. Do not ' +
  'extract or reuse these files outside the app without your own permission from their authors.'

/** The folders under assets/ that the apps bundle. */
export const ASSET_FOLDERS = ['avatars', 'animations', 'props']

const CC_BY = { license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' }

/** A Sketchfab prop. An entry whose source name matched more than one model says so in `match`. */
function prop(file, title, author, url, extra = {}) {
  return { file: `props/${file}`, title, author, source: url, ...CC_BY, ...extra }
}

const MIXAMO_CLIPS = [
  'Agreeing', 'Arm-Gesture', 'basic-idle', 'bow', 'Clapping', 'Cocky-Head-Turn', 'Crazy-Gesture',
  'dance-action', 'dance', 'Hands-Forward-Gesture', 'Happy-Hand-Gesture', 'Head-Gesture',
  'idle-stable', 'idle', 'Looking-1', 'Looking-Behind', 'Looking', 'Pointing-Forward', 'Praying',
  'Reacting', 'Salute', 'Shaking-It-Off', 'Shoulder-Rubbing', 'Spin-In-Place', 'spin',
  'standing-idle-watch', 'Surprised', 'Talking-1', 'Talking-2', 'Talking', 'Telling-A-Secret',
  'think', 'Thinking', 'throw', 'unarmed-idle', 'walking', 'warrior-idle', 'Waving', 'Whatever-Gesture'
]

const VRM0_AUTHOR_ONLY =
  'VRM 0.x licence "Redistribution_Prohibited"; allowed user: author only; commercial use: disallowed'
const VRM1_AUTHOR_ONLY =
  'VRM Public License 1.0 (https://vrm.dev/licenses/1.0/): avatar use by the author only; ' +
  'personal non-profit use; credit required; redistribution not allowed; modification prohibited'

export const ASSET_GROUPS = [
  {
    title: 'Ready Player Me avatars',
    author: 'Ready Player Me',
    source: 'Made with the Ready Player Me Avatar Creator (https://readyplayer.me) for Companion Intelligence',
    license: 'CC BY-NC 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
    credit:
      'Avatars made with Ready Player Me. Copyright Ready Player Me. Licensed under the Creative ' +
      'Commons Attribution-NonCommercial 4.0 International licence (CC BY-NC 4.0), ' +
      'https://creativecommons.org/licenses/by-nc/4.0/. Provided as is, without warranties.',
    changes:
      'rpm-mixamo-t-posed.glb is a Ready Player Me avatar re-exported with Blender (Khronos glTF ' +
      'Blender I/O 4.1.63) with a Mixamo animation track added. The other twelve are as the Avatar ' +
      'Creator exported them.',
    notes: [
      'Twelve of the files carry asset.generator and asset.copyright "Ready Player Me" in their glTF header.',
      'Ready Player Me published Avatar Creator output under CC BY-NC 4.0. readyplayer.me no longer resolves.'
    ],
    files: [
      'avatars/25-1-3_CI_model_female_Ash.glb',
      'avatars/25-1-3_CI_model_female_Brit.glb',
      'avatars/25-1-3_CI_model_female_Cara.glb',
      'avatars/25-1-3_CI_model_female_Courtney.glb',
      'avatars/25-1-3_CI_model_female_Shanee.glb',
      'avatars/25-1-3_CI_model_female_glasses_short_hair.glb',
      'avatars/25-1-3_CI_model_male_Brad.glb',
      'avatars/25-1-3_CI_model_male_Greg.glb',
      'avatars/25-1-3_CI_model_male_Jack.glb',
      'avatars/LiamCES.glb',
      'avatars/LiamCES2.glb',
      'avatars/unbranded-woman-short-hair.glb',
      'avatars/rpm-mixamo-t-posed.glb'
    ]
  },
  {
    title: 'VRM avatars (VRoid Studio and other VRM authors)',
    source: 'Not recorded in the repository, except that kenji and yuki carry VRoid Hub licence links',
    license: 'The terms embedded in each file, listed per file',
    notes: [
      'Author, title and terms are as the files\' own VRM metadata states them. "Not stated" means the metadata names no author.'
    ],
    items: [
      { file: 'avatars/vrm/casualman.vrm', title: 'casual man', author: 'moop', terms: VRM0_AUTHOR_ONLY },
      { file: 'avatars/vrm/sportboy.vrm', title: 'ubiq sport boy', author: 'moop', terms: VRM0_AUTHOR_ONLY },
      { file: 'avatars/vrm/sportwoman.vrm', title: 'sport woman', author: 'moop', terms: VRM0_AUTHOR_ONLY },
      { file: 'avatars/vrm/casualperson.vrm', title: 'casual person', author: 'moop', terms: VRM1_AUTHOR_ONLY, tool: 'VRoid Studio 1.22.0' },
      { file: 'avatars/vrm/workboy.vrm', title: 'Work Boy', author: 'moop', terms: VRM1_AUTHOR_ONLY, tool: 'VRoid Studio 1.22.0' },
      { file: 'avatars/vrm/erik.vrm', title: 'not stated', author: 'not stated', terms: VRM0_AUTHOR_ONLY },
      { file: 'avatars/vrm/maya.vrm', title: 'not stated', author: 'not stated', terms: VRM0_AUTHOR_ONLY },
      { file: 'avatars/vrm/scout.vrm', title: 'not stated', author: 'not stated', terms: VRM0_AUTHOR_ONLY },
      {
        file: 'avatars/vrm/kenji.vrm',
        title: 'not stated',
        author: 'not stated',
        terms:
          'VRoid Hub licence: credit necessary; redistribution disallowed; modification allowed; ' +
          'personal and corporate commercial use disallowed (https://hub.vroid.com/license?allowed_to_use_user=everyone&characterization_allowed_user=everyone&corporate_commercial_use=disallow&credit=necessary&modification=allow&personal_commercial_use=disallow&redistribution=disallow&sexual_expression=disallow&version=1&violent_expression=disallow)'
      },
      {
        file: 'avatars/vrm/yuki.vrm',
        title: 'not stated',
        author: 'not stated',
        terms:
          'VRoid Hub licence: credit necessary; redistribution allowed; modification allowed; ' +
          'personal and corporate commercial use disallowed (https://hub.vroid.com/license?allowed_to_use_user=everyone&characterization_allowed_user=everyone&corporate_commercial_use=disallow&credit=necessary&modification=allow&personal_commercial_use=disallow&redistribution=allow&sexual_expression=allow&version=1&violent_expression=allow)'
      }
    ]
  },
  {
    title: 'HumGen avatar',
    author: 'Companion Intelligence (the authors named in the file\'s VRM metadata)',
    source: 'Generated with Human Generator 3D (HumGen3D, https://www.humgen3d.com) and exported with the VRM Add-on for Blender 4.3.1',
    license: 'Human Generator Asset License (the tier is not recorded in the repository)',
    credit: 'Made with Human Generator 3D.',
    notes: [
      'Embedded VRM 1.0 terms: avatar use by the author only; personal non-profit use; credit required; redistribution not allowed; modification prohibited (https://vrm.dev/licenses/1.0/).'
    ],
    files: ['avatars/humgen-aria-01.vrm']
  },
  {
    title: 'Mixamo animation clips',
    author: 'Adobe (Mixamo)',
    source: 'Adobe Mixamo, https://www.mixamo.com. Each file holds the track "Armature|mixamo.com|Layer0" and was exported with Blender (Khronos glTF Blender I/O)',
    license: 'Adobe Mixamo terms, part of the Adobe General Terms of Use (https://www.adobe.com/legal/terms.html; FAQ: https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)',
    notes: ['Which Mixamo animation each clip came from is not recorded; the file names are Companion Intelligence\'s.'],
    files: MIXAMO_CLIPS.map((name) => `animations/${name}.glb`)
  },
  {
    title: 'Ready Player Me Animation Library clips',
    author: 'Copyright (c) 2023 Ready Player Me OÜ',
    source: 'Ready Player Me Animation Library, https://github.com/readyplayerme/animation-library (feminine set, converted with FBX2glTF 0.9.7)',
    license: 'Ready Player Me Animation Library License, https://github.com/readyplayerme/animation-library/blob/master/LICENSE.md',
    files: [
      'animations/rpm/feminine/F_Dances_001.glb',
      'animations/rpm/feminine/F_Dances_005.glb',
      'animations/rpm/feminine/F_Dances_006.glb',
      'animations/rpm/feminine/F_Standing_Idle_001.glb',
      'animations/rpm/feminine/F_Standing_Idle_Variations_002.glb',
      'animations/rpm/feminine/F_Talking_Variations_001.glb',
      'animations/rpm/feminine/F_Talking_Variations_002.glb'
    ]
  },
  {
    title: 'VRM animation clips (VRMA)',
    author: 'Not recorded in the repository; they appear to be by VRoid Project (pixiv Inc.)',
    source:
      'Not recorded. The seven motions match VRoid Project\'s "VRMアニメーション7種セット (.vrma)" ' +
      '(VRM animation set of 7), https://booth.pm/ja/items/5512385. The files are THREE.GLTFExporter ' +
      're-exports, so they cannot be matched to that pack byte for byte',
    license: 'The terms of that pack, as published on its BOOTH page',
    files: [
      'animations/vrm/dance_move.vrma',
      'animations/vrm/finger_gun.vrma',
      'animations/vrm/pose.vrma',
      'animations/vrm/spin_dance.vrma',
      'animations/vrm/squat.vrma',
      'animations/vrm/surprise_greet.vrma',
      'animations/vrm/victory_sign.vrma'
    ]
  },
  {
    title: 'ChatVRM idle animation',
    author: 'Copyright (c) 2023 pixiv Inc.',
    source: 'pixiv/ChatVRM, public/idle_loop.vrma, https://github.com/pixiv/ChatVRM (both files are byte-identical copies of it)',
    license: 'MIT',
    licenseText: 'MIT',
    holder: 'Copyright (c) 2023 pixiv Inc.',
    files: ['animations/vrm/idle_loop.vrma', 'animations/vrm/idle_loop copy.vrma']
  },
  {
    title: 'NeutralIdle clip (three.js JSON)',
    author: 'Unknown: not recorded in the repository',
    source: 'Unknown: not recorded in the repository',
    license: 'Unknown: not recorded in the repository',
    files: ['animations/neutral.json']
  },
  {
    title: 'Development helper files',
    author: 'Companion Intelligence',
    source: 'This repository (first-party, not used by the app at run time)',
    license: 'PolyForm Noncommercial License 1.0.0, as the rest of the app',
    files: ['animations/rename.sh', 'animations/test.js']
  },
  {
    title: 'Diorama props (1970s datacenter, shown with ?env=datacenter-1970s)',
    source: 'Sketchfab',
    license: 'CC BY 4.0, as listed per file',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    changes:
      'Converted to GLB with Blender, rescaled to the real machine\'s size, floor-aligned and ' +
      'centred; ibm-1401-mainframe.glb also had its backdrop geometry removed.',
    notes: [
      'The repository records only each model\'s Sketchfab source name (docs/DIORAMA.md). Authors and licences below come from matching those names against Sketchfab\'s public model pages on 2026-11-14; where more than one model matches, the entry says so.',
      'The props depict historical, trademarked hardware; the names belong to their owners.'
    ],
    items: [
      prop('ibm-ramac-305.glb', 'IBM RAMAC 305 - FIRST HARD DRIVE - 1956', 'museudocomputador', 'https://sketchfab.com/3d-models/ibm-ramac-305-first-hard-drive-1956-03f81005695944cca90ab1aecc11975a'),
      prop('ibm-1401-mainframe.glb', 'IBM 1401 - MAINFRAME - Date: 1959', 'museudocomputador', 'https://sketchfab.com/3d-models/ibm-1401-mainframe-date-1959-0d5ead7d38c84a5c916b214c50ca0a77'),
      prop('ibm-1401-cpu.glb', 'IBM 1401 Central Processing Unit', 'maxdragon (maxdragonn)', 'https://sketchfab.com/3d-models/ibm-1401-central-processing-unit-62a34be60e0548bf938b52989f86136d'),
      prop('engelbart-mouse.glb', 'First Mouse - Douglas Engelbart - Date:1963', 'museudocomputador', 'https://sketchfab.com/3d-models/first-mouse-douglas-engelbart-date1963-8f4a2b1d7fb6420191a77042bb275d15'),
      prop('plugboard.glb', 'Plugboard - "Ancient" Coding', 'museudocomputador', 'https://sketchfab.com/3d-models/plugboard-ancient-coding-b483e91712804a7bb387969c6d054870'),
      prop('kenbak-1.glb', 'Kenbak-1 // First Personal Computer', 'museudocomputador', 'https://sketchfab.com/3d-models/kenbak-1-first-personal-computer-bd931bcaf2094846a7708a5106ffd294'),
      prop('xerox-alto.glb', 'Xerox Alto - Son of Douglas Engelbart - 1973', 'museudocomputador', 'https://sketchfab.com/3d-models/xerox-alto-son-of-douglas-engelbart-1973-fc49263ee9b94ea98caa11c65e663a90'),
      prop('ibm-3350-disk.glb', 'IBM 3350 "Madrid"', 'maxdragon (maxdragonn)', 'https://sketchfab.com/3d-models/ibm-3350-madrid-6d1b6c37642a44388c06992e0923f990'),
      prop('ibm-2401-tape.glb', 'IBM 2401', 'maxdragon (maxdragonn)', 'https://sketchfab.com/3d-models/ibm-2401-61f8ce78c76b46dfade5ccc7ad020a1b'),
      prop(
        'ibm-3178-terminal.glb',
        'IBM 3178',
        'probably maxdragon (maxdragonn); not certain',
        'https://sketchfab.com/3d-models/ibm-3178-891ae8149d8547a5971381237d13e2e6',
        { match: 'Two Sketchfab models carry the source name "ibm-3178": maxdragon\'s (above) and mixlabshadow\'s "ibm_3178", https://sketchfab.com/3d-models/ibm-3178-0d36b4e3d129435895883e0cc33983f3. Both are CC BY 4.0. The other .blend props are maxdragon\'s.' }
      ),
      prop(
        'prologica-cp500.glb',
        'CP-500 - Prologica - TRS 80 Model III Clone',
        'probably museudocomputador; not certain',
        'https://sketchfab.com/3d-models/cp-500-prologica-trs-80-model-iii-clone-63ac1d69330b4d0a9629b62b30a14c9b',
        { match: 'A later upload of the same name by another account is under Sketchfab\'s Standard licence: https://sketchfab.com/3d-models/cp-500-prologica-trs-80-model-iii-clone-7822662afaa44bbfb9efc05cc3b62154.' }
      ),
      {
        file: 'props/commodore-pet.glb',
        title: 'Commodore PET',
        author: 'Unknown',
        source: 'Sketchfab, source name "commodore-pet"',
        license: 'Unknown',
        match:
          'Several Sketchfab models are named "Commodore PET", under CC BY 4.0, Editorial or other licences. ' +
          'The likeliest, since the other FBX props are museudocomputador\'s, is museudocomputador\'s ' +
          '"Commodore PET" (CC BY 4.0), https://sketchfab.com/3d-models/commodore-pet-fb1e5a04ef4644f98219e1d5d52ab073.'
      }
    ]
  }
]

/** Every file the catalogue lists, as a path under assets/ with forward slashes. */
export function catalogueFiles(groups = ASSET_GROUPS) {
  return groups.flatMap((group) => [...(group.files ?? []), ...(group.items ?? []).map((item) => item.file)])
}
