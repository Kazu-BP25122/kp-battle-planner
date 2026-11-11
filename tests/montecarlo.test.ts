import { describe, expect, it } from "vitest";
import { buildPlan, runMonteCarlo } from "../src/engine";
import { attack, makeInput, nextTurn, plain, use } from "./helpers";

describe("成功確率（§9）", () => {
  it("予定のバーストに連撃が必要な場合、確率どおりに成功する", () => {
    // ゲージ 70 から、T1 に 3 段（+30）を指定して 100 にし、T2 にバーストする計画
    const a = plain("a");
    const input = makeInput({ front1: a }, { corrections: { a: { startGauge: 70, doubleRate: 20, tripleRate: 40 } } });
    const ops = [attack({ a: 3 }), nextTurn, attack()];
    const plan = buildPlan(input, ops);
    expect(plan.plannedBursts.get(0)).toEqual(new Set());
    expect(plan.plannedBursts.get(2)).toEqual(new Set(["a"]));
    // 成功確率では comboOverride を使わない。T1 が 3 段（40%）のときだけ成功
    const r = runMonteCarlo(input, ops, 4000, { seed: 1 });
    expect(r.successes / r.trials).toBeGreaterThan(0.37);
    expect(r.successes / r.trials).toBeLessThan(0.43);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ reason: "burstMissed", charId: "a", opIndex: 2, turn: 2 });
  });

  it("予定外のバーストは失敗にせず数える", () => {
    const a = plain("a");
    const input = makeInput({ front1: a }, { corrections: { a: { startGauge: 80, tripleRate: 100 } } });
    const r = runMonteCarlo(input, [attack(), nextTurn, attack()], 100, { seed: 2 });
    expect(r.successes).toBe(100);
    expect(r.unexpectedBursts).toBe(100);
  });

  it("使えないアビは失敗。連撃率が未入力のキャラを報告する", () => {
    const a = plain("a", { abilities: [{ id: "x", name: "x", color: "red", ct: 0, cond: { gauge: { gte: 30 } }, effects: [] }] });
    const input = makeInput({ front1: a, front2: plain("b") }, { corrections: { a: { doubleRate: 50 } } });
    // 記録時（1 段）は 10 で使えない計画 → 全試行が失敗
    const r = runMonteCarlo(input, [attack(), nextTurn, use("a", "x")], 200, { seed: 3 });
    expect(r.failures[0]!.reason).toBe("cond");
    expect(r.missingComboRates).toEqual(["b"]);
    // 2 段なら 20 なので届かない → 全て失敗
    expect(r.successes).toBe(0);
  });
});
