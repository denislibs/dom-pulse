export const STYLES = `
:host{all:initial}
*{box-sizing:border-box}
.panel{width:440px;max-height:70vh;display:flex;flex-direction:column;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e5e7eb;background:rgba(17,24,39,.94);border:1px solid #374151;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);overflow:hidden}
.head{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#111827;cursor:move;user-select:none}
.title{font-weight:700;color:#f9fafb}
.stats{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.stats b{color:#fff}
.head button{all:unset;cursor:pointer;padding:0 5px;color:#9ca3af;font:inherit}.head button:hover{color:#fff}.head button.on{color:#fbbf24}
.settings{display:flex;flex-wrap:wrap;gap:6px 12px;padding:6px 8px;border-bottom:1px solid #374151}
.settings label{display:flex;align-items:center;gap:4px}
.settings input{font:inherit;background:#1f2937;color:#fff;border:1px solid #4b5563;border-radius:4px;padding:1px 4px}
.settings input[type=number]{width:4em}
.body{overflow:auto}
table{width:100%;border-collapse:collapse}
th,td{padding:3px 6px;text-align:right;white-space:nowrap}
th{color:#9ca3af;font-weight:500;cursor:pointer;position:sticky;top:0;background:rgba(17,24,39,.98)}th.sorted{color:#fff}
td.el,th:first-child{text-align:left;max-width:190px;overflow:hidden;text-overflow:ellipsis}
tr[data-i]{cursor:pointer}tr[data-i]:hover{background:#1f2937}tr.sel{background:#1e3a5f}tr.hot td.el{color:#f87171}
.empty{color:#6b7280;text-align:center;padding:8px}
.lane{border-top:1px solid #374151;padding:4px 8px;max-height:220px;overflow:auto}
.lane-title{color:#fff;font-weight:700;margin-bottom:4px}
.ev{padding:2px 0;border-bottom:1px dashed #1f2937;word-break:break-all}
.k{display:inline-block;min-width:44px;font-weight:700}.k.childList{color:#22c55e}.k.attributes{color:#3b82f6}.k.characterData{color:#eab308}
.ev{cursor:pointer}.ev .tog{color:#6b7280;margin-right:3px}
.ev-detail{padding:2px 0 4px 16px;border-bottom:1px dashed #1f2937;color:#9ca3af}
.det-h{color:#d1d5db;margin-top:2px}.det-h b{color:#fff}
.frame{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:8px}.frame .loc{color:#6b7280}
.ev ins{color:#86efac;text-decoration:none}.ev del{color:#fca5a5}.ev mark{background:#78350f;color:#fde68a}.meta{color:#9ca3af}
.sources{border-top:1px solid #374151;padding:4px 0}
.src{display:flex;justify-content:space-between;gap:8px;padding:2px 8px;cursor:pointer}.src:hover{background:#1f2937}.src.active{background:#3f3f46}
.src span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font:13px/1 ui-monospace,Menlo,monospace;background:rgba(17,24,39,.94);color:#fff;border:1px solid #374151;border-radius:999px;padding:6px 10px;cursor:pointer;user-select:none}
.badge small{color:#9ca3af}
`;
