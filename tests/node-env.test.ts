// @vitest-environment node
import { describe, it, expect } from 'vitest';

// package.json advertises dist/dom-pulse.esm.js (built from src/index.ts) as both
// `main` and `module`, so importing the package in a server-side / SSR bundle must
// not touch the DOM at module scope.
describe('importing the ESM entry outside a browser', () => {
  it('does not throw', async () => {
    expect(typeof globalThis.document).toBe('undefined');
    const mod = await import('../src/index');
    expect(typeof mod.DomPulse.start).toBe('function');
    expect(mod.DomPulse.running).toBe(false);
  });
});
