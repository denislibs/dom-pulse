# Known limitations

Recorded during the initial build. None of these block use; each is a real gap worth knowing about.

## Attribution

- **Named style writes are unattributed in current Chrome.** `src/attribution.ts` patches `CSSStyleDeclaration.prototype`, but Chrome 148 serves named style properties (`el.style.color = 'red'`) as per-instance own properties rather than prototype accessors, so those writes leave no record and their mutations show `unknown source`. Gecko historically put them on `CSS2Properties.prototype`; jsdom uses a per-instance Proxy. `setProperty`, `cssText` and `setAttribute('style', …)` are attributed everywhere.
- **`toggleAttribute(name, force)` with `force` matching the current state** produces no MutationRecord and is not in the inert-write list, so it can pair with a later same-attribute write in the same frame.
- **`DOMTokenList` writes to lists other than `classList`** (`relList`, `sandbox`, `part`) produce no write record, because only `classList` registers an owner.
- **A forced read of a filtered or ignored element** can still bump an in-scope ancestor's or descendant's reflow count, because `WriteLog.forRead` matches by containment.

## Cost signals

- **Element-charged reflows keep their count and source but not the API or stack.** A read that precedes any write to that element has no event to hang the detail on, so the HUD lane shows the reader's stack only for event-carried hits.
- **`Store.addReflow` and `Store.addShift` ignore `paused`.** Pausing freezes mutation recording but not every reflow and shift counter.
- **The orphan drain's forward fallback** can blame a write that ran after the read. Accepted best effort; the alternative is dropping the hit.

## HUD

- **Element labels are frozen at first sighting**, including the descendant count, so a list first seen with two children still reads `ul (2)` after it grows.
- **`topSources` sorts by mutation count**, so a source with no mutations and many reflows — a pure measuring function — sorts last and can fall out of the panel.
- **The header and the table both say "mut/s"** but the header is a one-second count and the column is the five-second average.
- **`bySource` is never pruned**, and `topSources` re-sorts the whole map on every render.

## Rendering

- **The overlay canvas clamps to 1×1 if `window.innerWidth` is 0 at mount** and only recovers when a `resize` event fires.
- **`parseStyle` splits on every `;`**, so a value containing a literal semicolon — a `data:` URI in `background-image`, for example — renders as a garbage style diff.
- **`shortFile` returns the full URL for a directory-ending path**, so an inline script at `http://host/demo/` shows its whole URL in the sources list.

## Not implemented

Recording and rewind, page-health tiles (FPS, long tasks, listener counts, detached nodes), framework adapters, data export, and a browser extension. See the design document for why each was left out of the first version.
