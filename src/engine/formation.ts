/**
 * 編成の入れ替え（§4.4）：交代アビ（即時）、戦闘不能、ターンエンド処理での補充。
 */
import type { Ctx, Exec } from "./context";
import { charLabel, emit, slotOf, warn } from "./context";
import { removeBuff } from "./buffs";
import { SUB_SLOTS } from "./types";

/** 生存しているサブの先頭の枠 */
export function firstLivingSubSlot(ctx: Ctx): number | null {
  for (const s of SUB_SLOTS) {
    const id = ctx.state.formation[s];
    if (id && !ctx.state.chars[id]!.knockedOut) return s;
  }
  return null;
}

/**
 * 交代（§4.4 ②）：即時に生存しているサブの先頭とスワップする。
 */
export function swapWithSub(ctx: Ctx, exec: Exec, outId: string): void {
  const outSlot = slotOf(ctx, outId);
  if (outSlot === null || outSlot === 0 || outSlot > 4) {
    warn(ctx, "opInvalid", `${charLabel(ctx, outId)}はメイン神姫の枠にいないため交代できない`, outId);
    return;
  }
  const subSlot = firstLivingSubSlot(ctx);
  if (subSlot === null) {
    warn(ctx, "noSub", `交代できるサブがいない（${charLabel(ctx, outId)}）`, outId);
    return;
  }
  const inId = ctx.state.formation[subSlot]!;
  ctx.state.formation[outSlot] = inId;
  ctx.state.formation[subSlot] = outId;

  // TODO(spec): §4.4 控えに回ったときのバフ・デバフは情報が矛盾。情報 B（原則解除、消去不可は保持）で仮置き
  const out = ctx.state.chars[outId]!;
  for (const b of [...out.buffs]) {
    if (b.removable) removeBuff(ctx, exec, outId, b.uid, "buffRemoved");
  }
  emit(ctx, { type: "swappedOut", sourceKind: exec.sourceKind, actor: outId });
  ctx.state.chars[inId]!.hasEntered = true;
  emit(ctx, { type: "enterBattle", sourceKind: exec.sourceKind, actor: inId, route: "swap" });
}

/** 戦闘不能（§4.4 ①③）。補充はターンエンド処理で行う */
export function knockOut(ctx: Ctx, exec: Exec, id: string): void {
  const c = ctx.state.chars[id];
  if (!c || c.knockedOut) return;
  c.knockedOut = true;
  emit(ctx, { type: "knockedOut", sourceKind: exec.sourceKind, actor: id });
}

export interface ReplenishPlan {
  /** 枠番号 → 入るキャラ（null なら空になる） */
  fills: { slot: number; outId: string; inId: string | null }[];
}

/**
 * 戦闘不能による補充の計画（§4.4）。枠の並び順（左から）で、サブ 1 → サブ 2 の順に入る。
 * 敵フェーズの入力パネルで「どの枠に誰が入るか」の表示にも使う。
 */
export function planReplenish(formation: readonly (string | null)[], isKnockedOut: (id: string) => boolean): ReplenishPlan {
  const subs: string[] = [];
  for (const s of SUB_SLOTS) {
    const id = formation[s];
    if (id && !isKnockedOut(id)) subs.push(id);
  }
  const fills: ReplenishPlan["fills"] = [];
  for (let slot = 0; slot <= 4; slot++) {
    const id = formation[slot];
    if (!id || !isKnockedOut(id)) continue;
    // 英霊は入れ替わらない（§4.4）
    const inId = slot === 0 ? null : subs.shift() ?? null;
    fills.push({ slot, outId: id, inId });
  }
  return { fills };
}

/** ターンエンド処理の補充（§5-5-2） */
export function replenish(ctx: Ctx, exec: Exec): void {
  const plan = planReplenish(ctx.state.formation, (id) => ctx.state.chars[id]!.knockedOut);
  for (const f of plan.fills) {
    if (f.inId) {
      const from = ctx.state.formation.indexOf(f.inId);
      ctx.state.formation[from] = null;
    }
    ctx.state.formation[f.slot] = f.inId;
  }
  // 戦闘不能のキャラ（サブにいる場合を含む）を隊列から外す
  ctx.state.formation.forEach((id, i) => {
    if (id && ctx.state.chars[id]!.knockedOut) ctx.state.formation[i] = null;
  });
  for (const f of plan.fills) {
    if (!f.inId) continue;
    ctx.state.chars[f.inId]!.hasEntered = true;
    emit(ctx, { type: "enterBattle", sourceKind: exec.sourceKind, actor: f.inId, route: "replenish" });
  }
}
