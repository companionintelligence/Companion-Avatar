import type { StorybookConfig } from '@storybook/react-vite'

import config from '../.storybook/main.ts'

/**
 * The planted-bug witness for the story tests: the real Storybook config with one story that axe must
 * fail (PlantedViolations.stories.tsx). `pnpm check:stories` runs it through vitest.witness.config.ts.
 */
const witness: StorybookConfig = { ...config, stories: ['./PlantedViolations.stories.tsx'] }

export default witness
