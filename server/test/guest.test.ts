// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultEdit } from '../../shared/edit.js';
import { BUILTIN_FORMATS } from '../../shared/formats.js';
import { cleanup, userDirName } from '../src/storage.js';
import { Agent, makeApp } from './helpers.js';
import { createMockImmich } from './mock-immich.js';

const f10x15 = BUILTIN_FORMATS.find((f) => f.id === '10x15')!;
const jpeg = () => sharp({ create: { width: 600, height: 400, channels: 3, background: '#4488cc' } }).jpeg().toBuffer();

describe('guest access', () => {
  it('is off by default', async () => {
    const t = await makeApp({ AUTH_MODE: 'local', ADMIN_EMAIL: 'admin@example.org', ADMIN_PASSWORD: 'admin-pass' });
    try {
      const a = new Agent(t.app);
      expect((await a.req('GET', '/api/config')).json().guestAccess).toBe(false);
      expect((await a.req('POST', '/api/auth/guest')).statusCode).toBe(403);
    } finally {
      await t.close();
    }
  });

  describe('when enabled', () => {
    let mock: Awaited<ReturnType<typeof createMockImmich>>;
    let t: Awaited<ReturnType<typeof makeApp>>;

    beforeAll(async () => {
      mock = await createMockImmich();
      t = await makeApp({ IMMICH_URL: mock.url, CUPS_URL: 'ipp://127.0.0.1:9/', GUEST_ACCESS: 'true', GUEST_SESSION_HOURS: '2', GUEST_MAX_UPLOADS: '2' });
    });
    afterAll(async () => {
      await t.close();
      await mock.app.close();
    });

    it('offers guest login and signs in anonymously', async () => {
      const g = new Agent(t.app);
      expect((await g.req('GET', '/api/config')).json()).toMatchObject({ guestAccess: true, guestSessionHours: 2 });
      expect((await g.req('POST', '/api/auth/guest')).statusCode).toBe(200);
      expect((await g.req('GET', '/api/auth/me')).json()).toMatchObject({ kind: 'guest', name: 'Gast', isAdmin: false, immichLinked: false });
    });

    it('lets guests upload, edit and download', async () => {
      const g = new Agent(t.app);
      await g.req('POST', '/api/auth/guest');
      const up = await g.upload('urlaub.jpg', await jpeg());
      expect(up.statusCode).toBe(200);
      const out = await g.req('POST', '/api/output/download', {
        items: [{ source: { kind: 'upload', id: up.json().id }, format: f10x15, orientation: 'landscape', edit: defaultEdit() }],
        type: 'jpeg',
      });
      expect(out.statusCode).toBe(200);
      expect((await sharp(out.rawPayload).metadata()).width).toBe(1772);
    });

    it('limits the number of uploads per guest', async () => {
      const g = new Agent(t.app);
      await g.req('POST', '/api/auth/guest');
      await g.upload('1.jpg', await jpeg());
      await g.upload('2.jpg', await jpeg());
      const third = await g.upload('3.jpg', await jpeg());
      expect(third.statusCode).toBe(429);
      expect(third.json()).toMatchObject({ error: 'upload.guestLimit', max: 2 });
    });

    it('blocks network functions: Immich, server printing, administration', async () => {
      const g = new Agent(t.app);
      await g.req('POST', '/api/auth/guest');
      const denied = [
        await g.req('GET', '/api/immich/status'),
        await g.req('GET', '/api/immich/albums'),
        await g.req('GET', `/api/immich/assets/${mock.ids.a1}/thumb`),
        await g.req('POST', '/api/output/immich', { items: [] }),
        await g.req('POST', '/api/account/immich', { method: 'apikey', apiKey: 'key-anna' }),
        await g.req('GET', '/api/print/printers'),
        await g.req('POST', '/api/print/jobs', {}),
        await g.req('GET', '/api/print/jobs'),
        await g.req('GET', '/api/admin/users'),
      ];
      for (const r of denied) expect(r.statusCode).toBe(403);
      expect(denied[0].json().error).toBe('auth.guestNotAllowed');
      // and cannot render Immich photos through the download route
      const viaRender = await g.req('POST', '/api/output/download', {
        items: [{ source: { kind: 'immich', id: mock.ids.a1 }, format: f10x15, orientation: 'portrait', edit: defaultEdit() }],
      });
      expect(viaRender.statusCode).toBe(403);
      const link = await g.req('GET', '/api/auth/oauth/start?mode=link');
      expect(link.headers.location).toBe('/?oauth_error=auth.guestNotAllowed');
    });

    it('keeps guests apart from each other', async () => {
      const a = new Agent(t.app);
      const b = new Agent(t.app);
      await a.req('POST', '/api/auth/guest');
      await b.req('POST', '/api/auth/guest');
      const id = (await a.upload('a.jpg', await jpeg())).json().id;
      expect((await b.req('GET', '/api/uploads')).json().items).toHaveLength(0);
      expect((await b.req('GET', `/api/uploads/${id}/preview`)).statusCode).toBe(404);
    });

    it('deletes everything on logout', async () => {
      const g = new Agent(t.app);
      await g.req('POST', '/api/auth/guest');
      const meId = (await g.req('GET', '/api/auth/me')).json().id;
      await g.upload('weg.jpg', await jpeg());
      const dir = path.join(t.dataDir, 'uploads', userDirName(meId));
      expect(fs.existsSync(dir)).toBe(true);
      await g.req('POST', '/api/auth/logout');
      expect(fs.existsSync(dir)).toBe(false);
      expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(meId)).toEqual({ n: 0 });
      expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM uploads WHERE user_id = ?').get(meId)).toEqual({ n: 0 });
    });

    it('removes guests after GUEST_SESSION_HOURS', async () => {
      const g = new Agent(t.app);
      await g.req('POST', '/api/auth/guest');
      const meId = (await g.req('GET', '/api/auth/me')).json().id;
      await g.upload('alt.jpg', await jpeg());
      const r = await cleanup(t.ctx, Date.now() + 3 * 3600_000);
      expect(r.guests).toBeGreaterThanOrEqual(1);
      expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(meId)).toEqual({ n: 0 });
      expect((await g.req('GET', '/api/auth/me')).statusCode).toBe(401);
    });

    it('does not list guests in the administration', async () => {
      const admin = new Agent(t.app);
      await admin.req('POST', '/api/auth/login', { method: 'apikey', apiKey: 'key-anna' });
      const users = (await admin.req('GET', '/api/admin/users')).json();
      expect(users.every((u: any) => u.kind !== 'guest')).toBe(true);
    });
  });
});
