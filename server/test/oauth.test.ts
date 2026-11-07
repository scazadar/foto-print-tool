// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetOAuthInfoCache } from '../src/oauth.js';
import { Agent, makeApp } from './helpers.js';
import { createMockImmich } from './mock-immich.js';

const PUBLIC = 'https://druck.example.org';

function cookieValue(setCookie: string | string[] | undefined, name: string): string | null {
  for (const c of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
    const [kv] = c.split(';');
    if (kv.startsWith(`${name}=`)) return kv;
  }
  return null;
}

/** Runs start → provider → callback and returns the callback response. */
async function oauthFlow(agent: Agent, mode: 'login' | 'link' = 'login', tamper?: (callbackPath: string) => string) {
  const start = await agent.req('GET', `/api/auth/oauth/start${mode === 'link' ? '?mode=link' : ''}`);
  expect(start.statusCode).toBe(302);
  const providerUrl = start.headers.location as string;
  const stateCookie = cookieValue(start.headers['set-cookie'], 'fd_oauth');
  // the browser signs in at the provider, which redirects back
  const idp = await fetch(providerUrl, { redirect: 'manual' });
  expect(idp.status).toBe(302);
  const back = new URL(idp.headers.get('location')!);
  let path = `${back.pathname}${back.search}`;
  if (tamper) path = tamper(path);
  const cookie = [agent.cookie, stateCookie].filter(Boolean).join('; ');
  const res = await agent.req('GET', path, undefined, cookie ? { cookie } : {});
  return { start, providerUrl, back, res };
}

describe('OAuth login through Immich (e.g. Authentik)', () => {
  let mock: Awaited<ReturnType<typeof createMockImmich>>;
  let t: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    mock = await createMockImmich();
    t = await makeApp({ IMMICH_URL: mock.url, PUBLIC_URL: PUBLIC });
  });
  afterAll(async () => {
    await t.close();
    await mock.app.close();
  });
  afterEach(() => {
    resetOAuthInfoCache();
    mock.oauth.enabled = true;
    mock.oauth.userEmail = 'anna@example.org';
  });

  it('announces OAuth with the button text from Immich', async () => {
    const cfg = (await new Agent(t.app).req('GET', '/api/config')).json();
    expect(cfg.oauth).toEqual({ enabled: true, buttonText: 'Mit Authentik anmelden', passwordLogin: true });
  });

  it('signs in with PKCE and the public callback URL', async () => {
    const a = new Agent(t.app);
    const { providerUrl, back, res } = await oauthFlow(a);
    const p = new URL(providerUrl).searchParams;
    expect(p.get('redirect_uri')).toBe(`${PUBLIC}/api/auth/oauth/callback`);
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(back.origin).toBe(PUBLIC);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const me = (await a.req('GET', '/api/auth/me')).json();
    expect(me).toMatchObject({ name: 'Anna', kind: 'immich', immichLinked: true, isAdmin: true });
    // the session works against Immich with the user's own token
    expect((await a.req('GET', '/api/immich/albums')).json().items.map((x: any) => x.name)).toEqual(['Urlaub']);
  });

  it('keeps users apart', async () => {
    mock.oauth.userEmail = 'ben@example.org';
    const b = new Agent(t.app);
    await oauthFlow(b);
    expect((await b.req('GET', '/api/auth/me')).json().name).toBe('Ben');
    expect((await b.req('GET', '/api/immich/albums')).json().items.map((x: any) => x.name)).toEqual(['Bens Album']);
  });

  it('rejects a callback with a wrong state', async () => {
    const a = new Agent(t.app);
    const { res } = await oauthFlow(a, 'login', (path) => path.replace(/state=[^&]+/, 'state=falsch'));
    expect(res.headers.location).toBe('/?oauth_error=auth.oauthState');
    expect((await a.req('GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('rejects a callback without the state cookie (e.g. started in another browser)', async () => {
    const start = await new Agent(t.app).req('GET', '/api/auth/oauth/start');
    const idp = await fetch(start.headers.location as string, { redirect: 'manual' });
    const back = new URL(idp.headers.get('location')!);
    const other = new Agent(t.app);
    const res = await other.req('GET', `${back.pathname}${back.search}`);
    expect(res.headers.location).toBe('/?oauth_error=auth.oauthState');
  });

  it('reports a provider refusal', async () => {
    const res = await new Agent(t.app).req('GET', '/api/auth/oauth/callback?error=access_denied&state=x');
    expect(res.headers.location).toBe('/?oauth_error=auth.oauthDenied');
  });

  it('tells the user when Immich has OAuth switched off', async () => {
    mock.oauth.enabled = false;
    resetOAuthInfoCache();
    const res = await new Agent(t.app).req('GET', '/api/auth/oauth/start');
    expect(res.headers.location).toBe('/?oauth_error=auth.oauthDisabled');
  });

  it('never hands the Immich token to the browser', async () => {
    const a = new Agent(t.app);
    const { res } = await oauthFlow(a);
    const all = JSON.stringify(res.headers) + res.body;
    for (const tok of mock.tokens.keys()) expect(all.includes(tok)).toBe(false);
  });
});

describe('OAuth for linking an Immich account to a local account', () => {
  it('links via OAuth', async () => {
    const mock = await createMockImmich();
    resetOAuthInfoCache();
    const t = await makeApp({ IMMICH_URL: mock.url, AUTH_MODE: 'local', ADMIN_EMAIL: 'admin@example.org', ADMIN_PASSWORD: 'admin-pass' });
    try {
      const a = new Agent(t.app);
      await a.req('POST', '/api/auth/login', { email: 'admin@example.org', password: 'admin-pass' });
      // OAuth is no login method in local mode
      expect((await a.req('GET', '/api/auth/oauth/start')).statusCode).toBe(400);
      const { providerUrl, res } = await oauthFlow(a, 'link');
      // without PUBLIC_URL the callback URL comes from the request
      expect(new URL(providerUrl).searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/oauth/callback');
      expect(res.headers.location).toBe('/?oauth_linked=1');
      const me = (await a.req('GET', '/api/auth/me')).json();
      expect(me).toMatchObject({ kind: 'local', immichLinked: true });
      expect((await a.req('GET', '/api/immich/albums')).json().items).toHaveLength(1);
    } finally {
      await t.close();
      await mock.app.close();
    }
  });
});
