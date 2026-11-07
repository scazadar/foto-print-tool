<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { t } from '../lib/i18n';
  import { app } from '../lib/state.svelte';
  import { sourceLink } from '../lib/source';
</script>

<footer>
  {#if app.config}
    <a href={sourceLink(app.config)} target="_blank" rel="noopener">{t('footer.source')}</a>
    <span>v{app.config.version} ({app.config.commit.slice(0, 7)})</span>
    <span>{t('footer.license')}</span>
    <button class="link" onclick={() => (app.aboutOpen = true)}>{t('nav.about')}</button>
  {/if}
</footer>

<style>
  footer { display: flex; flex-wrap: wrap; gap: 0.5rem 1.2rem; justify-content: center; padding: 0.8rem; font-size: 0.8rem; color: var(--muted); border-top: 1px solid var(--line); }
  .link { border: 0; background: none; padding: 0; min-height: 0; color: var(--accent); text-decoration: underline; font-size: inherit; }
</style>
