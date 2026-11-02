// Builds the Windows NSIS installer. The Authenticode certificate thumbprint is read from the
// environment and handed to the Tauri CLI as a temporary config file, so it never lands in a
// tracked file.
//
//   WINDOWS_CERTIFICATE_THUMBPRINT   SHA-1 thumbprint (40 hex digits) of the code-signing
//                                    certificate in the Windows certificate store.
//
// Run from apps/desktop on Windows: node scripts/desktop-build-windows.mjs
// Pass --unsigned for a test build with no signing certificate.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const unsigned = process.argv.includes('--unsigned')
const thumbprint = (process.env.WINDOWS_CERTIFICATE_THUMBPRINT ?? '').trim()

if (!unsigned && !thumbprint) {
  console.error('desktop-build-windows: WINDOWS_CERTIFICATE_THUMBPRINT is not set.')
  console.error('  Set it to the SHA-1 thumbprint (40 hex digits) of the code-signing certificate,')
  console.error('  or pass --unsigned for a test build. Nothing was built.')
  process.exit(2)
}
if (!unsigned && !/^[0-9a-fA-F]{40}$/.test(thumbprint)) {
  console.error('desktop-build-windows: WINDOWS_CERTIFICATE_THUMBPRINT must be exactly 40 hex digits.')
  console.error('  The value was not printed. Nothing was built.')
  process.exit(2)
}

const args = ['exec', 'tauri', 'build', '--bundles', 'nsis']
const workDir = mkdtempSync(join(tmpdir(), 'avatar-desktop-'))
try {
  if (!unsigned) {
    const override = join(workDir, 'windows-signing.conf.json')
    writeFileSync(override, JSON.stringify({ bundle: { windows: { certificateThumbprint: thumbprint } } }))
    args.push('--config', override)
  }
  const result = spawnSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' })
  process.exitCode = result.status ?? 1
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
