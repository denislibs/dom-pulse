/**
 * The "Instrument" theme: the panel reads as a piece of bench equipment resting on
 * the page rather than as another element of it — graphite casing, an inset screen
 * for the data, and amber for anything the eye should land on.
 *
 * Two constraints shape this stylesheet. It is injected into a shadow root on pages
 * DOM Pulse does not control, so it can only use fonts the host machine already has:
 * a condensed stack with a narrow fallback for the engraved labels, and the platform
 * monospace for the data. And amber on graphite stays legible over any background the
 * page puts behind it, which a lighter panel would not.
 *
 * The mutation-kind colours (green, blue, yellow) and the hot red are deliberately
 * NOT themed: they are the shared vocabulary between this panel, the canvas overlay
 * and the README, so they stay exactly as the design document fixes them.
 */

/** Sparkline stroke. Lives here so the theme owns every colour the panel shows. */
export const SPARK_COLOR = '#ffb454';

const LABEL = `"Avenir Next Condensed","Arial Narrow",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace`;

export const STYLES = `
:host{all:initial}
*{box-sizing:border-box}

.panel{width:452px;max-height:70vh;display:flex;flex-direction:column;
  font:12px/1.45 ${MONO};color:#ded7c9;background:#262b31;
  border:1px solid #14181c;border-radius:10px;overflow:hidden;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 18px 44px -14px rgba(0,0,0,.7)}

/* ---- faceplate ---- */
.head{display:flex;align-items:center;gap:9px;padding:9px 12px;cursor:move;user-select:none;
  background:linear-gradient(180deg,#3b424b,#31373f);border-bottom:1px solid #14181c;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.title{font:600 11px/1 ${LABEL};font-stretch:87.5%;letter-spacing:.2em;text-transform:uppercase;color:#f0eadc}
.stats{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#8f897d}
.stats b{color:#ffb454;font-weight:700;text-shadow:0 0 10px rgba(255,180,84,.35)}
.head button{all:unset;cursor:pointer;padding:0 6px;color:#8f897d;font:inherit;border-radius:4px}
.head button:hover{color:#f0eadc}
.head button:focus-visible{outline:2px solid #ffb454;outline-offset:1px}
.head button.on{color:#ffb454}

/* ---- filters ---- */
.settings{display:flex;flex-wrap:wrap;gap:8px 14px;padding:8px 12px;
  background:#2c323a;border-bottom:1px solid #14181c}
.settings label{display:flex;align-items:center;gap:5px;color:#8f897d}
.settings input{font:inherit;background:#14181c;color:#ded7c9;border:1px solid #0c0f12;
  border-radius:4px;padding:2px 5px;box-shadow:inset 0 2px 5px rgba(0,0,0,.5)}
.settings input:focus-visible{outline:2px solid #ffb454;outline-offset:1px}
.settings input[type=number]{width:4em}

/* ---- the screen ---- */
.body{overflow:auto;background:#1b1f24}
table{width:100%;border-collapse:collapse}
th,td{padding:4px 8px;text-align:right;white-space:nowrap}
th{position:sticky;top:0;cursor:pointer;background:#22272d;border-bottom:1px solid #14181c;
  font:600 10px/1.9 ${LABEL};font-stretch:87.5%;letter-spacing:.16em;text-transform:uppercase;color:#8f897d}
th.sorted{color:#ffb454}
td.el,th:first-child{text-align:left;max-width:190px;overflow:hidden;text-overflow:ellipsis}
tr[data-i]{cursor:pointer}
tr[data-i]:hover{background:#2c323a}
tr.sel{background:#3a3020}
tr.hot td.el{color:#ff8f6b}
.empty{color:#6b6558;text-align:center;padding:10px}

/* ---- lane ---- */
.lane{border-top:1px solid #14181c;background:#14181c;padding:7px 12px;max-height:220px;overflow:auto}
.lane-title{font:600 11px/1 ${LABEL};font-stretch:87.5%;letter-spacing:.16em;text-transform:uppercase;
  color:#ffb454;margin-bottom:6px}
.ev{padding:3px 0;border-bottom:1px solid #22272d;word-break:break-all;cursor:pointer}
.ev .tog{color:#6b6558;margin-right:3px}
.k{display:inline-block;min-width:44px;font-weight:700}
.k.childList{color:#7ee08a}.k.attributes{color:#7db4ff}.k.characterData{color:#ffd24a}
.ev ins{color:#7ee08a;text-decoration:none}
.ev del{color:#ff9d9d}
.ev mark{background:#4a3a12;color:#ffdf9e}
.meta{color:#8f897d}
.ev-detail{padding:2px 0 5px 16px;border-bottom:1px solid #22272d;color:#8f897d}
.det-h{color:#ded7c9;margin-top:3px}
.det-h b{color:#ffb454}
.frame{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:8px}
.frame .loc{color:#6b6558}

/* ---- sources ---- */
.sources{border-top:1px solid #14181c;background:#1b1f24;padding:5px 0}
.src{display:flex;justify-content:space-between;gap:8px;padding:3px 12px;cursor:pointer}
.src:hover{background:#2c323a}
.src.active{background:#3a3020;color:#ffb454}
.src span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ---- collapsed ---- */
.badge{font:600 12px/1 ${LABEL};font-stretch:87.5%;letter-spacing:.14em;text-transform:uppercase;
  background:linear-gradient(180deg,#3b424b,#31373f);color:#ffb454;
  border:1px solid #14181c;border-radius:999px;padding:9px 14px;cursor:pointer;user-select:none;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 10px 26px -10px rgba(0,0,0,.7)}
.badge small{color:#8f897d}
`;
