import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = await readFile(path.join(here, '../capacitor.config.ts'), 'utf8');
const gradle = await readFile(path.join(here, '../android/app/build.gradle'), 'utf8');
const pkg = JSON.parse(await readFile(path.join(here, '../package.json'), 'utf8'));

test('Avatar mobile config embeds the app and does not load the hosted site', () => {
  assert.match(config, /appId:\s*'com\.companionintelligence\.avatar'/);
  assert.match(config, /appName:\s*'Avatar Companion'/);
  assert.match(config, /webDir:\s*'\.\.\/web\/dist'/);
  assert.doesNotMatch(config, /server:\s*\{[^}]*url:/s);
});

test('Android versionName is the app version and versionCode is a whole number', () => {
  // Android installs an update only over a lower versionCode; the release workflow checks the tag
  // against versionName.
  assert.equal(gradle.match(/versionName\s+"([^"]+)"/)?.[1], pkg.version);
  assert.match(gradle, /versionCode\s+[1-9]\d*\s*\n/);
});
