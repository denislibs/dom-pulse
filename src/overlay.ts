import { Store } from './store';
import { originals } from './cost/reflow';
import { withInternal } from './internal';
import { warnOnce } from './warn';
import type { ElementStats, MutationKind, Rect } from './types';

export const FADE_MS = 1500;
export const KIND_COLORS: Record<MutationKind, [number, number, number]> = {
  childList: [34, 197, 94], attributes: [59, 130, 246], characterData: [234, 179, 8],
};
export const HOT_COLOR: [number, number, number] = [239, 68, 68];
export const SHIFT_COLOR: [number, number, number] = [249, 115, 22];

export interface FrameStyle { rgba: string; dashed: boolean; lineWidth: number; shiftAlpha: number }

export function frameStyle(s: ElementStats, now: number, hotThreshold: number): FrameStyle | null {
  const age = now - s.lastTime;
  if (age < 0 || age > FADE_MS) return null;
  const fade = 1 - age / FADE_MS;
  const recent = s.recent.count(now);
  const hot = recent >= hotThreshold;
  const [r, g, b] = hot ? HOT_COLOR : KIND_COLORS[s.lastKind];
  const intensity = hot ? 1 : Math.min(1, 0.35 + (recent / hotThreshold) * 0.65);
  const alpha = hot ? Math.max(0.6, fade) : fade * intensity;
  return {
    rgba: `rgba(${r},${g},${b},${alpha.toFixed(3)})`,
    dashed: now - s.lastReflowTime <= FADE_MS,
    lineWidth: hot ? 3 : 2,
    shiftAlpha: now - s.lastShiftTime <= FADE_MS ? 0.18 * fade : 0,
  };
}

const defaultRectOf = (el: Element): Rect => {
  const r = originals.getBoundingClientRect.call(el);
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};

export class Overlay {
  readonly element: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private raf = 0;
  private running = false;
  private highlights = new Map<Element, number>();
  private unsubscribe: () => void;

  constructor(private store: Store, private rectOf: (el: Element) => Rect = defaultRectOf) {
    const c = document.createElement('canvas');
    this.element = c;
    this.ctx = c.getContext('2d');
    // setAttribute and the style setter are both patched by attribution.ts's write-log
    // hooks, so the whole setup (not just appendChild) must run inside withInternal —
    // otherwise these self-writes would be logged as untracked page writes and could
    // misattribute a later forced-reflow read to the overlay's own construction.
    withInternal(() => {
      c.setAttribute('data-dom-pulse', 'overlay');
      c.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;';
      document.documentElement.appendChild(c);
    });
    this.resize();
    window.addEventListener('resize', this.resize);
    this.unsubscribe = store.subscribe(() => this.wake());
  }

  highlight(el: Element): void { this.highlights.set(el, performance.now()); this.wake(); }

  private resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    this.element.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    this.element.height = Math.max(1, Math.floor(window.innerHeight * dpr));
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  wake(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    try {
      const more = this.draw(performance.now());
      if (more) this.raf = requestAnimationFrame(this.frame);
      else this.running = false;
    } catch (err) {
      this.running = false;
      warnOnce('overlay-draw', err);
    }
  };

  /** Draws one frame; returns true while there is something still fading. */
  draw(now: number): boolean {
    const ctx = this.ctx;
    let any = false;
    ctx?.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const s of this.store.active(now, FADE_MS)) {
      if (!s.element.isConnected) continue;
      const st = frameStyle(s, now, this.store.hotThreshold);
      if (!st) continue;
      any = true;
      if (!ctx) continue;
      const r = this.rectOf(s.element);
      if (r.width === 0 && r.height === 0) continue;
      if (st.shiftAlpha > 0) {
        ctx.fillStyle = `rgba(${SHIFT_COLOR.join(',')},${st.shiftAlpha.toFixed(3)})`;
        for (const sr of s.shiftRects) ctx.fillRect(sr.x, sr.y, sr.width, sr.height);
      }
      ctx.setLineDash(st.dashed ? [4, 3] : []);
      ctx.lineWidth = st.lineWidth;
      ctx.strokeStyle = st.rgba;
      ctx.strokeRect(r.x, r.y, r.width, r.height);
    }
    for (const [el, t] of this.highlights) {
      const age = now - t;
      if (age > FADE_MS || !el.isConnected) { this.highlights.delete(el); continue; }
      any = true;
      if (!ctx) continue;
      const r = this.rectOf(el);
      const a = (1 - age / FADE_MS).toFixed(3);
      ctx.setLineDash([]);
      ctx.lineWidth = 4; ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
      ctx.lineWidth = 2; ctx.strokeStyle = `rgba(${HOT_COLOR.join(',')},${a})`;
      ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
    }
    return any;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.unsubscribe();
    window.removeEventListener('resize', this.resize);
    withInternal(() => this.element.remove());
  }
}
