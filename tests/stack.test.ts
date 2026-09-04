import { describe, it, expect } from 'vitest';
import { parseStack, sourceKey, shortFile, INTERNAL_PREFIX } from '../src/stack';

const chrome = [
  'Error',
  '    at capture (http://localhost/dist/dom-pulse.js:10:5)',
  `    at ${INTERNAL_PREFIX}setAttribute (http://localhost/dist/dom-pulse.js:20:7)`,
  '    at render (http://localhost/app/list.js?v=3:42:13)',
  '    at http://localhost/app/main.js:7:1',
  '    at async load (http://localhost/app/main.js:9:3)',
].join('\n');

const firefox = [
  `${INTERNAL_PREFIX}setAttribute@http://localhost/dist/dom-pulse.js:20:7`,
  'render@http://localhost/app/list.js:42:13',
  '@http://localhost/app/main.js:7:1',
].join('\n');

describe('parseStack', () => {
  it('parses Chrome frames and drops everything up to the last internal frame', () => {
    const frames = parseStack(chrome);
    expect(frames.map(f => f.fn)).toEqual(['render', '', 'async load']);
    expect(frames[0]).toEqual({ fn: 'render', file: 'http://localhost/app/list.js?v=3', line: 42, column: 13 });
  });
  it('keeps user frames when DOM Pulse is bundled into the page script', () => {
    // Bundled build: DOM Pulse's own frames and the page's frames share one file.
    // Only the internal-prefix marker may cut, so the user frames must survive.
    const raw = [
      'Error',
      '    at capture (http://x/app.js:1:1)',
      `    at ${INTERNAL_PREFIX}setAttribute (http://x/app.js:2:2)`,
      '    at render (http://x/app.js:3:3)',
      '    at onClick (http://x/app.js:4:4)',
    ].join('\n');
    expect(parseStack(raw).map(f => f.fn)).toEqual(['render', 'onClick']);
  });
  it('parses Firefox frames', () => {
    const frames = parseStack(firefox);
    expect(frames.map(f => f.fn)).toEqual(['render', '']);
  });
  it('returns [] for undefined', () => {
    expect(parseStack(undefined)).toEqual([]);
  });
  it('respects limit', () => {
    expect(parseStack(chrome, 1)).toHaveLength(1);
  });
});

describe('sourceKey', () => {
  it('formats first frame', () => {
    expect(sourceKey(parseStack(chrome))).toBe('list.js:42 render');
  });
  it('uses (anonymous) for empty fn', () => {
    expect(sourceKey([{ fn: '', file: 'http://x/a/b.js', line: 3, column: 1 }])).toBe('b.js:3 (anonymous)');
  });
  it('is null for empty stack', () => {
    expect(sourceKey([])).toBeNull();
  });
});

describe('shortFile', () => {
  it('strips path and query', () => {
    expect(shortFile('http://h/a/b/c.js?x=1')).toBe('c.js');
    expect(shortFile('c.js')).toBe('c.js');
  });
});
