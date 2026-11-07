#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/** Every source file needs the SPDX licence identifier and a copyright line near the top. */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIRS = ['server/src', 'server/test', 'shared', 'web/src', 'scripts'];
const FILES = ['web/index.html', 'web/vite.config.ts', 'web/svelte.config.js', 'server/vitest.config.ts', 'Dockerfile', 'docker-compose.yml'];
const EXT = new Set(['.ts', '.js', '.mjs', '.svelte', '.css', '.html']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXT.has(path.extname(e.name))) yield p;
  }
}

const files = [...DIRS.flatMap((d) => [...walk(path.join(root, d))]), ...FILES.map((f) => path.join(root, f)).filter((f) => fs.existsSync(f))];
const bad = [];
for (const f of files) {
  const head = fs.readFileSync(f, 'utf8').split('\n').slice(0, 5).join('\n');
  if (!head.includes('SPDX-License-Identifier: AGPL-3.0-or-later') || !/Copyright \(C\) \d{4}/.test(head)) bad.push(path.relative(root, f));
}
if (bad.length) {
  console.error('Missing SPDX header or copyright line:');
  for (const b of bad) console.error(`  ${b}`);
  process.exit(1);
}
console.log(`${files.length} files have SPDX headers.`);
