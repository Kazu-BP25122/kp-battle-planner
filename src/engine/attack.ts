/**
 * 攻撃ルーチン（§3-6）。攻撃フェーズからもアビリティ効果（performAttack）からも、必ずここを通す。
 * イベント発行・ゲージ上昇・連撃判定・回数制バフの消費を一元化する。
 */
import { characterBurstConsume } from "../schema/character";
import type { Ctx, Exec } from "./context";
import { charLabel, def, emit, warn } from "./context";
import { consumeCountBuffs } from "./buffs";
import { NORMAL_ATTACK_GAUGE, gainGauge, setGauge } from "./gauge";
import { runEffects } from "./effects";
import type { AttackAction } from "./types";

export interface AttackOptions {
  origin: "attackPhase" | "ability";
  /** kind: burst のみ。アビ効果のバースト後のゲージ（§10.2） */
  gaugeAfter?: "zero" | "keep";
}

/**
 * 連撃数を決める（§9）。連撃率の取得はここに集約する。
 * - 乱数なし（通常表示）：comboOverride があればそれ、なければ 1 段
 * - 乱数あり（成功確率）：ユーザー補正の 2 段・3 段攻撃率で抽選
 */
export function rollCombo(ctx: Ctx, charId: string, origin: "attackPhase" | "ability"): number {
  if (origin === "attackPhase" && ctx.useComboOverride) {
    const o = ctx.comboOverride?.[charId];
    if (o !== undefined) return o;
  }
  if (!ctx.rng) return 1;
  const rates = comboRates(ctx, charId);
  const r = ctx.rng() * 100;
  if (r < rates.triple) return 3;
  if (r < rates.triple + rates.double) return 2;
  return 1;
}

/** 連撃率（%）。将来キャラ定義の基礎値を持たせる場合もここで合成する（§9） */
export function comboRates(ctx: Ctx, charId: string): { double: number; triple: number; entered: boolean } {
  const c = ctx.input.corrections[charId];
  const entered = c?.doubleRate !== undefined || c?.tripleRate !== undefined;
  return { double: c?.doubleRate ?? 0, triple: c?.tripleRate ?? 0, entered };
}

export function performAttack(ctx: Ctx, parent: Exec, charId: string, kind: "normal" | "burst", opts: AttackOptions): AttackAction {
  const c = ctx.state.chars[charId]!;
  const d = def(ctx, charId);
  const startSeq = ctx.state.log.length;

  if (kind === "normal") {
    const exec: Exec = { self: charId, sourceKind: "normalAttack", defaultCategory: "normal", label: `${d.name} 通常攻撃`, dealtDamage: false };
    if (parent.ability) exec.ability = parent.ability;
    const combo = rollCombo(ctx, charId, opts.origin);
    emit(ctx, { type: "normalAttack", sourceKind: "normalAttack", actor: charId, combo, origin: opts.origin, ...(parent.ability ? { ability: parent.ability } : {}) });
    for (let i = 0; i < combo; i++) {
      emit(ctx, { type: "damage", sourceKind: "normalAttack", actor: charId, category: "normal", target: "enemy" });
    }
    // §8.3 上昇量 = 10 × (1 + 上昇量アップ合計%) × 連撃数
    gainGauge(ctx, exec, charId, NORMAL_ATTACK_GAUGE * combo, "normalAttack", true);
    const consumed = consumeCountBuffs(ctx, exec, charId, "attack", startSeq);
    if (opts.origin === "ability" && consumed.length > 0) {
      // TODO(spec): §10.2 アビ効果の通常攻撃が回数制バフを消費するかは実機未確認（消費するで仮置き）
      warn(ctx, "countBuffNotKept", `${charLabel(ctx, charId)}の回数制バフ（${consumed.map((b) => b.name).join("、")}）がアビの通常攻撃で消費され、攻撃フェーズまで残らない`, charId);
    }
    return { charId, kind, combo };
  }

  // バースト（§8.2）
  const exec: Exec = { self: charId, sourceKind: "burst", defaultCategory: "burst", label: `${d.name} バースト`, dealtDamage: false };
  let consumedGauge: number;
  if (opts.origin === "attackPhase") {
    consumedGauge = characterBurstConsume(d) === "consumeAll" ? c.gauge : Math.min(100, c.gauge);
    setGauge(ctx, exec, charId, c.gauge - consumedGauge, "burst");
  } else {
    // §10.2 アビ効果による即時バースト：既定は 0 に戻る、keep なら減らない
    // TODO(spec): §11 ゲージ 100 未満でも撃てるか、上限 200・subtract100 のキャラも 0 に戻るかは未確定
    if ((opts.gaugeAfter ?? "zero") === "keep") {
      consumedGauge = 0;
    } else {
      consumedGauge = c.gauge;
      setGauge(ctx, exec, charId, 0, "burst");
    }
  }
  emit(ctx, { type: "burst", sourceKind: "burst", actor: charId, gaugeConsumed: consumedGauge, origin: opts.origin });
  runEffects(ctx, exec, d.burst.effects);
  consumeCountBuffs(ctx, exec, charId, "attack", startSeq);
  return { charId, kind };
}
