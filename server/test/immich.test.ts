// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultEdit } from '../../shared/edit.js';
import { BUILTIN_FORMATS } from '../../shared/formats.js';
import { Agent, makeApp } from './helpers.js';
import { createMockImmich } from './mock-immich.js';

const f10x15 = BUILTIN_FORMATS.find((f) => f.id === '10x15')!;

describe('AUTH_MODE=immich', () => {
  let mock: Awaited<ReturnType<typeof createMockImmich>>;
  let t: Awaited<ReturnType<typeof makeApp>>;
  let anna: Agent;
  let ben: Agent;
  const bodies: string[] = [];

  const track = (a: Agent) => {
    const orig = a.req.bind(a);
    a.req = async (...args: Parameters<Agent['req']>) => {
      const res = await orig(...args);
      bodies.push(res.body);
      for (const v of Object.values(res.headers)) bodies.push(String(v));
      return res;
    };
    return a;
  };

  beforeAll(async () => {
    mock = await createMockImmich();
    t = await makeApp({ IMMICH_URL: mock.url, IMMICH_PUBLIC_URL: 'https://fotos.example.org' });
    anna = track(new Agent(t.app));
    ben = track(new Agent(t.app));
  });
  afterAll(async () => {
    await t.close();
    await mock.app.close();
  });

  it('defaults to Immich login when IMMICH_URL is set', async () => {
    const res = await anna.req('GET', '/api/config');
    expect(res.json()).toMatchObject({ authMode: 'immich', immich: true, setupRequired: false });
  });

  it('logs in with the Immich password', async () => {
    expect((await anna.req('POST', '/api/auth/login', { email: 'anna@example.org', password: 'falsch' })).statusCode).toBe(401);
    const res = await anna.req('POST', '/api/auth/login', { method: 'password', email: 'anna@example.org', password: 'anna-pass' });
    expect(res.statusCode).toBe(200);
    expect((await anna.req('GET', '/api/auth/me')).json()).toMatchObject({ name: 'Anna', isAdmin: true, immichLinked: true, kind: 'immich' });
  });

  it('logs in with a personal API key', async () => {
    expect((await ben.req('POST', '/api/auth/login', { method: 'apikey', apiKey: 'wrong' })).statusCode).toBe(401);
    const res = await ben.req('POST', '/api/auth/login', { method: 'apikey', apiKey: 'key-ben' });
    expect(res.statusCode).toBe(200);
    expect((await ben.req('GET', '/api/auth/me')).json()).toMatchObject({ name: 'Ben', isAdmin: false });
  });

  it('reports the Immich status', async () => {
    const s = (await anna.req('GET', '/api/immich/status')).json();
    expect(s).toMatchObject({ configured: true, reachable: true, version: '3.3.0', tooOld: false, linked: true, credentialValid: true });
  });

  it('shows every user only their own albums and photos', async () => {
    const aAlbums = (await anna.req('GET', '/api/immich/albums')).json().items;
    const bAlbums = (await ben.req('GET', '/api/immich/albums')).json().items;
    expect(aAlbums.map((a: any) => a.name)).toEqual(['Urlaub']);
    expect(bAlbums.map((a: any) => a.name)).toEqual(['Bens Album']);
    const content = (await anna.req('GET', `/api/immich/albums/${aAlbums[0].id}/assets`)).json();
    expect(content.items).toHaveLength(2);
    const timeline = (await ben.req('GET', '/api/immich/timeline')).json();
    expect(timeline.items.map((i: any) => i.id)).toEqual([mock.ids.b1]);
    expect((await ben.req('GET', `/api/immich/assets/${mock.ids.a1}/thumb`)).statusCode).toBe(400);
    expect((await anna.req('POST', '/api/immich/search', { query: 'IMG' })).json().items.length).toBe(2);
  });

  it('returns the oriented original size and faces', async () => {
    const info = (await anna.req('GET', `/api/immich/assets/${mock.ids.a2}`)).json();
    // stored 1600 × 1200 with orientation 6 → 1200 × 1600
    expect([info.width, info.height]).toEqual([1200, 1600]);
    expect(info.faces[0]).toMatchObject({ x1: 0.4, y1: 0.2 });
    expect(info.url).toBe(`https://fotos.example.org/photos/${mock.ids.a2}`);
  });

  it('saves the result as a new asset with the capture date, in the album "Druck"', async () => {
    const before = mock.assets.length;
    const original = Buffer.from(mock.assets.find((a) => a.id === mock.ids.a1)!.data);
    const res = await anna.req('POST', '/api/output/immich', {
      items: [{ source: { kind: 'immich', id: mock.ids.a1 }, format: f10x15, orientation: 'landscape', edit: defaultEdit() }],
      album: { mode: 'name', name: 'Druck' },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(mock.assets.length).toBe(before + 1);
    const created = mock.assets.find((a) => a.id === out.items[0].assetId)!;
    expect(created.ownerId).toBe(mock.users[0].id);
    expect(created.fileCreatedAt).toBe('2024-07-01T10:00:00.000Z');
    expect(created.deviceId).toBe('immich-print');
    expect(created.originalFileName).toMatch(/^IMG_0001_10x15_\d{4}-\d{2}-\d{2}\.jpg$/);
    expect(created.description).toBe('Druckversion 10×15 von IMG_0001');
    expect([created.width, created.height]).toEqual([1772, 1181]);
    expect((await sharp(created.data).metadata()).density).toBe(300);
    const album = mock.albums.find((a) => a.albumName === 'Druck')!;
    expect(album.ownerId).toBe(mock.users[0].id);
    expect(album.assetIds).toContain(created.id);
    // the original is untouched
    expect(mock.assets.find((a) => a.id === mock.ids.a1)!.data.equals(original)).toBe(true);
    expect(out.items[0].url).toBe(`https://fotos.example.org/photos/${created.id}`);
  });

  it('uploads end up in the account of the signed-in user', async () => {
    const res = await ben.req('POST', '/api/output/immich', {
      items: [{ source: { kind: 'immich', id: mock.ids.b1 }, format: f10x15, orientation: 'portrait', edit: defaultEdit() }],
      album: { mode: 'none' },
    });
    expect(res.statusCode).toBe(200);
    const created = mock.assets.find((a) => a.id === res.json().items[0].assetId)!;
    expect(created.ownerId).toBe(mock.users[1].id);
    // Ben cannot render Anna's photos
    const denied = await ben.req('POST', '/api/output/download', {
      items: [{ source: { kind: 'immich', id: mock.ids.a1 }, format: f10x15, orientation: 'portrait', edit: defaultEdit() }],
    });
    expect(denied.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('sends Immich requests with the credential of the user', async () => {
    const annaToken = [...mock.tokens.entries()].find(([, id]) => id === mock.users[0].id)![0];
    expect(mock.calls.some((c) => c.headers.authorization === `Bearer ${annaToken}`)).toBe(true);
    expect(mock.calls.some((c) => c.headers['x-api-key'] === 'key-ben')).toBe(true);
  });

  it('never sends Immich tokens or API keys to the browser', async () => {
    const secrets = [...mock.tokens.keys(), 'key-anna', 'key-ben'];
    for (const b of bodies) for (const s of secrets) expect(b.includes(s)).toBe(false);
    // and stores them encrypted only
    const rows = t.ctx.db.prepare('SELECT immich_cred FROM sessions').all() as { immich_cred: string }[];
    for (const r of rows) for (const s of secrets) expect(r.immich_cred.includes(s)).toBe(false);
  });

  it('logs out and revokes the Immich token', async () => {
    const before = mock.tokens.size;
    await anna.req('POST', '/api/auth/logout');
    expect(mock.tokens.size).toBe(before - 1);
    expect((await anna.req('GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('ends the session when the Immich token expires', async () => {
    const a = new Agent(t.app);
    await a.req('POST', '/api/auth/login', { method: 'password', email: 'anna@example.org', password: 'anna-pass' });
    mock.tokens.clear();
    const res = await a.req('GET', '/api/immich/albums');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('immich.sessionExpired');
    expect((await a.req('GET', '/api/auth/me')).statusCode).toBe(401);
  });
});

describe('local accounts with linked Immich account', () => {
  it('links and unlinks an Immich account', async () => {
    const mock = await createMockImmich();
    const t = await makeApp({ IMMICH_URL: mock.url, AUTH_MODE: 'local', ADMIN_EMAIL: 'admin@example.org', ADMIN_PASSWORD: 'admin-pass' });
    try {
      const a = new Agent(t.app);
      expect((await a.req('POST', '/api/auth/login', { email: 'admin@example.org', password: 'admin-pass' })).statusCode).toBe(200);
      expect((await a.req('GET', '/api/immich/albums')).json().error).toBe('immich.notLinked');
      const link = await a.req('POST', '/api/account/immich', { method: 'apikey', apiKey: 'key-anna' });
      expect(link.json()).toMatchObject({ ok: true, immichName: 'Anna' });
      expect((await a.req('GET', '/api/immich/albums')).json().items).toHaveLength(1);
      await a.req('DELETE', '/api/account/immich');
      expect((await a.req('GET', '/api/auth/me')).json().immichLinked).toBe(false);
    } finally {
      await t.close();
      await mock.app.close();
    }
  });
});
