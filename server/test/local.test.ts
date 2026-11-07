// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultEdit } from '../../shared/edit.js';
import { BUILTIN_FORMATS } from '../../shared/formats.js';
import { Agent, makeApp } from './helpers.js';

const f10x15 = BUILTIN_FORMATS.find((f) => f.id === '10x15')!;

async function phoneJpeg() {
  // stored landscape 400×300 with EXIF orientation 6 → displayed portrait 300×400
  return sharp({ create: { width: 400, height: 300, channels: 3, background: '#3366cc' } })
    .composite([{ input: { create: { width: 100, height: 300, channels: 3, background: '#ff0000' } }, left: 0, top: 0 }])
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe('local mode without Immich', () => {
  let t: Awaited<ReturnType<typeof makeApp>>;
  const a = () => new Agent(t.app);
  let agent: Agent;
  let uploadId: string;

  beforeAll(async () => {
    t = await makeApp();
    agent = a();
  });
  afterAll(async () => t.close());

  it('reports setup required and no Immich', async () => {
    const res = await agent.req('GET', '/api/config');
    expect(res.json()).toMatchObject({ authMode: 'local', immich: false, setupRequired: true, license: 'AGPL-3.0-or-later' });
  });

  it('rejects state changes without the CSRF header', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/setup', payload: { email: 'a@b.c', password: 'x' } });
    expect(res.statusCode).toBe(403);
  });

  it('creates the first admin and logs in', async () => {
    const res = await agent.req('POST', '/api/setup', { email: 'admin@example.org', password: 'sehr-geheim-1' });
    expect(res.statusCode).toBe(200);
    const cookie = res.headers['set-cookie'] as string;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const me = await agent.req('GET', '/api/auth/me');
    expect(me.json()).toMatchObject({ email: 'admin@example.org', isAdmin: true, immichLinked: false });
    const again = await a().req('POST', '/api/setup', { email: 'x@example.org', password: 'sehr-geheim-2' });
    expect(again.statusCode).toBe(409);
  });

  it('rejects wrong passwords', async () => {
    const res = await a().req('POST', '/api/auth/login', { email: 'admin@example.org', password: 'falsch-falsch' });
    expect(res.statusCode).toBe(401);
  });

  it('uploads a phone photo and applies the EXIF orientation', async () => {
    const res = await agent.upload('IMG_1234.JPG', await phoneJpeg());
    expect(res.statusCode).toBe(200);
    const up = res.json();
    expect(up).toMatchObject({ name: 'IMG_1234.JPG', format: 'jpeg', width: 300, height: 400 });
    uploadId = up.id;
    const prev = await agent.req('GET', `/api/uploads/${uploadId}/preview`);
    const meta = await sharp(prev.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([300, 400]);
  });

  it('accepts iPhone HEIC photos and renders them', async () => {
    const heic = fs.readFileSync(new URL('./fixtures/sample.heic', import.meta.url));
    const res = await agent.upload('IMG_5678.HEIC', heic, 'image/heic');
    expect(res.statusCode).toBe(200);
    const up = res.json();
    expect(up).toMatchObject({ format: 'heic', width: 640, height: 480 });
    const out = await agent.req('POST', '/api/output/download', {
      items: [{ source: { kind: 'upload', id: up.id }, format: f10x15, orientation: 'landscape', edit: defaultEdit() }],
      type: 'jpeg',
    });
    const meta = await sharp(out.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([1772, 1181]);
    await agent.req('DELETE', `/api/uploads/${up.id}`);
  });

  it.each(['png', 'webp', 'tiff', 'avif'] as const)('accepts %s uploads', async (fmt) => {
    const img = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#aa5500' } }).toFormat(fmt).toBuffer();
    const res = await agent.upload(`bild.${fmt}`, img);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ format: fmt, width: 320, height: 240 });
    await agent.req('DELETE', `/api/uploads/${res.json().id}`);
  });

  it('rejects non-images by content, not by name', async () => {
    const res = await agent.upload('evil.jpg', Buffer.from('<script>alert(1)</script>'));
    expect(res.statusCode).toBe(415);
  });

  it('keeps uploads private per user', async () => {
    await agent.req('POST', '/api/admin/users', { email: 'bob@example.org', password: 'bob-passwort' });
    const bob = a();
    expect((await bob.req('POST', '/api/auth/login', { email: 'bob@example.org', password: 'bob-passwort' })).statusCode).toBe(200);
    expect((await bob.req('GET', '/api/uploads')).json().items).toHaveLength(0);
    expect((await bob.req('GET', `/api/uploads/${uploadId}/preview`)).statusCode).toBe(404);
  });

  it('exports 10×15 JPEG with exactly 1181 × 1772 px and 300 dpi', async () => {
    const body = {
      items: [{ source: { kind: 'upload', id: uploadId }, format: f10x15, orientation: 'portrait', edit: defaultEdit() }],
      dpi: 300,
      type: 'jpeg',
    };
    const res = await agent.req('POST', '/api/output/download', body);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/IMG_1234_10x15_\d{4}-\d{2}-\d{2}\.jpg/);
    const meta = await sharp(res.rawPayload).metadata();
    expect([meta.width, meta.height, meta.density]).toEqual([1181, 1772, 300]);
    expect(meta.icc).toBeTruthy();
    // orientation 6 turns the stored file 90° clockwise: its red left edge ends up on top
    const { data, info } = await sharp(res.rawPayload).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    expect(px(590, 100)[0]).toBeGreaterThan(200);
    expect(px(590, 100)[2]).toBeLessThan(80);
    expect(px(590, 1700)[2]).toBeGreaterThan(150);
  });

  it('exports landscape as 1772 × 1181', async () => {
    const body = {
      items: [{ source: { kind: 'upload', id: uploadId }, format: f10x15, orientation: 'landscape', edit: { ...defaultEdit(), mode: 'fit' } }],
      type: 'png',
    };
    const res = await agent.req('POST', '/api/output/download', body);
    const meta = await sharp(res.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height, meta.density]).toEqual(['png', 1772, 1181, 300]);
  });

  it('exports a PDF with the exact page size in mm', async () => {
    const body = { items: [{ source: { kind: 'upload', id: uploadId }, format: f10x15, orientation: 'portrait', edit: defaultEdit() }], type: 'pdf' };
    const res = await agent.req('POST', '/api/output/download', body);
    const pdf = await PDFDocument.load(res.rawPayload);
    const { width, height } = pdf.getPage(0).getSize();
    expect((width / 72) * 25.4).toBeCloseTo(100, 2);
    expect((height / 72) * 25.4).toBeCloseTo(150, 2);
  });

  it('lays out 8 passport photos on 10 × 15', async () => {
    const pass = BUILTIN_FORMATS.find((f) => f.id === 'passport-eu')!;
    const body = {
      items: [{ source: { kind: 'upload', id: uploadId }, format: pass, orientation: 'portrait', edit: defaultEdit(), copies: 8 }],
      type: 'jpeg',
      sheet: { sheetId: '10x15', marginMm: 3, gapMm: 1, cropMarks: true },
    };
    const plan = await agent.req('POST', '/api/output/sheet-plan', body);
    expect(plan.json().pages[0].placements).toHaveLength(8);
    const res = await agent.req('POST', '/api/output/download', body);
    const meta = await sharp(res.rawPayload).metadata();
    expect([meta.width, meta.height].sort()).toEqual([1181, 1772]);
  });

  it('downloads several pictures as ZIP', async () => {
    const it1 = { source: { kind: 'upload', id: uploadId }, format: f10x15, orientation: 'portrait', edit: defaultEdit() };
    const res = await agent.req('POST', '/api/output/download', { items: [it1, it1], type: 'jpeg' });
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  it('stores custom formats per user', async () => {
    const res = await agent.req('POST', '/api/formats', { name: 'Labor 10,2 × 15,2', width: 10.2, height: 15.2, unit: 'cm' });
    expect(res.statusCode).toBe(200);
    expect((await agent.req('GET', '/api/formats')).json().custom).toHaveLength(1);
    const bob = a();
    await bob.req('POST', '/api/auth/login', { email: 'bob@example.org', password: 'bob-passwort' });
    expect((await bob.req('GET', '/api/formats')).json().custom).toHaveLength(0);
  });

  it('deletes uploads after the retention period', async () => {
    const { cleanup } = await import('../src/storage.js');
    const r = await cleanup(t.ctx, Date.now() + 8 * 86400_000);
    expect(r.uploads).toBe(1);
    expect((await agent.req('GET', '/api/uploads')).json().items).toHaveLength(0);
  });
});
