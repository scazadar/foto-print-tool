// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import type { FastifyInstance } from 'fastify';
import { formatSizeMm } from '../../shared/formats.js';
import { type AppContext, HttpError, requireNotGuest, requireUser, type SessionUser } from './context.js';
import { getAppSetting } from './db.js';
import {
  enumAttr,
  intAttr,
  ippRequest,
  IppError,
  kw,
  nameAttr,
  OP,
  TAG,
  type IppValue,
  type TypedAttr,
  type TypedCollection,
  uriAttr,
} from './ipp.js';
import { parseOutputRequest, renderSheet, renderSingles } from './output.js';
import { buildPdf } from './render.js';

export interface PrinterInfo {
  id: string;
  name: string;
  info: string | null;
  state: 'idle' | 'processing' | 'stopped' | 'unknown';
  stateReasons: string[];
  accepting: boolean;
  media: { key: string; label: string; wMm: number | null; hMm: number | null }[];
  mediaDefault: string | null;
  mediaTypes: string[];
  mediaSources: string[];
  borderless: boolean;
  color: boolean;
  scalingNone: boolean;
  maxCopies: number;
}

/** Job owner as shown in CUPS. */
function userLabel(u: SessionUser): string {
  return (u.name || u.email || u.id).replace(/[^\p{L}\p{N} ._@-]/gu, '_').slice(0, 127);
}

const STATE: Record<number, PrinterInfo['state']> = { 3: 'idle', 4: 'processing', 5: 'stopped' };

/** Parse a PWG 5101.1 self-describing media name, e.g. "na_index-4x6_4x6in" → mm. */
export function parseMediaName(key: string): { wMm: number; hMm: number } | null {
  const m = /_([\d.]+)x([\d.]+)(mm|in)$/.exec(key);
  if (!m) return null;
  const f = m[3] === 'in' ? 25.4 : 1;
  const r = (v: number) => Math.round(v * f * 100) / 100;
  return { wMm: r(Number(m[1])), hMm: r(Number(m[2])) };
}

function mediaLabel(key: string): string {
  const known: Record<string, string> = {
    iso_a4_210x297mm: 'A4',
    iso_a3_297x420mm: 'A3',
    iso_a5_148x210mm: 'A5',
    iso_a6_105x148mm: 'A6',
    'na_letter_8.5x11in': 'Letter',
    'na_index-4x6_4x6in': '10 × 15 cm (4 × 6 in)',
    'na_5x7_5x7in': '13 × 18 cm (5 × 7 in)',
    'om_small-photo_100x150mm': '10 × 15 cm',
    'na_govt-letter_8x10in': '20 × 25 cm (8 × 10 in)',
  };
  if (known[key]) return known[key];
  const d = parseMediaName(key);
  return d ? `${key.split('_')[1] ?? key} (${Math.round(d.wMm)} × ${Math.round(d.hMm)} mm)` : key;
}

const asStrings = (v: IppValue[] | undefined) => (v ?? []).filter((x): x is string => typeof x === 'string');

function supportsZero(v: IppValue[] | undefined): boolean {
  return (v ?? []).some((x) => x === 0);
}

async function printerAttributes(uri: string): Promise<Record<string, IppValue[]>> {
  const res = await ippRequest(uri, OP.getPrinterAttributes, {
    operation: [
      uriAttr('printer-uri', uri),
      kw(
        'requested-attributes',
        'printer-name',
        'printer-info',
        'printer-make-and-model',
        'printer-state',
        'printer-state-reasons',
        'printer-is-accepting-jobs',
        'media-supported',
        'media-default',
        'media-type-supported',
        'media-source-supported',
        'media-bottom-margin-supported',
        'media-top-margin-supported',
        'media-left-margin-supported',
        'media-right-margin-supported',
        'print-scaling-supported',
        'color-supported',
        'copies-supported',
      ),
    ],
  });
  return res.groups.find((g) => g.tag === TAG.printer)?.attrs ?? {};
}

function toPrinterInfo(uri: string, a: Record<string, IppValue[]>): PrinterInfo {
  const media = asStrings(a['media-supported']).map((key) => {
    const d = parseMediaName(key);
    return { key, label: mediaLabel(key), wMm: d?.wMm ?? null, hMm: d?.hMm ?? null };
  });
  const copies = a['copies-supported']?.[0] as { upper: number } | undefined;
  return {
    id: uri,
    name: String(a['printer-name']?.[0] ?? a['printer-make-and-model']?.[0] ?? uri),
    info: (a['printer-info']?.[0] as string) ?? (a['printer-make-and-model']?.[0] as string) ?? null,
    state: STATE[Number(a['printer-state']?.[0])] ?? 'unknown',
    stateReasons: asStrings(a['printer-state-reasons']).filter((r) => r !== 'none'),
    accepting: a['printer-is-accepting-jobs']?.[0] !== false,
    media,
    mediaDefault: (a['media-default']?.[0] as string) ?? null,
    mediaTypes: asStrings(a['media-type-supported']),
    mediaSources: asStrings(a['media-source-supported']),
    borderless:
      supportsZero(a['media-bottom-margin-supported']) &&
      supportsZero(a['media-top-margin-supported']) &&
      supportsZero(a['media-left-margin-supported']) &&
      supportsZero(a['media-right-margin-supported']),
    color: a['color-supported']?.[0] !== false,
    scalingNone: asStrings(a['print-scaling-supported']).includes('none'),
    maxCopies: copies?.upper ?? 99,
  };
}

let printerCache: { at: number; list: PrinterInfo[] } | null = null;

/** All printers behind CUPS_URL: a CUPS server (CUPS-Get-Printers) or a single IPP printer. */
export async function discoverPrinters(ctx: AppContext, force = false): Promise<PrinterInfo[]> {
  const base = ctx.config.cupsUrl;
  if (!base) return [];
  if (!force && printerCache && Date.now() - printerCache.at < 60_000) return printerCache.list;
  let uris: string[] = [];
  const u = new URL(base);
  if (u.pathname === '/' || u.pathname === '') {
    try {
      const res = await ippRequest(base, OP.cupsGetPrinters, {
        operation: [kw('requested-attributes', 'printer-uri-supported', 'printer-name')],
      });
      for (const g of res.groups.filter((g) => g.tag === TAG.printer)) {
        const name = g.attrs['printer-name']?.[0];
        if (typeof name === 'string') {
          // address the queue through CUPS_URL (the URIs CUPS reports may use an internal host name)
          uris.push(`${base.replace(/\/$/, '')}/printers/${encodeURIComponent(name)}`);
        }
      }
    } catch (err) {
      if (err instanceof IppError && err.code === 'print.unreachable') throw err;
      uris = [];
    }
  }
  if (uris.length === 0) uris = [base];
  const list: PrinterInfo[] = [];
  for (const uri of uris) {
    try {
      list.push(toPrinterInfo(uri, await printerAttributes(uri)));
    } catch {
      /* skip printers that do not answer */
    }
  }
  printerCache = { at: Date.now(), list };
  return list;
}

export async function visiblePrinters(ctx: AppContext, force = false): Promise<PrinterInfo[]> {
  const all = await discoverPrinters(ctx, force);
  const visible = getAppSetting<string[] | null>(ctx.db, 'visiblePrinters', null);
  return visible ? all.filter((p) => visible.includes(p.id)) : all;
}

const JOB_STATE: Record<number, string> = {
  3: 'waiting',
  4: 'waiting',
  5: 'printing',
  6: 'error',
  7: 'canceled',
  8: 'error',
  9: 'done',
};
const FINAL = new Set(['done', 'error', 'canceled']);

function mediaCol(key: string, borderless: boolean, mediaType?: string, source?: string): TypedCollection | null {
  const d = parseMediaName(key);
  if (!d) return null;
  const members: TypedAttr[] = [
    {
      name: 'media-size',
      tag: TAG.begCollection,
      values: [
        {
          members: [intAttr('x-dimension', Math.round(d.wMm * 100)), intAttr('y-dimension', Math.round(d.hMm * 100))],
        },
      ],
    },
  ];
  if (borderless) {
    for (const side of ['top', 'bottom', 'left', 'right']) members.push(intAttr(`media-${side}-margin`, 0));
  }
  if (mediaType) members.push(kw('media-type', mediaType));
  if (source) members.push(kw('media-source', source));
  return { members };
}

async function submitJob(ctx: AppContext, user: SessionUser, body: any) {
  const printers = await visiblePrinters(ctx);
  const printer = printers.find((p) => p.id === body?.printer);
  if (!printer) throw new HttpError(404, 'print.printerNotFound');
  if (!printer.accepting || printer.state === 'stopped') throw new HttpError(409, 'print.printerOffline');
  const r = parseOutputRequest({ ...body, type: 'jpeg' }, ctx.config.defaultDpi);
  const media = typeof body.media === 'string' && printer.media.some((m) => m.key === body.media) ? body.media : printer.mediaDefault;
  const borderless = body.borderless === true && printer.borderless;
  const mediaType = typeof body.mediaType === 'string' && printer.mediaTypes.includes(body.mediaType) ? body.mediaType : undefined;
  const source = typeof body.mediaSource === 'string' && printer.mediaSources.includes(body.mediaSource) ? body.mediaSource : undefined;
  const copies = Math.max(1, Math.min(printer.maxCopies, Math.floor(Number(body.copies) || 1)));

  // exact-size PDF: a page per picture (repeated by its copy count) or per sheet
  let pdf: Buffer;
  let title: string;
  if (r.sheet) {
    const { layout, pages } = await renderSheet(ctx, user, r, 'jpeg');
    pdf = await buildPdf(pages.map((jpeg) => ({ jpeg, wMm: layout.sheetW, hMm: layout.sheetH })), 'Bogen');
    title = `Bogen ${r.sheet.sheetId}`;
  } else {
    const files = await renderSingles(ctx, user, r, 'jpeg');
    const pages = files.flatMap((f, i) => {
      const mm = formatSizeMm(r.items[i].format, r.items[i].orientation);
      return Array.from({ length: r.items[i].copies }, () => ({ jpeg: f.data, wMm: mm.w, hMm: mm.h }));
    });
    pdf = await buildPdf(pages, files[0].name);
    title = files.length === 1 ? files[0].name : `${files.length} Fotos`;
  }

  const job: TypedAttr[] = [intAttr('copies', copies)];
  const col = media ? mediaCol(media, borderless, mediaType, source) : null;
  if (col) job.push({ name: 'media-col', tag: TAG.begCollection, values: [col] });
  else if (media) job.push(kw('media', media));
  if (printer.scalingNone) job.push(kw('print-scaling', 'none'));
  job.push(enumAttr('print-quality', 5)); // high

  const res = await ippRequest(
    printer.id,
    OP.printJob,
    {
      operation: [
        uriAttr('printer-uri', printer.id),
        nameAttr('requesting-user-name', userLabel(user)),
        nameAttr('job-name', title.slice(0, 255)),
        { name: 'document-format', tag: TAG.mimeMediaType, values: ['application/pdf'] },
      ],
      job,
    },
    pdf,
    120000,
  );
  const jobAttrs = res.groups.find((g) => g.tag === TAG.job)?.attrs ?? {};
  const jobId = Number(jobAttrs['job-id']?.[0] ?? 0) || null;
  const jobUri = (jobAttrs['job-uri']?.[0] as string) ?? null;
  const state = JOB_STATE[Number(jobAttrs['job-state']?.[0])] ?? 'waiting';
  const info = ctx.db
    .prepare(
      `INSERT INTO print_jobs(user_id, printer_uri, printer_name, job_id, job_uri, title, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(user.id, printer.id, printer.name, jobId, jobUri, title, state, Date.now());
  return { id: Number(info.lastInsertRowid), state, borderless };
}

export function registerPrintRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/print/printers', async (req) => {
    requireNotGuest(requireUser(req));
    if (!ctx.config.cupsUrl) return { configured: false, items: [] };
    try {
      return { configured: true, items: await visiblePrinters(ctx, (req.query as any).refresh === '1') };
    } catch (err) {
      if (err instanceof IppError) throw new HttpError(502, err.code);
      throw err;
    }
  });

  /** All printers incl. hidden ones (admin: choose visible printers). */
  app.get('/api/admin/printers', async (req) => {
    const u = requireUser(req);
    if (!u.isAdmin) throw new HttpError(403, 'auth.adminOnly');
    try {
      return { items: await discoverPrinters(ctx, true) };
    } catch (err) {
      if (err instanceof IppError) throw new HttpError(502, err.code);
      throw err;
    }
  });

  app.post('/api/print/jobs', async (req) => {
    const user = requireUser(req);
    requireNotGuest(user);
    if (!ctx.config.cupsUrl) throw new HttpError(404, 'print.notConfigured');
    try {
      return await submitJob(ctx, user, req.body);
    } catch (err) {
      if (err instanceof IppError) throw new HttpError(502, err.code, { message: err.message });
      throw err;
    }
  });

  app.get('/api/print/jobs', async (req) => {
    const user = requireUser(req);
    requireNotGuest(user);
    const rows = ctx.db
      .prepare('SELECT * FROM print_jobs WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 50')
      .all(user.id, Date.now() - 7 * 86400_000) as any[];
    for (const r of rows) {
      if (FINAL.has(r.state) || !r.job_id) continue;
      try {
        const res = await ippRequest(r.printer_uri, OP.getJobAttributes, {
          operation: [
            uriAttr('printer-uri', r.printer_uri),
            intAttr('job-id', r.job_id),
            nameAttr('requesting-user-name', userLabel(user)),
            kw('requested-attributes', 'job-state', 'job-state-message', 'job-state-reasons'),
          ],
        });
        const a = res.groups.find((g) => g.tag === TAG.job)?.attrs ?? {};
        const state = JOB_STATE[Number(a['job-state']?.[0])] ?? r.state;
        const message = (a['job-state-message']?.[0] as string) || null;
        ctx.db.prepare('UPDATE print_jobs SET state = ?, message = ? WHERE id = ?').run(state, message, r.id);
        r.state = state;
        r.message = message;
      } catch (err) {
        if (err instanceof IppError && err.code === 'print.notFound') {
          ctx.db.prepare(`UPDATE print_jobs SET state = 'done' WHERE id = ?`).run(r.id);
          r.state = 'done';
        }
      }
    }
    return {
      items: rows.map((r) => ({ id: r.id, title: r.title, printer: r.printer_name, state: r.state, message: r.message, createdAt: r.created_at })),
    };
  });

  app.delete('/api/print/jobs/:id', async (req) => {
    const user = requireUser(req);
    requireNotGuest(user);
    const row = ctx.db.prepare('SELECT * FROM print_jobs WHERE id = ? AND user_id = ?').get(Number((req.params as any).id), user.id) as any;
    if (!row) throw new HttpError(404, 'notFound');
    if (row.job_id) {
      await ippRequest(row.printer_uri, OP.cancelJob, {
        operation: [
          uriAttr('printer-uri', row.printer_uri),
          intAttr('job-id', row.job_id),
          nameAttr('requesting-user-name', userLabel(user)),
        ],
      }).catch(() => undefined);
    }
    ctx.db.prepare(`UPDATE print_jobs SET state = 'canceled' WHERE id = ?`).run(row.id);
    return { ok: true };
  });
}
