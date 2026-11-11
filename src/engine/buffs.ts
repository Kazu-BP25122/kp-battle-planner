/**
 * バフ／デバフ／状態異常（§7）。重複ルール（§7.1）・累積型・持続の管理。
 * 累積型は 1 段ごとに 1 つの BuffInstance を持つ（perStack で段ごとに切れるため）。
 */
import type { GaugeBlockSource, Polarity } from "../schema/common";
import type { Stack } from "../schema/dsl";
import type { Ctx, Exec } from "./context";
import { charLabel, emit, warn, warnOnce } from "./context";
import type { BuffDuration, BuffInstance } from "./types";

export interface BuffSpec {
  name: string;
  kind: "buff" | "status";
  slot: string | null;
  amount: number | null;
  polarity: Polarity;
  duration: BuffDuration;
  durationUnknown?: boolean;
  undispellable: boolean;
  stack?: Stack;
  blockSources?: GaugeBlockSource[];
}

/**
 * 同じ枠で付与できなかったときのゲーム内の表示（§7.1）。バフは CANCEL、デバフは MISS。
 * イベントはどちらも buffMissed（polarity で区別する）。
 */
export function missLabel(polarity: Polarity): "CANCEL" | "MISS" {
  return polarity === "buff" ? "CANCEL" : "MISS";
}

export function buffList(ctx: Ctx, id: string): BuffInstance[] | null {
  if (id === "enemy") return ctx.state.enemy.buffs;
  return ctx.state.chars[id]?.buffs ?? null;
}

/** 持続の比較用の値（永続 = 無限大） */
function durationValue(d: BuffDuration): number {
  return d.type === "permanent" ? Infinity : d.remaining;
}

/** 同じバフの累積数（同じ名前・同じ極性の枠付きバフの数） */
export function stackCount(list: readonly BuffInstance[], name: string, polarity: Polarity): number {
  return list.filter((b) => b.kind === "buff" && b.name === name && b.polarity === polarity).length;
}

/** 合計の効果量（不明が混ざれば null） */
function totalAmount(list: readonly BuffInstance[]): number | null {
  let t = 0;
  for (const b of list) {
    if (b.amount === null) return null;
    t += b.amount;
  }
  return t;
}

export function applyBuff(ctx: Ctx, exec: Exec, targetId: string, spec: BuffSpec): void {
  const list = buffList(ctx, targetId);
  if (!list) return;
  const who = charLabel(ctx, targetId);
  const charId = targetId === "enemy" ? undefined : targetId;

  if (spec.durationUnknown) {
    // TODO(spec): 持続が不明（turns: null）の効果は永続として扱う。分かり次第データを埋める
    warnOnce(ctx, `durationUnknown:${spec.name}`, "durationUnknown", `「${spec.name}」の持続が不明のため、永続として扱う`, charId);
  }

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
    duration: { ...spec.duration },
    undispellable: spec.undispellable,
    appliedTurn: ctx.state.turn,
    appliedPhase: ctx.state.phase,
    appliedSeq: ctx.state.log.length,
    sourceChar: exec.self === "enemy" ? null : exec.self,
    sourceLabel: exec.label,
  };
  if (spec.durationUnknown) inst.durationUnknown = true;
  if (spec.stack) inst.stack = { max: spec.stack.max, duration: spec.stack.duration };
  if (spec.blockSources) inst.blockSources = spec.blockSources;

  const evBase = (stacks?: number) => ({
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
    ...(stacks !== undefined ? { stacks } : {}),
    label: exec.label,
  });

  // ---- 状態（addStatus）：同じ名前があれば持続を新しい値に置き換える（足さない。§7.1）
  if (spec.kind === "status") {
    const idx = list.findIndex((b) => b.kind === "status" && b.name === spec.name);
    if (idx < 0) {
      list.push(inst);
      emit(ctx, { ...evBase(), type: "buffApplied" });
    } else {
      list[idx] = inst;
      emit(ctx, { ...evBase(), type: "buffOverwritten" });
    }
    return;
  }

  // ---- デバフの合計下限（§7.2）
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

  // ---- 累積型（§7.1）：同じバフ（buff 名が同じ）があれば上書き・MISS の判定をせず累積数を 1 増やす
  if (spec.stack) {
    const same = list.filter((b) => b.kind === "buff" && b.name === spec.name && b.polarity === spec.polarity);
    if (same.length > 0) {
      const max = spec.stack.max;
      if (max === "unknown") {
        warnOnce(ctx, `stackMaxUnknown:${spec.name}`, "stackMax", `「${spec.name}」の累積の上限が不明のため、上限なしとして扱う`, charId);
      } else if (max !== null && same.length >= max) {
        // TODO(spec): §7.1・§11 累積の上限に達したときに MISS 扱いにするかは未確定。累積数を増やさず警告だけ出す
        warn(ctx, "stackMax", `${who}の「${spec.name}」は累積の上限（${max}）に達している`, charId);
        return;
      }
      if (spec.stack.duration === "unknown") {
        warnOnce(ctx, `stackDuration:${spec.name}`, "stackDurationUnknown", `「${spec.name}」の累積の持続の扱いが不明のため、1 段ずつ別々に切れるとして扱う`, charId);
      }
      if (spec.stack.duration === "refresh") {
        // 重ねるたびに全体の持続を新しい方に更新する
        for (const b of same) b.duration = { ...inst.duration };
      }
      list.push(inst);
      emit(ctx, { ...evBase(same.length + 1), type: "buffApplied" });
      return;
    }
  }

  // ---- 同じ枠の既存の効果との重複ルール（§7.1）。累積型は合計の効果量どうしで比べる
  const sameSlot = spec.slot === null ? [] : list.filter((b) => b.kind === "buff" && b.slot === spec.slot && b.polarity === spec.polarity);
  const stacksOut = spec.stack ? 1 : undefined;
  if (sameSlot.length === 0) {
    list.push(inst);
    emit(ctx, { ...evBase(stacksOut), type: "buffApplied" });
    return;
  }

  const replace = () => {
    for (const b of sameSlot) list.splice(list.indexOf(b), 1);
    list.push(inst);
    emit(ctx, { ...evBase(stacksOut), type: "buffOverwritten" });
  };

  const oldTotal = totalAmount(sameSlot);
  if (oldTotal === null || spec.amount === null) {
    // §7.2 効果量が不明なものは推測で判定しない。表示上は上書きとして扱い、警告を出す
    warn(ctx, "amountUnknown", `${who}の「${spec.name}」：効果量が不明のため CANCEL・MISS・上書きを判定できない`, charId);
    replace();
    return;
  }

  if (spec.amount < oldTotal) {
    // §7.1 小さい効果は付与されない（バフは CANCEL、デバフは MISS）。既存の効果の持続も更新しない
    warn(ctx, "buffMissed", `${who}の「${spec.name}」が ${missLabel(spec.polarity)}（既存「${sameSlot[0]!.name}」${oldTotal} > ${spec.amount}）`, charId);
    emit(ctx, { ...evBase(), type: "buffMissed" });
    return;
  }

  // 大きい、または同じ効果量なら上書き（持続も新しい方に置き換わる）
  // TODO(spec): §7.1 デバフで効果量が同じ場合も上書きとする（仮置き）
  const oldDur = Math.min(...sameSlot.map((b) => durationValue(b.duration)));
  if (spec.amount === oldTotal && durationValue(inst.duration) < oldDur) {
    warn(ctx, "buffShortened", `${who}の「${spec.name}」：同じ効果量で上書きされ、持続が短くなった`, charId);
  }
  replace();
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
    ...(b.stack ? { stacks: stackCount(list, b.name, b.polarity) } : {}),
  });
}

/**
 * デバフ・状態異常の解除（removeDebuff）。累積型は全段まとめて 1 個と数える。
 * TODO(spec): §11「状態異常 1 個回復」で消す順番は未確定。古い順とする。累積型を 1 個と数えるのも仮置き
 */
export function removeDebuffs(ctx: Ctx, exec: Exec, targetId: string, count: number | "all"): void {
  const list = buffList(ctx, targetId);
  if (!list) return;
  const units: BuffInstance[][] = [];
  for (const b of list) {
    if (b.polarity !== "debuff" || b.undispellable) continue;
    const unit = b.stack ? units.find((u) => u[0]!.stack && u[0]!.name === b.name) : undefined;
    if (unit) unit.push(b);
    else units.push([b]);
  }
  const n = count === "all" ? units.length : Math.min(count, units.length);
  for (const unit of units.slice(0, n)) for (const b of unit) removeBuff(ctx, exec, targetId, b.uid, "buffRemoved");
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
 * ターンエンド処理のターン制効果の減少（§5-5-4、§7）。累積型は段ごとに減る（perStack）。
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
