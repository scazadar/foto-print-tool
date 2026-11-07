<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { app } from '../lib/state.svelte';
</script>

{#if app.items.length > 1}
  <div class="strip" role="listbox" aria-label="Filmstreifen">
    {#each app.items as it, i (it.key)}
      <button class:active={i === app.current} role="option" aria-selected={i === app.current} onclick={() => (app.current = i)} title={it.ref.name}>
        <img src={it.ref.thumbUrl} alt={it.ref.name} />
        {#if it.copies > 1}<span class="copies">×{it.copies}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .strip { display: flex; gap: 6px; overflow-x: auto; padding: 8px 2px; margin-top: 0.6rem; }
  button { padding: 0; border: 3px solid transparent; border-radius: 6px; flex: 0 0 auto; position: relative; background: var(--line); min-height: 0; }
  button.active { border-color: var(--accent); background: var(--accent); }
  img { width: 72px; height: 72px; object-fit: cover; display: block; border-radius: 3px; }
  .copies { position: absolute; right: 2px; bottom: 2px; background: rgba(0,0,0,0.6); color: #fff; font-size: 0.7rem; padding: 0 4px; border-radius: 3px; }
</style>
