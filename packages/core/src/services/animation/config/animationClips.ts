import type { AnimationCategory, AnimationClip } from '../animationTypes'
import * as THREE from 'three'

/**
 * Animation catalogs, split by skeleton family (see docs/ANIMATION-PIPELINE.md):
 *   - VRMA_CLIPS  → VRM humanoid avatars (Erik, Yuki, Work Boy, …). Retargeted per-VRM at load.
 *   - GLB_CLIPS   → RPM/Mixamo GLB avatars (all CI models incl. the default 'Greg').
 *
 * `getAvatarCatalog(isVRM)` returns the right one; the loader in AvatarModel picks by the
 * active avatar so GLB avatars finally get real body animation (previously only VRMA were
 * wired, leaving GLB avatars frozen).
 */

// ---- VRMA clips (VRM avatars) ----
export const VRMA_CLIPS = {
  idle_loop: {
    name: 'idle_loop',
    path: '/assets/animations/vrm/idle_loop.vrma',
    duration: 5000,
    weight: 1,
    blendTime: 1000,
    category: 'idle',
    priority: 1,
    loopCount: Infinity,
    blendCurve: 'easeInOut',
    speed: 1
  },
  victory_sign: {
    name: 'victory_sign',
    path: '/assets/animations/vrm/victory_sign.vrma',
    duration: 2500,
    weight: 0.5,
    blendTime: 600,
    category: 'action',
    priority: 3,
    loopCount: 1,
    blendCurve: 'easeOut',
    speed: 0.8
  },
  surprise_greet: {
    name: 'surprise_greet',
    path: '/assets/animations/vrm/surprise_greet.vrma',
    duration: 3000,
    weight: 0.6,
    blendTime: 700,
    category: 'gesture',
    priority: 2,
    loopCount: 1,
    blendCurve: 'easeInOut',
    speed: 0.9
  },
  pose: {
    name: 'pose',
    path: '/assets/animations/vrm/pose.vrma',
    duration: 2000,
    weight: 0.3,
    blendTime: 500,
    category: 'gesture',
    priority: 2,
    loopCount: 1,
    blendCurve: 'easeInOut',
    speed: 1
  },
  finger_gun: {
    name: 'finger_gun',
    path: '/assets/animations/vrm/finger_gun.vrma',
    duration: 2000,
    weight: 0.4,
    blendTime: 500,
    category: 'action',
    priority: 3,
    loopCount: 1,
    blendCurve: 'easeOut',
    speed: 1
  },
  dance_move: {
    name: 'dance_move',
    path: '/assets/animations/vrm/dance_move.vrma',
    duration: 3500,
    weight: 0.7,
    blendTime: 800,
    category: 'action',
    priority: 5,
    loopCount: 1,
    blendCurve: 'easeInOut',
    speed: 0.9
  }
} as Record<string, AnimationClip>

// Back-compat alias (existing imports of ANIMATION_CLIPS keep working).
export const ANIMATION_CLIPS = VRMA_CLIPS

// ---- GLB clips (RPM/Mixamo avatars) ----
// Compact builder: [fileBaseName, category, { loop?, blend?, speed?, priority? }]
type GlbDef = [string, AnimationCategory, Partial<Pick<AnimationClip, 'loopCount' | 'blendTime' | 'speed' | 'priority' | 'weight'>>?]

const GLB_DEFS: GlbDef[] = [
  // idle (looping base)
  ['idle-stable', 'idle', { loopCount: Infinity, blendTime: 1000, priority: 1 }],
  ['basic-idle', 'idle', { loopCount: Infinity, blendTime: 1000 }],
  ['standing-idle-watch', 'idle', { loopCount: Infinity, blendTime: 1000 }],
  // communication (talking)
  ['Talking', 'communication', { blendTime: 500 }],
  ['Talking-1', 'communication', { blendTime: 500 }],
  ['Talking-2', 'communication', { blendTime: 500 }],
  ['Telling-A-Secret', 'communication', { blendTime: 500 }],
  // gesture
  ['Waving', 'gesture', { blendTime: 500, speed: 0.9 }],
  ['Arm-Gesture', 'gesture', { blendTime: 500 }],
  ['Head-Gesture', 'gesture', { blendTime: 500 }],
  ['Happy-Hand-Gesture', 'gesture', { blendTime: 500 }],
  ['Hands-Forward-Gesture', 'gesture', { blendTime: 500, speed: 0.9 }],
  ['Whatever-Gesture', 'gesture', { blendTime: 500 }],
  ['Clapping', 'gesture', { blendTime: 450 }],
  ['Pointing-Forward', 'gesture', { blendTime: 500 }],
  ['Salute', 'gesture', { blendTime: 500 }],
  ['Shoulder-Rubbing', 'gesture', { blendTime: 500 }],
  ['Agreeing', 'gesture', { blendTime: 500 }],
  // expression / reactions
  ['Surprised', 'expression', { blendTime: 400 }],
  ['Reacting', 'expression', { blendTime: 500 }],
  ['Thinking', 'expression', { blendTime: 600, speed: 0.9 }],
  ['Looking', 'expression', { blendTime: 600 }],
  ['Looking-1', 'expression', { blendTime: 600 }],
  ['Looking-Behind', 'expression', { blendTime: 600 }],
  ['Shaking-It-Off', 'expression', { blendTime: 450 }],
  ['Cocky-Head-Turn', 'expression', { blendTime: 500 }],
  // action
  ['dance', 'action', { blendTime: 800, priority: 5 }],
  ['dance-action', 'action', { blendTime: 800, priority: 5 }],
  ['bow', 'action', { blendTime: 600 }],
  ['throw', 'action', { blendTime: 500 }],
  ['Praying', 'action', { blendTime: 600 }],
  ['Spin-In-Place', 'action', { blendTime: 600 }],
  ['Crazy-Gesture', 'action', { blendTime: 500 }],
  // movement
  ['walking', 'movement', { loopCount: Infinity, blendTime: 400 }]
]

const buildGlbClips = (defs: GlbDef[], dir = ''): Record<string, AnimationClip> =>
  Object.fromEntries(
    defs.map(([name, category, opts = {}]) => [
      name,
      {
        name,
        path: `/assets/animations/${dir}${name}.glb`,
        duration: 3000, // updated from the real clip after load
        weight: opts.weight ?? 1,
        blendTime: opts.blendTime ?? 500,
        category,
        priority: opts.priority ?? (category === 'idle' ? 1 : 3),
        loopCount: opts.loopCount ?? 1,
        speed: opts.speed ?? 1
      }
    ])
  )

export const GLB_CLIPS: Record<string, AnimationClip> = buildGlbClips(GLB_DEFS)

// ---- Feminine motion set (RPM animation library, female-actor mocap) ----
// Female GLB avatars get feminine idle/talking/dance in place of the unisex ones, so
// masculine and feminine avatars move differently (see docs/ANIMATION-PIPELINE.md).
// The RPM library shares the Mixamo skeleton — no retargeting needed.
const FEM_DEFS: GlbDef[] = [
  ['F_Standing_Idle_001', 'idle', { loopCount: Infinity, blendTime: 1000, priority: 1 }],
  ['F_Standing_Idle_Variations_002', 'idle', { loopCount: Infinity, blendTime: 1000 }],
  ['F_Talking_Variations_001', 'communication', { blendTime: 500 }],
  ['F_Talking_Variations_002', 'communication', { blendTime: 500 }],
  ['F_Dances_001', 'action', { blendTime: 800, priority: 5 }],
  ['F_Dances_005', 'action', { blendTime: 800, priority: 5 }],
  ['F_Dances_006', 'action', { blendTime: 800, priority: 5 }]
]

export const FEMININE_CLIPS: Record<string, AnimationClip> = buildGlbClips(FEM_DEFS, 'rpm/feminine/')

/** Union of every GLB-skeleton clip — what the loader fetches for GLB avatars. */
export const GLB_ALL_CLIPS: Record<string, AnimationClip> = { ...GLB_CLIPS, ...FEMININE_CLIPS }

// Feminine catalog: feminine idle/talking/dance REPLACE the male-mocap ones; unisex
// gestures/expressions/actions are shared. (Category swaps keep pickLoadedClipByCategory
// and LLM reactions picking feminine motion for female avatars.)
const FEM_REPLACED = new Set([
  'idle-stable', 'basic-idle', 'standing-idle-watch', // idle → F_Standing_Idle_*
  'Talking', 'Talking-1', 'Talking-2', // talking beats → F_Talking_Variations_*
  'dance', 'dance-action' // dance → F_Dances_*
])
export const FEMININE_GLB_CLIPS: Record<string, AnimationClip> = {
  ...Object.fromEntries(Object.entries(GLB_CLIPS).filter(([k]) => !FEM_REPLACED.has(k))),
  ...FEMININE_CLIPS
}

// ---- Catalog selection + named roles ----
export function getAvatarCatalog(isVRM: boolean, feminine = false): Record<string, AnimationClip> {
  if (isVRM) return VRMA_CLIPS
  return feminine ? FEMININE_GLB_CLIPS : GLB_CLIPS
}

/** The looping idle clip for a catalog (the base state). */
export function getIdleClip(catalog: Record<string, AnimationClip>): AnimationClip {
  if (catalog === VRMA_CLIPS) return VRMA_CLIPS.idle_loop
  if (catalog === FEMININE_GLB_CLIPS) return FEMININE_CLIPS['F_Standing_Idle_001']
  return GLB_CLIPS['idle-stable']
}

/** The startup greeting clip for a catalog. */
export function getGreetClip(catalog: Record<string, AnimationClip>): AnimationClip {
  return catalog === VRMA_CLIPS ? VRMA_CLIPS.surprise_greet : GLB_CLIPS['Waving']
}

/**
 * Update clip durations from the actual loaded THREE.AnimationClips (matched by name),
 * across both catalogs.
 *
 * Contract: `AnimationClip.duration` is the WALL-CLOCK length in ms, the file length divided
 * by the catalog speed. playClip runs the action at timeScale = speed, so a 3 s file at speed
 * 0.9 plays for 3333 ms. Duration-derived timing (e.g. emote relaxTime) needs that value.
 */
export const updateAnimationDurations = (threeAnimations: THREE.AnimationClip[]): void => {
  const all = { ...VRMA_CLIPS, ...GLB_ALL_CLIPS }
  threeAnimations.forEach((threeClip) => {
    const key = Object.keys(all).find((k) => all[k].name === threeClip.name)
    if (key && threeClip.duration) {
      const speed = all[key].speed || 1
      all[key].duration = Math.round((threeClip.duration / speed) * 1000)
    }
  })
}

export const getAnimationClips = (catalog: Record<string, AnimationClip> = VRMA_CLIPS): AnimationClip[] =>
  Object.values(catalog)

export const getClipsByCategory = (
  category: AnimationClip['category'],
  catalog: Record<string, AnimationClip> = VRMA_CLIPS
): AnimationClip[] => Object.values(catalog).filter((clip) => clip.category === category)

export const getRandomClip = (
  category?: AnimationClip['category'],
  catalog: Record<string, AnimationClip> = VRMA_CLIPS
): AnimationClip => {
  const clips = category ? getClipsByCategory(category, catalog) : Object.values(catalog)
  return clips[Math.floor(Math.random() * clips.length)]
}

export type AnimationKey = keyof typeof VRMA_CLIPS
export const getAnimationByKey = (key: AnimationKey): AnimationClip => VRMA_CLIPS[key]
