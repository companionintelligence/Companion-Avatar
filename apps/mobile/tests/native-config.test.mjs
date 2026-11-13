import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = await readFile(path.join(here, '../capacitor.config.ts'), 'utf8');

test('Avatar mobile config embeds the app and does not load the hosted site', () => {
  assert.match(config, /appId:\s*'com\.companionintelligence\.avatar'/);
  assert.match(config, /appName:\s*'Avatar Companion'/);
  assert.match(config, /webDir:\s*'\.\.\/web\/dist'/);
  assert.doesNotMatch(config, /server:\s*\{[^}]*url:/s);
});
