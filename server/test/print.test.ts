// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import http from 'node:http';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultEdit } from '../../shared/edit.js';
import { BUILTIN_FORMATS } from '../../shared/formats.js';
import { decodeResponse, encodeRequest, OP, TAG, type TypedAttr } from '../src/ipp.js';
import { parseMediaName } from '../src/print.js';
import { Agent, makeApp } from './helpers.js';

/** Minimal CUPS: two queues, "photo" (borderless) and "office" (5 mm margins). */
function mockCups() {
  const received: { op: number; path: string; attrs: Record<string, unknown[]>; groups: any[]; data: Buffer }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const parsed = decodeResponse(body); // same layout as a request: "statusCode" is the operation
      // find the end of the attributes to get the document data
      const endIdx = findEnd(body);
      const op = parsed.statusCode;
      const attrs = Object.assign({}, ...parsed.groups.map((g) => g.attrs));
      received.push({ op, path: req.url ?? '', attrs, groups: parsed.groups, data: body.subarray(endIdx) });
      const groups: { tag: number; attrs: TypedAttr[] }[] = [
        {
          tag: TAG.operation,
          attrs: [
            { name: 'attributes-charset', tag: TAG.charset, values: ['utf-8'] },
            { name: 'attributes-natural-language', tag: TAG.naturalLanguage, values: ['de'] },
          ],
        },
      ];
      const queue = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
      if (op === OP.cupsGetPrinters) {
        for (const name of ['photo', 'office']) {
          groups.push({ tag: TAG.printer, attrs: [{ name: 'printer-name', tag: TAG.name, values: [name] }, { name: 'printer-uri-supported', tag: TAG.uri, values: [`ipp://cups.internal/printers/${name}`] }] });
        }
      } else if (op === OP.getPrinterAttributes) {
        const margins = queue === 'photo' ? [0, 300] : [500];
        groups.push({
          tag: TAG.printer,
          attrs: [
            { name: 'printer-name', tag: TAG.name, values: [queue] },
            { name: 'printer-state', tag: TAG.enum, values: [3] },
            { name: 'printer-is-accepting-jobs', tag: TAG.boolean, values: [true] },
            { name: 'media-supported', tag: TAG.keyword, values: ['na_index-4x6_4x6in', 'iso_a4_210x297mm'] },
            { name: 'media-default', tag: TAG.keyword, values: ['iso_a4_210x297mm'] },
            { name: 'media-type-supported', tag: TAG.keyword, values: ['stationery', 'photographic-glossy'] },
            ...['top', 'bottom', 'left', 'right'].map((s) => ({ name: `media-${s}-margin-supported`, tag: TAG.integer, values: margins })),
            { name: 'print-scaling-supported', tag: TAG.keyword, values: ['auto', 'fit', 'none'] },
          ],
        });
      } else if (op === OP.printJob) {
        groups.push({ tag: TAG.job, attrs: [{ name: 'job-id', tag: TAG.integer, values: [42] }, { name: 'job-state', tag: TAG.enum, values: [3] }] });
      } else if (op === OP.getJobAttributes) {
        groups.push({ tag: TAG.job, attrs: [{ name: 'job-state', tag: TAG.enum, values: [9] }] });
      }
      const out = encodeRequest(0x0000, parsed.requestId, groups);
      res.writeHead(200, { 'content-type': 'application/ipp' });
      res.end(out);
    });
  });
  return { server, received };
}

/** Byte offset after the end-of-attributes tag of an IPP message. */
function findEnd(b: Buffer): number {
  let p = 8;
  while (p < b.length) {
    const tag = b[p++];
    if (tag === TAG.end) return p;
    if (tag < 0x10) continue;
    const nl = b.readUInt16BE(p);
    p += 2 + nl;
    const vl = b.readUInt16BE(p);
    p += 2 + vl;
  }
  return p;
}

describe('IPP encoding', () => {
  it('round-trips attributes and collections', () => {
    const msg = encodeRequest(OP.printJob, 7, [
      { tag: TAG.operation, attrs: [{ name: 'attributes-charset', tag: TAG.charset, values: ['utf-8'] }] },
      {
        tag: TAG.job,
        attrs: [
          { name: 'copies', tag: TAG.integer, values: [2] },
          { name: 'media-col', tag: TAG.begCollection, values: [{ members: [{ name: 'media-size', tag: TAG.begCollection, values: [{ members: [{ name: 'x-dimension', tag: TAG.integer, values: [10160] }] }] }, { name: 'media-top-margin', tag: TAG.integer, values: [0] }] }] },
          { name: 'finishings', tag: TAG.enum, values: [3, 4] },
        ],
      },
    ]);
    const r = decodeResponse(msg);
    expect(r.statusCode).toBe(OP.printJob);
    expect(r.requestId).toBe(7);
    const job = r.groups[1].attrs;
    expect(job.copies).toEqual([2]);
    expect(job.finishings).toEqual([3, 4]);
    expect(job['media-col'][0]).toEqual({ 'media-size': { 'x-dimension': 10160 }, 'media-top-margin': 0 });
  });

  it('parses PWG media names', () => {
    expect(parseMediaName('na_index-4x6_4x6in')).toEqual({ wMm: 101.6, hMm: 152.4 });
    expect(parseMediaName('iso_a4_210x297mm')).toEqual({ wMm: 210, hMm: 297 });
  });
});

describe('server printing via CUPS', () => {
  const cups = mockCups();
  let t: Awaited<ReturnType<typeof makeApp>>;
  let agent: Agent;
  let uploadId: string;
  const f10x15 = BUILTIN_FORMATS.find((f) => f.id === '10x15')!;

  beforeAll(async () => {
    await new Promise<void>((r) => cups.server.listen(0, '127.0.0.1', () => r()));
    const port = (cups.server.address() as any).port;
    t = await makeApp({ CUPS_URL: `ipp://127.0.0.1:${port}`, AUTH_MODE: 'local', ADMIN_EMAIL: 'admin@example.org', ADMIN_PASSWORD: 'admin-pass' });
    agent = new Agent(t.app);
    await agent.req('POST', '/api/auth/login', { email: 'admin@example.org', password: 'admin-pass' });
    const jpeg = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: '#888' } }).jpeg().toBuffer();
    uploadId = (await agent.upload('foto.jpg', jpeg)).json().id;
  });
  afterAll(async () => {
    await t.close();
    cups.server.close();
  });

  it('lists printers and offers borderless only where the printer reports zero margins', async () => {
    const res = (await agent.req('GET', '/api/print/printers')).json();
    expect(res.configured).toBe(true);
    const byName = Object.fromEntries(res.items.map((p: any) => [p.name, p]));
    expect(byName.photo.borderless).toBe(true);
    expect(byName.office.borderless).toBe(false);
    expect(byName.photo.media.map((m: any) => m.key)).toContain('na_index-4x6_4x6in');
  });

  it('prints an exact-size PDF with the user name, media and no scaling', async () => {
    const printers = (await agent.req('GET', '/api/print/printers')).json().items;
    const photo = printers.find((p: any) => p.name === 'photo');
    const res = await agent.req('POST', '/api/print/jobs', {
      items: [{ source: { kind: 'upload', id: uploadId }, format: f10x15, orientation: 'portrait', edit: defaultEdit(), copies: 2 }],
      printer: photo.id,
      media: 'na_index-4x6_4x6in',
      mediaType: 'photographic-glossy',
      borderless: true,
      copies: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'waiting', borderless: true });
    const job = cups.received.filter((r) => r.op === OP.printJob).pop()!;
    expect(job.attrs['requesting-user-name']).toEqual(['admin']);
    expect(job.attrs['print-scaling']).toEqual(['none']);
    expect(job.attrs['document-format']).toEqual(['application/pdf']);
    expect(job.attrs['media-col'][0]).toMatchObject({
      'media-size': { 'x-dimension': 10160, 'y-dimension': 15240 },
      'media-top-margin': 0,
      'media-bottom-margin': 0,
      'media-type': 'photographic-glossy',
    });
    const pdf = await PDFDocument.load(job.data);
    expect(pdf.getPageCount()).toBe(2); // two copies of the picture
    const { width, height } = pdf.getPage(0).getSize();
    expect((width / 72) * 25.4).toBeCloseTo(100, 2);
    expect((height / 72) * 25.4).toBeCloseTo(150, 2);
  });

  it('ignores borderless on printers without it (exact size with the smallest margin)', async () => {
    const printers = (await agent.req('GET', '/api/print/printers')).json().items;
    const office = printers.find((p: any) => p.name === 'office');
    const res = await agent.req('POST', '/api/print/jobs', {
      items: [{ source: { kind: 'upload', id: uploadId }, format: f10x15, orientation: 'portrait', edit: defaultEdit() }],
      printer: office.id,
      media: 'iso_a4_210x297mm',
      borderless: true,
    });
    expect(res.json().borderless).toBe(false);
    const job = cups.received.filter((r) => r.op === OP.printJob).pop()!;
    expect(job.attrs['media-col'][0]).not.toHaveProperty('media-top-margin');
    const pdf = await PDFDocument.load(job.data);
    const { width } = pdf.getPage(0).getSize();
    expect((width / 72) * 25.4).toBeCloseTo(100, 2);
  });

  it('shows the job status of the own jobs only', async () => {
    const jobs = (await agent.req('GET', '/api/print/jobs')).json().items;
    expect(jobs.length).toBe(2);
    expect(jobs.every((j: any) => j.state === 'done')).toBe(true);
    await agent.req('POST', '/api/admin/users', { email: 'eve@example.org', password: 'eve-passwort' });
    const eve = new Agent(t.app);
    await eve.req('POST', '/api/auth/login', { email: 'eve@example.org', password: 'eve-passwort' });
    expect((await eve.req('GET', '/api/print/jobs')).json().items).toHaveLength(0);
  });

  it('lets the admin hide printers', async () => {
    const all = (await agent.req('GET', '/api/admin/printers')).json().items;
    await agent.req('PUT', '/api/admin/settings', { visiblePrinters: [all.find((p: any) => p.name === 'photo').id] });
    const vis = (await agent.req('GET', '/api/print/printers')).json().items;
    expect(vis.map((p: any) => p.name)).toEqual(['photo']);
  });
});
