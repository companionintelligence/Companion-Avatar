// Types for scripts/check-dist-secrets.mjs, which is plain JavaScript so that `vite build` (apps/web/vite.config.ts) and `node` can both run it.

/** Values shorter than this are not treated as credentials. */
export const MIN_SECRET_LENGTH: number

/** A variable whose name ends like a credential (API_KEY, TOKEN, SECRET, PASSWORD, ...). */
export const SECRET_NAME: RegExp

/** Strings that are credentials whatever the variable was called. */
export const SECRET_SHAPES: readonly { rule: string; pattern: RegExp }[]

/** Which credential shapes appear in `text`: rule names only, each once. */
export function findSecretShapes(text: string): string[]

/** The forms a value can take in a bundle: as is, URL-encoded and JSON-escaped. */
export function valueForms(value: string): string[]

/** `NAME=value` lines of a .env file. */
export function parseEnvFile(text: string): Map<string, string>

/** The .env files (not their examples) directly inside each directory. */
export function envFilesIn(dirs: (string | null | undefined)[]): string[]

/** The credentials a build could publish, from the environment and from .env files. */
export function secretValues(options?: {
  env?: Record<string, string | undefined>
  envFiles?: string[]
}): { name: string; value: string; source: string }[]

/** Every text file under `dir` worth reading, in a stable order. */
export function textFilesIn(dir: string): { path: string; size: number }[]

/** Scan the build output. One problem line per (file, rule) and per (file, variable), none holding a credential. */
export function scanDist(options: {
  dist: string
  env?: Record<string, string | undefined>
  envFiles?: string[]
}): { problems: string[]; files: number; bytes: number }

/** Throws one Error listing every problem. A `dist` that does not exist is not an error. */
export function assertNoDistSecrets(options: {
  dist: string | null
  envDirs?: (string | null | undefined)[]
  env?: Record<string, string | undefined>
}): { files: number; bytes: number }
