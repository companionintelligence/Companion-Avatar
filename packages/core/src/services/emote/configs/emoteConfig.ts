export interface EmoteConfig {
  // Timing parameters
  blink: {
    minInterval: number
    maxInterval: number
    cycleDuration: number
  }
  
  // Gaze constraints
  gaze: {
    maxDistance: number
    interpolationFactor: number
    eye: {
      focused: {
        horizontal: number
        vertical: number
      }
      peripheral: {
        horizontal: number
        vertical: number
      }
    }
    neck: {
      pitch: number 
      yaw:  number
    }
    options: GazeOptions
  }
  
  // Relaxation timing
  relaxation: {
    defaultTime: number
  }
  
  tick:{
    intensity: number
    frequency: number
    probability: number
  }
  // Mood configuration
  mood: MoodOptions

  // Head motion while speaking: a soft nod at each phrase end and a slow sway
  speech: {
    nods: {
      enabled: boolean
      amplitudeDeg: number
    }
  }
  
}

export interface GazeOptions {
  delay?: number
  duration?: number
  randomness?: number
}


export interface MoodOptions {
    baseline: Partial<import('../emoteTypes').FacialTarget>
    speech?: {
      deltaRate: number
      deltaPitch: number
      deltaVolume: number
    }
}

export const defaultEmoteConfig: EmoteConfig = {
  blink: {
    minInterval: 2000, // 2 seconds
    maxInterval: 8000, // 8 seconds
    cycleDuration: 150  // 150ms blink duration
  },
  gaze: {
    maxDistance: 10,
    interpolationFactor: 2,
    eye: {
      focused: {
        horizontal: 45, // degrees
        vertical: 30    // degrees
      },
      peripheral: {
        horizontal: 100, // degrees
        vertical: 70    // degrees
      }
    },
    neck: {
      pitch: 70,   // neck extension
      yaw: 80   // neck turn
    },
    options: {
      delay: -1, // random delay
      duration: -1, // random duration
      randomness: 0.8 // 80% chance to actually gaze
    }
  },
  tick:{
    intensity: 0.3,
    frequency: 2000,
    probability: 0.1
  },
  relaxation: {
    defaultTime: 5000 // 5 seconds
  },
  mood: {
    baseline: {},
    speech: {
      deltaRate: 1.0,
      deltaPitch: 1.0,
      deltaVolume: 1.0
    }
  },
  speech: {
    nods: {
      enabled: true,
      amplitudeDeg: 2 // degrees; the nod peaks here and the sway is 0.3 times it
    }
  }
}
