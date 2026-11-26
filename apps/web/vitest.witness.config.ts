import { storiesConfig } from './vitest.config'

/**
 * The planted-bug witness: the story in .storybook-witness, run under the real preview. It must fail.
 * `pnpm check:stories` (scripts/check-stories.mjs) runs it and fails if it passes.
 */
export default storiesConfig('.storybook-witness', 'storybook-witness')
