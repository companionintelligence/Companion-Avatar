#!/usr/bin/env node
/**
 * pack-assets.mjs — package the shared avatar/environment media into an app's public dir.
 *
 * Single source of truth: /assets/{avatars,animations,props,environments} at the repo root.
 * Each app (apps/web, apps/vision-pro) keeps NO committed copy — its public/assets/{avatars,
 * animations,props,environments} are gitignored and regenerated here on `predev` /
 * `prebuild`, so the marketplace container build (`pnpm --filter @ci-avatar/web build`)
 * always ships the full, current media set with zero duplication or drift across apps.
 *
 * It is also the packaging GATE: every file referenced by AvatarOptions.ts, DioramaProps.ts
 * or StudioEnvironment.tsx must resolve to a real file under /assets/<subtree>, or the build
 * fails here (before Vite) rather than shipping an image whose catalog 404s at runtime. For
 * StudioEnvironment that file is the studio's HDRI: without it every scene would start on
 * the generated fallback lighting, which is a net for a bad deploy, not a build to ship.
 *
 * Usage:
 *   node scripts/pack-assets.mjs [web] [vision-pro] ...   # default: all apps
 */
import { existsSync, rmSync, cpSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const canonical = join(repoRoot, 'assets')

// Media subtrees that live in the shared source and get packed into each app.
const MEDIA = ['avatars', 'animations', 'props', 'environments']
// URL-path prefix -> canonical subdir (AvatarOptions/DioramaProps paths are absolute URLs).
const URL_PREFIX = '/assets/'

// Catalogs gated against a media subtree: every URL a catalog references must resolve to
// a real file under assets/<subtree>/, or the build fails here (before Vite).
const CATALOGS = [
  {
    subtree: 'avatars',
    path: 'packages/core/src/components/scene/avatar/AvatarOptions.ts',
    label: 'AvatarOptions'
  },
  {
    subtree: 'props',
    path: 'packages/core/src/components/scene/environment/DioramaProps.ts',
    label: 'DioramaProps'
  },
  {
    subtree: 'environments',
    path: 'packages/core/src/components/scene/environment/StudioEnvironment.tsx',
    label: 'StudioEnvironment'
  }
]

// App public dirs. Accept app names on argv; default to every app with a public/.
const APP_DIRS = { web: 'apps/web', 'vision-pro': 'apps/vision-pro' }
const requested = process.argv.slice(2)
const apps = (requested.length ? requested : Object.keys(APP_DIRS)).map((name) => {
  const rel = APP_DIRS[name] ?? `apps/${name}`
  return { name, publicAssets: join(repoRoot, rel, 'public', 'assets') }
})

function fail(msg) {
  console.error(`\n[pack-assets] ERROR: ${msg}\n`)
  process.exit(1)
}

// --- 0. sanity: canonical source exists ---
for (const m of MEDIA) {
  if (!existsSync(join(canonical, m))) fail(`missing canonical source: assets/${m}/`)
}

// --- 1. GATE: every catalog (AvatarOptions, DioramaProps, ...) entry must exist on disk ---
// --- 2. orphan report (present in source but never referenced) — warn only ---
function listFiles(dir, subtree, base = dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...listFiles(p, subtree, base))
    else out.push(`/assets/${subtree}/` + relative(base, p).split('\\').join('/'))
  }
  return out
}

let totalCatalogRefs = 0
for (const { subtree, path, label } of CATALOGS) {
  if (!existsSync(join(canonical, subtree))) continue // gated separately below (step 0)
  const catalogPath = join(repoRoot, path)
  const src = readFileSync(catalogPath, 'utf8')
  const prefix = `/assets/${subtree}/`
  const referenced = [...src.matchAll(new RegExp(`['"](${prefix.replace(/\//g, '\\/')}[^'"]+)['"]`, 'g'))].map(
    (m) => m[1]
  )
  const uniqueRefs = [...new Set(referenced)]
  totalCatalogRefs += uniqueRefs.length

  const missing = uniqueRefs.filter((url) => !existsSync(join(canonical, url.slice(URL_PREFIX.length))))
  if (missing.length) {
    fail(
      `${label} references ${missing.length} file(s) with no match under assets/${subtree}:\n` +
        missing.map((u) => `    - ${u}`).join('\n') +
        `\n  Add the file to assets/${subtree}/ or remove the ${label} entry.`
    )
  }

  const onDisk = listFiles(join(canonical, subtree), subtree)
  const orphans = onDisk.filter((u) => !uniqueRefs.includes(u))
  if (orphans.length) {
    console.warn(
      `[pack-assets] note: ${orphans.length} file(s) in assets/${subtree} not referenced by ` +
        `${label} (shipped but unselectable): ${orphans.map((o) => o.split('/').pop()).join(', ')}`
    )
  }
}

// --- 3. sync canonical -> each app public (clean replace, no drift) ---
let bytes = 0
const sizeOf = (dir) =>
  listFilesRaw(dir).reduce((n, f) => n + statSync(f).size, 0)
function listFilesRaw(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...listFilesRaw(p))
    else out.push(p)
  }
  return out
}

const perApp = MEDIA.reduce((n, m) => n + sizeOf(join(canonical, m)), 0)
for (const app of apps) {
  for (const m of MEDIA) {
    const from = join(canonical, m)
    const to = join(app.publicAssets, m)
    rmSync(to, { recursive: true, force: true })
    cpSync(from, to, { recursive: true })
  }
}
bytes = perApp

const mb = (bytes / 1024 / 1024).toFixed(0)
console.log(
  `[pack-assets] packed ${totalCatalogRefs} catalog entries (avatars, props and the studio HDRI, + animations) into ` +
    `${apps.map((a) => a.name).join(', ')} — ${mb} MB/app, single source: assets/`
)
