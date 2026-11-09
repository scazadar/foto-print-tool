// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import crypto from 'node:crypto';

/**
 * Minimal Immich REST client. Written against the Immich OpenAPI spec
 * (open-api/immich-openapi-specs.json, API 3.4.0-rc.0). Every call runs with
 * the credentials of the signed-in user, never with a global key.
 */

export type ImmichCredential = { type: 'token' | 'apikey'; value: string };

export const MIN_IMMICH_VERSION = { major: 2, minor: 0, patch: 0 };
export const TESTED_IMMICH_API = '3.4.0-rc.0';

export class ImmichError extends Error {
  constructor(
    public code: string,
    public status: number,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface ImmichAssetSummary {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  type: string;
}

export interface ImmichAlbumSummary {
  id: string;
  name: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  shared: boolean;
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  body?: BodyInit;
  timeoutMs?: number;
}

export class ImmichClient {
  constructor(
    private baseUrl: string,
    private cred: ImmichCredential | null,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json' };
    if (this.cred?.type === 'apikey') h['x-api-key'] = this.cred.value;
    else if (this.cred?.type === 'token') h['authorization'] = `Bearer ${this.cred.value}`;
    return h;
  }

  async raw(method: string, path: string, o: RequestOptions = {}): Promise<Response> {
    const url = new URL(`${this.baseUrl}/api${path}`);
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers = this.headers();
    let body = o.body;
    if (o.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(o.json);
    }
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(o.timeoutMs ?? 30000), redirect: 'error' });
    } catch (err) {
      throw new ImmichError('immich.unreachable', 502, (err as Error).message);
    }
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      const code =
        res.status === 401
          ? 'immich.unauthorized'
          : res.status === 403
            ? 'immich.forbidden'
            : res.status === 404
              ? 'immich.notFound'
              : res.status === 400
                ? 'immich.badRequest'
                : 'immich.error';
      throw new ImmichError(code, res.status, detail);
    }
    return res;
  }

  async json<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    const res = await this.raw(method, path, o);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  ping() {
    return this.json<{ res: string }>('GET', '/server/ping', { timeoutMs: 5000 });
  }

  version() {
    return this.json<{ major: number; minor: number; patch: number }>('GET', '/server/version', { timeoutMs: 5000 });
  }

  login(email: string, password: string) {
    return this.json<{ accessToken: string; userId: string; userEmail: string; name: string; isAdmin: boolean }>(
      'POST',
      '/auth/login',
      { json: { email, password } },
    );
  }

  features() {
    return this.json<{ oauth: boolean; oauthAutoLaunch: boolean; passwordLogin: boolean }>('GET', '/server/features', { timeoutMs: 5000 });
  }

  serverConfig() {
    return this.json<{ oauthButtonText?: string }>('GET', '/server/config', { timeoutMs: 5000 });
  }

  /** Start Immich's OAuth flow (the way the mobile app does it); returns the provider URL. */
  oauthAuthorize(redirectUri: string, state: string, codeChallenge: string) {
    return this.json<{ url: string }>('POST', '/oauth/authorize', { json: { redirectUri, state, codeChallenge } });
  }

  /** Finish the OAuth flow: Immich exchanges the code with the provider and returns an access token. */
  oauthCallback(url: string, state: string, codeVerifier: string) {
    return this.json<{ accessToken: string; userId: string; userEmail: string; name: string; isAdmin: boolean }>('POST', '/oauth/callback', {
      json: { url, state, codeVerifier },
    });
  }

  logout() {
    return this.json<unknown>('POST', '/auth/logout');
  }

  me() {
    return this.json<{ id: string; email: string; name: string; isAdmin: boolean; profileImagePath: string }>('GET', '/users/me');
  }

  async albums(): Promise<ImmichAlbumSummary[]> {
    // without filters Immich returns owned and shared albums
    const all = await this.json<any[]>('GET', '/albums');
    const map = new Map<string, ImmichAlbumSummary>();
    for (const a of all) {
      map.set(a.id, {
        id: a.id,
        name: a.albumName,
        assetCount: a.assetCount ?? 0,
        thumbnailAssetId: a.albumThumbnailAssetId ?? null,
        shared: !!a.shared,
      });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  album(id: string) {
    return this.json<any>('GET', `/albums/${encodeURIComponent(id)}`);
  }

  createAlbum(name: string) {
    return this.json<{ id: string; albumName: string }>('POST', '/albums', { json: { albumName: name } });
  }

  addToAlbum(albumId: string, assetIds: string[]) {
    return this.json<{ id: string; success: boolean; error?: string }[]>('PUT', `/albums/${encodeURIComponent(albumId)}/assets`, { json: { ids: assetIds } });
  }

  /**
   * Search via POST /search/metadata or /search/smart. `next` is the opaque
   * continuation we hand to the browser: "c:<cursor>" (API ≥ 3.2) or
   * "p:<page>" (older versions).
   */
  async search(
    kind: 'metadata' | 'smart',
    filter: Record<string, unknown>,
    next: string | null,
    size = 100,
  ): Promise<{ items: ImmichAssetSummary[]; next: string | null }> {
    const body: Record<string, unknown> = { ...filter, size, type: 'IMAGE' };
    if (kind === 'metadata') body.order = 'desc';
    if (next?.startsWith('c:')) body.cursor = next.slice(2);
    else if (next?.startsWith('p:')) body.page = Number(next.slice(2));
    const res = await this.json<any>('POST', `/search/${kind}`, { json: body });
    const assets = res?.assets ?? {};
    const items: ImmichAssetSummary[] = (assets.items ?? []).map(mapAsset);
    let nxt: string | null = null;
    if (assets.nextCursor) nxt = `c:${assets.nextCursor}`;
    else if (assets.nextPage) nxt = `p:${assets.nextPage}`;
    return { items, next: nxt };
  }

  asset(id: string) {
    return this.json<any>('GET', `/assets/${encodeURIComponent(id)}`);
  }

  faces(assetId: string) {
    return this.json<any[]>('GET', '/faces', { query: { id: assetId } });
  }

  people(name?: string) {
    return this.json<{ people: any[] }>('GET', '/people', { query: { size: 200, withHidden: false, name } });
  }

  thumbnail(id: string, size: 'thumbnail' | 'preview' | 'fullsize') {
    return this.raw('GET', `/assets/${encodeURIComponent(id)}/thumbnail`, { query: { size }, timeoutMs: 60000 });
  }

  original(id: string) {
    return this.raw('GET', `/assets/${encodeURIComponent(id)}/original`, { timeoutMs: 300000 });
  }

  personThumbnail(id: string) {
    return this.raw('GET', `/people/${encodeURIComponent(id)}/thumbnail`);
  }

  profileImage(userId: string) {
    return this.raw('GET', `/users/${encodeURIComponent(userId)}/profile-image`);
  }

  async upload(o: {
    data: Buffer;
    filename: string;
    mime: string;
    fileCreatedAt: string;
    fileModifiedAt: string;
  }): Promise<{ id: string; status: string }> {
    const form = new FormData();
    // required up to Immich 2.x, ignored (stripped by the DTO whitelist) by current versions
    form.set('deviceAssetId', `immich-print-${crypto.randomUUID()}`);
    form.set('deviceId', 'immich-print');
    form.set('fileCreatedAt', o.fileCreatedAt);
    form.set('fileModifiedAt', o.fileModifiedAt);
    form.set('filename', o.filename);
    form.set('assetData', new Blob([new Uint8Array(o.data)], { type: o.mime }), o.filename);
    return this.json('POST', '/assets', { body: form, timeoutMs: 300000 });
  }

  updateAsset(id: string, patch: { description?: string; dateTimeOriginal?: string }) {
    return this.json<unknown>('PUT', `/assets/${encodeURIComponent(id)}`, { json: patch });
  }
}

export function mapAsset(a: any): ImmichAssetSummary {
  return {
    id: a.id,
    name: a.originalFileName ?? a.id,
    width: a.width ?? a.exifInfo?.exifImageWidth ?? null,
    height: a.height ?? a.exifInfo?.exifImageHeight ?? null,
    takenAt: a.exifInfo?.dateTimeOriginal ?? a.localDateTime ?? a.fileCreatedAt ?? null,
    type: a.type,
  };
}

export function versionAtLeast(v: { major: number; minor: number; patch: number }, min = MIN_IMMICH_VERSION): boolean {
  if (v.major !== min.major) return v.major > min.major;
  if (v.minor !== min.minor) return v.minor > min.minor;
  return v.patch >= min.patch;
}
