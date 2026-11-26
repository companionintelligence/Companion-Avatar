/**
 * check-stories.mjs — the check behind the component-stories entry in .agent-configs/specs.toml.
 *
 * An exit code alone proves nothing, so this passes only when all three hold:
 *
 *   1. The stories and the Storybook config typecheck (apps/web/tsconfig.stories.json).
 *   2. The planted-bug witness fails. apps/web/.storybook-witness holds one story with an unnamed
 *      button and an image without alt text, run under the real preview. axe must fail it on both
 *      rules. If it passes, axe did not run, or the preview no longer runs it at 'error'.
 *   3. Every story passes, and Vitest's summary says that every test passed.
 *
 * Usage: pnpm check:stories [vitest arguments for the story run, such as a file name filter]
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('../apps/web/', import.meta.url))
const env = { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1', NO_COLOR: '1' }
const PLANTED_RULES = ['button-name', 'image-alt']

// Colour codes and terminal hyperlinks, which some reporters print even with NO_COLOR.
// eslint-disable-next-line no-control-regex
const TERMINAL_CODES = /\u001b\[[0-9;]*m|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g

/** Runs a tool from apps/web's node_modules and returns its exit status and plain output. */
function run(args) {
  const result = spawnSync('pnpm', ['exec', ...args], {
    cwd: web,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024
  })
  if (result.error) fail(`could not run ${args[0]}: ${result.error.message}`)
  return { status: result.status, output: `${result.stdout}${result.stderr}`.replace(TERMINAL_CODES, '') }
}

function fail(message, output = '') {
  if (output) process.stderr.write(`${output.trimEnd()}\n\n`)
  process.stderr.write(`check:stories: ${message}\n`)
  process.exit(1)
}

const types = run(['tsc', '-p', 'tsconfig.stories.json'])
if (types.status !== 0) fail('the stories do not typecheck.', types.output)

const witness = run(['vitest', 'run', '-c', 'vitest.witness.config.ts'])
const missing = PLANTED_RULES.filter((rule) => !witness.output.includes(`/${rule}?application=axeAPI`))
if (witness.status !== 1 || !/Tests\s+1 failed \(1\)/.test(witness.output) || missing.length > 0) {
  const why = missing.length > 0 ? `axe did not report ${missing.join(' or ')}` : `it exited ${witness.status}`
  fail(`the planted-bug witness must fail on ${PLANTED_RULES.join(' and ')}, but ${why}.`, witness.output)
}

const stories = run(['vitest', 'run', ...process.argv.slice(2)])
const summary = /Tests\s+(\d+) passed \((\d+)\)/.exec(stories.output)
if (stories.status !== 0 || !summary || summary[1] !== summary[2] || summary[1] === '0') {
  fail('the stories did not all pass.', stories.output)
}

process.stdout.write(`${stories.output.trimEnd()}\n\n`)
process.stdout.write(
  `check:stories: the stories typecheck, the witness fails on ${PLANTED_RULES.join(' and ')}, and all ${summary[1]} stories pass.\n`
)
