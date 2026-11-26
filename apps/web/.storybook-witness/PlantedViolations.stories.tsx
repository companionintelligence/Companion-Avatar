import type { Meta, StoryObj } from '@storybook/react-vite'

/**
 * A planted bug, kept on purpose: a button with no name and an image with no text alternative.
 * `pnpm check:stories` runs this story and expects axe to fail it on button-name and image-alt. If it
 * passes, axe did not run or did not fail the story, and a green story suite would prove nothing.
 */
const meta = {
  title: 'Witness/PlantedViolations'
} satisfies Meta

export default meta

export const PlantedViolations: StoryObj<typeof meta> = {
  render: () => (
    <div>
      <button type="button" />
      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'/%3E" />
    </div>
  )
}
