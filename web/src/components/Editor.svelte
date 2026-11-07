<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { centerOnBox, clampCenter, copyStyle, dpiLevel, effectiveDpi, type EditState, ZOOM_MAX, ZOOM_MIN_FIT } from '../../../shared/edit';
  import { formatSizeMm } from '../../../shared/formats';
  import { api } from '../lib/api';
  import { beginChange, change, computeAutoLevels, endChange, loadItem, redo, undo } from '../lib/editor';
  import { fmtDate, t } from '../lib/i18n';
  import { app, currentFormat, refKey } from '../lib/state.svelte';
  import EditorCanvas from './EditorCanvas.svelte';
  import Filmstrip from './Filmstrip.svelte';
  import FormatPicker from './FormatPicker.svelte';
  import OutputPanel from './OutputPanel.svelte';
  import Slider from './Slider.svelte';

  const item = $derived(app.items[app.current]);
  const format = $derived(currentFormat());
  const guides = $state({ thirds: false, safety: false, passport: true });
  let straightening = $state(false);
  let faceIndex = $state(0);

  $effect(() => {
    if (item) loadItem(item);
    // preload the neighbours
    const n = app.items[app.current + 1];
    if (n) loadItem(n);
  });

  const mm = $derived(item ? formatSizeMm(format, item.orientation) : { w: 100, h: 150 });
  const dpi = $derived(item && item.loaded && item.origW ? effectiveDpi(mm.w, mm.h, item.origW, item.origH, item.edit) : null);
  const level = $derived(dpi === null ? null : dpiLevel(dpi));

  const begin = () => item && beginChange(item);
  const end = () => {
    if (!item) return;
    reclamp();
    endChange(item);
  };

  /** Keep the crop valid after zoom, rotation, border or format changes. */
  function reclamp() {
    if (!item?.img || !item.loaded) return;
    const W = 1000;
    const H = (1000 * mm.h) / mm.w;
    const c = clampCenter($state.snapshot(item.edit) as EditState, W, H, W / mm.w, item.img.naturalWidth, item.img.naturalHeight);
    item.edit.cx = c.cx;
    item.edit.cy = c.cy;
    item.edit.zoom = c.zoom;
  }

  function act(fn: () => void) {
    if (!item) return;
    change(item, () => {
      fn();
      reclamp();
    });
  }

  function selectFormat(id: string) {
    app.formatId = id;
    api.post('/api/formats/recent', { id }).catch(() => undefined);
    if (!app.formats.recent.includes(id)) app.formats.recent = [id, ...app.formats.recent].slice(0, 5);
    // keep the picture centre, but the crop has to stay valid for every picture
    for (const it of app.items) {
      if (!it.img || !it.loaded) continue;
      const m = formatSizeMm(currentFormat(), it.orientation);
      const c = clampCenter($state.snapshot(it.edit) as EditState, 1000, (1000 * m.h) / m.w, 1000 / m.w, it.img.naturalWidth, it.img.naturalHeight);
      it.edit.cx = c.cx;
      it.edit.cy = c.cy;
    }
  }

  function setMode(mode: EditState['mode']) {
    act(() => {
      item.edit.mode = mode;
      if (mode !== 'fit') item.edit.zoom = Math.max(1, item.edit.zoom);
    });
  }

  function rotate(dir: 1 | -1) {
    act(() => {
      item.edit.rot90 = (((item.edit.rot90 + dir * 90) % 360) + 360) % 360 as EditState['rot90'];
    });
  }

  function auto() {
    if (!item?.img) return;
    act(() => {
      item.edit.adjust.levels = item.edit.adjust.levels ? null : computeAutoLevels(item.img!);
    });
  }

  function centerFace() {
    if (!item?.faces.length) return;
    const f = item.faces[faceIndex % item.faces.length];
    faceIndex++;
    act(() => {
      const c = centerOnBox($state.snapshot(item.edit) as EditState, f);
      item.edit.cx = c.cx;
      item.edit.cy = c.cy;
    });
  }

  function applyAll() {
    if (!item) return;
    const src = $state.snapshot(item.edit) as EditState;
    for (const it of app.items) {
      if (it === item) continue;
      change(it, () => {
        it.edit = copyStyle(src, $state.snapshot(it.edit) as EditState);
      });
    }
  }

  function removeCurrent() {
    if (!item) return;
    const key = item.key;
    app.items.splice(app.current, 1);
    app.selection = app.selection.filter((s) => refKey(s) !== key);
    if (app.current >= app.items.length) app.current = Math.max(0, app.items.length - 1);
    if (app.items.length === 0) app.view = 'photos';
  }

  function toggleCaption(on: boolean) {
    act(() => {
      item.edit.caption = on ? { text: fmtDate(item.ref.takenAt) || '', font: 'sans', sizeMm: 4, color: '#222222' } : null;
      if (on) {
        // the caption sits in the bottom border
        item.edit.mode = 'border';
        item.edit.borderBottomMm = Math.max(item.edit.borderBottomMm, 10);
      }
    });
  }

  function keys(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!item || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(item);
      else undo(item);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo(item);
    }
  }
  onMount(() => window.addEventListener('keydown', keys));
  onDestroy(() => window.removeEventListener('keydown', keys));
</script>

{#if !item}
  <p class="muted">{t('editor.empty')}</p>
  <button onclick={() => (app.view = 'photos')}>{t('nav.photos')}</button>
{:else}
  <div class="editor">
    <section class="stage">
      <div class="toolbar row">
        <button class="icon" onclick={() => undo(item)} disabled={!item.history.length} title={t('editor.undo')} aria-label={t('editor.undo')}>↶</button>
        <button class="icon" onclick={() => redo(item)} disabled={!item.future.length} title={t('editor.redo')} aria-label={t('editor.redo')}>↷</button>
        <button onclick={() => act(() => { item.edit = structuredClone($state.snapshot(item.initial)) as EditState; })} title={t('editor.resetAll')}>{t('common.reset')}</button>
        <span class="grow"></span>
        {#if dpi !== null && level}
          <span class="badge {level}" title={t(`editor.dpi.${level}`)}>{t('editor.dpi', { dpi: Math.round(dpi) })}</span>
        {/if}
        <span class="muted small name" title={item.ref.name}>{item.ref.name}</span>
      </div>
      {#if level === 'bad'}
        <div class="notice err small" role="alert">{t('editor.dpi.bad')}</div>
      {:else if level === 'ok'}
        <div class="notice warn small">{t('editor.dpi.ok')}</div>
      {/if}
      {#if item.warning}<div class="notice warn small">{t('editor.lowres')}</div>{/if}
      <EditorCanvas {item} {format} {guides} {straightening} onBegin={begin} onEnd={end} />
      <Filmstrip />
    </section>

    <aside class="side">
      <details open>
        <summary>{t('editor.format')}</summary>
        <FormatPicker value={app.formatId} onSelect={selectFormat} />
        <div class="row seg">
          <button aria-pressed={item.orientation === 'portrait'} onclick={() => act(() => (item.orientation = 'portrait'))}>▯ {t('editor.portrait')}</button>
          <button aria-pressed={item.orientation === 'landscape'} onclick={() => act(() => (item.orientation = 'landscape'))}>▭ {t('editor.landscape')}</button>
        </div>
        <p class="hint">{t('format.labHint')}</p>
      </details>

      <details open>
        <summary>{t('editor.mode')}</summary>
        <div class="row seg wrapbtn">
          {#each ['fill', 'fit', 'border'] as m (m)}
            <button aria-pressed={item.edit.mode === m} onclick={() => setMode(m as EditState['mode'])}>{t(`editor.mode.${m}`)}</button>
          {/each}
        </div>
        {#if item.edit.mode === 'fit'}
          <label class="field"><span>{t('editor.background')}</span>
            <select value={item.edit.background} onchange={(e) => act(() => (item.edit.background = e.currentTarget.value as EditState['background']))}>
              {#each ['white', 'black', 'color', 'blur'] as b (b)}<option value={b}>{t(`editor.bg.${b}`)}</option>{/each}
            </select>
          </label>
        {/if}
        {#if item.edit.mode === 'border'}
          <label class="field"><span>{t('editor.background')}</span>
            <select value={item.edit.background === 'blur' ? 'white' : item.edit.background} onchange={(e) => act(() => (item.edit.background = e.currentTarget.value as EditState['background']))}>
              {#each ['white', 'black', 'color'] as b (b)}<option value={b}>{t(`editor.bg.${b}`)}</option>{/each}
            </select>
          </label>
          <Slider label={t('editor.border')} bind:value={item.edit.borderMm} min={0} max={30} step={0.5} reset={5} unit=" mm" digits={1} onBegin={begin} onEnd={end} />
          <Slider label={t('editor.borderBottom')} bind:value={item.edit.borderBottomMm} min={0} max={40} step={0.5} reset={0} unit=" mm" digits={1} onBegin={begin} onEnd={end} />
        {/if}
        {#if item.edit.mode !== 'fill' && item.edit.background === 'color'}
          <label class="row"><span class="label">{t('editor.bg.color')}</span>
            <input type="color" value={item.edit.bgColor} oninput={(e) => { begin(); item.edit.bgColor = e.currentTarget.value; }} onchange={end} />
          </label>
        {/if}
        <Slider label={t('editor.zoom')} bind:value={item.edit.zoom} min={item.edit.mode === 'fit' ? ZOOM_MIN_FIT : 1} max={ZOOM_MAX} step={0.01} reset={1} unit="×" digits={2} onBegin={begin} onEnd={end} />
        {#if item.faces.length}
          <button onclick={centerFace}>☺ {t('editor.face')}</button>
        {/if}
      </details>

      <details open>
        <summary>{t('editor.rotate')}</summary>
        <div class="row">
          <button class="icon" onclick={() => rotate(-1)} title={t('editor.rotateLeft')} aria-label={t('editor.rotateLeft')}>⟲</button>
          <button class="icon" onclick={() => rotate(1)} title={t('editor.rotateRight')} aria-label={t('editor.rotateRight')}>⟳</button>
          <button class="icon" aria-pressed={item.edit.flipH} onclick={() => act(() => (item.edit.flipH = !item.edit.flipH))} title={t('editor.flipH')} aria-label={t('editor.flipH')}>⇋</button>
          <button class="icon" aria-pressed={item.edit.flipV} onclick={() => act(() => (item.edit.flipV = !item.edit.flipV))} title={t('editor.flipV')} aria-label={t('editor.flipV')}>⇵</button>
        </div>
        <div onpointerdown={() => (straightening = true)} onpointerup={() => (straightening = false)} onpointerleave={() => (straightening = false)} role="presentation">
          <Slider label={t('editor.straighten')} bind:value={item.edit.angle} min={-45} max={45} step={0.1} reset={0} unit="°" digits={1} onBegin={begin} onEnd={end} />
        </div>
      </details>

      <details open>
        <summary>{t('editor.corrections')}</summary>
        <Slider label={t('editor.brightness')} bind:value={item.edit.adjust.brightness} min={-100} max={100} onBegin={begin} onEnd={end} />
        <Slider label={t('editor.contrast')} bind:value={item.edit.adjust.contrast} min={-100} max={100} onBegin={begin} onEnd={end} />
        <Slider label={t('editor.saturation')} bind:value={item.edit.adjust.saturation} min={-100} max={100} onBegin={begin} onEnd={end} />
        <Slider label={t('editor.temperature')} bind:value={item.edit.adjust.temperature} min={-100} max={100} onBegin={begin} onEnd={end} />
        <Slider label={t('editor.sharpness')} bind:value={item.edit.adjust.sharpness} min={0} max={100} onBegin={begin} onEnd={end} />
        <div class="row seg wrapbtn">
          {#each ['none', 'bw', 'sepia'] as f (f)}
            <button aria-pressed={item.edit.adjust.filter === f} onclick={() => act(() => (item.edit.adjust.filter = f as EditState['adjust']['filter']))}>{t(`editor.filter.${f}`)}</button>
          {/each}
          <button aria-pressed={!!item.edit.adjust.levels} onclick={auto}>{t('editor.auto')}</button>
        </div>
      </details>

      <details>
        <summary>{t('editor.caption')}</summary>
        <label class="check"><input type="checkbox" checked={!!item.edit.caption} onchange={(e) => toggleCaption(e.currentTarget.checked)} /> {t('editor.caption')}</label>
        {#if item.edit.caption}
          <label class="field"><span>{t('editor.captionText')}</span>
            <input value={item.edit.caption.text} maxlength="200" oninput={(e) => { begin(); item.edit.caption!.text = e.currentTarget.value; }} onchange={end} />
          </label>
          {#if item.ref.takenAt}
            <button onclick={() => act(() => (item.edit.caption!.text = fmtDate(item.ref.takenAt)))}>{t('editor.captionDate')}</button>
          {/if}
          <div class="row">
            <label class="field grow"><span>{t('editor.captionFont')}</span>
              <select value={item.edit.caption.font} onchange={(e) => act(() => (item.edit.caption!.font = e.currentTarget.value as any))}>
                {#each ['sans', 'serif', 'mono', 'hand'] as f (f)}<option value={f}>{t(`editor.font.${f}`)}</option>{/each}
              </select>
            </label>
            <label class="field"><span>{t('editor.captionColor')}</span>
              <input type="color" value={item.edit.caption.color} oninput={(e) => { begin(); item.edit.caption!.color = e.currentTarget.value; }} onchange={end} />
            </label>
          </div>
          <Slider label={t('editor.captionSize')} bind:value={item.edit.caption.sizeMm} min={1} max={20} step={0.5} reset={4} unit=" mm" digits={1} onBegin={begin} onEnd={end} />
        {/if}
      </details>

      <details>
        <summary>{t('editor.guides')}</summary>
        <label class="check"><input type="checkbox" bind:checked={guides.thirds} /> {t('editor.thirds')}</label>
        <label class="check"><input type="checkbox" bind:checked={guides.safety} /> {t('editor.safety')}</label>
        {#if format.passport}
          <label class="check"><input type="checkbox" bind:checked={guides.passport} /> {t('editor.passport')}</label>
          <p class="hint">{format.passport === 'us' ? t('editor.passportNoteUs') : t('editor.passportNote')}</p>
        {/if}
      </details>

      <div class="row more">
        <label class="row"><span class="label">{t('editor.copies')}</span>
          <input type="number" min="1" max="99" bind:value={item.copies} style="width: 5em" />
        </label>
        {#if app.items.length > 1}
          <button onclick={applyAll} title={t('editor.applyAllHint')}>{t('editor.applyAll')}</button>
        {/if}
        <button class="danger" onclick={removeCurrent}>{t('editor.remove')}</button>
      </div>

      <OutputPanel />
    </aside>
  </div>
{/if}

<style>
  .editor { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 1rem; align-items: start; }
  .stage { position: sticky; top: 64px; }
  .toolbar { margin-bottom: 0.5rem; }
  .name { max-width: 14em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .side { display: flex; flex-direction: column; gap: 0.6rem; }
  details { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 0.6rem 0.8rem; }
  summary { font-weight: 600; cursor: pointer; margin-bottom: 0.5rem; }
  details:not([open]) summary { margin-bottom: 0; }
  .seg { margin: 0.5rem 0; }
  .seg button { flex: 1; }
  .wrapbtn button { flex: 1 1 auto; }
  .more { justify-content: space-between; }
  @media (max-width: 900px) {
    .editor { grid-template-columns: 1fr; }
    .stage { position: static; }
  }
</style>
