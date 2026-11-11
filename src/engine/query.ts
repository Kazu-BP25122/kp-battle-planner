/**
 * イベントログへの集計クエリ（§4.7）。カウンターは固定変数で持たず、ここで数える。
 */
import type { EventFilter } from "../schema/dsl";
import type { EventType, NumCompare } from "../schema/common";
import type { BattleEvent } from "./types";

const inList = <T>(v: T | undefined, cond: T | T[] | undefined): boolean => {
  if (cond === undefined) return true;
  if (v === undefined) return false;
  return Array.isArray(cond) ? cond.includes(v) : cond === v;
};

/** "self" を持ち主に解決して、イベントが絞り込み条件に合うか */
export function matchesFilter(ev: BattleEvent, filter: EventFilter | undefined, owner: string | null): boolean {
  if (!filter) return true;
  if (filter.actor !== undefined) {
    if (filter.actor === "self") {
      if (ev.actor !== owner) return false;
    } else if (filter.actor === "other") {
      if (ev.actor === owner) return false;
    } else if (ev.actor !== filter.actor) return false;
  }
  if (filter.target !== undefined) {
    const t = filter.target === "self" ? owner : filter.target;
    if (ev.target !== t) return false;
  }
  if (!inList(ev.element ?? undefined, filter.element)) return false;
  if (!inList(ev.category, filter.category)) return false;
  if (!inList(ev.color, filter.color)) return false;
  if (!inList(ev.sourceKind, filter.sourceKind)) return false;
  if (filter.ability !== undefined && ev.ability !== filter.ability) return false;
  if (filter.assist !== undefined && ev.assist !== filter.assist) return false;
  if (filter.slot !== undefined && ev.slot !== filter.slot) return false;
  if (filter.polarity !== undefined && ev.polarity !== filter.polarity) return false;
  if (!inList(ev.means, filter.means)) return false;
  if (filter.origin !== undefined && ev.origin !== filter.origin) return false;
  if (filter.route !== undefined && ev.route !== filter.route) return false;
  return true;
}

export interface CountQuery {
  event: EventType;
  filter?: EventFilter;
  scope: "turn" | "battle";
  turn: number;
  owner: string | null;
  /** この通し番号以下のイベントだけを数える（§4.7 条件の評価時点） */
  seqLimit?: number;
}

export function countEvents(log: readonly BattleEvent[], q: CountQuery): number {
  const limit = q.seqLimit === undefined ? log.length - 1 : Math.min(q.seqLimit, log.length - 1);
  let n = 0;
  for (let i = limit; i >= 0; i--) {
    const ev = log[i]!;
    if (q.scope === "turn" && ev.turn !== q.turn) {
      // ログはターン順に並ぶので、前のターンに入ったら打ち切る
      if (ev.turn < q.turn) break;
      continue;
    }
    if (ev.type !== q.event) continue;
    if (!matchesFilter(ev, q.filter, q.owner)) continue;
    n++;
  }
  return n;
}

/** 数値の比較。複数指定したらすべて満たすこと */
export function compareNum(v: number, c: NumCompare): boolean {
  if (c.gte !== undefined && !(v >= c.gte)) return false;
  if (c.lte !== undefined && !(v <= c.lte)) return false;
  if (c.eq !== undefined && v !== c.eq) return false;
  if (c.multipleOf !== undefined && (v === 0 || v % c.multipleOf !== 0)) return false;
  if (c.parity === "odd" && v % 2 !== 1) return false;
  if (c.parity === "even" && (v === 0 || v % 2 !== 0)) return false;
  return true;
}
