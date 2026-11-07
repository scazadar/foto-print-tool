// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/**
 * End-to-end test against a real Immich instance (see the e2e-immich job in
 * .github/workflows/ci.yml). Expects a fresh Immich at IMMICH_URL.
 *
 *   IMMICH_URL=http://localhost:2283 node --import tsx test/e2e/immich-e2e.ts
 */

import assert from 'node:assert/strict';
import sharp from 'sharp';
import { defaultEdit } from '../../../shared/edit.js';
import { BUILTIN_FORMATS } from '../../../shared/formats.js';
import { Agent, makeApp } from '../helpers.js';

const IMMICH = (process.env.IMMICH_URL ?? 'http://localhost:2283').replace(/\/$/, '');
const f10x15 = BUILTIN_FORMATS.find((f) => f.id === '10x15')!;

async function immich(method: string, path: string, token: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${IMMICH}/api${path}`, { method, headers, body: payload });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function waitForImmich() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${IMMICH}/api/server/ping`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Immich did not start');
}

async function main() {
  await waitForImmich();
  const version = await immich('GET', '/server/version', null);
  console.log(`Immich ${version.major}.${version.minor}.${version.patch}`);

  // users
  await immich('POST', '/auth/admin-sign-up', null, { email: 'admin@example.org', password: 'admin-pass', name: 'Admin' });
  const admin = await immich('POST', '/auth/login', null, { email: 'admin@example.org', password: 'admin-pass' });
  await immich('POST', '/admin/users', admin.accessToken, { email: 'user2@example.org', password: 'user2-pass', name: 'User Zwei' });

  // a portrait phone photo: stored landscape with EXIF orientation 6
  const photo = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#4477aa' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Make: 'E2E', Model: 'Cam' }, IFD2: { DateTimeOriginal: '2023:05:06 07:08:09' } })
    .toBuffer();
  const form = new FormData();
  form.set('deviceAssetId', 'e2e-1');
  form.set('deviceId', 'e2e');
  form.set('fileCreatedAt', '2023-05-06T07:08:09.000Z');
  form.set('fileModifiedAt', '2023-05-06T07:08:09.000Z');
  form.set('assetData', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'IMG_E2E.jpg');
  const uploaded = await immich('POST', '/assets', admin.accessToken, form);
  const originalBefore = Buffer.from(await (await fetch(`${IMMICH}/api/assets/${uploaded.id}/original`, { headers: { authorization: `Bearer ${admin.accessToken}` } })).arrayBuffer());
  // wait until Immich has extracted the metadata and generated previews
  for (let i = 0; i < 60; i++) {
    const a = await immich('GET', `/assets/${uploaded.id}`, admin.accessToken);
    if (a.exifInfo?.exifImageWidth && a.thumbhash) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const t = await makeApp({ IMMICH_URL: IMMICH });
  try {
    const a = new Agent(t.app);
    assert.equal((await a.req('POST', '/api/auth/login', { method: 'password', email: 'admin@example.org', password: 'admin-pass' })).statusCode, 200);
    const status = (await a.req('GET', '/api/immich/status')).json();
    assert.equal(status.reachable, true);
    assert.equal(status.tooOld, false);

    const timeline = (await a.req('GET', '/api/immich/timeline')).json();
    assert.ok(timeline.items.some((i: any) => i.id === uploaded.id), 'timeline contains the photo');

    const info = (await a.req('GET', `/api/immich/assets/${uploaded.id}`)).json();
    assert.deepEqual([info.width, info.height], [1800, 2400], 'oriented size of the original');

    const thumb = await a.req('GET', `/api/immich/assets/${uploaded.id}/thumb?size=preview`);
    const tm = await sharp(thumb.rawPayload).metadata();
    assert.ok(tm.height! > tm.width!, 'preview is upright');

    const item = { source: { kind: 'immich', id: uploaded.id }, format: f10x15, orientation: 'portrait', edit: defaultEdit() };
    const dl = await a.req('POST', '/api/output/download', { items: [item], type: 'jpeg' });
    const dm = await sharp(dl.rawPayload).metadata();
    assert.deepEqual([dm.width, dm.height, dm.density], [1181, 1772, 300]);

    const saved = await a.req('POST', '/api/output/immich', { items: [item], album: { mode: 'name', name: 'Druck' } });
    assert.equal(saved.statusCode, 200, saved.body);
    const newId = saved.json().items[0].assetId;
    let created: any;
    for (let i = 0; i < 30; i++) {
      created = await immich('GET', `/assets/${newId}`, admin.accessToken);
      if (created.exifInfo?.dateTimeOriginal) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(new Date(created.fileCreatedAt).toISOString(), new Date(info.takenAt ?? '2023-05-06T07:08:09.000Z').toISOString(), 'capture date taken over');
    assert.match(created.originalFileName, /^IMG_E2E_10x15_\d{4}-\d{2}-\d{2}\.jpg$/);
    const albums = await immich('GET', '/albums', admin.accessToken);
    const druck = albums.find((x: any) => x.albumName === 'Druck');
    assert.ok(druck, 'album Druck created');
    const inAlbum = await immich('POST', '/search/metadata', admin.accessToken, { albumIds: [druck.id] });
    assert.ok(inAlbum.assets.items.some((x: any) => x.id === newId), 'result is in the album');
    const originalAfter = Buffer.from(await (await fetch(`${IMMICH}/api/assets/${uploaded.id}/original`, { headers: { authorization: `Bearer ${admin.accessToken}` } })).arrayBuffer());
    assert.ok(originalAfter.equals(originalBefore), 'original unchanged');

    // a second user sees nothing of the first one
    const b = new Agent(t.app);
    assert.equal((await b.req('POST', '/api/auth/login', { method: 'password', email: 'user2@example.org', password: 'user2-pass' })).statusCode, 200);
    assert.equal((await b.req('GET', '/api/immich/timeline')).json().items.length, 0);
    assert.equal((await b.req('GET', '/api/immich/albums')).json().items.length, 0);

    // API key login
    const key = await immich('POST', '/api-keys', admin.accessToken, { name: 'fotodruck-e2e', permissions: ['all'] });
    const c = new Agent(t.app);
    assert.equal((await c.req('POST', '/api/auth/login', { method: 'apikey', apiKey: key.secret })).statusCode, 200);
    assert.ok((await c.req('GET', '/api/immich/albums')).json().items.length >= 1);

    console.log('Immich end-to-end test passed.');
  } finally {
    await t.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
