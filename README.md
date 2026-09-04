# DOM Pulse

Live DOM mutation stethoscope for any page and any framework. Attach one script and the page starts to breathe: every mutating element flashes an outline, a HUD shows mutations per second, the hottest elements, what exactly changed, which code did it, and what it cost (forced reflows, layout shifts, nodes touched).

Unlike react-scan it listens to the DOM itself, so it sees writes from React, Vue, Svelte, jQuery, vanilla code and third-party scripts alike. It does not see renders that never reach the DOM.

## Use

Script tag (auto-starts):

```html
<script src="dom-pulse.js"></script>
```

Bookmarklet:

```js
javascript:(function(){var s=document.createElement('script');s.src='https://YOUR-HOST/dom-pulse.js';document.body.appendChild(s)})()
```

ESM:

```js
import { DomPulse } from 'dom-pulse';
DomPulse.start({ hotThreshold: 20, bufferSize: 500, include: '', exclude: '', topN: 10 });
```

API: `DomPulse.start(options)`, `stop()`, `pause()`, `resume()`, `reset()`, `running`.

## Reading the overlay

- Green outline: children changed. Blue: attribute changed. Yellow: text changed.
- Red, thicker: hot element, more than `hotThreshold` mutations in the last 5 s.
- Dashed outline: a forced synchronous layout (offsetWidth, getBoundingClientRect, getComputedStyle, …) was read right after this write.
- Orange fill: this mutation shifted layout; the fill marks the shifted area.

## HUD

Header: mutations/s, reflows/s, total layout shift, 30 s sparkline. Table: top elements sortable by any column; click a row to scroll to it, click again to open its mutation lane with diffs, stack source and cost marks. Sources: files and functions writing to the DOM most; click to filter the table. Alt+click any element on the page to open its lane. Settings: include/exclude selectors, mutation kinds, min rate, rows.

## Develop

```bash
npm install
npm test
npm run dev    # builds in watch mode and serves demo at http://127.0.0.1:8765/demo/
npm run build
```
