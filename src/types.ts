import type { SlidingCounter } from './sliding-counter';

export type MutationKind = 'childList' | 'attributes' | 'characterData';

export interface StackFrame { fn: string; file: string; line: number; column: number }

export interface StyleChange { prop: string; oldValue: string | null; newValue: string | null }

export interface AttributeDiff {
  kind: 'attribute';
  name: string;
  oldValue: string | null;
  newValue: string | null;
  classAdded?: string[];
  classRemoved?: string[];
  styleChanges?: StyleChange[];
}
export interface TextDiff {
  kind: 'text';
  oldValue: string;
  newValue: string;
  changeStart: number;
  oldEnd: number;
  newEnd: number;
}
export interface ChildDiff {
  kind: 'children';
  /** Signatures of the added / removed nodes, capped at MAX_LISTED_NODES per side. */
  added: string[];
  removed: string[];
  recreated: string[];
  /** How many added / removed nodes were left out of the lists above. */
  addedMore: number;
  removedMore: number;
  /** Exact node counts (subtrees included) for every added / removed node, cap or no cap. */
  addedTotal: number;
  removedTotal: number;
}
export type Diff = AttributeDiff | TextDiff | ChildDiff;

export interface Rect { x: number; y: number; width: number; height: number }

export interface ReflowHit { api: string; delay: number; stack: StackFrame[]; source: string | null }

export interface PulseEvent {
  id: number;
  time: number;
  kind: MutationKind;
  target: Element;
  node: Node;
  diff: Diff;
  stack: StackFrame[];
  source: string | null;
  nodesAffected: number;
  reflows: ReflowHit[];
  layoutShift: number;
  shiftRects: Rect[];
}

export interface ElementStats {
  element: Element;
  label: string;
  total: number;
  reflows: number;
  layoutShift: number;
  nodesAffected: number;
  lastKind: MutationKind;
  lastTime: number;
  lastReflowTime: number;
  lastShiftTime: number;
  shiftRects: Rect[];
  sources: Map<string, number>;
  recent: SlidingCounter;
}

export interface SourceStats { key: string; mutations: number; reflows: number }

export type SortKey = 'rate' | 'reflows' | 'layoutShift' | 'nodesAffected' | 'total';

export interface Options { hotThreshold: number; bufferSize: number; include: string; exclude: string; topN: number }
export const DEFAULT_OPTIONS: Options = { hotThreshold: 20, bufferSize: 500, include: '', exclude: '', topN: 10 };
