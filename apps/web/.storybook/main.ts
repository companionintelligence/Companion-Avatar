import type { StorybookConfig } from '@storybook/react-vite'

/**
 * Storybook is hosted in apps/web (Vite 6, the well-supported builder line) but
 * documents the shared components from @ci-avatar/core, so stories are colocated
 * with the components under packages/core/src. Importing them through the
 * `@ci-avatar/core` specifier also validates the public export surface in index.ts.
 */
const config: StorybookConfig = {
  stories: ['../../../packages/core/src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs', '@storybook/addon-vitest'],
  framework: {
    name: '@storybook/react-vite',
    options: {}
  },
  core: {
    disableTelemetry: true
  }
}

export default config
