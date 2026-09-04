import { Store } from './store';
import { WriteLog } from './write-log';
import { installWritePatches } from './attribution';
import { installReflowPatches, originals } from './cost/reflow';
import { watchLayoutShifts } from './cost/layout-shift';
import { createObserver } from './observer';
import { Overlay } from './overlay';
import { Hud } from './hud/hud';
import { parseStack } from './stack';
import { withInternal } from './internal';
import { warnOnce } from './warn';
import { DEFAULT_OPTIONS, type Options, type MutationKind } from './types';

export type { Options, PulseEvent, ElementStats, SourceStats, Diff } from './types';
export interface DomPulseOptions extends Partial<Options> {}

interface Instance {
  store: Store; hud: Hud;
  // The single source of truth for tearing this instance down. Both stop() and
  // the failed-start catch path in start() unwind this same array, in reverse
  // registration order -- there is exactly one place that knows how to tear an
  // instance down, so a partial-start path and stop() can never drift apart.
  cleanups: Array<() => void>;
}

let inst: Instance | null = null;
const ALL_KINDS: MutationKind[] = ['childList', 'attributes', 'characterData'];

function detectSelfFile(): string | undefined {
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  if (src) return src;
  return parseStack(new Error().stack)[0]?.file;
}

function unwind(cleanups: Array<() => void>): void {
  for (const c of cleanups.reverse()) { try { c(); } catch { /* never break the page while unwinding */ } }
}

export const DomPulse = {
  start(options: DomPulseOptions = {}): void {
    if (inst) return;
    // Anything constructed below (DOM nodes, listeners, timers, patched
    // descriptors) is recorded here as it happens. If a later step throws,
    // the catch block unwinds exactly what was built so far, in reverse
    // order -- a failed start() must never leave a half-patched page behind.
    const cleanups: Array<() => void> = [];
    try {
      const opts: Options = { ...DEFAULT_OPTIONS, ...options };
      const selfFile = detectSelfFile();
      const store = new Store(opts.bufferSize, opts.hotThreshold);
      const log = new WriteLog();
      const overlay = new Overlay(store);
      cleanups.push(() => overlay.destroy());
      let hud: Hud | null = null;
      let observer: ReturnType<typeof createObserver> | null = null;
      const isIgnored = (n: Node): boolean =>
        n === overlay.element || (hud !== null && (n === hud.host || hud.host.contains(n)));
      hud = new Hud(store, {
        onPause: p => { store.paused = p; },
        onReset: () => store.reset(),
        onFilters: f => observer?.setFilters({ include: f.include, exclude: f.exclude, kinds: new Set(f.kinds) }),
        onLocate: el => {
          withInternal(() => { try { originals.scrollIntoView?.call(el, { block: 'center', inline: 'nearest' }); } catch { /* ignore */ } });
          overlay.highlight(el);
        },
      }, { topN: opts.topN, include: opts.include, exclude: opts.exclude });
      cleanups.push(() => hud!.destroy());
      const restoreWrites = installWritePatches(log);
      cleanups.push(restoreWrites);
      const restoreReflow = installReflowPatches(log, (ev, hit) => store.addReflow(ev, hit), selfFile);
      cleanups.push(restoreReflow);
      observer = createObserver({ store, log, selfFile, isIgnored }, { include: opts.include, exclude: opts.exclude, kinds: new Set(ALL_KINDS) });
      cleanups.push(() => observer!.disconnect());
      const stopShift = watchLayoutShifts(store);
      cleanups.push(stopShift);
      const timer = window.setInterval(() => store.tick(performance.now()), 1000);
      cleanups.push(() => clearInterval(timer));
      const clickHandler = (e: MouseEvent): void => {
        if (!e.altKey || !hud) return;
        const t = e.target as Element | null;
        if (!t || isIgnored(t)) return;
        try {
          e.preventDefault(); e.stopPropagation();
          // hud.select() renders a lane for this element whether or not the Store
          // already tracks it -- for an untracked-but-connected element it falls
          // back to computing the label directly, so nothing here needs to (or may)
          // register the element in the Store as a side effect of Alt+click.
          hud.select(t);
          overlay.highlight(t);
        } catch (err) { warnOnce('click', err); }
      };
      document.addEventListener('click', clickHandler, true);
      cleanups.push(() => document.removeEventListener('click', clickHandler, true));
      inst = { store, hud, cleanups };
    } catch (e) {
      warnOnce('start', e);
      unwind(cleanups);
      // Belt and braces: remove any stray marked nodes a cleanup above missed.
      document.querySelectorAll('[data-dom-pulse]').forEach(n => withInternal(() => n.remove()));
    }
  },

  stop(): void {
    const i = inst;
    inst = null;
    if (!i) {
      // Nothing to unwind: either never started, or a failed start() already
      // cleaned up after itself above.
      document.querySelectorAll('[data-dom-pulse]').forEach(n => withInternal(() => n.remove()));
      return;
    }
    unwind(i.cleanups);
  },

  pause(): void { if (inst) { inst.store.paused = true; inst.hud.setPaused(true); } },
  resume(): void { if (inst) { inst.store.paused = false; inst.hud.setPaused(false); } },
  reset(): void { inst?.store.reset(); },
  get running(): boolean { return inst !== null; },
};
