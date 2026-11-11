/**
 * 成功確率（§9）。同じエンジンを乱数ありで多数回実行する。
 * 成功の判定は差し替え可能な関数（Judge）にしておく（将来の「続行判定」のため）。
 */
import type { Op } from "../schema/chart";
import { Battle } from "./battle";
import { comboRates } from "./attack";
import { createCtx } from "./context";
import { replay } from "./replay";
import { mulberry32 } from "./rng";
import type { EngineInput, OpResult, UnusableReason } from "./types";

export type FailureReason = "burstMissed" | "stepLimit" | UnusableReason;

export interface Failure {
  opIndex: number;
  turn: number;
  charId: string | null;
  reason: FailureReason;
}

/** 記録した操作から求める「計画」（§9） */
export interface Plan {
  ops: readonly Op[];
  /** 攻撃の操作の番号 → バーストする予定のキャラ（記録時の通常表示でバーストしたキャラ） */
  plannedBursts: Map<number, Set<string>>;
}

export interface JudgeResult {
  failure: Failure | null;
  unexpectedBursts: number;
}

export type Judge = (plan: Plan, result: OpResult, battle: Battle) => JudgeResult;

/** 厳格判定（§9 確定） */
export const strictJudge: Judge = (plan, result, battle) => {
  const turn = battle.state.turn;
  if (!result.ok) {
    const op = result.op;
    const reason: FailureReason = battle.state.warnings.some((w) => w.code === "stepLimit" && w.opIndex === result.opIndex)
      ? "stepLimit"
      : result.reasons[0] ?? "unknown";
    return { failure: { opIndex: result.opIndex, turn, charId: op.type === "useAbility" ? op.charId : null, reason }, unexpectedBursts: 0 };
  }
  if (result.op.type !== "attack") return { failure: null, unexpectedBursts: 0 };
  const planned = plan.plannedBursts.get(result.opIndex) ?? new Set<string>();
  let unexpected = 0;
  for (const a of result.attackActions ?? []) {
    if (planned.has(a.charId) && a.kind !== "burst") {
      return { failure: { opIndex: result.opIndex, turn, charId: a.charId, reason: "burstMissed" }, unexpectedBursts: unexpected };
    }
    // 予定外のバーストは失敗にせず続行する（§9 確定）
    if (!planned.has(a.charId) && a.kind === "burst") unexpected++;
  }
  return { failure: null, unexpectedBursts: unexpected };
};

export function buildPlan(input: EngineInput, ops: readonly Op[]): Plan {
  const r = replay(input, ops);
  const plannedBursts = new Map<number, Set<string>>();
  for (const s of r.steps) {
    if (s.result.op.type !== "attack") continue;
    plannedBursts.set(s.result.opIndex, new Set((s.result.attackActions ?? []).filter((a) => a.kind === "burst").map((a) => a.charId)));
  }
  return { ops, plannedBursts };
}

export interface FailureSummary extends Failure {
  count: number;
}

export interface MonteCarloResult {
  trials: number;
  successes: number;
  /** 失敗の集計（多い順） */
  failures: FailureSummary[];
  /** 予定外のバーストの合計回数 */
  unexpectedBursts: number;
  /** 予定外のバーストが 1 回以上あった試行の数 */
  trialsWithUnexpected: number;
  /** 連撃率が未入力のキャラ */
  missingComboRates: string[];
}

export interface MonteCarloOptions {
  seed?: number;
  judge?: Judge;
}

/** 少しずつ実行できる形（UI でブラウザを止めないため） */
export function createMonteCarlo(input: EngineInput, ops: readonly Op[], options: MonteCarloOptions = {}) {
  const plan = buildPlan(input, ops);
  const judge = options.judge ?? strictJudge;
  const rng = mulberry32(options.seed ?? 12345);
  const failures = new Map<string, FailureSummary>();
  let trials = 0;
  let successes = 0;
  let unexpectedBursts = 0;
  let trialsWithUnexpected = 0;

  const ctx0 = createCtx(input);
  const missingComboRates = Object.keys(ctx0.state.chars).filter((id) => !comboRates(ctx0, id).entered);

  function runOne(): void {
    const battle = new Battle(input, { rng, useComboOverride: false });
    let unexpected = 0;
    let failure: Failure | null = null;
    for (const op of plan.ops) {
      const res = battle.apply(op);
      const j = judge(plan, res, battle);
      unexpected += j.unexpectedBursts;
      if (j.failure) {
        failure = j.failure;
        break;
      }
    }
    trials++;
    unexpectedBursts += unexpected;
    if (unexpected > 0) trialsWithUnexpected++;
    if (!failure) {
      successes++;
      return;
    }
    const key = `${failure.opIndex}:${failure.charId}:${failure.reason}`;
    const s = failures.get(key);
    if (s) s.count++;
    else failures.set(key, { ...failure, count: 1 });
  }

  return {
    runBatch(n: number): void {
      for (let i = 0; i < n; i++) runOne();
    },
    result(): MonteCarloResult {
      return {
        trials,
        successes,
        failures: [...failures.values()].sort((a, b) => b.count - a.count),
        unexpectedBursts,
        trialsWithUnexpected,
        missingComboRates,
      };
    },
  };
}

export function runMonteCarlo(input: EngineInput, ops: readonly Op[], trials = 10000, options: MonteCarloOptions = {}): MonteCarloResult {
  const mc = createMonteCarlo(input, ops, options);
  mc.runBatch(trials);
  return mc.result();
}
