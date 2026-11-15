import type { CapacitorConfig } from '@capacitor/cli'

// Native shells for Avatar Companion. `cap sync` copies the web build (apps/web/dist) into the
// Android and iOS projects, so the app runs from its own origin. There is deliberately no
// `server.url`: a shell that loads the website instead would repeat the visionOS pattern the
// App Store review flags. A store build must never set one.
//
// `appId` is final: it is the bundle ID of the live App Store app (apps/mobile/STORE-PREP-IOS.md),
// and the Android applicationId matches it. Do not change it. An Android applicationId is also
// permanent once an app is uploaded to Google Play.
const config: CapacitorConfig = {
  appId: 'com.companionintelligence.avatar',
  appName: 'Avatar Companion',
  webDir: '../web/dist',
  android: {
    allowMixedContent: false
  }
}

export default config
