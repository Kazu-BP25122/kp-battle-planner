/**
 * バフ／デバフ／状態異常（§7）。重複ルール（§7.1）と持続の管理。
 */
import type { GaugeBlockSource, Polarity } from "../schema/common";
import type { Duration } from "../schema/dsl";
import type { Ctx, Exec } from "./context";
import { charLabel, emit, warn } from "./context";
import type { BuffDuration, BuffInstance } from "./types";

export interface BuffSpec {
  name: string;
  kind: "buff" | "status";
  slot: string | null;
  amount: number | null;
  polarity: Polarity;
  duration: Duration | undefined;
  removable: boolean;
  blockSources?: GaugeBlockSource[];
}

export function buffList(ctx: Ctx, id: string): BuffInstance[] | null {
  if (id === "enemy") return ctx.state.enemy.buffs;
  return ctx.state.chars[id]?.buffs ?? null;
}

function toDuration(d: Duration | undefined): BuffDuration {
  if (d === undefined) return { type: "permanent" };
  if ("turns" in d) return { type: "turns", remaining: d.turns };
  if ("count" in d) return { type: "count", remaining: d.count, consumeOn: d.consumeOn ?? "attack" };
  return { type: "permanent" };
}

/** 持続の比較用の値（永続 = 無限大） */
function durationValue(d: BuffDuration): number {
  return d.type === "permanent" ? Infinity : d.remaining;
}

export function applyBuff(ctx: Ctx, exec: Exec, targetId: string, spec: BuffSpec): void {
  const list = buffList(ctx, targetId);
  if (!list) return;
  const who = charLabel(ctx, targetId);
  const charId = targetId === "enemy" ? undefined : targetId;

  if (spec.kind === "buff" && spec.slot !== null) {
    const slotDef = ctx.slots.get(spec.slot);
    if (!slotDef) warn(ctx, "unknownSlot", `未登録の枠「${spec.slot}」（${spec.name}）`, charId);
    else if (slotDef.polarity !== spec.polarity) {
      warn(ctx, "dataError", `枠「${slotDef.name}」の極性（${slotDef.polarity}）と効果（${spec.polarity}）が一致しない`, charId);
    }
  }

  const inst: BuffInstance = {
    uid: ctx.state.nextUid++,
    name: spec.name,
    kind: spec.kind,
    slot: spec.slot,
    amount: spec.amount,
    polarity: spec.polarity,
    duration: toDuration(spec.duration),
    removable: spec.removable,
    appliedTurn: ctx.state.turn,
    appliedPhase: ctx.state.phase,
    appliedSeq: ctx.state.log.length,
    sourceChar: exec.self === "enemy" ? null : exec.self,
    sourceLabel: exec.label,
  };
  if (spec.blockSources) inst.blockSources = spec.blockSources;

  const evBase = {
    sourceKind: exec.sourceKind,
    actor: exec.self === "enemy" ? null : exec.self,
    target: targetId,
    slot: spec.slot,
    buff: spec.name,
    polarity: spec.polarity,
    ...(exec.ability ? { ability: exec.ability } : {}),
    ...(exec.assist ? { assist: exec.assist } : {}),
    ...(spec.amount !== null ? { amount: spec.amount } : {}),
    durationType: inst.duration.type,
    ...(inst.duration.type !== "permanent" ? { remaining: inst.duration.remaining } : {}),
    label: exec.label,
  };

  // 同じ枠（状態異常は同じ名前）の既存効果
  const idx = list.findIndex((b) =>
    spec.kind === "buff" && spec.slot !== null
      ? b.kind === "buff" && b.slot === spec.slot && b.polarity === spec.polarity
      : b.kind === "status" && b.name === spec.name,
  );

  // デバフの合計下限（§7.2）
  if (spec.polarity === "debuff" && spec.slot !== null) {
    const group = ctx.slots.get(spec.slot);
    if (group?.floorGroup !== undefined && group.floor !== undefined) {
      let total = 0;
      for (const b of list) {
        if (b.polarity !== "debuff" || b.slot === null || b.amount === null) continue;
        if (ctx.slots.get(b.slot)?.floorGroup === group.floorGroup) total += b.amount;
      }
      if (total >= group.floor) {
        warn(ctx, "debuffFloor", `${who}の${group.floorGroup}は合計が下限（${group.floor}）に達しているため「${spec.name}」は効果なし`, charId);
      }
    }
  }

  if (idx < 0) {
    list.push(inst);
    emit(ctx, { ...evBase, type: "buffApplied" });
    return;
  }

  const old = list[idx]!;
  if (spec.kind === "status") {
    // TODO(spec): §11 状態異常の重複判定は未確定。同名なら上書きとする
    list[idx] = inst;
    emit(ctx, { ...evBase, type: "buffOverwritten" });
    return;
  }

  if (old.amount === null || spec.amount === null) {
    // §7.2 効果量が不明なものは推測で判定しない。表示上は上書きとして扱い、警告を出す
    warn(ctx, "amountUnknown", `${who}の「${spec.name}」：効果量が不明のため MISS・上書きを判定できない`, charId);
    list[idx] = inst;
    emit(ctx, { ...evBase, type: "buffOverwritten" });
    return;
  }

  if (spec.amount < old.amount) {
    // §7.1 小さい効果は MISS。既存の効果の持続も更新しない
    warn(ctx, "buffMissed", `${who}の「${spec.name}」が MISS（既存「${old.name}」${old.amount} > ${spec.amount}）`, charId);
    emit(ctx, { ...evBase, type: "buffMissed" });
    return;
  }

  // 大きい、または同じ効果量なら上書き（持続も新しい方に置き換わる）
  // TODO(spec): §7.1 デバフで効果量が同じ場合も上書きとする（仮置き）
  if (spec.amount === old.amount && durationValue(inst.duration) < durationValue(old.duration)) {
    warn(ctx, "buffShortened", `${who}の「${spec.name}」：同じ効果量で上書きされ、持続が短くなった`, charId);
  }
  list[idx] = inst;
  emit(ctx, { ...evBase, type: "buffOverwritten" });
}

export function removeBuff(ctx: Ctx, exec: Exec, targetId: string, uid: number, type: "buffRemoved" | "buffExpired" | "buffConsumed"): void {
  const list = buffList(ctx, targetId);
  if (!list) return;
  const i = list.findIndex((b) => b.uid === uid);
  if (i < 0) return;
  const b = list[i]!;
  list.splice(i, 1);
  emit(ctx, {
    type,
    sourceKind: exec.sourceKind,
    actor: exec.self === "enemy" ? null : exec.self,
    target: targetId,
    slot: b.slot,
    buff: b.name,
    polarity: b.polarity,
    ...(type === "buffConsumed" ? { remaining: 0 } : {}),
  });
}

/**
 * 回数制バフの消費（§7）。行動単位で 1 回分。
 * startSeq より前に付与されたものだけを消費する（その行動中に付与されたものは消費しない）。
 * 戻り値：消費したバフ
 */
export function consumeCountBuffs(ctx: Ctx, exec: Exec, charId: string, on: "attack" | "damaged", startSeq: number, times = 1): BuffInstance[] {
  const c = ctx.state.chars[charId];
  if (!c) return [];
  const consumed: BuffInstance[] = [];
  for (const b of [...c.buffs]) {
    if (b.duration.type !== "count" || b.duration.consumeOn !== on || b.appliedSeq >= startSeq) continue;
    b.duration.remaining = Math.max(0, b.duration.remaining - times);
    consumed.push(b);
    if (b.duration.remaining === 0) {
      removeBuff(ctx, exec, charId, b.uid, "buffConsumed");
    } else {
      emit(ctx, { type: "buffConsumed", sourceKind: exec.sourceKind, actor: charId, target: charId, slot: b.slot, buff: b.name, polarity: b.polarity, remaining: b.duration.remaining });
    }
  }
  return consumed;
}

/**
 * ターンエンド処理のターン制効果の減少（§5-5-4、§7）。
 * このターンの敵フェーズ中に付与されたものは減らさない。
 */
export function tickTurnBuffs(ctx: Ctx, exec: Exec, targetId: string): void {
  const list = buffList(ctx, targetId);
  if (!list) return;
  for (const b of [...list]) {
    if (b.duration.type !== "turns") continue;
    if (b.appliedTurn === ctx.state.turn && b.appliedPhase === "enemy") continue;
    b.duration.remaining--;
    if (b.duration.remaining <= 0) removeBuff(ctx, exec, targetId, b.uid, "buffExpired");
  }
}

/** 状態効果を持っているか */
export function hasStatus(ctx: Ctx, charId: string, status: string): BuffInstance[] {
  return ctx.state.chars[charId]?.buffs.filter((b) => b.kind === "status" && b.name === status) ?? [];
}
