// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { defaultEdit, type EditState, matchingOrientation } from '../../../shared/edit';
import { BUILTIN_FORMATS, type Orientation, type PhotoFormat } from '../../../shared/formats';
import { api, ApiError } from './api';
import { errorText, t } from './i18n';

export interface PublicConfig {
  authMode: 'local' | 'immich' | 'none';
  immich: boolean;
  immichPublicUrl: string | null;
  print: boolean;
  version: string;
  commit: string;
  sourceUrl: string;
  setupRequired: boolean;
  registration: boolean;
  defaultDpi: number;
  uploadMaxMb: number;
  uploadRetentionDays: number;
  testedImmichApi: string;
  loggedIn: boolean;
  oauth: { enabled: boolean; buttonText: string; passwordLogin: boolean };
}

export interface User {
  id: string;
  kind: 'local' | 'immich' | 'none';
  email: string | null;
  name: string;
  isAdmin: boolean;
  immichLinked: boolean;
}

export interface Prefs {
  immichAlbum: string;
  fitMode: 'fill' | 'fit' | 'border';
  jpegQuality: number;
  includeGps: boolean;
  units: 'cm' | 'in';
  dpi: number | null;
  printer: { id: string | null; media: string | null; mediaType: string | null; mediaSource: string | null; borderless: boolean };
}

export interface PhotoRef {
  kind: 'upload' | 'immich';
  id: string;
  name: string;
  thumbUrl: string;
  previewUrl: string;
  width: number | null;
  height: number | null;
  takenAt: string | null;
}

export interface Face {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  name: string | null;
}

export interface EditorItem {
  key: string;
  ref: PhotoRef;
  /** oriented size of the original (for the dpi check) */
  origW: number;
  origH: number;
  faces: Face[];
  edit: EditState;
  initial: EditState;
  orientation: Orientation;
  history: { edit: EditState; orientation: Orientation }[];
  future: { edit: EditState; orientation: Orientation }[];
  copies: number;
  warning: string | null;
  /** preview image, loaded lazily */
  img: HTMLImageElement | null;
  loaded: boolean;
  error: string | null;
}

export type View = 'photos' | 'editor' | 'settings' | 'admin';

export const app = $state({
  ready: false,
  config: null as PublicConfig | null,
  user: null as User | null,
  prefs: null as Prefs | null,
  formats: { builtin: BUILTIN_FORMATS, custom: [] as PhotoFormat[], hidden: [] as string[], recent: [] as string[] },
  view: 'photos' as View,
  selection: [] as PhotoRef[],
  items: [] as EditorItem[],
  current: 0,
  formatId: '10x15',
  toast: null as { text: string; kind: 'info' | 'error' } | null,
  aboutOpen: false,
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: 'info' | 'error' = 'info'): void {
  app.toast = { text, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (app.toast = null), kind === 'error' ? 7000 : 3500);
}

export function showError(err: unknown): void {
  if (err instanceof ApiError) toast(errorText(err.code, err.data), 'error');
  else toast(t('errors.generic'), 'error');
}

export async function loadSession(): Promise<void> {
  app.config = await api.get<PublicConfig>('/api/config');
  if (app.config.loggedIn) {
    app.user = await api.get<User>('/api/auth/me');
    const [prefs, formats] = await Promise.all([api.get<Prefs>('/api/settings'), api.get<typeof app.formats>('/api/formats')]);
    app.prefs = prefs;
    app.formats = formats;
    if (formats.recent[0]) app.formatId = formats.recent[0];
  } else {
    app.user = null;
  }
  app.ready = true;
}

export function allFormats(): PhotoFormat[] {
  return [...app.formats.builtin, ...app.formats.custom];
}

export function currentFormat(): PhotoFormat {
  return allFormats().find((f) => f.id === app.formatId) ?? BUILTIN_FORMATS[1];
}

export function refKey(r: { kind: string; id: string }): string {
  return `${r.kind}:${r.id}`;
}

export function isSelected(r: PhotoRef): boolean {
  return app.selection.some((s) => refKey(s) === refKey(r));
}

export function toggleSelect(r: PhotoRef): void {
  const k = refKey(r);
  const i = app.selection.findIndex((s) => refKey(s) === k);
  if (i >= 0) app.selection.splice(i, 1);
  else app.selection.push(r);
}

function newItem(ref: PhotoRef): EditorItem {
  const mode = app.prefs?.fitMode ?? 'fill';
  const edit = defaultEdit(mode);
  return {
    key: refKey(ref),
    ref,
    origW: ref.width ?? 0,
    origH: ref.height ?? 0,
    faces: [],
    edit,
    initial: structuredClone(edit),
    orientation: ref.width && ref.height ? matchingOrientation(ref.width, ref.height) : 'portrait',
    history: [],
    future: [],
    copies: 1,
    warning: null,
    img: null,
    loaded: false,
    error: null,
  };
}

/** Move the selection into the editor (keeping edits of pictures already there). */
export function openEditor(): void {
  const existing = new Map(app.items.map((i) => [i.key, i]));
  const next: EditorItem[] = [];
  for (const r of app.selection) next.push(existing.get(refKey(r)) ?? newItem(r));
  app.items = next;
  if (app.current >= next.length) app.current = 0;
  app.view = 'editor';
}

export function uploadRef(u: { id: string; name: string; width: number; height: number; takenAt: string | null }): PhotoRef {
  return {
    kind: 'upload',
    id: u.id,
    name: u.name,
    thumbUrl: `/api/uploads/${u.id}/thumb`,
    previewUrl: `/api/uploads/${u.id}/preview`,
    width: u.width,
    height: u.height,
    takenAt: u.takenAt,
  };
}

export function immichRef(a: { id: string; name: string; width: number | null; height: number | null; takenAt: string | null }): PhotoRef {
  return {
    kind: 'immich',
    id: a.id,
    name: a.name,
    thumbUrl: `/api/immich/assets/${a.id}/thumb`,
    previewUrl: `/api/immich/assets/${a.id}/thumb?size=preview`,
    width: a.width,
    height: a.height,
    takenAt: a.takenAt,
  };
}

export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  app.prefs = await api.put<Prefs>('/api/settings', patch);
}

export async function reloadFormats(): Promise<void> {
  app.formats = await api.get<typeof app.formats>('/api/formats');
}
