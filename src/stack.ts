import type { StackFrame } from './types';

/** Wrapper functions created by DOM Pulse are named with this prefix so they can be cut from stacks. */
export const INTERNAL_PREFIX = '__domPulse_';

const CHROME = /^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const FIREFOX = /^(.*?)@(.+?):(\d+):(\d+)\s*$/;

export function parseStack(raw: string | undefined, selfFile?: string, limit = 12): StackFrame[] {
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
    if (f.fn.includes(INTERNAL_PREFIX) || (selfFile !== undefined && f.file === selfFile)) cut = i;
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
