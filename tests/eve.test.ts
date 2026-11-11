/**
 * §16.1-5 イヴ 1 体のテスト：カウンター・CT 短縮・回数上限（§10.3、§4.7、§6.1）
 */
import { describe, expect, it } from "vitest";
import { Battle } from "../src/engine";
import { eve, makeInput, redThunder, times, use } from "./helpers";

function setup() {
  const a = redThunder("a");
  const input = makeInput({ front1: eve, front2: a });
  const b = new Battle(input);
  return { b, a };
}

const assistCount = (b: Battle, id: string, turn?: number) =>
  b.state.log.filter((e) => e.type === "assistTriggered" && e.assist === id && (turn === undefined || e.turn === turn)).length;

describe("イヴ", () => {
  it("アビ3：CT 5、全体ゲージ +20、1 回目（奇数）はバーストダメージ UP", () => {
    const { b } = setup();
    const r = b.apply(use("eve", "eve_ability3"));
    expect(r.ok).toBe(true);
    expect(b.state.chars.eve!.ct.eve_ability3).toBe(5);
    expect(b.state.chars.eve!.gauge).toBe(20);
    expect(b.state.chars.a!.gauge).toBe(20);
    expect(b.state.chars.a!.buffs.map((x) => x.name)).toContain("バーストダメージUP");
    expect(b.state.chars.a!.buffs.map((x) => x.name)).not.toContain("サステイン");
    // CT 中は使えない
    expect(b.apply(use("eve", "eve_ability3")).reasons).toContain("ct");
  });

  it("アシスト1：赤・雷のアビ 5 回ごとに全アビの CT -1", () => {
    const { b } = setup();
    b.apply(use("eve", "eve_ability3"));
    for (let i = 1; i <= 4; i++) b.apply(use("a", "a_red"));
    expect(b.state.chars.eve!.ct.eve_ability3).toBe(5);
    expect(assistCount(b, "eve_assist1")).toBe(0);
    b.apply(use("a", "a_red"));
    expect(assistCount(b, "eve_assist1")).toBe(1);
    expect(b.state.chars.eve!.ct.eve_ability3).toBe(4);
    for (let i = 0; i < 5; i++) b.apply(use("a", "a_red"));
    expect(b.state.chars.eve!.ct.eve_ability3).toBe(3);
  });

  it("アシスト1：1 ターン 10 回まで", () => {
    const { b } = setup();
    for (const op of times(60, use("a", "a_red"))) b.apply(op);
    expect(assistCount(b, "eve_assist1", 1)).toBe(10);
  });

  it("アシスト2：今ターンの赤・雷アビが 15 回以上なら毎回発動し、アビダメージを与える", () => {
    const { b } = setup();
    for (const op of times(14, use("a", "a_red"))) b.apply(op);
    expect(assistCount(b, "eve_assist2")).toBe(0);
    b.apply(use("a", "a_red"));
    expect(assistCount(b, "eve_assist2")).toBe(1);
    b.apply(use("a", "a_red"));
    expect(assistCount(b, "eve_assist2")).toBe(2);
    const dmg = b.state.log.filter((e) => e.type === "damage" && e.sourceKind === "assist" && e.actor === "eve");
    expect(dmg).toHaveLength(2);
    expect(dmg.every((e) => e.category === "ability")).toBe(true);
    // 回復はイベントの記録だけ（§4.11）
    expect(b.state.log.filter((e) => e.type === "heal").length).toBeGreaterThan(0);
  });

  it("カウンターはターンごとに数え直す（ログをターンで絞り込む）", () => {
    const { b } = setup();
    for (const op of times(4, use("a", "a_red"))) b.apply(op);
    b.apply({ type: "attack" });
    b.apply({ type: "nextTurn" });
    b.apply(use("eve", "eve_ability3"));
    b.apply(use("a", "a_red"));
    // 前のターンの 4 回と合わせても 5 回目にはならない
    expect(assistCount(b, "eve_assist1")).toBe(0);
  });

  it("イヴ自身の黄アビは赤アビのカウントに入らない", () => {
    const { b } = setup();
    b.apply(use("eve", "eve_ability3"));
    const used = b.state.log.filter((e) => e.type === "abilityUsed" && e.color === "red").length;
    expect(used).toBe(0);
  });
});
