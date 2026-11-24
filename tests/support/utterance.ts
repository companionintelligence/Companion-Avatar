/**
 * The line the render specs make an avatar say.
 *
 * Deliberately long. These specs render with software GL (SwiftShader), where a frame can
 * take a second or more, and the first frame after an avatar starts speaking is often the
 * slowest. A two-second line spans only a handful of frames, so observing the speech layer
 * mid-utterance became a coin flip: the suite passed by luck rather than by construction.
 * The synthetic engine scales its duration with text length, so a long line buys tens of
 * frames to observe.
 *
 * Measured on 12 rigs with the 1.3 s "Hello world" this replaced in the avatar matrix: the
 * first rendered frame after speak() arrived 0.5 to 2.0 s later, so on 9 of the 12 the line
 * was over before any frame saw it. With this line (9 s) every one of them got frames.
 */
export const LONG_UTTERANCE =
  'Hello there, this is a lip sync check that runs for long enough to be observed ' +
  'reliably even when the renderer is limping along in software mode on a build agent.'
