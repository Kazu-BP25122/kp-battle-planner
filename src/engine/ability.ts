/**
 * アビリティの使用判定と使用時の処理（§6）。
 * 使用可否はフラグで持たず、毎回計算する（§3-3）。
 */
import type { Ability } from "../schema/character";
import type { Ctx, Exec } from "./context";
import { charLabel, emit, isActiveMain, slotOf } from "./context";
import { evalCondition } from "./conditions";
import { canPayCosts, payCosts, processQueue } from "./assists";
import { runEffect } from "./effects";
import { consumeCountBuffs } from "./buffs";
import { countEvents } from "./query";
import { needsChosenAlly } from "./targets";
import { evalValue } from "./values";
import type { UnusableReason } from "./types";

export function findAbility(ctx: Ctx, charId: string, abilityId: string): Ability | undefined {
  return ctx.input.characters[charId]?.abilities.find((a) => a.id === abilityId);
}

function abilityExec(ctx: Ctx, charId: string, ab: Ability, chosenAlly: string | undefined): Exec {
  const exec: Exec = {
    self: charId,
    sourceKind: "ability",
    ability: ab.id,
    defaultCategory: "ability",
    label: `${charLabel(ctx, charId)} ${ab.name}`,
    dealtDamage: false,
  };
  if (chosenAlly !== undefined) exec.chosenAlly = chosenAlly;
  return exec;
}

/**
 * 使えない理由の一覧。空なら使用可能（§6 アビリティの使用判定）。
 * 使う前に評価するので、useCount・回数上限は今回の使用を含まない（§6 コスト）。
 */
export function abilityUnusableReasons(ctx: Ctx, charId: string, abilityId: string, chosenAlly?: string): UnusableReason[] {
  const ab = findAbility(ctx, charId, abilityId);
  const c = ctx.state.chars[charId];
  if (!ab || !c) return ["unknown"];
  const reasons: UnusableReason[] = [];
  if (ctx.state.phase !== "action" || ctx.state.attacked) reasons.push("phase");
  if (c.knockedOut) reasons.push("knockedOut");
  else if (!isActiveMain(ctx, charId)) reasons.push("notInMain");
  if ((c.ct[ab.id] ?? 0) > 0) reasons.push("ct");
  const exec = abilityExec(ctx, charId, ab, chosenAlly);
  // 1 ターン上限・戦闘上限は使用回数（abilityUsed）で数える。効果による発動は数えない（§10.2 仮置き）
  const q = { event: "abilityUsed" as const, filter: { source: "self" as const, ability: ab.id }, owner: charId, turn: ctx.state.turn };
  if (ab.limit?.perTurn !== undefined && countEvents(ctx.state.log, { ...q, scope: "turn" }) >= evalValue(ctx, exec, ab.limit.perTurn)) reasons.push("perTurn");
  if (ab.limit?.perBattle !== undefined && countEvents(ctx.state.log, { ...q, scope: "battle" }) >= evalValue(ctx, exec, ab.limit.perBattle)) reasons.push("perBattle");
  if (!canPayCosts(ctx, exec, ab.cost)) reasons.push("cost");
  if (ab.usable && !evalCondition(ctx, exec, ab.usable)) reasons.push("cond");
  if (needsChosenAlly(ab.effects) || (ab.usable && needsChosenAlly(ab.usable))) {
    if (chosenAlly === undefined || !isActiveMain(ctx, chosenAlly)) reasons.push("chosenAlly");
  }
  return reasons;
}

/** アビリティを使う。事前に abilityUnusableReasons が空であることを確かめること */
export function useAbility(ctx: Ctx, charId: string, abilityId: string, chosenAlly?: string): void {
  const ab = findAbility(ctx, charId, abilityId)!;
  const c = ctx.state.chars[charId]!;
  const exec = abilityExec(ctx, charId, ab, chosenAlly);
  const startSeq = ctx.state.log.length;

  // 1. コストを支払う（when は使う前の状態で評価する）
  payCosts(ctx, exec, ab.cost);
  // 2. CT を最大値に戻す（効果より前。効果の中で CT を 0 にすると、その結果が残る）
  c.ct[ab.id] = ab.ct;
  // 3. abilityUsed と abilityActivated（経路 use）を記録
  emit(ctx, { type: "abilityUsed", sourceKind: "ability", actor: charId, ability: ab.id, color: ab.color });
  emit(ctx, { type: "abilityActivated", sourceKind: "ability", actor: charId, ability: ab.id, color: ab.color, route: "use" });
  // 4. 効果を順に処理する
  for (const e of ab.effects) {
    runEffect(ctx, exec, e);
    // TODO(spec): §6 アシストの判定タイミング。perEffect なら効果ごとに判定する（既定は afterAbility）
    if (ctx.input.settings.assistTiming === "perEffect") processQueue(ctx);
  }
  // 多段アビも 1 アビ全体で回数制の攻撃バフを 1 回分消費する（§7）
  if (exec.dealtDamage && slotOf(ctx, charId) !== null) consumeCountBuffs(ctx, exec, charId, "attack", startSeq);
  // 5. 記録したイベントのアシストを判定する
  processQueue(ctx);
}
