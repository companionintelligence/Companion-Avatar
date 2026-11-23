import type { MoodOptions } from "./emoteConfig";

export const moodConfigurations: Record<string, MoodOptions> = {
  neutral: {
    baseline: {
      eyesLookDown: 0.1
    },
    speech: {
      deltaRate: 0,
      deltaPitch: 0,
      deltaVolume: 0
    }  
  } as MoodOptions,

  happy: {
    baseline: {
      mouthSmile: 0.6,
      eyesLookDown: 0.1
    },
    speech: {
      deltaRate: 0,
      deltaPitch: 0.1,
      deltaVolume: 0
    }
  } as MoodOptions,

  angry: {
    baseline: {
      eyesLookDown: 0.1,
      browDownLeft: 0.6,
      browDownRight: 0.6,
      jawForward: 0.3,
      mouthFrownLeft: 0.7,
      mouthFrownRight: 0.7,
      mouthRollLower: 0.2,
      mouthShrugLower: 0.3,
      handFistLeft: 1,
      handFistRight: 1
    },
    speech: {
      deltaRate: -0.2,
      deltaPitch: 0.2,
      deltaVolume: 0
    }
  } as MoodOptions,

  sad: {
    baseline: {
      eyesLookDown: 0.2,
      browDownRight: 0.1,
      browInnerUp: 0.6,
      browOuterUpRight: 0.2,
      eyeSquintLeft: 0.7,
      eyeSquintRight: 0.7,
      mouthFrownLeft: 0.8,
      mouthFrownRight: 0.8,
      mouthLeft: 0.2,
      mouthPucker: 0.5,
      mouthRollLower: 0.2,
      mouthRollUpper: 0.2,
      mouthShrugLower: 0.2,
      mouthShrugUpper: 0.2,
      mouthStretchLeft: 0.4
    },
    speech: {
      deltaRate: -0.2,
      deltaPitch: -0.2,
      deltaVolume: 0
    }
  } as MoodOptions,

  fear: {
    baseline: {
      browInnerUp: 0.7,
      eyeSquintLeft: 0.5,
      eyeSquintRight: 0.5,
      eyeWideLeft: 0.6,
      eyeWideRight: 0.6,
      mouthClose: 0.1,
      mouthFunnel: 0.3,
      mouthShrugLower: 0.5,
      mouthShrugUpper: 0.5
    },
    speech: {
      deltaRate: -0.2,
      deltaPitch: 0,
      deltaVolume: 0
    }
  } as MoodOptions,

  disgust: {
    baseline: {
      browDownLeft: 0.7,
      browDownRight: 0.1,
      browInnerUp: 0.3,
      eyeSquintLeft: 1,
      eyeSquintRight: 1,
      eyeWideLeft: 0.5,
      eyeWideRight: 0.5,
      eyesRotateX: 0.05,
      mouthLeft: 0.4,
      mouthPressLeft: 0.3,
      mouthRollLower: 0.3,
      mouthShrugLower: 0.3,
      mouthShrugUpper: 0.8,
      mouthUpperUpLeft: 0.3,
      noseSneerLeft: 1,
      noseSneerRight: 0.7
    },
    speech: {
      deltaRate: -0.2,
      deltaPitch: 0,
      deltaVolume: 0
    }
  } as MoodOptions,

  love: {
    baseline: {
      browInnerUp: 0.4,
      browOuterUpLeft: 0.2,
      browOuterUpRight: 0.2,
      mouthSmile: 0.2,
      eyeBlinkLeft: 0.6,
      eyeBlinkRight: 0.6,
      eyeWideLeft: 0.7,
      eyeWideRight: 0.7,
      headRotateX: 0.1,
      mouthDimpleLeft: 0.1,
      mouthDimpleRight: 0.1,
      mouthPressLeft: 0.2,
      mouthShrugUpper: 0.2,
      mouthUpperUpLeft: 0.1,
      mouthUpperUpRight: 0.1
    },
    speech: {
      deltaRate: -0.1,
      deltaPitch: -0.7,
      deltaVolume: 0
    }
  } as MoodOptions    ,

  sleep: {
    baseline: {
      eyeBlinkLeft: 1,
      eyeBlinkRight: 1,
      eyesClosed: 0.6
    },
    speech: {
      deltaRate: 0,
      deltaPitch: -0.2,
      deltaVolume: 0
    }
  } as MoodOptions,

  alert: {
    baseline: {
      browInnerUp: 0.7,
      eyeWideLeft: 0.6,
      eyeWideRight: 0.6
    },
    speech: {
      deltaRate: 0,
      deltaPitch: 0,
      deltaVolume: 0
    }
  } as MoodOptions,
}
