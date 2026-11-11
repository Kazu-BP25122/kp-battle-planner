/**
 * アシストの処理（§6.1）。イベントキューから 1 件ずつ取り出し、そのタイミングのアシストを編成順に判定する。
 */
import type { Cost } from "../schema/dsl";
import type { Ctx, Exec } from "./context";
import { emit, slotOf, step } from "./context";
import { evalCondition } from "./conditions";
import { matchesFilter, countEvents } from "./query";
import { runEffects } from "./effects";
import { loseGauge } from "./gauge";
import type { BattleEvent, OwnedAssist } from "./types";

/** アシストが今有効か（§4.4 activeIn） */
function isAssistActive(ctx: Ctx, oa: OwnedAssist): boolean {
  const s = slotOf(ctx, oa.owner);
  if (s === null) return false;
  const c = ctx.state.chars[oa.owner]!;
  if (c.knockedOut) return false;
  const activeIn = oa.assist.activeIn ?? "main";
  // TODO(spec): §11 一度メインに出て下がったキャラの「サブ時有効」アシストの扱いは未確定。サブにいる間は有効とする
  if (s <= 4) return activeIn === "main" || activeIn === "both";
  return activeIn === "sub" || activeIn === "both";
}

export function canPayCosts(ctx: Ctx, exec: Exec, costs: readonly Cost[] | undefined): boolean {
  for (const cost of costs ?? []) {
    if (cost.cond && !evalCondition(ctx, exec, cost.cond)) continue;
    const c = ctx.state.chars[exec.self];
    if (!c) return false;
    if (cost.type === "gauge" && c.gauge < cost.amount) return false;
    if (cost.type === "token" && (c.tokens[cost.token] ?? 0) < cost.amount) return false;
  }
  return true;
}

export function payCosts(ctx: Ctx, exec: Exec, costs: readonly Cost[] | undefined): void {
  for (const cost of costs ?? []) {
    if (cost.cond && !evalCondition(ctx, exec, cost.cond)) continue;
    const c = ctx.state.chars[exec.self]!;
    if (cost.type === "gauge") loseGauge(ctx, exec, exec.self, cost.amount, "cost");
    else c.tokens[cost.token] = (c.tokens[cost.token] ?? 0) - cost.amount;
  }
}

function assistExec(ctx: Ctx, oa: OwnedAssist, ev: BattleEvent): Exec {
  const d = ctx.input.characters[oa.owner]!;
  return {
    self: oa.owner,
    sourceKind: "assist",
    assist: oa.assist.id,
    // TODO(spec): §11 アシストが与えるダメージの攻撃区分の既定値は未確定。category の指定が無ければ ability とする
    defaultCategory: "ability",
    label: `${d.name} ${oa.assist.name ?? oa.assist.id}${oa.user ? "（ユーザー補正）" : ""}`,
    seqLimit: ev.seq,
    dealtDamage: false,
  };
}

function limitReached(ctx: Ctx, oa: OwnedAssist): boolean {
  const lim = oa.assist.limit;
  if (!lim) return false;
  const q = { event: "assistTriggered" as const, filter: { actor: "self", assist: oa.assist.id }, owner: oa.owner, turn: ctx.state.turn };
  if (lim.perTurn !== undefined && countEvents(ctx.state.log, { ...q, scope: "turn" }) >= lim.perTurn) return true;
  if (lim.perBattle !== undefined && countEvents(ctx.state.log, { ...q, scope: "battle" }) >= lim.perBattle) return true;
  return false;
}

function matches(ctx: Ctx, oa: OwnedAssist, ev: BattleEvent): boolean {
  if (!isAssistActive(ctx, oa)) return false;
  if (!matchesFilter(ev, oa.assist.trigger.filter, oa.owner)) return false;
  if (limitReached(ctx, oa)) return false;
  const exec = assistExec(ctx, oa, ev);
  if (oa.assist.cond && !evalCondition(ctx, exec, oa.assist.cond)) return false;
  if (!canPayCosts(ctx, exec, oa.assist.cost)) return false;
  return true;
}

/** 編成順（§6.1-1）→ 同じキャラ内はアシストの並び順（§6.1-2） */
function orderedCandidates(ctx: Ctx, ev: BattleEvent): OwnedAssist[] {
  const list = ctx.assistsByEvent.get(ev.type);
  if (!list) return [];
  return list
    .map((oa) => ({ oa, slot: slotOf(ctx, oa.owner) as number | null }))
    .filter((x): x is { oa: OwnedAssist; slot: number } => x.slot !== null)
    .sort((a, b) => a.slot - b.slot || a.oa.index - b.oa.index)
    .map((x) => x.oa);
}

function fire(ctx: Ctx, oa: OwnedAssist, ev: BattleEvent): void {
  step(ctx);
  const exec = assistExec(ctx, oa, ev);
  emit(ctx, { type: "assistTriggered", sourceKind: "assist", actor: oa.owner, assist: oa.assist.id });
  // アシストの効果の中の条件は、効果を処理する瞬間の状態で見る（回数は発動したイベント時点まで）
  payCosts(ctx, exec, oa.assist.cost);
  const queueMark = ctx.queue.length;
  runEffects(ctx, exec, oa.assist.effects);
  if (ctx.input.settings.assistEventOrder === "interrupt") {
    // §6.1-4 「割り込み」：アシストが生んだイベントをその場で処理する
    const born = ctx.queue.splice(queueMark);
    for (const e of born) processEvent(ctx, e);
  }
}

/**
 * 1 つのタイミング（イベント）のアシストを処理する（§6.1-1〜3）。
 * TODO(spec): §6.1-3 連鎖は実機未確認。assistReentry: true なら、発動のたびに未発動のものを先頭から判定し直す
 */
export function processEvent(ctx: Ctx, ev: BattleEvent): void {
  step(ctx);
  const candidates = orderedCandidates(ctx, ev);
  if (candidates.length === 0) return;
  // 1 つのアシストは 1 つのタイミングで最大 1 回まで
  const fired = new Set<OwnedAssist>();
  if (ctx.input.settings.assistReentry) {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const oa of orderedCandidates(ctx, ev)) {
        if (fired.has(oa)) continue;
        if (matches(ctx, oa, ev)) {
          fired.add(oa);
          fire(ctx, oa, ev);
          progressed = true;
          break;
        }
      }
    }
  } else {
    for (const oa of candidates) {
      if (matches(ctx, oa, ev)) fire(ctx, oa, ev);
    }
  }
}

/**
 * キューが空になるまで処理する（§6.1-4。先入れ先出し、アシストが生んだイベントは末尾に積む）。
 */
export function processQueue(ctx: Ctx): void {
  while (ctx.queue.length > 0) {
    const ev = ctx.queue.shift()!;
    processEvent(ctx, ev);
  }
}
