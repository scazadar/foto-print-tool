// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/**
 * Non-destructive edit parameters and the geometry shared by the browser
 * preview and the server-side render. Everything here is resolution
 * independent: the same EditState gives the same picture for a 1000 px
 * preview and a 7000 px print.
 */

export type FitMode = 'fill' | 'fit' | 'border';
export type Background = 'white' | 'black' | 'color' | 'blur';
export type Rot90 = 0 | 90 | 180 | 270;

export interface Adjustments {
  /** -100 … 100 */
  brightness: number;
  contrast: number;
  saturation: number;
  /** negative = cooler, positive = warmer */
  temperature: number;
  /** 0 … 100 */
  sharpness: number;
  filter: 'none' | 'bw' | 'sepia';
  /** Auto levels: per-channel black and white points (0…255), or null. */
  levels: { lo: [number, number, number]; hi: [number, number, number] } | null;
}

export interface Caption {
  text: string;
  font: 'sans' | 'serif' | 'mono' | 'hand';
  /** Font size in mm (cap height is roughly 70 % of it). */
  sizeMm: number;
  color: string;
}

export interface EditState {
  mode: FitMode;
  background: Background;
  /** CSS hex colour, used when background = 'color' */
  bgColor: string;
  /** Border width around the picture in mm (mode 'border'). */
  borderMm: number;
  /** Additional border at the bottom in mm (Polaroid look). */
  borderBottomMm: number;
  rot90: Rot90;
  /** Fine rotation in degrees, -45 … 45. */
  angle: number;
  flipH: boolean;
  flipV: boolean;
  /** 1 = picture just covers (fill) or just fits (fit) the frame. */
  zoom: number;
  /**
   * Point of the oriented picture that sits in the centre of the frame,
   * normalised to -0.5 … 0.5 of the picture's width/height.
   */
  cx: number;
  cy: number;
  adjust: Adjustments;
  caption: Caption | null;
}

export const ZOOM_MIN_FIT = 0.2;
export const ZOOM_MAX = 8;

export function defaultAdjustments(): Adjustments {
  return { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0, filter: 'none', levels: null };
}

export function defaultEdit(mode: FitMode = 'fill'): EditState {
  return {
    mode,
    background: 'white',
    bgColor: '#ffffff',
    borderMm: 5,
    borderBottomMm: 0,
    rot90: 0,
    angle: 0,
    flipH: false,
    flipV: false,
    zoom: 1,
    cx: 0,
    cy: 0,
    adjust: defaultAdjustments(),
    caption: null,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && isFinite(v) ? clamp(v, lo, hi) : d;

/** Sanitise untrusted input (e.g. from the browser) into a valid EditState. */
export function sanitizeEdit(input: unknown): EditState {
  const d = defaultEdit();
  if (!input || typeof input !== 'object') return d;
  const i = input as Record<string, any>;
  const a = (i.adjust ?? {}) as Record<string, any>;
  let levels: Adjustments['levels'] = null;
  if (a.levels && Array.isArray(a.levels.lo) && Array.isArray(a.levels.hi)) {
    const ch = (arr: unknown[], def: number) =>
      [0, 1, 2].map((k) => num(arr[k], def, 0, 255)) as [number, number, number];
    levels = { lo: ch(a.levels.lo, 0), hi: ch(a.levels.hi, 255) };
  }
  let caption: Caption | null = null;
  if (i.caption && typeof i.caption === 'object' && typeof i.caption.text === 'string' && i.caption.text.trim()) {
    caption = {
      text: String(i.caption.text).slice(0, 200),
      font: ['sans', 'serif', 'mono', 'hand'].includes(i.caption.font) ? i.caption.font : 'sans',
      sizeMm: num(i.caption.sizeMm, 4, 1, 40),
      color: isHexColor(i.caption.color) ? i.caption.color : '#222222',
    };
  }
  const mode: FitMode = ['fill', 'fit', 'border'].includes(i.mode) ? i.mode : 'fill';
  return {
    mode,
    background: ['white', 'black', 'color', 'blur'].includes(i.background) ? i.background : 'white',
    bgColor: isHexColor(i.bgColor) ? i.bgColor : '#ffffff',
    borderMm: num(i.borderMm, d.borderMm, 0, 100),
    borderBottomMm: num(i.borderBottomMm, 0, 0, 200),
    rot90: [0, 90, 180, 270].includes(i.rot90) ? i.rot90 : 0,
    angle: num(i.angle, 0, -45, 45),
    flipH: i.flipH === true,
    flipV: i.flipV === true,
    zoom: num(i.zoom, 1, mode === 'fill' || mode === 'border' ? 1 : ZOOM_MIN_FIT, ZOOM_MAX),
    cx: num(i.cx, 0, -0.5, 0.5),
    cy: num(i.cy, 0, -0.5, 0.5),
    adjust: {
      brightness: num(a.brightness, 0, -100, 100),
      contrast: num(a.contrast, 0, -100, 100),
      saturation: num(a.saturation, 0, -100, 100),
      temperature: num(a.temperature, 0, -100, 100),
      sharpness: num(a.sharpness, 0, 0, 100),
      filter: ['none', 'bw', 'sepia'].includes(a.filter) ? a.filter : 'none',
      levels,
    },
    caption,
  };
}

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  frameW: number;
  frameH: number;
  /** Area the picture is placed into (frame minus border). */
  inner: Rect;
  /** Oriented picture size (after the 90° rotation), in source pixels. */
  srcW: number;
  srcH: number;
  /** Source pixel → frame pixel scale. */
  scale: number;
  /** Fine rotation in radians. */
  theta: number;
  /** Frame position of the picture centre. */
  centerX: number;
  centerY: number;
}

/** Picture size after the 90° rotation. */
export function orientedSize(imgW: number, imgH: number, rot90: Rot90): { w: number; h: number } {
  return rot90 === 90 || rot90 === 270 ? { w: imgH, h: imgW } : { w: imgW, h: imgH };
}

export function innerRect(frameW: number, frameH: number, pxPerMm: number, e: EditState): Rect {
  if (e.mode !== 'border') return { x: 0, y: 0, w: frameW, h: frameH };
  const b = e.borderMm * pxPerMm;
  const bb = e.borderBottomMm * pxPerMm;
  const w = Math.max(1, frameW - 2 * b);
  const h = Math.max(1, frameH - 2 * b - bb);
  return { x: b, y: b, w, h };
}

/** Scale at zoom 1: just covering (fill/border) or just containing (fit) the inner rect. */
export function baseScale(innerW: number, innerH: number, srcW: number, srcH: number, theta: number, mode: FitMode): number {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  if (mode === 'fit') {
    // rotated picture bounding box must fit into the rect
    return Math.min(innerW / (srcW * c + srcH * s), innerH / (srcW * s + srcH * c));
  }
  // the rect, rotated into picture space, must lie within the picture
  return Math.max((innerW * c + innerH * s) / srcW, (innerW * s + innerH * c) / srcH);
}

/**
 * Clamp the picture centre so that a covering picture leaves no gaps
 * (fill/border). Works in picture space so it is exact for any rotation.
 */
export function clampCenter(e: EditState, frameW: number, frameH: number, pxPerMm: number, imgW: number, imgH: number): EditState {
  if (e.mode === 'fit') {
    return { ...e, cx: clamp(e.cx, -0.5, 0.5), cy: clamp(e.cy, -0.5, 0.5) };
  }
  const inner = innerRect(frameW, frameH, pxPerMm, e);
  const { w: sw, h: sh } = orientedSize(imgW, imgH, e.rot90);
  const theta = (e.angle * Math.PI) / 180;
  const scale = baseScale(inner.w, inner.h, sw, sh, theta, e.mode) * Math.max(1, e.zoom);
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  // half extents of the rect in picture space (source pixels)
  const hx = (inner.w * c + inner.h * s) / 2 / scale;
  const hy = (inner.w * s + inner.h * c) / 2 / scale;
  const mx = Math.max(0, sw / 2 - hx);
  const my = Math.max(0, sh / 2 - hy);
  return { ...e, zoom: Math.max(1, e.zoom), cx: clamp(e.cx * sw, -mx, mx) / sw, cy: clamp(e.cy * sh, -my, my) / sh };
}

export function computeLayout(frameW: number, frameH: number, pxPerMm: number, imgW: number, imgH: number, e: EditState): Layout {
  const inner = innerRect(frameW, frameH, pxPerMm, e);
  const { w: srcW, h: srcH } = orientedSize(imgW, imgH, e.rot90);
  const theta = (e.angle * Math.PI) / 180;
  const scale = baseScale(inner.w, inner.h, srcW, srcH, theta, e.mode) * e.zoom;
  // picture point (cx*srcW, cy*srcH) sits at the inner centre:
  // frame = innerCentre + R(theta)·scale·(p − c)  ⇒ picture centre p=0 at innerCentre − R·scale·c
  const px = -e.cx * srcW * scale;
  const py = -e.cy * srcH * scale;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const centerX = inner.x + inner.w / 2 + (px * cos - py * sin);
  const centerY = inner.y + inner.h / 2 + (px * sin + py * cos);
  return { frameW, frameH, inner, srcW, srcH, scale, theta, centerX, centerY };
}

/**
 * Effective print resolution of the visible picture: one source pixel covers
 * `scale` output pixels, so dpi_eff = dpi / scale. `scale` must come from a
 * layout computed with the original picture size and the output frame size;
 * thanks to linearity this equals dpi · origW / (layoutScale · frameW / previewW…),
 * which we get without rendering by passing the real dimensions.
 */
export function effectiveDpi(
  formatWmm: number,
  formatHmm: number,
  origW: number,
  origH: number,
  e: EditState,
): number {
  // use a virtual frame of 1 px per mm
  const layout = computeLayout(formatWmm, formatHmm, 1, origW, origH, e);
  // layout.scale = frame px (mm) per source px → source px per inch = 25.4 / scale
  return 25.4 / layout.scale;
}

export type DpiLevel = 'good' | 'ok' | 'bad';
export function dpiLevel(dpi: number): DpiLevel {
  if (dpi >= 300) return 'good';
  if (dpi >= 150) return 'ok';
  return 'bad';
}

/** Picture point in normalised original coordinates (0…1) → oriented centred coordinates (-0.5…0.5). */
export function toOrientedPoint(nx: number, ny: number, e: Pick<EditState, 'rot90' | 'flipH' | 'flipV'>): { x: number; y: number } {
  let x = nx - 0.5;
  let y = ny - 0.5;
  // rotation clockwise by rot90
  for (let r = 0; r < e.rot90; r += 90) {
    const t = x;
    x = -y;
    y = t;
  }
  if (e.flipH) x = -x;
  if (e.flipV) y = -y;
  return { x, y };
}

/** Centre the frame on a face box given in normalised original coordinates. */
export function centerOnBox(e: EditState, box: { x1: number; y1: number; x2: number; y2: number }): EditState {
  const p = toOrientedPoint((box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2, e);
  return { ...e, cx: p.x, cy: p.y };
}

/** Pick the orientation that matches the picture. */
export function matchingOrientation(imgW: number, imgH: number): 'portrait' | 'landscape' {
  return imgW > imgH ? 'landscape' : 'portrait';
}

/** Copy filters and fit mode, not the crop (for "apply to all"). */
export function copyStyle(from: EditState, to: EditState): EditState {
  return {
    ...to,
    mode: from.mode,
    background: from.background,
    bgColor: from.bgColor,
    borderMm: from.borderMm,
    borderBottomMm: from.borderBottomMm,
    adjust: { ...from.adjust, levels: to.adjust.levels },
    zoom: from.mode === 'fit' ? to.zoom : Math.max(1, to.zoom),
  };
}
