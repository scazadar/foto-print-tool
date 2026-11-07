// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/**
 * Small stand-in for the Immich API (paths and fields as in the Immich
 * OpenAPI spec) used by the tests and for local development. Two users with
 * their own assets and albums.
 */

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import crypto from 'node:crypto';
import sharp from 'sharp';

export interface MockAsset {
  id: string;
  ownerId: string;
  originalFileName: string;
  data: Buffer;
  width: number;
  height: number;
  orientation: string | null;
  fileCreatedAt: string;
  dateTimeOriginal: string | null;
  description?: string;
  faces?: { x1: number; y1: number; x2: number; y2: number }[];
  deviceId?: string;
}

export async function createMockImmich() {
  const users = [
    { id: crypto.randomUUID(), email: 'anna@example.org', password: 'anna-pass', name: 'Anna', isAdmin: true, apiKey: 'key-anna' },
    { id: crypto.randomUUID(), email: 'ben@example.org', password: 'ben-pass', name: 'Ben', isAdmin: false, apiKey: 'key-ben' },
  ];
  const tokens = new Map<string, string>(); // token → user id
  const assets: MockAsset[] = [];
  const albums: { id: string; ownerId: string; albumName: string; assetIds: string[]; sharedWith: string[] }[] = [];
  const calls: { method: string; url: string; headers: Record<string, unknown> }[] = [];

  async function addAsset(owner: string, name: string, w: number, h: number, color: string, taken: string, orientation: string | null = null) {
    // a pattern makes crops and rotations visible
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#fde68a"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      ${Array.from({ length: 9 }, (_, i) => `<line x1="${((i + 1) * w) / 10}" y1="0" x2="${((i + 1) * w) / 10}" y2="${h}" stroke="#fff" stroke-opacity="0.5"/><line x1="0" y1="${((i + 1) * h) / 10}" x2="${w}" y2="${((i + 1) * h) / 10}" stroke="#fff" stroke-opacity="0.5"/>`).join('')}
      <circle cx="${w / 2}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.1}" fill="#1f2937"/>
      <text x="${w * 0.05}" y="${h * 0.95}" font-size="${h * 0.08}" font-family="sans-serif" fill="#111">${name} oben links ↖</text>
      <rect x="0" y="0" width="${w * 0.08}" height="${h * 0.08}" fill="#111"/>
    </svg>`;
    let img = sharp(Buffer.from(svg)).jpeg();
    if (orientation) img = img.withMetadata({ orientation: Number(orientation) });
    const a: MockAsset = {
      id: crypto.randomUUID(),
      ownerId: owner,
      originalFileName: name,
      data: await img.toBuffer(),
      width: w,
      height: h,
      orientation,
      fileCreatedAt: taken,
      dateTimeOriginal: taken,
      faces: [{ x1: 0.4, y1: 0.2, x2: 0.6, y2: 0.4 }],
    };
    assets.push(a);
    return a;
  }

  const a1 = await addAsset(users[0].id, 'IMG_0001.JPG', 3000, 2000, '#cc3333', '2024-07-01T10:00:00.000Z');
  const a2 = await addAsset(users[0].id, 'IMG_0002.JPG', 1600, 1200, '#33cc33', '2024-07-02T10:00:00.000Z', '6');
  const b1 = await addAsset(users[1].id, 'BEN_0001.JPG', 500, 500, '#3333cc', '2023-01-01T10:00:00.000Z');
  albums.push({ id: crypto.randomUUID(), ownerId: users[0].id, albumName: 'Urlaub', assetIds: [a1.id, a2.id], sharedWith: [] });
  albums.push({ id: crypto.randomUUID(), ownerId: users[1].id, albumName: 'Bens Album', assetIds: [b1.id], sharedWith: [] });

  const app = Fastify({ logger: false });
  await app.register(multipart);

  function auth(req: any) {
    const key = req.headers['x-api-key'];
    if (key) return users.find((u) => u.apiKey === key) ?? null;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (m && tokens.has(m[1])) return users.find((u) => u.id === tokens.get(m[1])) ?? null;
    return null;
  }
  const visible = (uid: string, a: MockAsset) =>
    a.ownerId === uid || albums.some((al) => al.sharedWith.includes(uid) && al.assetIds.includes(a.id));

  app.addHook('onRequest', async (req, reply) => {
    calls.push({ method: req.method, url: req.url, headers: { ...req.headers } });
    const open = ['/api/server/ping', '/api/server/version', '/api/auth/login'];
    if (open.includes(req.url.split('?')[0])) return;
    const u = auth(req);
    if (!u) return reply.status(401).send({ message: 'Authentication required' });
    (req as any).u = u;
  });

  const assetDto = (a: MockAsset) => ({
    id: a.id,
    ownerId: a.ownerId,
    originalFileName: a.originalFileName,
    originalMimeType: 'image/jpeg',
    type: 'IMAGE',
    width: a.width,
    height: a.height,
    fileCreatedAt: a.fileCreatedAt,
    localDateTime: a.fileCreatedAt,
    exifInfo: { exifImageWidth: a.width, exifImageHeight: a.height, orientation: a.orientation, dateTimeOriginal: a.dateTimeOriginal, make: 'Test', model: 'Cam' },
  });

  app.get('/api/server/ping', async () => ({ res: 'pong' }));
  app.get('/api/server/version', async () => ({ major: 3, minor: 3, patch: 0, prerelease: null, featureLevel: 1 }));
  app.post('/api/auth/login', async (req, reply) => {
    const b = req.body as any;
    const u = users.find((x) => x.email === b?.email && x.password === b?.password);
    if (!u) return reply.status(401).send({ message: 'Incorrect email or password' });
    const token = crypto.randomBytes(16).toString('hex');
    tokens.set(token, u.id);
    return reply.status(201).send({ accessToken: token, userId: u.id, userEmail: u.email, name: u.name, isAdmin: u.isAdmin });
  });
  app.post('/api/auth/logout', async (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (m) tokens.delete(m[1]);
    return { successful: true };
  });
  app.get('/api/users/me', async (req) => {
    const u = (req as any).u;
    return { id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin, profileImagePath: '' };
  });
  app.get('/api/users/:id/profile-image', async (_req, reply) => reply.status(404).send({}));
  app.get('/api/albums', async (req) => {
    const u = (req as any).u;
    return albums
      .filter((al) => al.ownerId === u.id || al.sharedWith.includes(u.id))
      .map((al) => ({ id: al.id, albumName: al.albumName, assetCount: al.assetIds.length, albumThumbnailAssetId: al.assetIds[0] ?? null, shared: al.sharedWith.length > 0 }));
  });
  app.post('/api/albums', async (req, reply) => {
    const u = (req as any).u;
    const al = { id: crypto.randomUUID(), ownerId: u.id, albumName: (req.body as any).albumName, assetIds: [], sharedWith: [] };
    albums.push(al);
    return reply.status(201).send({ id: al.id, albumName: al.albumName });
  });
  app.put('/api/albums/:id/assets', async (req, reply) => {
    const u = (req as any).u;
    const al = albums.find((x) => x.id === (req.params as any).id && x.ownerId === u.id);
    if (!al) return reply.status(400).send({ message: 'Not found or no album.read access' });
    for (const id of (req.body as any).ids) al.assetIds.push(id);
    return (req.body as any).ids.map((id: string) => ({ id, success: true }));
  });
  app.post('/api/search/metadata', async (req) => {
    const u = (req as any).u;
    const b = req.body as any;
    let list = assets.filter((a) => visible(u.id, a));
    if (b.albumIds?.length) list = list.filter((a) => albums.some((al) => b.albumIds.includes(al.id) && al.assetIds.includes(a.id)));
    if (b.takenAfter) list = list.filter((a) => a.fileCreatedAt >= b.takenAfter);
    return { albums: { items: [], total: 0, count: 0, facets: [] }, assets: { items: list.map(assetDto), total: list.length, count: list.length, facets: [], nextPage: null, nextCursor: null } };
  });
  app.post('/api/search/smart', async (req) => {
    const u = (req as any).u;
    const q = String((req.body as any).query ?? '').toLowerCase();
    const list = assets.filter((a) => visible(u.id, a) && a.originalFileName.toLowerCase().includes(q.slice(0, 3)));
    return { albums: { items: [] }, assets: { items: list.map(assetDto), nextPage: null } };
  });
  app.get('/api/people', async () => ({ people: [], total: 0, hidden: 0, hasNextPage: false }));
  const findAsset = (req: any) => assets.find((a) => a.id === req.params.id && visible(req.u.id, a));
  app.get('/api/assets/:id', async (req, reply) => {
    const a = findAsset(req);
    if (!a) return reply.status(400).send({ message: 'Not found or no asset.read access' });
    return assetDto(a);
  });
  app.put('/api/assets/:id', async (req, reply) => {
    const a = findAsset(req);
    if (!a) return reply.status(400).send({});
    a.description = (req.body as any).description;
    return assetDto(a);
  });
  app.get('/api/faces', async (req) => {
    const a = assets.find((x) => x.id === (req.query as any).id);
    return (a?.faces ?? []).map((f) => ({
      id: crypto.randomUUID(),
      imageWidth: 1000,
      imageHeight: 1000,
      boundingBoxX1: f.x1 * 1000,
      boundingBoxY1: f.y1 * 1000,
      boundingBoxX2: f.x2 * 1000,
      boundingBoxY2: f.y2 * 1000,
    }));
  });
  app.get('/api/assets/:id/thumbnail', async (req, reply) => {
    const a = findAsset(req);
    if (!a) return reply.status(400).send({});
    const size = (req.query as any).size === 'preview' ? 1440 : 250;
    const buf = await sharp(a.data).rotate().resize(size, size, { fit: 'inside' }).jpeg().toBuffer();
    return reply.type('image/jpeg').send(buf);
  });
  app.get('/api/assets/:id/original', async (req, reply) => {
    const a = findAsset(req);
    if (!a) return reply.status(400).send({});
    return reply.type('image/jpeg').send(a.data);
  });
  app.post('/api/assets', async (req, reply) => {
    const u = (req as any).u;
    const fields: Record<string, string> = {};
    let data: Buffer | null = null;
    let filename = '';
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        data = await part.toBuffer();
        filename = part.filename;
      } else fields[part.fieldname] = String(part.value);
    }
    if (!data || !fields.fileCreatedAt || !fields.fileModifiedAt) return reply.status(400).send({ message: 'missing fields' });
    const meta = await sharp(data).metadata();
    const a: MockAsset = {
      id: crypto.randomUUID(),
      ownerId: u.id,
      originalFileName: fields.filename ?? filename,
      data,
      width: meta.width!,
      height: meta.height!,
      orientation: null,
      fileCreatedAt: fields.fileCreatedAt,
      dateTimeOriginal: fields.fileCreatedAt,
      deviceId: fields.deviceId,
    };
    assets.push(a);
    return reply.status(201).send({ id: a.id, status: 'created' });
  });

  await app.listen({ host: '127.0.0.1', port: Number(process.env.MOCK_IMMICH_PORT ?? 0) });
  const addr = app.server.address() as { port: number };
  return { app, url: `http://127.0.0.1:${addr.port}`, users, assets, albums, calls, tokens, ids: { a1: a1.id, a2: a2.id, b1: b1.id } };
}

// `tsx test/mock-immich.ts` runs it standalone for development
if (import.meta.url === `file://${process.argv[1]}`) {
  createMockImmich().then((m) => {
    console.log(`Mock Immich on ${m.url}`);
    for (const u of m.users) console.log(`  ${u.email} / ${u.password}  (API key ${u.apiKey})`);
  });
}
