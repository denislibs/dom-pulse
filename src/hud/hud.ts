import { Store } from '../store';
import { withInternal } from '../internal';
import { STYLES } from './styles';
import { renderDiff, escapeHtml } from './render-diff';
import { drawSparkline } from './sparkline';
import type { ElementStats, MutationKind, SortKey } from '../types';

export interface HudFilters { include: string; exclude: string; kinds: MutationKind[]; minRate: number; topN: number }
export interface HudCallbacks {
  onPause(paused: boolean): void;
  onReset(): void;
  onFilters(f: HudFilters): void;
  onLocate(el: Element): void;
}
export interface HudOptions { topN: number; include: string; exclude: string }

const POS_KEY = 'dom-pulse:pos';
const KINDS: MutationKind[] = ['childList', 'attributes', 'characterData'];
const KIND_LABEL: Record<MutationKind, string> = { childList: 'child', attributes: 'attr', characterData: 'text' };
const COLUMNS: Array<{ key: SortKey; title: string }> = [
  { key: 'rate', title: 'mut/s' }, { key: 'reflows', title: 'reflow' }, { key: 'layoutShift', title: 'shift' },
  { key: 'nodesAffected', title: 'nodes' }, { key: 'total', title: 'total' },
];

export class Hud {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  private timer = 0;
  private rows: ElementStats[] = [];
  private sourceKeys: string[] = [];
  private state = {
    collapsed: false, paused: false, settingsOpen: false,
    sortKey: 'rate' as SortKey, selected: null as Element | null, expanded: false, sourceFilter: null as string | null,
    include: '', exclude: '', kinds: { childList: true, attributes: true, characterData: true } as Record<MutationKind, boolean>,
    minRate: 0, topN: 10,
  };
  private el!: {
    panel: HTMLElement; badge: HTMLElement; head: HTMLElement; settings: HTMLElement; spark: HTMLCanvasElement;
    tbody: HTMLElement; thead: HTMLElement; lane: HTMLElement; sources: HTMLElement; stat: Record<string, HTMLElement>;
  };
  private drag: { dx: number; dy: number } | null = null;

  constructor(private store: Store, private cb: HudCallbacks, opts: HudOptions) {
    this.state.topN = opts.topN; this.state.include = opts.include; this.state.exclude = opts.exclude;
    this.host = document.createElement('div');
    this.root = this.host.attachShadow({ mode: 'open' });
    withInternal(() => {
      this.host.setAttribute('data-dom-pulse', 'hud');
      this.host.style.cssText = 'all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647;';
      this.root.innerHTML = this.skeleton();
      document.documentElement.appendChild(this.host);
    });
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.el = {
      panel: q('.panel'), badge: q('.badge'), head: q('.head'), settings: q('.settings'), spark: q<HTMLCanvasElement>('.spark'),
      tbody: q('tbody'), thead: q('thead'), lane: q('.lane'), sources: q('.sources'),
      stat: { mut: q('[data-k="mut"]'), reflow: q('[data-k="reflow"]'), shift: q('[data-k="shift"]') },
    };
    withInternal(() => {
      (q<HTMLInputElement>('input[data-f="include"]')).value = opts.include;
      (q<HTMLInputElement>('input[data-f="exclude"]')).value = opts.exclude;
      (q<HTMLInputElement>('input[data-f="topN"]')).value = String(opts.topN);
    });
    this.restorePosition();
    this.bind();
    this.render();
    this.timer = window.setInterval(() => this.render(), 250);
  }

  private skeleton(): string {
    const ths = COLUMNS.map(c => `<th data-sort="${c.key}">${c.title}</th>`).join('');
    return `<style>${STYLES}</style>
<div class="badge" hidden><span class="badge-n">0</span> <small>mut/s</small></div>
<div class="panel">
  <div class="head">
    <span class="title">DOM Pulse</span>
    <span class="stats"><b data-k="mut">0</b> mut/s · <b data-k="reflow">0</b> reflow/s · <b data-k="shift">0.000</b> shift</span>
    <canvas class="spark" width="90" height="22"></canvas>
    <button data-act="pause" title="Pause">⏸</button><button data-act="reset" title="Reset counters">↺</button><button data-act="settings" title="Filters">⚙</button><button data-act="collapse" title="Collapse">–</button>
  </div>
  <div class="settings" hidden>
    <label>include <input data-f="include" placeholder=".app"></label>
    <label>exclude <input data-f="exclude" placeholder="#ads"></label>
    ${KINDS.map(k => `<label><input type="checkbox" data-kind="${k}" checked> ${KIND_LABEL[k]}</label>`).join('')}
    <label>min mut/5s <input type="number" data-f="minRate" value="0" min="0"></label>
    <label>rows <input type="number" data-f="topN" value="10" min="1"></label>
  </div>
  <div class="body">
    <table><thead><tr><th>element</th>${ths}</tr></thead><tbody></tbody></table>
    <div class="lane" hidden></div>
    <div class="sources"></div>
  </div>
</div>`;
  }

  render(): void {
    withInternal(() => {
      const now = performance.now();
      const s = this.state;
      const rates = this.store.rates(now);
      this.el.badge.hidden = !s.collapsed;
      this.el.panel.hidden = s.collapsed;
      this.el.settings.hidden = !s.settingsOpen;
      (this.el.badge.querySelector('.badge-n') as HTMLElement).textContent = String(rates.mutations);
      this.el.stat.mut.textContent = String(rates.mutations);
      this.el.stat.reflow.textContent = String(rates.reflows);
      this.el.stat.shift.textContent = this.store.totalShift.toFixed(3);
      drawSparkline(this.el.spark, this.store.history);
      if (s.collapsed) return;

      this.rows = this.store.topElements(s.topN, s.sortKey, now, st =>
        (s.minRate === 0 || st.recent.count(now) >= s.minRate) && (!s.sourceFilter || st.sources.has(s.sourceFilter)));
      this.el.tbody.innerHTML = this.rows.map((st, i) => {
        const cls = [st.element === s.selected ? 'sel' : '', this.store.isHot(st, now) ? 'hot' : ''].join(' ').trim();
        return `<tr data-i="${i}" class="${cls}"><td class="el" title="${escapeHtml(st.label)}">${escapeHtml(st.label)}</td>` +
          `<td>${(st.recent.count(now) / 5).toFixed(1)}</td><td>${st.reflows}</td><td>${st.layoutShift.toFixed(3)}</td><td>${st.nodesAffected}</td><td>${st.total}</td></tr>`;
      }).join('') || '<tr><td colspan="6" class="empty">no mutations yet</td></tr>';
      for (const th of this.el.thead.querySelectorAll('th[data-sort]')) th.classList.toggle('sorted', th.getAttribute('data-sort') === s.sortKey);

      const showLane = s.selected !== null && s.expanded;
      this.el.lane.hidden = !showLane;
      if (showLane && s.selected) {
        const label = escapeHtml(this.store.stats(s.selected).label);
        const evs = this.store.eventsFor(s.selected).slice(-20).reverse();
        this.el.lane.innerHTML = `<div class="lane-title">${label}</div>` + (evs.map(ev => {
          const meta = [ev.reflows.length ? `⟲${ev.reflows.length}` : '', ev.layoutShift ? `↕${ev.layoutShift.toFixed(3)}` : '', ev.source ? escapeHtml(ev.source) : '<i>unknown source</i>']
            .filter(Boolean).join(' ');
          return `<div class="ev"><span class="k ${ev.kind}">${KIND_LABEL[ev.kind]}</span> ${renderDiff(ev.diff)} <span class="meta">${meta}</span></div>`;
        }).join('') || '<div class="empty">no recorded mutations for this element</div>');
      }

      const sources = this.store.topSources(8);
      this.sourceKeys = sources.map(x => x.key);
      this.el.sources.innerHTML = sources.map((x, i) =>
        `<div class="src${x.key === s.sourceFilter ? ' active' : ''}" data-s="${i}"><span>${escapeHtml(x.key)}</span><span>${x.mutations} mut · ${x.reflows} reflow</span></div>`).join('');
    });
  }

  select(el: Element): void {
    this.state.selected = el; this.state.expanded = true; this.state.collapsed = false;
    this.render();
  }

  setPaused(p: boolean): void {
    this.state.paused = p;
    const b = this.root.querySelector('[data-act="pause"]') as HTMLElement;
    withInternal(() => { b.textContent = p ? '▶' : '⏸'; b.classList.toggle('on', p); });
  }

  private bind(): void {
    this.root.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const act = t.closest('[data-act]')?.getAttribute('data-act');
      if (act === 'pause') { this.setPaused(!this.state.paused); this.cb.onPause(this.state.paused); return; }
      if (act === 'reset') { this.cb.onReset(); this.state.selected = null; this.state.sourceFilter = null; this.render(); return; }
      if (act === 'settings') { this.state.settingsOpen = !this.state.settingsOpen; this.render(); return; }
      if (act === 'collapse') { this.state.collapsed = true; this.render(); return; }
      if (t.closest('.badge')) { this.state.collapsed = false; this.render(); return; }
      const th = t.closest('th[data-sort]');
      if (th) { this.state.sortKey = th.getAttribute('data-sort') as SortKey; this.render(); return; }
      const tr = t.closest('tr[data-i]');
      if (tr) {
        const st = this.rows[Number(tr.getAttribute('data-i'))];
        if (!st) return;
        if (this.state.selected === st.element) this.state.expanded = !this.state.expanded;
        else { this.state.selected = st.element; this.state.expanded = false; this.cb.onLocate(st.element); }
        this.render(); return;
      }
      const src = t.closest('.src[data-s]');
      if (src) {
        const key = this.sourceKeys[Number(src.getAttribute('data-s'))] ?? null;
        this.state.sourceFilter = this.state.sourceFilter === key ? null : key;
        this.render();
      }
    });
    this.root.addEventListener('change', e => {
      const t = e.target as HTMLInputElement;
      const f = t.getAttribute('data-f'); const k = t.getAttribute('data-kind') as MutationKind | null;
      if (f === 'include') this.state.include = t.value.trim();
      else if (f === 'exclude') this.state.exclude = t.value.trim();
      else if (f === 'minRate') this.state.minRate = Math.max(0, Number(t.value) || 0);
      else if (f === 'topN') this.state.topN = Math.max(1, Number(t.value) || 10);
      else if (k) this.state.kinds[k] = t.checked;
      else return;
      this.cb.onFilters({ include: this.state.include, exclude: this.state.exclude, kinds: KINDS.filter(x => this.state.kinds[x]), minRate: this.state.minRate, topN: this.state.topN });
      this.render();
    });
    this.el.head.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).closest('button,canvas')) return;
      const r = withInternal(() => this.host.getBoundingClientRect());
      this.drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      withInternal(() => { this.host.style.right = 'auto'; this.host.style.bottom = 'auto'; this.host.style.left = r.left + 'px'; this.host.style.top = r.top + 'px'; });
      e.preventDefault();
    });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  private onMove = (e: PointerEvent): void => {
    if (!this.drag) return;
    withInternal(() => { this.host.style.left = e.clientX - this.drag!.dx + 'px'; this.host.style.top = e.clientY - this.drag!.dy + 'px'; });
  };
  private onUp = (): void => {
    if (!this.drag) return;
    this.drag = null;
    try { localStorage.setItem(POS_KEY, JSON.stringify({ left: this.host.style.left, top: this.host.style.top })); } catch { /* ignore */ }
  };
  private restorePosition(): void {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { left: string; top: string };
      withInternal(() => { this.host.style.right = 'auto'; this.host.style.bottom = 'auto'; this.host.style.left = p.left; this.host.style.top = p.top; });
    } catch { /* ignore */ }
  }

  destroy(): void {
    clearInterval(this.timer);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    withInternal(() => this.host.remove());
  }
}
