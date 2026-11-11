/**
 * イベントログへの集計クエリ（§4.7）。カウンターは固定変数で持たず、ここで数える。
 */
import type { EventFilter } from "../schema/dsl";
import type { EventType, NumCompare } from "../schema/common";
import type { BattleEvent } from "./types";

const inList = <T>(v: T | undefined | null, cond: T | T[] | undefined): boolean => {
  if (cond === undefined) return true;
  if (v === undefined || v === null) return false;
  return Array.isArray(cond) ? cond.includes(v) : cond === v;
};

/**
 * イベントが絞り込み条件に合うか。owner はアシスト・効果の持ち主（source・target の "self" の解決に使う）。
 */
export function matchesFilter(ev: BattleEvent, filter: EventFilter | undefined, owner: string | null): boolean {
  if (!filter) return true;
  if (filter.source === "self" && ev.actor !== owner) return false;
  if (filter.source === "others" && (ev.actor === null || ev.actor === owner)) return false;
  if (filter.target !== undefined) {
    const t = filter.target === "self" ? owner : filter.target;
    if (ev.target !== t) return false;
  }
  if (filter.ability !== undefined && ev.ability !== filter.ability) return false;
  if (!inList(ev.color, filter.color)) return false;
  if (!inList(ev.sourceElement, filter.sourceElement)) return false;
  if (!inList(ev.element, filter.element)) return false;
  if (!inList(ev.category, filter.category)) return false;
  if (filter.route !== undefined && ev.route !== filter.route) return false;
  if (filter.token !== undefined && ev.token !== filter.token) return false;
  if (filter.assist !== undefined && ev.assist !== filter.assist) return false;
  if (!inList(ev.sourceKind, filter.sourceKind)) return false;
  if (filter.slot !== undefined && ev.slot !== filter.slot) return false;
  if (filter.buff !== undefined && ev.buff !== filter.buff) return false;
  if (filter.polarity !== undefined && ev.polarity !== filter.polarity) return false;
  if (!inList(ev.means, filter.means)) return false;
  if (filter.origin !== undefined && ev.origin !== filter.origin) return false;
  if (filter.via !== undefined && ev.via !== filter.via) return false;
  return true;
}

export interface CountQuery {
  event: EventType;
  filter?: EventFilter;
  scope: "turn" | "battle";
  turn: number;
  owner: string | null;
  /** 件数ではなく amount の合計を数える（§4.7 sum） */
  sum?: "amount";
  /** 数える範囲（§4.7 条件の評価時点。Exec.window） */
  window?: { upTo: number; from: number };
}

export function countEvents(log: readonly BattleEvent[], q: CountQuery): number {
  let n = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const ev = log[i]!;
    if (q.scope === "turn" && ev.turn !== q.turn) {
      // ログはターン順に並ぶので、前のターンに入ったら打ち切る
      if (ev.turn < q.turn) break;
      continue;
    }
    if (q.window && ev.seq > q.window.upTo && ev.seq < q.window.from) continue;
    if (ev.type !== q.event) continue;
    if (!matchesFilter(ev, q.filter, q.owner)) continue;
    n += q.sum === "amount" ? ev.amount ?? 0 : 1;
  }
  return n;
}

/** 数値の比較。複数指定したらすべて満たすこと */
export function compareNum(v: number, c: NumCompare): boolean {
  if (c.gte !== undefined && !(v >= c.gte)) return false;
  if (c.lte !== undefined && !(v <= c.lte)) return false;
  if (c.eq !== undefined && v !== c.eq) return false;
  if (c.multipleOf !== undefined && (v === 0 || v % c.multipleOf !== 0)) return false;
  if (c.parity === "odd" && Math.abs(v % 2) !== 1) return false;
  if (c.parity === "even" && (v === 0 || v % 2 !== 0)) return false;
  if (c.mod !== undefined && ((v % c.mod.by) + c.mod.by) % c.mod.by !== c.mod.eq) return false;
  return true;
}

/** NumCompare 以外の項目を取り除く（条件の部品から比較部分だけを取り出す） */
export function pickCompare(o: NumCompare): NumCompare {
  const out: NumCompare = {};
  if (o.gte !== undefined) out.gte = o.gte;
  if (o.lte !== undefined) out.lte = o.lte;
  if (o.eq !== undefined) out.eq = o.eq;
  if (o.multipleOf !== undefined) out.multipleOf = o.multipleOf;
  if (o.parity !== undefined) out.parity = o.parity;
  if (o.mod !== undefined) out.mod = o.mod;
  return out;
}
