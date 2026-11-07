// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/**
 * Small IPP/2.0 client (RFC 8010/8011) with collection support, enough for
 * CUPS-Get-Printers, Get-Printer-Attributes, Print-Job, Get-Job-Attributes
 * and Cancel-Job.
 */

export const TAG = {
  operation: 0x01,
  job: 0x02,
  end: 0x03,
  printer: 0x04,
  unsupportedGroup: 0x05,
  unsupported: 0x10,
  unknown: 0x12,
  noValue: 0x13,
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  octetString: 0x30,
  dateTime: 0x31,
  resolution: 0x32,
  rangeOfInteger: 0x33,
  begCollection: 0x34,
  textWithLanguage: 0x35,
  nameWithLanguage: 0x36,
  endCollection: 0x37,
  text: 0x41,
  name: 0x42,
  keyword: 0x44,
  uri: 0x45,
  uriScheme: 0x46,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
  memberAttrName: 0x4a,
} as const;

export const OP = {
  printJob: 0x0002,
  cancelJob: 0x0008,
  getJobAttributes: 0x0009,
  getPrinterAttributes: 0x000b,
  cupsGetPrinters: 0x4002,
} as const;

export type IppValue = string | number | boolean | IppCollection | { lower: number; upper: number } | { x: number; y: number; units: number } | null;
export interface IppCollection {
  [member: string]: IppValue | IppValue[];
}

/** Attribute to send: value(s) with their syntax. Collections: value is a TypedCollection. */
export interface TypedAttr {
  name: string;
  tag: number;
  values: (string | number | boolean | TypedCollection)[];
}
export interface TypedCollection {
  members: TypedAttr[];
}

export interface IppResponse {
  version: string;
  statusCode: number;
  requestId: number;
  groups: { tag: number; attrs: Record<string, IppValue[]> }[];
}

/* ------------------------------ encoding ------------------------------ */

class Writer {
  private chunks: Buffer[] = [];
  u8(v: number) {
    this.chunks.push(Buffer.from([v & 0xff]));
  }
  u16(v: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(v);
    this.chunks.push(b);
  }
  i32(v: number) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v);
    this.chunks.push(b);
  }
  bytes(b: Buffer) {
    this.chunks.push(b);
  }
  str(s: string) {
    const b = Buffer.from(s, 'utf8');
    this.u16(b.length);
    this.chunks.push(b);
  }
  done() {
    return Buffer.concat(this.chunks);
  }
}

function writeValue(w: Writer, tag: number, name: string, v: string | number | boolean | TypedCollection) {
  w.u8(tag);
  w.str(name);
  switch (tag) {
    case TAG.integer:
    case TAG.enum:
      w.u16(4);
      w.i32(Number(v));
      return;
    case TAG.boolean:
      w.u16(1);
      w.u8(v ? 1 : 0);
      return;
    case TAG.begCollection: {
      w.u16(0);
      for (const m of (v as TypedCollection).members) {
        w.u8(TAG.memberAttrName);
        w.u16(0);
        w.str(m.name);
        m.values.forEach((mv) => writeValue(w, m.tag, '', mv));
      }
      w.u8(TAG.endCollection);
      w.u16(0);
      w.u16(0);
      return;
    }
    case TAG.noValue:
      w.u16(0);
      return;
    default:
      w.str(String(v));
  }
}

export function encodeRequest(op: number, requestId: number, groups: { tag: number; attrs: TypedAttr[] }[], data?: Buffer): Buffer {
  const w = new Writer();
  w.u8(2);
  w.u8(0);
  w.u16(op);
  w.i32(requestId);
  for (const g of groups) {
    w.u8(g.tag);
    for (const a of g.attrs) {
      a.values.forEach((v, i) => writeValue(w, a.tag, i === 0 ? a.name : '', v));
    }
  }
  w.u8(TAG.end);
  if (data) w.bytes(data);
  return w.done();
}

/* ------------------------------ decoding ------------------------------ */

class Reader {
  pos = 0;
  constructor(private b: Buffer) {}
  get left() {
    return this.b.length - this.pos;
  }
  u8() {
    if (this.left < 1) throw new Error('IPP: truncated');
    return this.b[this.pos++];
  }
  u16() {
    if (this.left < 2) throw new Error('IPP: truncated');
    const v = this.b.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  i32() {
    if (this.left < 4) throw new Error('IPP: truncated');
    const v = this.b.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  take(n: number) {
    if (this.left < n) throw new Error('IPP: truncated');
    const v = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  peek() {
    return this.b[this.pos];
  }
}

function decodeValue(tag: number, raw: Buffer): IppValue {
  switch (tag) {
    case TAG.integer:
    case TAG.enum:
      return raw.length >= 4 ? raw.readInt32BE(0) : 0;
    case TAG.boolean:
      return raw[0] === 1;
    case TAG.rangeOfInteger:
      return { lower: raw.readInt32BE(0), upper: raw.readInt32BE(4) };
    case TAG.resolution:
      return { x: raw.readInt32BE(0), y: raw.readInt32BE(4), units: raw[8] };
    case TAG.unsupported:
    case TAG.unknown:
    case TAG.noValue:
      return null;
    case TAG.textWithLanguage:
    case TAG.nameWithLanguage: {
      const langLen = raw.readUInt16BE(0);
      const textLen = raw.readUInt16BE(2 + langLen);
      return raw.subarray(4 + langLen, 4 + langLen + textLen).toString('utf8');
    }
    case TAG.dateTime:
      return raw.toString('hex');
    case TAG.octetString:
      return raw.toString('utf8');
    default:
      return raw.toString('utf8');
  }
}

function readCollection(r: Reader): IppCollection {
  const out: IppCollection = {};
  let current: string | null = null;
  for (;;) {
    const tag = r.u8();
    const nameLen = r.u16();
    r.take(nameLen);
    const valueLen = r.u16();
    const raw = r.take(valueLen);
    if (tag === TAG.endCollection) return out;
    if (tag === TAG.memberAttrName) {
      current = raw.toString('utf8');
      continue;
    }
    const value = tag === TAG.begCollection ? readCollection(r) : decodeValue(tag, raw);
    if (current === null) continue;
    const prev = out[current];
    if (prev === undefined) out[current] = value;
    else if (Array.isArray(prev)) prev.push(value);
    else out[current] = [prev, value];
  }
}

export function decodeResponse(b: Buffer): IppResponse {
  const r = new Reader(b);
  const version = `${r.u8()}.${r.u8()}`;
  const statusCode = r.u16();
  const requestId = r.i32();
  const groups: IppResponse['groups'] = [];
  let group: IppResponse['groups'][number] | null = null;
  let lastName = '';
  while (r.left > 0) {
    const tag = r.u8();
    if (tag === TAG.end) break;
    if (tag < 0x10) {
      group = { tag, attrs: {} };
      groups.push(group);
      continue;
    }
    const nameLen = r.u16();
    const name = nameLen ? r.take(nameLen).toString('utf8') : lastName;
    const valueLen = r.u16();
    const raw = r.take(valueLen);
    const value = tag === TAG.begCollection ? readCollection(r) : decodeValue(tag, raw);
    if (!group) continue;
    lastName = name;
    (group.attrs[name] ??= []).push(value);
  }
  return { version, statusCode, requestId, groups };
}

/* ------------------------------ transport ------------------------------ */

export class IppError extends Error {
  constructor(
    public code: string,
    message?: string,
    public statusCode?: number,
  ) {
    super(message ?? code);
  }
}

/** Port of an IPP address: explicit, else 443/80 for https/http and 631 for ipp/ipps. */
function ippPort(u: URL): string {
  if (u.port) return u.port;
  if (u.protocol === 'https:') return '443';
  if (u.protocol === 'http:') return '80';
  return '631';
}

/** HTTP(S) URL the IPP request is posted to. */
export function httpUrlFor(ippUri: string): string {
  const u = new URL(ippUri);
  const secure = u.protocol === 'ipps:' || u.protocol === 'https:';
  return `${secure ? 'https' : 'http'}://${u.hostname}:${ippPort(u)}${u.pathname}${u.search}`;
}

/**
 * Value of the printer-uri attribute: always an ipp:// or ipps:// URI with an
 * explicit port, also when CUPS_URL is given as http(s)://, e.g. behind a
 * reverse proxy on port 443.
 */
export function printerUriFor(uri: string): string {
  const u = new URL(uri);
  const secure = u.protocol === 'ipps:' || u.protocol === 'https:';
  return `${secure ? 'ipps' : 'ipp'}://${u.hostname}:${ippPort(u)}${u.pathname}${u.search}`;
}

let requestCounter = 1;

export async function ippRequest(
  uri: string,
  op: number,
  attrs: { operation?: TypedAttr[]; job?: TypedAttr[] },
  data?: Buffer,
  timeoutMs = 15000,
): Promise<IppResponse> {
  const operation: TypedAttr[] = [
    { name: 'attributes-charset', tag: TAG.charset, values: ['utf-8'] },
    { name: 'attributes-natural-language', tag: TAG.naturalLanguage, values: ['de'] },
    ...(attrs.operation ?? []),
  ];
  const groups: { tag: number; attrs: TypedAttr[] }[] = [{ tag: TAG.operation, attrs: operation }];
  if (attrs.job?.length) groups.push({ tag: TAG.job, attrs: attrs.job });
  const body = encodeRequest(op, requestCounter++, groups, data);
  let res: Response;
  try {
    res = await fetch(httpUrlFor(uri), {
      method: 'POST',
      headers: { 'content-type': 'application/ipp' },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new IppError('print.unreachable', (err as Error).message);
  }
  if (!res.ok) throw new IppError('print.httpError', `HTTP ${res.status}`);
  const parsed = decodeResponse(Buffer.from(await res.arrayBuffer()));
  if (parsed.statusCode >= 0x0400) {
    const msg = parsed.groups[0]?.attrs['status-message']?.[0];
    throw new IppError(parsed.statusCode === 0x0406 ? 'print.notFound' : 'print.ippError', String(msg ?? parsed.statusCode.toString(16)), parsed.statusCode);
  }
  return parsed;
}

export const uriAttr = (name: string, v: string): TypedAttr => ({ name, tag: TAG.uri, values: [name === 'printer-uri' ? printerUriFor(v) : v] });
export const kw = (name: string, ...v: string[]): TypedAttr => ({ name, tag: TAG.keyword, values: v });
export const nameAttr = (name: string, v: string): TypedAttr => ({ name, tag: TAG.name, values: [v] });
export const intAttr = (name: string, v: number): TypedAttr => ({ name, tag: TAG.integer, values: [v] });
export const enumAttr = (name: string, v: number): TypedAttr => ({ name, tag: TAG.enum, values: [v] });
