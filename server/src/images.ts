// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import exifReader from 'exif-reader';
import sharp from 'sharp';
import { HttpError } from './context.js';

sharp.cache(false);
sharp.concurrency(Math.max(1, Math.min(4, (await import('node:os')).cpus().length)));

export const MAX_INPUT_PIXELS = 268_402_689; // sharp default (16383²)

export type InputFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'tiff' | 'gif';
const SUPPORTED = new Set<string>(['jpeg', 'png', 'webp', 'heif', 'tiff', 'gif']);

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  /** set when the picture had to be taken from a low resolution fallback */
  warning?: string;
}

export interface ExifSubset {
  make?: string;
  model?: string;
  lens?: string;
  dateTimeOriginal?: string;
  latitude?: number;
  longitude?: number;
}

/** ISO-BMFF brands of HEIC/HEIF still images. */
function isHeic(buf: Buffer): boolean {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brand = buf.toString('ascii', 8, 12);
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand);
}

function isAvif(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(buf.toString('ascii', 8, 12));
}

/** Detect the format from the content, never from the file name. */
export async function detectFormat(buf: Buffer): Promise<InputFormat> {
  if (isAvif(buf)) return 'avif';
  try {
    const meta = await sharp(buf, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (meta.format && SUPPORTED.has(meta.format)) {
      if (meta.format === 'heif') return isHeic(buf) ? 'heic' : 'avif';
      return meta.format as InputFormat;
    }
  } catch {
    /* fall through */
  }
  if (isHeic(buf)) return 'heic';
  throw new HttpError(415, 'upload.unsupportedType');
}

async function decodeHeic(buf: Buffer): Promise<RawImage> {
  const { default: decode } = (await import('heic-decode')) as any;
  const img = await decode({ buffer: buf });
  return { data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), width: img.width, height: img.height };
}

/**
 * Decode to sRGB RGBA pixels with the EXIF orientation applied.
 * `maxSide` downsizes (for previews).
 */
export async function decodeOriented(buf: Buffer, maxSide?: number): Promise<RawImage> {
  let pipeline: ReturnType<typeof sharp>;
  try {
    // throws for HEVC-coded HEIC, which the bundled libvips cannot read
    const probe = sharp(buf, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS });
    await probe.metadata();
    pipeline = sharp(buf, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    if (maxSide) pipeline = pipeline.resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true });
    const { data, info } = await pipeline.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (err) {
    if (!isHeic(buf)) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(415, 'upload.decodeFailed');
    }
  }
  // HEIC: libheif applies the irot/imir transforms itself
  let raw: RawImage;
  try {
    raw = await decodeHeic(buf);
  } catch {
    throw new HttpError(415, 'upload.decodeFailed');
  }
  if (!maxSide || (raw.width <= maxSide && raw.height <= maxSide)) return raw;
  const { data, info } = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .resize(maxSide, maxSide, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function readExif(buf: Buffer): Promise<ExifSubset> {
  try {
    const meta = await sharp(buf, { failOn: 'none' }).metadata();
    if (!meta.exif) return {};
    return exifFromBuffer(meta.exif);
  } catch {
    return {};
  }
}

export function exifFromBuffer(exifBuf: Buffer): ExifSubset {
  try {
    const e = exifReader(exifBuf) as any;
    const img = e.Image ?? e.image ?? {};
    const ph = e.Photo ?? e.exif ?? {};
    const gps = e.GPSInfo ?? e.gps ?? {};
    const out: ExifSubset = {};
    if (img.Make) out.make = String(img.Make).trim();
    if (img.Model) out.model = String(img.Model).trim();
    if (ph.LensModel) out.lens = String(ph.LensModel).trim();
    const dto = ph.DateTimeOriginal ?? img.DateTime;
    if (dto instanceof Date && !isNaN(dto.getTime())) out.dateTimeOriginal = dto.toISOString();
    const lat = dms(gps.GPSLatitude, gps.GPSLatitudeRef);
    const lon = dms(gps.GPSLongitude, gps.GPSLongitudeRef);
    if (lat !== null && lon !== null) {
      out.latitude = lat;
      out.longitude = lon;
    }
    return out;
  } catch {
    return {};
  }
}

function dms(v: unknown, ref: unknown): number | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const d = Number(v[0]) + Number(v[1]) / 60 + Number(v[2]) / 3600;
  if (!isFinite(d)) return null;
  return ref === 'S' || ref === 'W' ? -d : d;
}

function exifDate(iso: string): string {
  // EXIF format "YYYY:MM:DD HH:MM:SS"
  return iso.slice(0, 19).replace('T', ' ').replace(/-/g, ':');
}

function toRational(deg: number): string {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const mFloat = (a - d) * 60;
  const m = Math.floor(mFloat);
  const s = Math.round((mFloat - m) * 60 * 10000);
  return `${d}/1 ${m}/1 ${s}/10000`;
}

/** EXIF block for outputs: date, camera, optional GPS. */
type SharpExif = NonNullable<Parameters<ReturnType<typeof sharp>['withExif']>[0]>;

export function buildExif(exif: ExifSubset, includeGps: boolean): SharpExif {
  const ifd0: Record<string, string> = { Software: 'Fotodruck' };
  const ifd2: Record<string, string> = {};
  if (exif.make) ifd0.Make = exif.make;
  if (exif.model) ifd0.Model = exif.model;
  if (exif.dateTimeOriginal) {
    ifd0.DateTime = exifDate(exif.dateTimeOriginal);
    ifd2.DateTimeOriginal = exifDate(exif.dateTimeOriginal);
  }
  if (exif.lens) ifd2.LensModel = exif.lens;
  const out: SharpExif = { IFD0: ifd0, IFD2: ifd2 };
  if (includeGps && exif.latitude !== undefined && exif.longitude !== undefined) {
    out.IFD3 = {
      GPSLatitudeRef: exif.latitude < 0 ? 'S' : 'N',
      GPSLatitude: toRational(exif.latitude),
      GPSLongitudeRef: exif.longitude < 0 ? 'W' : 'E',
      GPSLongitude: toRational(exif.longitude),
    };
  }
  return out;
}

export interface EncodeOptions {
  dpi: number;
  quality: number;
  exif?: ExifSubset;
  includeGps?: boolean;
}

/** RGBA → JPEG with density, sRGB ICC profile and EXIF. */
export function encodeJpeg(raw: RawImage, o: EncodeOptions): Promise<Buffer> {
  let p = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .removeAlpha()
    .withIccProfile('srgb');
  if (o.exif) p = p.withExif(buildExif(o.exif, !!o.includeGps));
  return p
    .withMetadata({ density: o.dpi })
    .jpeg({ quality: Math.round(o.quality), chromaSubsampling: o.quality >= 90 ? '4:4:4' : '4:2:0', mozjpeg: false })
    .toBuffer();
}

export function encodePng(raw: RawImage, o: EncodeOptions): Promise<Buffer> {
  let p = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .removeAlpha()
    .withIccProfile('srgb');
  if (o.exif) p = p.withExif(buildExif(o.exif, !!o.includeGps));
  return p.withMetadata({ density: o.dpi }).png({ compressionLevel: 6 }).toBuffer();
}
