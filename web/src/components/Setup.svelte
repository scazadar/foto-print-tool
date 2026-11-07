<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { api, ApiError } from '../lib/api';
  import { errorText, t } from '../lib/i18n';
  import { loadSession } from '../lib/state.svelte';

  let email = $state('');
  let password = $state('');
  let name = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await api.post('/api/setup', { email, password, name });
      await loadSession();
    } catch (err) {
      error = err instanceof ApiError ? errorText(err.code, err.data) : t('errors.generic');
    } finally {
      busy = false;
    }
  }
</script>

<section class="panel setup">
  <h1>{t('setup.title')}</h1>
  <p>{t('setup.text')}</p>
  <form onsubmit={submit}>
    <label class="field"><span>{t('login.name')}</span><input bind:value={name} autocomplete="name" /></label>
    <label class="field"><span>{t('login.email')}</span><input type="email" bind:value={email} required autocomplete="username" /></label>
    <label class="field"><span>{t('settings.newPassword')}</span><input type="password" bind:value={password} minlength="8" required autocomplete="new-password" /></label>
    {#if error}<p class="error-text" role="alert">{error}</p>{/if}
    <button class="primary" type="submit" disabled={busy}>{t('setup.submit')}</button>
  </form>
</section>

<style>
  .setup { max-width: 420px; margin: 2rem auto; }
  input { width: 100%; }
</style>
