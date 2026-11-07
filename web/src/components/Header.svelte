<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { api } from '../lib/api';
  import { t } from '../lib/i18n';
  import { app, loadSession, type View } from '../lib/state.svelte';

  let avatarFailed = $state(false);
  let menuOpen = $state(false);

  function go(v: View) {
    app.view = v;
    menuOpen = false;
  }

  async function logout() {
    await api.post('/api/auth/logout').catch(() => undefined);
    app.user = null;
    app.items = [];
    app.selection = [];
    app.view = 'photos';
    await loadSession();
  }
</script>

<header>
  <button class="brand" onclick={() => go('photos')} aria-label={t('app.name')}>
    <img src="/favicon.svg" alt="" width="26" height="26" />
    <span>{t('app.name')}</span>
  </button>
  {#if app.user}
    <nav class:open={menuOpen}>
      <button class:active={app.view === 'photos'} onclick={() => go('photos')}>{t('nav.photos')}</button>
      <button class:active={app.view === 'editor'} onclick={() => go('editor')} disabled={app.items.length === 0}>
        {t('nav.editor')}{app.items.length ? ` (${app.items.length})` : ''}
      </button>
      <button class:active={app.view === 'settings'} onclick={() => go('settings')}>{t('nav.settings')}</button>
      {#if app.user.isAdmin && app.config?.authMode !== 'none'}
        <button class:active={app.view === 'admin'} onclick={() => go('admin')}>{t('nav.admin')}</button>
      {/if}
    </nav>
    <div class="user">
      {#if app.user.immichLinked && !avatarFailed}
        <img class="avatar" src="/api/auth/avatar" alt="" onerror={() => (avatarFailed = true)} />
      {:else}
        <span class="avatar initials" aria-hidden="true">{app.user.name.slice(0, 1).toUpperCase()}</span>
      {/if}
      <span class="name">{app.user.name}</span>
      {#if app.config?.authMode !== 'none'}
        <button onclick={logout}>{t('nav.logout')}</button>
      {/if}
    </div>
    <button class="menu icon" aria-label="Menü" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>☰</button>
  {/if}
</header>

<style>
  header {
    display: flex; align-items: center; gap: 1rem; padding: 0.5rem 1rem; background: var(--panel);
    border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 20;
  }
  .brand { border: 0; background: none; font-weight: 700; font-size: 1.1rem; padding: 0.2em; }
  nav { display: flex; gap: 0.25rem; flex: 1; }
  nav button { border: 0; background: none; }
  nav button.active { color: var(--accent); background: none; font-weight: 600; }
  .user { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
  .initials { display: inline-flex; align-items: center; justify-content: center; background: var(--accent); color: #fff; font-weight: 600; }
  .menu { display: none; }
  @media (max-width: 760px) {
    .menu { display: inline-flex; }
    .user .name { display: none; }
    nav { display: none; position: absolute; top: 100%; left: 0; right: 0; flex-direction: column; background: var(--panel); border-bottom: 1px solid var(--line); padding: 0.5rem; }
    nav.open { display: flex; }
  }
</style>
