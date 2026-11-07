<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { setUnauthorizedHandler } from './lib/api';
  import { t } from './lib/i18n';
  import { errorText } from './lib/i18n';
  import { app, loadSession, toast } from './lib/state.svelte';
  import Header from './components/Header.svelte';
  import Footer from './components/Footer.svelte';
  import About from './components/About.svelte';
  import Login from './components/Login.svelte';
  import Setup from './components/Setup.svelte';
  import Sources from './components/Sources.svelte';
  import Editor from './components/Editor.svelte';
  import Settings from './components/Settings.svelte';
  import Admin from './components/Admin.svelte';

  let loadError = $state(false);

  onMount(() => {
    setUnauthorizedHandler(() => {
      if (app.user) {
        app.user = null;
        loadSession().catch(() => undefined);
      }
    });
    // result of an OAuth round trip (?oauth_error=… / ?oauth_linked=1)
    const params = new URLSearchParams(location.search);
    const oauthError = params.get('oauth_error');
    if (oauthError) toast(errorText(oauthError), 'error');
    if (params.get('oauth_linked')) {
      toast(t('settings.oauthLinked'));
      app.view = 'settings';
    }
    if (oauthError || params.get('oauth_linked')) history.replaceState(null, '', location.pathname);
    loadSession().catch(() => (loadError = true));
  });
</script>

<Header />
<main>
  {#if loadError}
    <div class="notice err">{t('errors.network')}</div>
  {:else if !app.ready || !app.config}
    <p class="muted">{t('common.loading')}</p>
  {:else if app.config.setupRequired}
    <Setup />
  {:else if !app.user}
    <Login />
  {:else if app.view === 'editor'}
    <Editor />
  {:else if app.view === 'settings'}
    <Settings />
  {:else if app.view === 'admin' && app.user.isAdmin}
    <Admin />
  {:else}
    <Sources />
  {/if}
</main>
<Footer />
{#if app.aboutOpen}<About />{/if}
{#if app.toast}
  <div class="toast" class:error={app.toast.kind === 'error'} role="status" aria-live="polite">{app.toast.text}</div>
{/if}
