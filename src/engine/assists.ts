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
import { consumeToken } from "./tokens";
import { evalValue } from "./values";
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

/** when を満たすコストだけを取り出す（使う前の状態で評価する。§6 コスト） */
function activeCosts(ctx: Ctx, exec: Exec, costs: readonly Cost[] | undefined): Cost[] {
  return (costs ?? []).filter((cost) => !cost.when || evalCondition(ctx, exec, cost.when));
}

export function canPayCosts(ctx: Ctx, exec: Exec, costs: readonly Cost[] | undefined): boolean {
  const c = ctx.state.chars[exec.self];
  const list = activeCosts(ctx, exec, costs);
  if (list.length === 0) return true;
  if (!c) return false;
  let gauge = 0;
  let hp = 0;
  const tokens = new Map<string, number>();
  for (const cost of list) {
    if ("gauge" in cost) gauge += cost.gauge;
    else if ("token" in cost) tokens.set(cost.token.name, (tokens.get(cost.token.name) ?? 0) + cost.token.amount);
    else hp += cost.hpRate;
  }
  if (c.gauge < gauge) return false;
  for (const [name, n] of tokens) if ((c.tokens[name] ?? 0) < n) return false;
  // TODO(spec): HP 割合のコストを払える条件（HP が 0 にならないか）は未定義。残りがコスト以上あれば払えるとする
  if (hp > 0 && c.hp < hp) return false;
  return true;
}

export function payCosts(ctx: Ctx, exec: Exec, costs: readonly Cost[] | undefined): void {
  const c = ctx.state.chars[exec.self];
  if (!c) return;
  // when はすべて支払う前に評価する
  for (const cost of activeCosts(ctx, exec, costs)) {
    if ("gauge" in cost) loseGauge(ctx, exec, exec.self, cost.gauge, "cost");
    else if ("token" in cost) consumeToken(ctx, exec, exec.self, { name: cost.token.name }, cost.token.amount);
    else c.hp = Math.max(0, c.hp - cost.hpRate);
  }
}

function assistExec(ctx: Ctx, oa: OwnedAssist, ev: BattleEvent, timingStart: number): Exec {
  const d = ctx.input.characters[oa.owner]!;
  return {
    self: oa.owner,
    sourceKind: "assist",
    assist: oa.assist.id,
    // TODO(spec): §11 アシストが与えるダメージの攻撃区分の既定値は未確定（damage は category 必須なので使わない）
    defaultCategory: "ability",
    label: `${d.name} ${oa.assist.name ?? oa.assist.id}${oa.user ? "（ユーザー補正）" : ""}`,
    window: { upTo: ev.seq, from: timingStart },
    triggerEvent: ev,
    dealtDamage: false,
  };
}

function limitReached(ctx: Ctx, oa: OwnedAssist): boolean {
  const lim = oa.assist.limit;
  if (!lim) return false;
  const q = { event: "assistTriggered" as const, filter: { source: "self" as const, assist: oa.assist.id }, owner: oa.owner, turn: ctx.state.turn };
  const exec = assistExec(ctx, oa, ctx.state.log[ctx.state.log.length - 1]!, ctx.state.log.length);
  if (lim.perTurn !== undefined && countEvents(ctx.state.log, { ...q, scope: "turn" }) >= evalValue(ctx, exec, lim.perTurn)) return true;
  if (lim.perBattle !== undefined && countEvents(ctx.state.log, { ...q, scope: "battle" }) >= evalValue(ctx, exec, lim.perBattle)) return true;
  return false;
}

function matches(ctx: Ctx, oa: OwnedAssist, ev: BattleEvent, timingStart: number): boolean {
  if (!isAssistActive(ctx, oa)) return false;
  if (!matchesFilter(ev, oa.assist.trigger.filter, oa.owner)) return false;
  if (limitReached(ctx, oa)) return false;
  const exec = assistExec(ctx, oa, ev, timingStart);
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

function fire(ctx: Ctx, oa: OwnedAssist, ev: BattleEvent, timingStart: number): void {
  step(ctx);
  const exec = assistExec(ctx, oa, ev, timingStart);
  payCosts(ctx, exec, oa.assist.cost);
  // assistTriggered は効果を処理する前に記録する（効果の中で数える自分の発動回数は今回を含む。§4.7）
  emit(ctx, { type: "assistTriggered", sourceKind: "assist", actor: oa.owner, assist: oa.assist.id });
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
  // このタイミングの処理を始めた位置。これ以降に記録されたイベントは回数の条件に数える（Exec.window）
  const timingStart = ctx.state.log.length;
  // 1 つのアシストは 1 つのタイミングで最大 1 回まで
  const fired = new Set<OwnedAssist>();
  if (ctx.input.settings.assistReentry) {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const oa of orderedCandidates(ctx, ev)) {
        if (fired.has(oa)) continue;
        if (matches(ctx, oa, ev, timingStart)) {
          fired.add(oa);
          fire(ctx, oa, ev, timingStart);
          progressed = true;
          break;
        }
      }
    }
  } else {
    for (const oa of candidates) {
      if (matches(ctx, oa, ev, timingStart)) fire(ctx, oa, ev, timingStart);
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
