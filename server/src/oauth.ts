// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/**
 * Sign-in through the OAuth/OIDC provider configured in Immich (e.g.
 * Authentik), the same way the Immich mobile app does it:
 *
 *   1. POST /api/oauth/authorize {redirectUri, state, codeChallenge} → provider URL
 *   2. the browser signs in at the provider, which redirects to
 *      <Fotodruck>/api/auth/oauth/callback?code=…&state=…
 *   3. POST /api/oauth/callback {url, state, codeVerifier} → Immich access token
 *
 * Fotodruck needs no client of its own at the provider; the callback URL only
 * has to be allowed as redirect URI of Immich's client there.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { linkImmichAccount, signInImmichUser } from './auth.js';
import { type AppContext, HttpError } from './context.js';
import { randomToken } from './crypto.js';
import { ImmichClient, ImmichError } from './immich.js';

const STATE_COOKIE = 'fd_oauth';
const STATE_MAX_AGE_S = 600;
const CALLBACK_PATH = '/api/auth/oauth/callback';

export interface OAuthInfo {
  enabled: boolean;
  buttonText: string;
  passwordLogin: boolean;
}

/** `at` = valid until */
let infoCache: { at: number; info: OAuthInfo } | null = null;

/** Whether Immich offers OAuth and password login (cached for a minute). */
export async function immichOAuthInfo(ctx: AppContext): Promise<OAuthInfo> {
  const off: OAuthInfo = { enabled: false, buttonText: '', passwordLogin: true };
  if (!ctx.config.immichUrl) return off;
  if (infoCache && Date.now() < infoCache.at) return infoCache.info;
  const client = new ImmichClient(ctx.config.immichUrl, null);
  let info = off;
  try {
    const features = await client.features();
    const cfg = await client.serverConfig().catch(() => ({ oauthButtonText: '' }));
    info = {
      enabled: !!features.oauth,
      buttonText: (cfg.oauthButtonText || '').trim() || 'OAuth',
      passwordLogin: features.passwordLogin !== false,
    };
  } catch {
    // Immich not reachable: no OAuth button for now, ask again in 15 s
    infoCache = { at: Date.now() + 15_000, info: off };
    return off;
  }
  infoCache = { at: Date.now() + 60_000, info };
  return info;
}

export function resetOAuthInfoCache(): void {
  infoCache = null;
}

/** Public base URL of Fotodruck as the browser sees it. */
export function publicBaseUrl(ctx: AppContext, req: FastifyRequest): string {
  const raw = ctx.config.publicUrl ?? `${req.protocol}://${req.host}`;
  // normalised (no default port), the way the provider compares redirect URIs
  const u = new URL(raw);
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

const b64url = (b: Buffer) => b.toString('base64url');

interface PendingFlow {
  state: string;
  verifier: string;
  mode: 'login' | 'link';
  /** user that started a link flow */
  userId: string | null;
  redirectUri: string;
  exp: number;
}

function back(reply: FastifyReply, params: Record<string, string>) {
  reply.clearCookie(STATE_COOKIE, { path: '/api/auth/oauth' });
  const q = new URLSearchParams(params).toString();
  return reply.redirect(`/${q ? `?${q}` : ''}`, 302);
}

export function registerOAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config } = ctx;

  app.get('/api/auth/oauth/start', async (req, reply) => {
    if (!config.immichUrl) throw new HttpError(404, 'immich.notConfigured');
    const mode = (req.query as any).mode === 'link' ? 'link' : 'login';
    if (mode === 'login' && config.authMode !== 'immich') throw new HttpError(400, 'auth.oauthNotForLogin');
    if (mode === 'link') {
      if (!req.user) return back(reply, { oauth_error: 'auth.required' });
      if (req.user.kind === 'immich') return back(reply, { oauth_error: 'immich.alreadyImmichLogin' });
      if (req.user.kind === 'guest') return back(reply, { oauth_error: 'auth.guestNotAllowed' });
    }
    const info = await immichOAuthInfo(ctx);
    if (!info.enabled) return back(reply, { oauth_error: 'auth.oauthDisabled' });

    const state = randomToken(24);
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const redirectUri = `${publicBaseUrl(ctx, req)}${CALLBACK_PATH}`;
    let url: string;
    try {
      url = (await new ImmichClient(config.immichUrl, null).oauthAuthorize(redirectUri, state, challenge)).url;
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'oauth authorize failed');
      return back(reply, { oauth_error: err instanceof ImmichError ? err.code : 'auth.oauthFailed' });
    }
    const flow: PendingFlow = { state, verifier, mode, userId: req.user?.id ?? null, redirectUri, exp: Date.now() + STATE_MAX_AGE_S * 1000 };
    reply.setCookie(STATE_COOKIE, ctx.box.encrypt(JSON.stringify(flow)), {
      path: '/api/auth/oauth',
      httpOnly: true,
      // the provider redirects back with a top-level GET: Lax cookies are sent
      sameSite: 'lax',
      secure: 'auto',
      signed: true,
      maxAge: STATE_MAX_AGE_S,
    });
    return reply.redirect(url, 302);
  });

  app.get(CALLBACK_PATH, async (req, reply) => {
    if (!config.immichUrl) throw new HttpError(404, 'immich.notConfigured');
    const q = req.query as Record<string, string | undefined>;
    if (q.error) return back(reply, { oauth_error: 'auth.oauthDenied' });

    const raw = req.cookies[STATE_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    const plain = unsigned?.valid && unsigned.value ? ctx.box.decrypt(unsigned.value) : null;
    let flow: PendingFlow | null = null;
    try {
      flow = plain ? (JSON.parse(plain) as PendingFlow) : null;
    } catch {
      flow = null;
    }
    if (!flow || flow.exp < Date.now() || typeof q.state !== 'string' || q.state.length !== flow.state.length ||
      !crypto.timingSafeEqual(Buffer.from(q.state), Buffer.from(flow.state))) {
      return back(reply, { oauth_error: 'auth.oauthState' });
    }
    if (typeof q.code !== 'string' || !q.code) return back(reply, { oauth_error: 'auth.oauthFailed' });

    // Immich derives the redirect URI from this URL (without the query), so it must match step 1
    const callbackUrl = `${flow.redirectUri}?${new URLSearchParams(q as Record<string, string>).toString()}`;
    let login;
    try {
      login = await new ImmichClient(config.immichUrl, null).oauthCallback(callbackUrl, flow.state, flow.verifier);
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'oauth callback failed');
      return back(reply, { oauth_error: 'auth.oauthFailed' });
    }
    const cred = { type: 'token' as const, value: login.accessToken };
    let me;
    try {
      me = await new ImmichClient(config.immichUrl, cred).me();
    } catch {
      return back(reply, { oauth_error: 'auth.oauthFailed' });
    }

    if (flow.mode === 'link') {
      // the same user must still be signed in
      if (!req.user || req.user.id !== flow.userId) return back(reply, { oauth_error: 'auth.oauthState' });
      linkImmichAccount(ctx, req.user.id, cred, me.id);
      return back(reply, { oauth_linked: '1' });
    }
    if (config.authMode !== 'immich') return back(reply, { oauth_error: 'auth.oauthNotForLogin' });
    signInImmichUser(ctx, reply, cred, me);
    return back(reply, {});
  });
}
