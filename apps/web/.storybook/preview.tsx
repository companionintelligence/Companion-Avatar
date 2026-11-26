import type { Preview } from '@storybook/react-vite'

import '@fontsource/manrope/400.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@ci-avatar/core/styles/globals.css'

/**
 * The overlays are dark-glassmorphism and mostly `position: absolute`, so every
 * story renders inside a relative, dark (canonical `.dark` tokens), sized stage.
 */
const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i
      }
    },
    a11y: {
      // An axe violation fails the story's test (pnpm test:stories). A story that cannot pass yet
      // sets `a11y: { test: 'todo' }` itself and names the rule it is waiting on.
      test: 'error'
    }
  },
  decorators: [
    (Story) => (
      <div
        className="dark"
        style={{
          position: 'relative',
          width: 440,
          minHeight: 280,
          padding: 24,
          borderRadius: 12,
          background: 'var(--background, #041620)',
          fontFamily: 'var(--font-sans, Manrope, system-ui, sans-serif)',
          color: 'var(--foreground, #e8f2f4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Story />
      </div>
    )
  ]
}

export default preview
