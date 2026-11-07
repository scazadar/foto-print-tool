<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n';
  import { app } from '../lib/state.svelte';
  import { sourceLink } from '../lib/source';

  let dlg: HTMLDialogElement;
  onMount(() => dlg.showModal());
</script>

<dialog bind:this={dlg} onclose={() => (app.aboutOpen = false)}>
  <h2>{t('about.title')}</h2>
  {#if app.config}
    <p>{t('about.version', { version: app.config.version, commit: app.config.commit })}</p>
    <p>{t('about.text')}</p>
    <p><a href={sourceLink(app.config)} target="_blank" rel="noopener">{t('about.sourceLink')}</a> · <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0</a></p>
    <p class="muted small">{t('about.independent')} {t('about.noTelemetry')}</p>
  {/if}
  <div class="row"><button class="primary" onclick={() => dlg.close()}>{t('common.close')}</button></div>
</dialog>
