import type { CapacitorConfig } from '@capacitor/cli'

// Native shells for Avatar Companion. `cap sync` copies the web build (apps/web/dist) into the
// Android and iOS projects, so the app runs from its own origin. There is deliberately no
// `server.url`: a shell that loads the website instead would repeat the visionOS pattern the
// App Store review flags. A store build must never set one.
//
// `appId` is provisional. The owner picks the store identifier before any upload, and an
// Android applicationId is permanent once uploaded.
const config: CapacitorConfig = {
  appId: 'com.companionintelligence.avatar',
  appName: 'Avatar Companion',
  webDir: '../web/dist',
  android: {
    allowMixedContent: false
  }
}

export default config
