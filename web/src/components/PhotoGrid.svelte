<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { fmtDate, t } from '../lib/i18n';
  import { isSelected, type PhotoRef, toggleSelect } from '../lib/state.svelte';

  let {
    items,
    onMore = null,
    loading = false,
    onDelete = null,
  }: {
    items: PhotoRef[];
    onMore?: (() => void) | null;
    loading?: boolean;
    onDelete?: ((r: PhotoRef) => void) | null;
  } = $props();
</script>

<div class="grid">
  {#each items as r (r.kind + r.id)}
    <div class="wrap">
      <button class="cell" class:selected={isSelected(r)} onclick={() => toggleSelect(r)} aria-pressed={isSelected(r)} title={r.name}>
        <img src={r.thumbUrl} alt={r.name} loading="lazy" />
        <span class="tick" aria-hidden="true">{isSelected(r) ? '✓' : ''}</span>
        <span class="caption">{fmtDate(r.takenAt) || r.name}</span>
      </button>
      {#if onDelete}
        <button class="del icon" aria-label={t('common.delete')} title={t('common.delete')} onclick={() => onDelete?.(r)}>🗑</button>
      {/if}
    </div>
  {/each}
</div>
{#if loading}<p class="muted">{t('common.loading')}</p>{/if}
{#if onMore && !loading}
  <div class="row more"><button onclick={() => onMore?.()}>{t('common.more')}</button></div>
{/if}

<style>
  .wrap { position: relative; }
  .wrap .cell { width: 100%; }
  .del { position: absolute; top: 6px; left: 6px; min-height: 28px; min-width: 28px; padding: 0; background: rgba(0,0,0,0.45); color: #fff; border: 0; font-size: 13px; }
  .more { justify-content: center; margin-top: 1rem; }
</style>
