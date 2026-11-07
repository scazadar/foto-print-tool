<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { t } from '../lib/i18n';
  import { app, openEditor } from '../lib/state.svelte';
  import UploadPanel from './UploadPanel.svelte';
  import ImmichPanel from './ImmichPanel.svelte';

  let tab = $state<'upload' | 'immich'>('upload');
</script>

{#if app.config?.immich}
  <div class="tabs" role="tablist">
    <button role="tab" class:active={tab === 'upload'} aria-selected={tab === 'upload'} onclick={() => (tab = 'upload')}>{t('sources.upload')}</button>
    <button role="tab" class:active={tab === 'immich'} aria-selected={tab === 'immich'} onclick={() => (tab = 'immich')}>{t('sources.immich')}</button>
  </div>
{/if}

{#if tab === 'immich' && app.config?.immich}
  <ImmichPanel />
{:else}
  <UploadPanel />
{/if}

{#if app.selection.length}
  <div class="selbar">
    <span>{t('sources.selected', { n: app.selection.length })}</span>
    <button onclick={() => (app.selection = [])}>{t('sources.clearSelection')}</button>
    <button class="primary" onclick={openEditor}>{t('sources.toEditor')} →</button>
  </div>
{/if}

<style>
  .selbar {
    position: sticky; bottom: 0; margin-top: 1rem; display: flex; gap: 0.6rem; align-items: center; justify-content: flex-end;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 0.6rem 0.8rem;
    box-shadow: 0 -2px 12px rgba(0,0,0,0.08); flex-wrap: wrap;
  }
  .selbar span { margin-right: auto; font-weight: 600; }
</style>
