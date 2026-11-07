<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { api, ApiError } from '../lib/api';
  import { errorText, t } from '../lib/i18n';
  import { app, loadSession } from '../lib/state.svelte';

  const immichMode = $derived(app.config?.authMode === 'immich');
  let method = $state<'password' | 'apikey'>('password');
  let register = $state(false);
  let email = $state('');
  let password = $state('');
  let name = $state('');
  let apiKey = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit(e: Event) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      if (register) await api.post('/api/auth/register', { email, password, name });
      else if (immichMode && method === 'apikey') await api.post('/api/auth/login', { method: 'apikey', apiKey });
      else await api.post('/api/auth/login', { method: 'password', email, password });
      password = '';
      apiKey = '';
      await loadSession();
    } catch (err) {
      error = err instanceof ApiError ? errorText(err.code, err.data) : t('errors.generic');
    } finally {
      busy = false;
    }
  }
</script>

<section class="panel login">
  <h1>{register ? t('login.register') : t('login.title')}</h1>
  {#if immichMode}
    <p class="muted">{t('login.immichHint')}</p>
    <div class="tabs" role="tablist">
      <button role="tab" class:active={method === 'password'} aria-selected={method === 'password'} onclick={() => (method = 'password')}>{t('login.withPassword')}</button>
      <button role="tab" class:active={method === 'apikey'} aria-selected={method === 'apikey'} onclick={() => (method = 'apikey')}>{t('login.withApiKey')}</button>
    </div>
  {/if}
  <form onsubmit={submit}>
    {#if immichMode && method === 'apikey'}
      <label class="field"><span>{t('login.apiKey')}</span>
        <input type="password" bind:value={apiKey} autocomplete="off" required />
      </label>
      <p class="hint">{t('login.apiKeyHint')}</p>
    {:else}
      {#if register}
        <label class="field"><span>{t('login.name')}</span><input bind:value={name} autocomplete="name" /></label>
      {/if}
      <label class="field"><span>{t('login.email')}</span>
        <input type="email" bind:value={email} autocomplete="username" required />
      </label>
      <label class="field"><span>{t('login.password')}</span>
        <input type="password" bind:value={password} autocomplete={register ? 'new-password' : 'current-password'} required />
      </label>
    {/if}
    {#if error}<p class="error-text" role="alert">{error}</p>{/if}
    <button class="primary" type="submit" disabled={busy}>{register ? t('login.register') : t('login.submit')}</button>
    {#if app.config?.registration}
      <button type="button" class="linkish" onclick={() => (register = !register)}>{register ? t('login.toLogin') : t('login.register')}</button>
    {/if}
  </form>
</section>

<style>
  .login { max-width: 420px; margin: 2rem auto; }
  input { width: 100%; }
  .linkish { border: 0; background: none; color: var(--accent); }
</style>
