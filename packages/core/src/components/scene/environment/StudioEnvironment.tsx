/**
 * StudioEnvironment — the studio's image-based light, served with the app and unable to take the scene down.
 *
 * The light is one HDRI, `studio_small_03_1k.hdr` (1.7 MB; "Studio Small 03" by Greg Zaal, Poly Haven, CC0),
 * the file drei's own studio preset points at. The scene used to take it from raw.githack.com when it mounted.
 * R3F suspends the whole canvas until that file has loaded, and when the fetch fails the loader throws, R3F
 * rethrows into the page, and with no error boundary above it React unmounts everything: the page is empty.
 * That happened to https://avatar.ci.computer on 2026-11-24 (about 19:21Z to past 20:03Z): the host began
 * answering the request with a 301, then a 403, neither carrying an Access-Control-Allow-Origin header, so
 * the browser blocked it ("Could not load studio_small_03_1k.hdr: Failed to fetch"). It recovered on its own
 * by 20:47Z, and nothing in the app would have survived the next time.
 *
 * Two things keep it from happening again:
 *
 * - The file ships with the app. It lives in assets/environments/, scripts/pack-assets.mjs packs it into
 *   every app's public/assets/ (and fails the build if it is missing), and it is served from the app's own
 *   origin, so the scene asks no third party for its light and the apps start with no connection.
 * - The environment sits in its own boundary. If the file still fails to load (a bad deploy, a file the
 *   browser cannot decode), the scene is lit by a generated one instead (a few softboxes in a cube render,
 *   which needs no file and no network), and the avatar and the rest of the page carry on. The generated
 *   light is a stand-in, not a copy: it was tuned until the default avatar's mean luminance matched the
 *   HDRI's (134.6 against 131.9 in the same headless rig), and it has less of the HDRI's sheen on glossy cloth.
 */
import { Environment, Lightformer } from '@react-three/drei'
import { Component } from 'react'
import type { ReactNode } from 'react'

/**
 * Where the studio's HDRI is served from: the app's own origin, packed from assets/environments/ like the
 * avatars (absolute, as theirs are). scripts/pack-assets.mjs reads this file and fails the build when the
 * file is not there; scripts/third-party/assets.mjs holds its credit.
 */
export const STUDIO_HDRI_URL = '/assets/environments/studio_small_03_1k.hdr'

interface EnvironmentBoundaryProps {
  /** Shown in place of the children when one of them throws. */
  fallback: ReactNode
  children: ReactNode
}

interface EnvironmentBoundaryState {
  failed: boolean
}

/**
 * Keeps whatever throws below it from reaching the page. An error boundary has to be a class: there is
 * no hook for getDerivedStateFromError.
 */
export class EnvironmentBoundary extends Component<EnvironmentBoundaryProps, EnvironmentBoundaryState> {
  state: EnvironmentBoundaryState = { failed: false }

  static getDerivedStateFromError(): EnvironmentBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.warn('[scene] the studio environment failed to load; the scene is lit by a generated one instead:', error)
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * A small photo studio, generated: a big softbox overhead, a key to the front left, a cooler fill on the
 * right, a warm rim behind, and a pale bounce from the floor, in a mid-grey room. The positions are
 * directions, not places (a cube camera at the origin only records solid angle), as in
 * MachineRoomEnvironment. 128 px is enough for soft rectangles; it renders once and is prefiltered once.
 */
function GeneratedStudioEnvironment({ intensity }: { intensity: number }) {
  const face = (self: { lookAt: (x: number, y: number, z: number) => void }) => self.lookAt(0, 0, 0)
  return (
    <Environment frames={1} resolution={128} background={false} environmentIntensity={intensity}>
      <color attach="background" args={['#c0c5ca']} />
      <Lightformer form="rect" intensity={4.6} color="#ffffff" position={[0, 5, 0]} scale={[9, 9, 1]} onUpdate={face} />
      <Lightformer form="rect" intensity={6.5} color="#ffffff" position={[-4, 2.4, 4]} scale={[5, 4, 1]} onUpdate={face} />
      <Lightformer form="rect" intensity={3.4} color="#eef3ff" position={[4.5, 1.6, 2.6]} scale={[4, 5, 1]} onUpdate={face} />
      <Lightformer form="rect" intensity={4.2} color="#fff1e6" position={[0, 2.6, -5]} scale={[7, 3, 1]} onUpdate={face} />
      <Lightformer form="rect" intensity={1.4} color="#e8e8e8" position={[0, -3, 0]} scale={[9, 9, 1]} onUpdate={face} />
    </Environment>
  )
}

export interface StudioEnvironmentProps {
  /** scene.environmentIntensity: how much of the environment reaches the materials. */
  intensity?: number
}

export function StudioEnvironment({ intensity = 1 }: StudioEnvironmentProps) {
  return (
    <EnvironmentBoundary fallback={<GeneratedStudioEnvironment intensity={intensity} />}>
      <Environment files={STUDIO_HDRI_URL} background={false} environmentIntensity={intensity} />
    </EnvironmentBoundary>
  )
}
