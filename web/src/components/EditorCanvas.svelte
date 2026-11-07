<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { clampCenter, computeLayout, orientedSize, ZOOM_MAX, ZOOM_MIN_FIT, type EditState } from '../../../shared/edit';
  import { formatSizeMm, type PhotoFormat } from '../../../shared/formats';
  import { passportGuides } from '../../../shared/passport';
  import { renderPhoto } from '../../../shared/render';
  import type { EditorItem } from '../lib/state.svelte';

  let {
    item,
    format,
    guides,
    straightening = false,
    onBegin,
    onEnd,
  }: {
    item: EditorItem;
    format: PhotoFormat;
    guides: { thirds: boolean; safety: boolean; passport: boolean };
    straightening?: boolean;
    onBegin: () => void;
    onEnd: () => void;
  } = $props();

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let box = $state({ w: 600, h: 600 });
  let dragging = $state(false);
  let raf = 0;

  const mm = $derived(formatSizeMm(format, item.orientation));
  // canvas size in CSS pixels, keeping the format's aspect ratio
  const size = $derived.by(() => {
    const ratio = mm.w / mm.h;
    let w = box.w;
    let h = w / ratio;
    if (h > box.h) {
      h = box.h;
      w = h * ratio;
    }
    return { w: Math.max(50, Math.floor(w)), h: Math.max(50, Math.floor(h)) };
  });

  /* ------- scratch canvases, reused between frames ------- */
  const pool = new Map<string, HTMLCanvasElement>();
  function factory(w: number, h: number) {
    const key = `${Math.round(w)}x${Math.round(h)}`;
    let c = pool.get(key);
    if (!c) {
      if (pool.size > 6) pool.clear();
      c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      pool.set(key, c);
    }
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    return { canvas: c, ctx };
  }

  function draw() {
    raf = 0;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(size.w * dpr);
    const H = Math.round(size.h * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const img = item.img;
    if (!img || !item.loaded) {
      ctx.fillStyle = '#d1d5db';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const pxPerMm = W / mm.w;
    const edit = $state.snapshot(item.edit) as EditState;
    const layout = renderPhoto({
      ctx,
      frameW: W,
      frameH: H,
      pxPerMm,
      image: img,
      imgW: img.naturalWidth,
      imgH: img.naturalHeight,
      edit,
      createCanvas: factory,
      fast: dragging,
    });
    drawOverlays(ctx, W, H, pxPerMm, layout.inner);
  }

  function drawOverlays(ctx: CanvasRenderingContext2D, W: number, H: number, pxPerMm: number, inner: { x: number; y: number; w: number; h: number }) {
    const dpr = W / size.w;
    ctx.save();
    ctx.lineWidth = 1 * dpr;
    if (guides.thirds || straightening) {
      const n = straightening ? 9 : 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 2 * dpr;
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        const x = inner.x + (inner.w * i) / n;
        const y = inner.y + (inner.h * i) / n;
        ctx.moveTo(x, inner.y);
        ctx.lineTo(x, inner.y + inner.h);
        ctx.moveTo(inner.x, y);
        ctx.lineTo(inner.x + inner.w, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (guides.safety) {
      const m = 3 * pxPerMm;
      ctx.strokeStyle = 'rgba(220,38,38,0.9)';
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
      ctx.setLineDash([]);
    }
    if (guides.passport && format.passport) {
      const g = passportGuides(format.passport);
      const sy = H / g.heightMm;
      const colors: Record<string, string> = { crown: 'rgba(37,99,235,0.28)', eyes: 'rgba(22,163,74,0.28)', chin: 'rgba(234,88,12,0.35)' };
      for (const b of g.bands) {
        ctx.fillStyle = colors[b.key];
        ctx.fillRect(0, b.top * sy, W, (b.bottom - b.top) * sy);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(draw);
  }

  $effect(() => {
    // track everything the picture depends on
    JSON.stringify(item.edit);
    void item.orientation;
    void item.loaded;
    void size.w;
    void size.h;
    void guides.thirds;
    void guides.safety;
    void guides.passport;
    void straightening;
    void dragging;
    void format.id;
    schedule();
  });

  /* ------------------------------ gestures ------------------------------ */
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; zoom: number } | null = null;

  function geometry() {
    const img = item.img!;
    const W = canvas.width;
    const H = canvas.height;
    const pxPerMm = W / mm.w;
    return { W, H, pxPerMm, iw: img.naturalWidth, ih: img.naturalHeight };
  }

  function apply(e: EditState) {
    const g = geometry();
    const c = clampCenter(e, g.W, g.H, g.pxPerMm, g.iw, g.ih);
    item.edit.cx = c.cx;
    item.edit.cy = c.cy;
    item.edit.zoom = c.zoom;
  }

  function pan(dxCss: number, dyCss: number) {
    const g = geometry();
    const s = g.W / size.w;
    const e = $state.snapshot(item.edit) as EditState;
    const layout = computeLayout(g.W, g.H, g.pxPerMm, g.iw, g.ih, e);
    const dx = dxCss * s;
    const dy = dyCss * s;
    const cos = Math.cos(-layout.theta);
    const sin = Math.sin(-layout.theta);
    const qx = (dx * cos - dy * sin) / layout.scale;
    const qy = (dx * sin + dy * cos) / layout.scale;
    const { w: sw, h: sh } = orientedSize(g.iw, g.ih, e.rot90);
    apply({ ...e, cx: e.cx - qx / sw, cy: e.cy - qy / sh });
  }

  function setZoom(z: number) {
    const e = $state.snapshot(item.edit) as EditState;
    const min = e.mode === 'fit' ? ZOOM_MIN_FIT : 1;
    apply({ ...e, zoom: Math.min(ZOOM_MAX, Math.max(min, z)) });
  }

  function down(e: PointerEvent) {
    if (!item.loaded) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      onBegin();
      dragging = true;
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: item.edit.zoom };
    }
  }

  function move(e: PointerEvent) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) pan(cur.x - prev.x, cur.y - prev.y);
    else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.dist > 0) setZoom(pinch.zoom * (d / pinch.dist));
      // move with the midpoint as well
      pan((cur.x - prev.x) / 2, (cur.y - prev.y) / 2);
    }
  }

  function up(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      dragging = false;
      onEnd();
    }
  }

  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  function wheel(e: WheelEvent) {
    if (!item.loaded) return;
    e.preventDefault();
    if (!wheelTimer) onBegin();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      wheelTimer = undefined;
      onEnd();
    }, 400);
    setZoom(item.edit.zoom * Math.exp(-e.deltaY * 0.0015));
  }

  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 20 : 4;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      onBegin();
      pan(-moves[e.key][0], -moves[e.key][1]);
      onEnd();
    } else if (e.key === '+' || e.key === '-') {
      onBegin();
      setZoom(item.edit.zoom * (e.key === '+' ? 1.1 : 1 / 1.1));
      onEnd();
    }
  }

  let ro: ResizeObserver;
  onMount(() => {
    ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      box = { w: r.width, h: Math.max(240, Math.min(window.innerHeight * 0.68, r.width * 1.6)) };
    });
    ro.observe(wrap);
    canvas.addEventListener('wheel', wheel, { passive: false });
  });
  onDestroy(() => {
    ro?.disconnect();
    if (raf) cancelAnimationFrame(raf);
    canvas?.removeEventListener('wheel', wheel);
  });
</script>

<div class="wrap" bind:this={wrap} style="height: {box.h}px">
  <canvas
    bind:this={canvas}
    style="width: {size.w}px; height: {size.h}px"
    tabindex="0"
    aria-label="Bildausschnitt: ziehen zum Verschieben, Mausrad oder zwei Finger zum Zoomen, Pfeiltasten und +/−"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onkeydown={key}
  ></canvas>
  {#if item.error}<p class="err">{item.error}</p>{/if}
</div>

<style>
  .wrap { display: flex; align-items: center; justify-content: center; width: 100%; position: relative; }
  canvas { touch-action: none; box-shadow: 0 2px 16px rgba(0,0,0,0.25); cursor: grab; background: #fff; }
  canvas:active { cursor: grabbing; }
  canvas:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
  .err { position: absolute; color: var(--danger); background: var(--panel); padding: 0.4em 0.8em; border-radius: 6px; }
</style>
