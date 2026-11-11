/**
 * Undo / Redo（§14.3）。チャートデータの不変スナップショットを積む方式。
 * 表示位置（cursor）も一緒に戻す。履歴はメモリ上だけに持つ。
 */
import type { ChartData } from "../schema/chart";
import type { Cursor } from "./tree";

export const HISTORY_LIMIT = 100;

export interface Snapshot {
  chart: ChartData;
  cursor: Cursor;
}

export interface History {
  past: { snap: Snapshot; label: string }[];
  present: Snapshot;
  future: { snap: Snapshot; label: string }[];
}

export function initHistory(present: Snapshot): History {
  return { past: [], present, future: [] };
}

/** 新しい編集。Redo の履歴は破棄する。label は「何をしたか」（Undo 時の表示に使う） */
export function pushHistory(h: History, next: Snapshot, label: string): History {
  if (next.chart === h.present.chart) return { ...h, present: next };
  const past = [...h.past, { snap: h.present, label }];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

export function undo(h: History): { history: History; label: string } | null {
  const last = h.past[h.past.length - 1];
  if (!last) return null;
  return {
    history: { past: h.past.slice(0, -1), present: last.snap, future: [{ snap: h.present, label: last.label }, ...h.future] },
    label: last.label,
  };
}

export function redo(h: History): { history: History; label: string } | null {
  const next = h.future[0];
  if (!next) return null;
  return {
    history: { past: [...h.past, { snap: h.present, label: next.label }], present: next.snap, future: h.future.slice(1) },
    label: next.label,
  };
}
