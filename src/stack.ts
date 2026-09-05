import type { StackFrame } from './types';

/** Wrapper functions created by DOM Pulse are named with this prefix so they can be cut from stacks.
 * Uses containment check (includes) not prefix match: V8 prepends the receiver's constructor name to method frames,
 * so a patched setAttribute appears as "HTMLDivElement.__domPulse_setAttribute" in the stack. */
export const INTERNAL_PREFIX = '__domPulse_';

const CHROME = /^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const FIREFOX = /^(.*?)@(.+?):(\d+):(\d+)\s*$/;

/**
 * Parses a captured stack and drops DOM Pulse's own frames: everything up to and
 * including the last frame whose function name carries INTERNAL_PREFIX.
 *
 * The prefix is the only marker used. An earlier version also cut every frame whose
 * file matched DOM Pulse's own script URL, but that URL had to be guessed from the
 * stack when document.currentScript is null (always, for ESM), and a consumer who
 * bundles DOM Pulse into their own app.js then had every one of their frames cut --
 * every event reported "unknown source". The prefix match needs no guessing, cannot
 * match page code, and survives minification by construction: the wrappers are
 * created as computed-name object methods, so the name is a string literal.
 */
export function parseStack(raw: string | undefined, limit = 12): StackFrame[] {
  if (!raw) return [];
  const frames: StackFrame[] = [];
  for (const line of raw.split('\n')) {
    let m = CHROME.exec(line);
    let fn: string, file: string, ln: string, col: string;
    if (m) { fn = m[1] ?? ''; file = m[2]; ln = m[3]; col = m[4]; }
    else {
      m = FIREFOX.exec(line);
      if (!m) continue;
      fn = m[1]; file = m[2]; ln = m[3]; col = m[4];
    }
    frames.push({ fn: fn.trim(), file, line: Number(ln), column: Number(col) });
  }
  let cut = -1;
  frames.forEach((f, i) => {
    if (f.fn.includes(INTERNAL_PREFIX)) cut = i;
  });
  return frames.slice(cut + 1, cut + 1 + limit);
}

export function shortFile(file: string): string {
  const q = file.split('?')[0];
  return q.slice(q.lastIndexOf('/') + 1) || q;
}

export function sourceKey(frames: StackFrame[]): string | null {
  const f = frames[0];
  if (!f) return null;
  return `${shortFile(f.file)}:${f.line} ${f.fn || '(anonymous)'}`;
}
