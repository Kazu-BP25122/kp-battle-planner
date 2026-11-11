/**
 * 表示名：通知・警告・付与元に ID が出ないこと（§4.2 分けたアシスト・アビの常時効果の表示）
 */
import { describe, expect, it } from "vitest";
import { Battle } from "../src/engine";
import { assistDisplayName } from "../src/schema/character";
import { eventLogLines, eventNotice } from "../src/components/labels";
import type { Catalog } from "../src/chart/input";
import { amon, artemis, attack, beethoven, buffSlots, eve, makeInput, nextTurn, plain, shaitan, use } from "./helpers";
import type { Effect } from "../src/schema/dsl";

const chars = [beethoven, eve, shaitan, amon, artemis];
const catalog: Catalog = { characters: Object.fromEntries(chars.map((c) => [c.id, c])), buffSlots };
const allIds = chars.flatMap((c) => [...c.abilities.map((a) => a.id), ...(c.assists ?? []).map((a) => a.id)]);

describe("表示名", () => {
  it("名前の無いアシストは、分けた元のアシスト名・「アシスト n」・「<アビ名>（常時効果）」で表示する", () => {
    expect(assistDisplayName(shaitan, "shaitan_assist1_limiterReset")).toBe("バハルタフリール");
    expect(assistDisplayName({ ...shaitan, assists: shaitan.assists!.map(({ name: _n, ...a }) => a) }, "shaitan_assist2")).toBe("アシスト2");
    expect(assistDisplayName(shaitan, "shaitan_a3_passive")).toBe("ジャースウサハム（常時効果）");
    expect(assistDisplayName(amon, "amon_assist1_turnEnd")).toBe("ヴォルトパニッシュメント");
    expect(assistDisplayName(amon, "amon_a2_passive")).toBe("破滅雷撃+（常時効果）");
  });

  it("5 体で数ターン操作しても、通知・警告・付与元にアビ・アシストの ID が出ない", () => {
    const b = new Battle(makeInput({ hero: beethoven, front1: eve, front2: shaitan, back1: amon, back2: artemis }, { corrections: { eve: { startGauge: 100 }, shaitan: { startGauge: 100 } } }));
    for (let t = 0; t < 3; t++) {
      for (const [c, a] of [["eve", "eve_a2"], ["eve", "eve_a2"], ["eve", "eve_a2"], ["shaitan", "shaitan_a1"], ["shaitan", "shaitan_a2"], ["amon", "amon_a2"], ["artemis", "artemis_a2"], ["beethoven", "beethoven_a1"]] as const) b.apply(use(c, a));
      b.apply(attack());
      b.apply(nextTurn);
    }
    const texts = [
      ...b.state.log.map((e) => eventNotice(catalog, e)).filter((x): x is string => x !== null),
      ...eventLogLines(catalog, b.state.log).map((l) => l.text),
      ...b.state.warnings.map((w) => w.message),
      ...Object.values(b.state.chars).flatMap((c) => c.buffs.map((x) => x.sourceLabel)),
    ];
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) for (const id of allIds) expect(t, t).not.toContain(id);
  });

  it("チャートのログ：操作で起きたことを並べ、同じ行が続けば ×n にまとめる。使用と同時の発動・非表示トークンは出さない", () => {
    const b = new Battle(makeInput({ front1: beethoven, front2: shaitan }));
    b.state.chars.beethoven!.tokens.紅の旋律 = 3;
    const from = b.state.log.length;
    b.apply(use("beethoven", "beethoven_a1"));
    const lines = eventLogLines(catalog, b.state.log.slice(from));
    expect(lines[0]!.text).toBe("ベートーヴェン「ナインズフォージョイ」使用");
    expect(lines.find((l) => l.text.startsWith("ベートーヴェン ダメージ"))!.times).toBe(5);
    expect(lines.some((l) => l.text.includes("紅の譜面 +1"))).toBe(true);
    const from2 = b.state.log.length;
    b.apply(use("shaitan", "shaitan_a1"));
    b.apply(use("shaitan", "shaitan_a2"));
    const texts = eventLogLines(catalog, b.state.log.slice(from2)).map((l) => l.text);
    expect(texts.filter((t) => t.includes("シュイドオラアド+」使用"))).toHaveLength(1);
    expect(texts).toContain("[波戯の愛霹]シャイターン「シュイドオラアド+」発動");
    expect(texts).toContain("[波戯の愛霹]シャイターンのアシスト「バハルタフリール」発動");
    expect(texts.join()).not.toContain("shaitan_limiterUses");
  });

  it("チャートのログ：通常攻撃は「通常攻撃 n 段」と「バーストゲージ m 上昇」の 2 行だけ", () => {
    const b = new Battle(makeInput({ front1: eve }));
    const from = b.state.log.length;
    b.apply(attack({ eve: 3 }));
    expect(eventLogLines(catalog, b.state.log.slice(from)).map((l) => l.text)).toEqual(["神代の始祖イヴ 通常攻撃 3段", "神代の始祖イヴ バーストゲージ 30 上昇"]);
  });

  it("同じ枠で付与できなかったとき、バフは CANCEL、デバフは MISS と表示する（§7.1）", () => {
    const eff = (type: "addBuff" | "addDebuff", amount: number): Effect => ({ type, target: type === "addBuff" ? "self" : "enemy", buff: `x${amount}`, slot: type === "addBuff" ? "atkUp" : "dmgDealtDown", amount, duration: { turns: 3 } });
    const c = plain("c", { abilities: [{ id: "c_a1", name: "a", color: "red", ct: 0, effects: [eff("addBuff", 30), eff("addBuff", 10), eff("addDebuff", 30), eff("addDebuff", 10)] }] });
    const cat: Catalog = { characters: { c }, buffSlots };
    const b = new Battle(makeInput({ front1: c }));
    b.apply(use("c", "c_a1"));
    const missed = b.state.log.filter((e) => e.type === "buffMissed");
    expect(missed.map((e) => eventNotice(cat, e))).toEqual(["CANCEL：cの「x10」", "MISS：敵の「x10」"]);
    expect(b.state.warnings.filter((w) => w.code === "buffMissed").map((w) => w.message.includes("CANCEL") ? "CANCEL" : "MISS")).toEqual(["CANCEL", "MISS"]);
  });
});
