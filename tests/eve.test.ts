/**
 * §16.1-8 イヴ：アシストの連鎖・カウンター・CT 短縮・回数上限、条件付き即リキャ、累積型のバフ、使用と発動の区別
 * （定義：src/content/characters/eve.json、資料：CHARACTER.md §3）
 */
import { describe, expect, it } from "vitest";
import { Battle } from "../src/engine";
import { attack, eve, makeInput, nextTurn, redThunder, times, use } from "./helpers";

const red = redThunder("a");
function setup(startGauge = 0) {
  return new Battle(makeInput({ front1: eve, front2: red }, { corrections: { eve: { startGauge } } }));
}
const evs = (b: Battle, type: string, f: (e: Battle["state"]["log"][number]) => boolean = () => true) => b.state.log.filter((e) => e.type === type && f(e));
const assistCount = (b: Battle, id: string, turn?: number) => evs(b, "assistTriggered", (e) => e.assist === id && (turn === undefined || e.turn === turn)).length;
const a1Hits = (b: Battle, from: number) => b.state.log.slice(from).filter((e) => e.type === "damage" && e.ability === "eve_a1").length;

describe("イヴ", () => {
  it("アビ 1：n 回目の発動で n ヒット。バーストでの発動も数え、CT は変えず、使用回数には数えない", () => {
    const b = setup(100);
    let from = b.state.log.length;
    b.apply(use("eve", "eve_a1"));
    expect(a1Hits(b, from)).toBe(1);
    expect(b.state.chars.eve!.ct.eve_a1).toBe(1);
    from = b.state.log.length;
    const r = b.apply(attack()); // ゲージ 100 → バーストでアビ 1 を発動
    expect(r.attackActions![0]).toMatchObject({ charId: "eve", kind: "burst" });
    expect(a1Hits(b, from)).toBe(2);
    expect(evs(b, "damage", (e) => e.category === "burst" && e.actor === "eve")).toHaveLength(1);
    expect(b.state.chars.eve!.ct.eve_a1).toBe(1); // 発動は CT を変えない
    expect(evs(b, "abilityUsed", (e) => e.ability === "eve_a1")).toHaveLength(1);
    expect(evs(b, "abilityActivated", (e) => e.ability === "eve_a1").map((e) => e.route)).toEqual(["use", "effect"]);
    b.apply(nextTurn);
    from = b.state.log.length;
    b.apply(use("eve", "eve_a1"));
    expect(a1Hits(b, from)).toBe(3);
    // ダメージの属性はイヴの属性（雷）、区分はアビリティ
    expect(b.state.log.slice(from).filter((e) => e.type === "damage").every((e) => e.element === "thunder" && e.category === "ability")).toBe(true);
  });

  it("アビ 2：全属性ダメージ（幻・火・水・風・雷・闇・光の順に 1 ヒットずつ）", () => {
    const b = setup();
    const from = b.state.log.length;
    b.apply(use("eve", "eve_a2"));
    const dmg = b.state.log.slice(from).filter((e) => e.type === "damage");
    expect(dmg.map((e) => e.element)).toEqual(["phantom", "fire", "water", "wind", "thunder", "dark", "light"]);
    expect(dmg.every((e) => e.sourceElement === "thunder" && e.category === "ability")).toBe(true);
  });

  it("アビ 2：即リキャは 1 ターン 2 回まで。そのターンの 2 回目以降はゲージ 20 消費。4 回目以降は CT が 0 まで回復したときだけ", () => {
    const b = setup(100);
    const g = () => b.state.chars.eve!.gauge;
    const ct = () => b.state.chars.eve!.ct.eve_a2;
    expect(b.apply(use("eve", "eve_a2")).ok).toBe(true);
    expect([g(), ct()]).toEqual([100, 0]);
    expect(b.apply(use("eve", "eve_a2")).ok).toBe(true);
    expect([g(), ct()]).toEqual([80, 0]);
    expect(b.apply(use("eve", "eve_a2")).ok).toBe(true);
    expect([g(), ct()]).toEqual([60, 5]);
    expect(b.apply(use("eve", "eve_a2")).reasons).toContain("ct");
    // 2 回目以降のゲージ 20 は消費（減少）として記録される
    const costs = evs(b, "gaugeChanged", (e) => e.target === "eve" && e.means === "cost");
    expect(costs.map((e) => e.amount)).toEqual([-20, -20]);
    // ターンが変わると最初の使用は無料に戻る（CT が 0 なら）
    b.apply(attack());
    b.apply(nextTurn);
    b.state.chars.eve!.ct.eve_a2 = 0;
    const before = g();
    expect(b.apply(use("eve", "eve_a2")).ok).toBe(true);
    expect([g(), ct()]).toEqual([before, 0]);
  });

  it("アビ 2：ゲージが 20 未満なら 2 回目は使えない（コスト不足）", () => {
    const b = setup(10);
    b.apply(use("eve", "eve_a2"));
    expect(b.apply(use("eve", "eve_a2")).reasons).toContain("cost");
  });

  it("アビ 2：ダメージ上限 UP は累積し、1 段ずつ別々に切れる（perStack）", () => {
    const b = setup(100);
    const stacks = () => b.state.chars.a!.buffs.filter((x) => x.name === "ダメージ上限UP").length;
    b.apply(use("eve", "eve_a2"));
    b.apply(use("eve", "eve_a2"));
    expect(stacks()).toBe(2);
    expect(evs(b, "buffApplied", (e) => e.target === "a" && e.buff === "ダメージ上限UP").map((e) => e.stacks)).toEqual([1, 2]);
    b.apply(attack());
    b.apply(nextTurn); // T1 終了：残り 1
    b.state.chars.eve!.ct.eve_a2 = 0;
    b.apply(use("eve", "eve_a2"));
    expect(stacks()).toBe(3);
    b.apply(attack());
    b.apply(nextTurn); // T2 終了：T1 の 2 段が切れる
    expect(stacks()).toBe(1);
    b.apply(attack());
    b.apply(nextTurn); // T3 終了：T2 の 1 段が切れる
    expect(stacks()).toBe(0);
    // 1 段が切れるたびに buffExpired を記録し、残りの累積数を持たせる（§7.1）
    expect(evs(b, "buffExpired", (e) => e.target === "a" && e.buff === "ダメージ上限UP").map((e) => e.stacks)).toEqual([2, 1, 0]);
  });

  it("アビ 3：ゲージ +20・被ダメージマイナス。奇数回の発動はバーストダメージプラス、偶数回はサステイン", () => {
    const b = setup();
    b.apply(use("eve", "eve_a3"));
    expect(b.state.chars.eve!.ct.eve_a3).toBe(2);
    expect(b.state.chars.a!.gauge).toBe(20);
    const names = () => b.state.chars.a!.buffs.map((x) => x.name);
    expect(names()).toEqual(expect.arrayContaining(["被ダメージマイナス", "バーストダメージプラス"]));
    expect(names()).not.toContain("サステイン");
    expect(b.apply(use("eve", "eve_a3")).reasons).toContain("ct");
    for (const _ of [0, 1]) {
      b.apply(attack());
      b.apply(nextTurn);
    }
    b.apply(use("eve", "eve_a3"));
    expect(names()).toContain("サステイン");
  });

  it("アシスト 1：雷属性のキャラの赤アビ使用 5 回ごとに全アビの CT -1（1 ターン 10 回まで）", () => {
    const b = setup();
    b.apply(use("eve", "eve_a3")); // CT 2
    b.apply(use("eve", "eve_a2")); // 赤 1 回目（即リキャで CT 0）
    for (let i = 0; i < 3; i++) b.apply(use("a", "a_red"));
    expect(assistCount(b, "eve_assist1")).toBe(0);
    b.apply(use("a", "a_red")); // 5 回目
    expect(assistCount(b, "eve_assist1")).toBe(1);
    expect(b.state.chars.eve!.ct.eve_a3).toBe(1);
    for (const op of times(60, use("a", "a_red"))) b.apply(op);
    expect(assistCount(b, "eve_assist1", 1)).toBe(10);
  });

  it("アシスト 1：バーストで発動したアビ 1 は赤アビの使用に数えない", () => {
    const b = setup(100);
    for (let i = 0; i < 4; i++) b.apply(use("a", "a_red"));
    b.apply(attack()); // バーストでアビ 1 を発動（使用ではない）
    expect(assistCount(b, "eve_assist1")).toBe(0);
  });

  it("アシスト 2：ターン終了時に毎ターン雷属性アビダメージ 1 ヒット。15 回以上なら回復と状態異常回復を追加", () => {
    const b = setup();
    b.apply(attack());
    b.apply(nextTurn);
    expect(assistCount(b, "eve_assist2", 1)).toBe(1);
    const dmg = evs(b, "damage", (e) => e.assist === "eve_assist2");
    expect(dmg).toHaveLength(1);
    expect(dmg[0]).toMatchObject({ category: "ability", element: "thunder", phase: "turnEnd" });
    expect(evs(b, "heal")).toHaveLength(0);
    for (const op of times(15, use("a", "a_red"))) b.apply(op);
    b.apply(attack());
    b.apply(nextTurn);
    expect(evs(b, "heal", (e) => e.turn === 2).map((e) => e.target).sort()).toEqual(["a", "eve"]);
  });
});
