/**
 * バーストゲージ（§8）。
 */
import { characterGaugeMax } from "../schema/character";
import type { GaugeMeans } from "../schema/common";
import type { Ctx, Exec } from "./context";
import { def, emit } from "./context";
import { hasStatus } from "./buffs";

export const GAUGE_BLOCKED_STATUS = "gaugeGainBlocked";
/** バースト連鎖の上昇量（§8.4。上昇量アップは乗らない） */
export const CHAIN_GAUGE = 10;
/** 通常攻撃 1 段あたりの基礎上昇量（§8.3） */
export const NORMAL_ATTACK_GAUGE = 10;
export const BURST_THRESHOLD = 100;

/** 受け手のゲージ上昇量アップの合計（%）。バフとユーザー補正を合算する（§8.3） */
export function gaugeRate(ctx: Ctx, charId: string): number {
  let rate = ctx.input.corrections[charId]?.gaugeRate ?? 0;
  for (const b of ctx.state.chars[charId]?.buffs ?? []) {
    if (b.slot === null || b.amount === null) continue;
    if (ctx.slots.get(b.slot)?.engineEffect === "gaugeRate") rate += b.amount;
  }
  return rate;
}

/** gaugeGainBlocked で止められているか（§8.3） */
export function isGaugeBlocked(ctx: Ctx, charId: string, means: GaugeMeans): boolean {
  return hasStatus(ctx, charId, GAUGE_BLOCKED_STATUS).some(
    (b) => b.blockSources === undefined || b.blockSources.includes("all") || (b.blockSources as string[]).includes(means),
  );
}

/**
 * ゲージを増やす。applyRate なら受け手の上昇量アップを掛ける。
 * TODO(spec): 端数の扱い（切り捨てなど）は未確定。計算値のまま持つ
 */
export function gainGauge(ctx: Ctx, exec: Exec, charId: string, base: number, means: GaugeMeans, applyRate: boolean): number {
  const c = ctx.state.chars[charId];
  if (!c || base <= 0) return 0;
  if (means !== "correction" && means !== "cost" && means !== "burst" && isGaugeBlocked(ctx, charId, means)) return 0;
  const amount = applyRate ? base * (1 + gaugeRate(ctx, charId) / 100) : base;
  return setGauge(ctx, exec, charId, c.gauge + amount, means);
}

export function loseGauge(ctx: Ctx, exec: Exec, charId: string, amount: number, means: GaugeMeans): number {
  const c = ctx.state.chars[charId];
  if (!c || amount <= 0) return 0;
  return setGauge(ctx, exec, charId, c.gauge - amount, means);
}

export function setGauge(ctx: Ctx, exec: Exec, charId: string, value: number, means: GaugeMeans): number {
  const c = ctx.state.chars[charId]!;
  const max = characterGaugeMax(def(ctx, charId));
  const next = Math.min(max, Math.max(0, value));
  const delta = next - c.gauge;
  if (delta === 0) return 0;
  c.gauge = next;
  emit(ctx, {
    type: "gaugeChanged",
    sourceKind: exec.sourceKind,
    actor: exec.self === "enemy" ? null : exec.self,
    target: charId,
    amount: delta,
    means,
    ...(exec.ability ? { ability: exec.ability } : {}),
    ...(exec.assist ? { assist: exec.assist } : {}),
  });
  return delta;
}
