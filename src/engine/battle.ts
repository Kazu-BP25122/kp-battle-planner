/**
 * ターン進行（§5）と操作の適用。チャートデータの操作を 1 件ずつ受け取って状態を進める。
 */
import type { ManualEvent, Op } from "../schema/chart";
import type { Ctx, Exec } from "./context";
import { StepLimitError, activeMainIds, charLabel, createCtx, emit, isActiveMain, slotOf, warn } from "./context";
import { processQueue } from "./assists";
import { abilityUnusableReasons, useAbility } from "./ability";
import { performAttack } from "./attack";
import { consumeCountBuffs, tickTurnBuffs } from "./buffs";
import { BURST_THRESHOLD, CHAIN_GAUGE, gainGauge, setGauge } from "./gauge";
import { knockOut, replenish } from "./formation";
import { runEffect } from "./effects";
import type { AttackAction, BattleState, EngineInput, EngineOptions, OpResult } from "./types";
import { MAIN_SLOTS } from "./types";

const systemExec = (label = "システム"): Exec => ({ self: "enemy", sourceKind: "system", defaultCategory: "ability", label, dealtDamage: false });

export class Battle {
  readonly ctx: Ctx;
  private opCount = 0;

  constructor(input: EngineInput, options: EngineOptions = {}) {
    this.ctx = createCtx(input, options);
    this.guard(() => this.battleStart());
  }

  get state(): BattleState {
    return this.ctx.state;
  }

  /** 例外（ステップ上限）を警告に変えて処理を打ち切る（§3-8） */
  private guard(fn: () => void): boolean {
    this.ctx.steps = 0;
    try {
      fn();
      return true;
    } catch (e) {
      if (e instanceof StepLimitError) {
        this.ctx.queue.length = 0;
        warn(this.ctx, "stepLimit", e.message);
        return false;
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------- 戦闘開始・ターン開始

  private battleStart(): void {
    const ctx = this.ctx;
    // §8.0 開始時のゲージ（ユーザー補正）
    for (const id of Object.keys(ctx.state.chars)) {
      const g = ctx.input.corrections[id]?.startGauge;
      if (g) setGauge(ctx, { ...systemExec("ユーザー補正"), sourceKind: "manual" }, id, g, "correction");
    }
    emit(ctx, { type: "battleStart", sourceKind: "system", actor: null });
    processQueue(ctx);
    this.turnStart();
  }

  private turnStart(): void {
    const ctx = this.ctx;
    ctx.state.phase = "turnStart";
    emit(ctx, { type: "turnStart", sourceKind: "system", actor: null });
    processQueue(ctx);
    ctx.state.phase = "action";
    ctx.state.attacked = false;
  }

  // ---------------------------------------------------------------- 操作

  apply(op: Op): OpResult {
    const ctx = this.ctx;
    ctx.opIndex = this.opCount++;
    const from = ctx.state.log.length;
    const result: OpResult = { op, opIndex: ctx.opIndex, ok: true, reasons: [], eventRange: [from, from] };

    const invalid = (msg: string) => {
      result.ok = false;
      if (result.reasons.length === 0) result.reasons.push("phase");
      warn(ctx, "opInvalid", msg);
    };

    const ok = this.guard(() => {
      switch (op.type) {
        case "useAbility": {
          const reasons = abilityUnusableReasons(ctx, op.charId, op.abilityId, op.chosenAlly);
          if (reasons.length > 0) {
            result.ok = false;
            result.reasons = reasons;
            warn(ctx, "opInvalid", `${charLabel(ctx, op.charId)}の「${op.abilityId}」は使用できない`, op.charId);
            return;
          }
          useAbility(ctx, op.charId, op.abilityId, op.chosenAlly);
          return;
        }
        case "setBurst":
          if (ctx.state.phase !== "action" || ctx.state.attacked) return invalid("バースト発動の切り替えは行動フェーズでのみ可能");
          ctx.state.burstMode = op.mode;
          return;
        case "attack":
          if (ctx.state.phase !== "action" || ctx.state.attacked) return invalid("攻撃はターンに 1 回、行動フェーズでのみ可能");
          ctx.comboOverride = op.comboOverride;
          result.attackActions = this.attackPhase();
          ctx.comboOverride = undefined;
          return;
        case "enemyPhase":
          if (ctx.state.phase !== "enemy") return invalid("敵フェーズの入力は攻撃の後でのみ可能");
          for (const e of op.events) this.manualEvent(e);
          return;
        case "nextTurn":
          if (ctx.state.phase !== "enemy") return invalid("次のターンへ進むには攻撃が必要");
          this.turnEnd();
          ctx.state.turn++;
          this.turnStart();
          return;
      }
    });
    if (!ok) result.ok = false;
    result.eventRange = [from, ctx.state.log.length];
    return result;
  }

  // ---------------------------------------------------------------- 攻撃フェーズ（§5-3）

  private attackPhase(): AttackAction[] {
    const ctx = this.ctx;
    ctx.state.phase = "attack";
    const actions: AttackAction[] = [];
    const acted = new Set<string>();
    const exec = systemExec();
    // 英霊 → 前衛 1 → 前衛 2 → 後衛 1 → 後衛 2（§4.4 行動順）
    for (const slot of MAIN_SLOTS) {
      const id = ctx.state.formation[slot];
      if (!id || acted.has(id) || ctx.state.chars[id]!.knockedOut) continue;
      const c = ctx.state.chars[id]!;
      const burst = ctx.state.burstMode === "fire" && c.gauge >= BURST_THRESHOLD;
      const action = performAttack(ctx, exec, id, burst ? "burst" : "normal", { origin: "attackPhase" });
      actions.push(action);
      acted.add(id);
      if (burst) {
        // §8.4 自身を除く未行動の味方に +10（上昇量アップは乗らない）
        for (const later of MAIN_SLOTS) {
          if (later <= slot) continue;
          const lid = ctx.state.formation[later];
          if (!lid || acted.has(lid) || ctx.state.chars[lid]!.knockedOut) continue;
          gainGauge(ctx, { ...exec, self: id, sourceKind: "burst" }, lid, CHAIN_GAUGE, "chain", false);
        }
      }
      processQueue(ctx);
    }
    ctx.state.phase = "enemy";
    ctx.state.attacked = true;
    return actions;
  }

  // ---------------------------------------------------------------- 敵フェーズの手入力（§4.10）

  private manualEvent(e: ManualEvent): void {
    const ctx = this.ctx;
    const exec: Exec = { self: "enemy", sourceKind: "manual", defaultCategory: "ability", label: "手入力", dealtDamage: false };
    switch (e.type) {
      case "damaged": {
        if (!isActiveMain(ctx, e.target)) return warn(ctx, "opInvalid", `${charLabel(ctx, e.target)}はメインにいないため被弾できない`, e.target);
        const start = ctx.state.log.length;
        emit(ctx, { type: "damaged", sourceKind: "manual", actor: null, element: ctx.state.enemy.element, target: e.target, count: e.count });
        // TODO(spec): §7・§11 防御系の回数制バフが多段の敵攻撃でヒット単位に減るかは未確定。被弾回数ぶん減らす
        consumeCountBuffs(ctx, { ...exec, self: e.target }, e.target, "damaged", start + 1, e.count);
        break;
      }
      case "knockedOut":
        if (slotOf(ctx, e.target) === null) return warn(ctx, "opInvalid", `${charLabel(ctx, e.target)}は場にいない`, e.target);
        knockOut(ctx, exec, e.target);
        break;
      case "hpRate": {
        const c = ctx.state.chars[e.target];
        if (c) c.hp = e.value;
        break;
      }
      case "effect": {
        const subject = e.subject ?? "enemy";
        if (subject !== "enemy" && slotOf(ctx, subject) === null) return warn(ctx, "opInvalid", `${charLabel(ctx, subject)}は場にいない`, subject);
        runEffect(ctx, { ...exec, self: subject }, e.effect);
        break;
      }
    }
    processQueue(ctx);
  }

  // ---------------------------------------------------------------- ターンエンド処理（§5-5）

  /**
   * TODO(spec): §5・§11.0-8 ターンエンド処理の順番は仮置き。補充されたキャラに 3〜5 が適用されるかも未確定
   * （現状は補充後のメインに適用する）
   */
  private turnEnd(): void {
    const ctx = this.ctx;
    ctx.state.phase = "turnEnd";
    const exec = systemExec("ターンエンド");
    // 1. スリップダメージ：戦闘不能は手入力イベント（何もしない）
    // 2. 補充
    replenish(ctx, exec);
    processQueue(ctx);
    // 3. turnEnd イベント、ターン終了時のゲージ上昇、ターン終了時のアシスト
    emit(ctx, { type: "turnEnd", sourceKind: "system", actor: null });
    for (const id of activeMainIds(ctx)) {
      for (const b of ctx.state.chars[id]!.buffs) {
        if (b.slot === null || b.amount === null) continue;
        if (ctx.slots.get(b.slot)?.engineEffect !== "turnEndGauge") continue;
        // TODO(spec): §11 ターン終了時のゲージ上昇に受け手の上昇量アップが乗るかは未確定。乗せない
        gainGauge(ctx, { ...exec, label: b.name }, id, b.amount, "turnEnd", false);
      }
    }
    processQueue(ctx);
    // 4. ターン制の効果の残りターンを減らす（敵フェーズ中に付与されたものは除く）
    for (const id of activeMainIds(ctx)) tickTurnBuffs(ctx, exec, id);
    tickTurnBuffs(ctx, exec, "enemy");
    // 5. メインにいるキャラの CT を 1 減らす（サブは減らさない）
    for (const id of activeMainIds(ctx)) {
      const c = ctx.state.chars[id]!;
      for (const k of Object.keys(c.ct)) c.ct[k] = Math.max(0, c.ct[k]! - 1);
    }
    // buffExpired などはアシストのトリガーにもなりうるため処理する
    processQueue(ctx);
  }

  // ---------------------------------------------------------------- 予測

  /** このまま攻撃した場合に誰がバーストするか（§8.4。通常表示 = 連撃 1 段で予測） */
  previewAttack(comboOverride?: Record<string, 1 | 2 | 3>): AttackAction[] {
    if (this.ctx.state.phase !== "action" || this.ctx.state.attacked) return [];
    const clone = new Battle(this.ctx.input, { stepLimit: this.ctx.stepLimit });
    clone.ctx.state = cloneState(this.ctx.state);
    clone.opCount = this.opCount;
    const r = clone.apply({ type: "attack", ...(comboOverride ? { comboOverride } : {}) });
    return r.attackActions ?? [];
  }
}

/** 状態の複製（ログ・警告は追記のみなので浅く複製する） */
export function cloneState(s: BattleState): BattleState {
  return {
    ...s,
    formation: [...s.formation],
    chars: Object.fromEntries(
      Object.entries(s.chars).map(([k, c]) => [
        k,
        { ...c, ct: { ...c.ct }, tokens: { ...c.tokens }, buffs: c.buffs.map((b) => ({ ...b, duration: { ...b.duration } })) },
      ]),
    ),
    enemy: { ...s.enemy, buffs: s.enemy.buffs.map((b) => ({ ...b, duration: { ...b.duration } })) },
    log: [...s.log],
    warnings: [...s.warnings],
  };
}

