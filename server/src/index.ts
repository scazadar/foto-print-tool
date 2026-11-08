// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { immichServerInfo } from './immich-routes.js';
import { MIN_IMMICH_VERSION, TESTED_IMMICH_API } from './immich.js';
import { cleanup } from './storage.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`Konfigurationsfehler: ${(err as Error).message}`);
  process.exit(1);
}

const db = openDb(config.dataDir);
const { app, ctx } = await buildApp(config, db);

app.log.info(
  { version: config.version, commit: config.commit, authMode: config.authMode, immich: !!config.immichUrl, print: !!config.cupsUrl },
  'Fotodruck starting',
);

if (config.immichUrl) {
  const info = await immichServerInfo(ctx, true);
  const min = `${MIN_IMMICH_VERSION.major}.${MIN_IMMICH_VERSION.minor}.${MIN_IMMICH_VERSION.patch}`;
  if (!info.reachable) {
    app.log.warn(`Immich unter ${config.immichUrl} ist nicht erreichbar. Die App startet trotzdem; Immich-Funktionen sind bis zur Verbindung gestört.`);
  } else if (info.tooOld) {
    app.log.error(`Immich ${info.version} ist zu alt. Benötigt wird mindestens ${min} (getestet mit API ${TESTED_IMMICH_API}).`);
  } else {
    app.log.info(`Immich ${info.version} verbunden (getestet mit API ${TESTED_IMMICH_API}).`);
  }
}

const runCleanup = () =>
  cleanup(ctx)
    .then((r) => (r.uploads || r.cache || r.guests ? app.log.info(r, 'cleanup') : undefined))
    .catch((err) => app.log.error(err, 'cleanup failed'));
await runCleanup();
setInterval(runCleanup, 60 * 60 * 1000).unref();
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600_000).unref();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}

await app.listen({ host: '0.0.0.0', port: config.port });
