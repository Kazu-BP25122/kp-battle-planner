/**
 * §16.1 手順 2：スキーマとデータ検証、省略形の展開
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Character } from "../src/schema/character";
import { EffectList, type Effect } from "../src/schema/dsl";
import { expandCharacter, expandEffects, hasShorthand } from "../src/schema/expand";
import { loadContent } from "../src/schema/loadContent";
import { validateCharacter } from "../src/schema/validate";
import { CUSTOM_EFFECT_IDS } from "../src/engine/custom";
import { Battle } from "../src/engine";
import { amon, artemis, beethoven, buffSlots, eve, makeInput, plain, shaitan, use } from "./helpers";

const root = join(__dirname, "..");
const charDir = join(root, "src/content/characters");
const files = readdirSync(charDir)
  .filter((f) => f.endsWith(".json"))
  .map((name) => ({ name, text: readFileSync(join(charDir, name), "utf8") }));
const slotsFile = { name: "buffSlots.json", text: readFileSync(join(root, "src/content/buffSlots.json"), "utf8") };

describe("コンテンツデータの検証（§12、§16.1-2）", () => {
  it("5 体の JSON と buffSlots.json がスキーマと参照の検査をすべて通る", () => {
    const r = loadContent(files, slotsFile, CUSTOM_EFFECT_IDS);
    expect(r.issues).toEqual([]);
    expect(r.characters.map((c) => c.id).sort()).toEqual(["amon", "artemis", "beethoven", "eve", "shaitan"]);
  });

  const vc = { buffSlots, characters: [eve, beethoven, shaitan, amon, artemis], customIds: CUSTOM_EFFECT_IDS };
  const withAbility = (effects: unknown[], extra: Record<string, unknown> = {}) =>
    Character.parse({
      id: "z",
      name: "z",
      kind: "kamihime",
      element: "thunder",
      burst: { effects: [] },
      abilities: [{ id: "z_a1", name: "a", color: "red", ct: 0, effects }],
      ...extra,
    });
  const messages = (c: Character) => validateCharacter(c, { ...vc, characters: [...vc.characters, c] }).map((i) => i.message);

  it("未登録の枠・極性の違いを見つける", () => {
    const c = withAbility([
      { type: "addBuff", target: "self", buff: "x", slot: "noSuchSlot", amount: 1, duration: { turns: 1 } },
      { type: "addDebuff", target: "enemy", buff: "x", slot: "atkUp", amount: 1, duration: { turns: 1 } },
    ]);
    const m = messages(c);
    expect(m.some((x) => x.includes("noSuchSlot"))).toBe(true);
    expect(m.some((x) => x.includes("極性"))).toBe(true);
  });

  it("トークン・アビ・アシスト・オプション・共有の効果・custom の参照先を確かめる", () => {
    const c = withAbility(
      [
        { type: "addToken", target: "self", name: "無いトークン", amount: 1 },
        { type: "activateAbility", character: "self", ability: "z_a9" },
        { type: "if", cond: { option: { id: "noOpt", is: true } }, then: [] },
        { type: "if", cond: { count: { event: "assistTriggered", filter: { assist: "noAssist" }, scope: "turn", gte: 1 } }, then: [] },
        { type: "useEffects", id: "noShared" },
        { type: "custom", id: "noCustom" },
      ],
      { tokens: [{ name: "t", group: "無いグループ" }] },
    );
    const m = messages(c).join("\n");
    for (const s of ["無いトークン", "z_a9", "noOpt", "noAssist", "noShared", "noCustom", "無いグループ"]) expect(m).toContain(s);
  });

  it("アシストの中の ability: \"self\" はエラー（アビ ID を直接書く。§10.2）", () => {
    const c = withAbility([], {
      assists: [{ id: "z_assist1", trigger: { event: "abilityUsed", filter: { ability: "self" } }, effects: [] }],
    });
    expect(messages(c).some((x) => x.includes("ability"))).toBe(true);
  });

  it("展開後の入れ子が 3 段を超えたらエラー", () => {
    const t = { turnCount: { gte: 1 } };
    // 展開前は if → if → useEffects で 3 段。展開すると if → if → repeat → heal で 4 段
    const c = withAbility([{ type: "if", cond: t, then: [{ type: "if", cond: t, then: [{ type: "useEffects", id: "s" }] }] }], {
      sharedEffects: { s: [{ type: "repeat", times: 1, effects: [{ type: "heal", target: "self" }] }] },
    });
    expect(messages(c).some((x) => x.includes("展開後の入れ子"))).toBe(true);
  });

  it("sharedEffects の中の useEffects はエラー（循環防止）", () => {
    const c = withAbility([{ type: "useEffects", id: "a" }], { sharedEffects: { a: [{ type: "useEffects", id: "b" }], b: [] } });
    expect(messages(c).some((x) => x.includes("useEffects"))).toBe(true);
  });
});

describe("DSL のスキーマ（§10）", () => {
  it("入れ子は 3 段まで（いちばん外を 1 段目。if・switch・repeat の中に入るたびに 1 段増える）", () => {
    const nest = (n: number): Effect => (n === 0 ? { type: "heal", target: "self" } : { type: "if", cond: { turnCount: { gte: 1 } }, then: [nest(n - 1)] });
    expect(EffectList.safeParse([nest(2)]).success).toBe(true);
    expect(EffectList.safeParse([nest(3)]).success).toBe(false);
    const rep: Effect = { type: "if", cond: { turnCount: { gte: 1 } }, then: [{ type: "repeat", times: 2, effects: [{ type: "heal", target: "self" }] }] };
    expect(EffectList.safeParse([rep]).success).toBe(true);
    expect(EffectList.safeParse([{ type: "repeat", times: 1, effects: [rep] }]).success).toBe(false);
  });

  it("未知の部品やコードは受け付けない（§3-4）", () => {
    expect(EffectList.safeParse([{ type: "eval", code: "alert(1)" }]).success).toBe(false);
    expect(EffectList.safeParse([{ type: "damage", target: "enemy", category: "ability", extra: 1 }]).success).toBe(false);
  });

  it("changeCT は amount か setTo のどちらか一方、token は name か group のどちらか一方", () => {
    expect(EffectList.safeParse([{ type: "changeCT", target: "self", abilities: "all" }]).success).toBe(false);
    expect(EffectList.safeParse([{ type: "changeCT", target: "self", abilities: "all", amount: -1, setTo: 0 }]).success).toBe(false);
    expect(EffectList.safeParse([{ type: "if", cond: { token: { name: "a", group: "b", gte: 1 } }, then: [] }]).success).toBe(false);
  });
});

describe("省略形の展開（§6 recast、§10.2 useEffects）", () => {
  it("recast は if + changeCT(setTo 0) に展開される", () => {
    const when = { useCount: { ability: "self", scope: "turn" as const, lte: 2 } };
    expect(expandEffects([{ type: "recast", when }], undefined)).toEqual([
      { type: "if", cond: when, then: [{ type: "changeCT", target: "self", abilities: "self", setTo: 0 }] },
    ]);
  });

  it("useEffects は sharedEffects の中身に置き換わる。展開後に省略形は残らない", () => {
    for (const c of [eve, beethoven, shaitan, amon, artemis]) {
      const x = expandCharacter(c);
      for (const a of x.abilities) expect(hasShorthand(a.effects)).toBe(false);
      for (const a of x.assists ?? []) expect(hasShorthand(a.effects)).toBe(false);
    }
    const a2 = expandCharacter(beethoven).abilities.find((a) => a.id === "beethoven_a2")!;
    expect(a2.effects).toEqual(beethoven.sharedEffects!.scoreEffects);
  });

  it("展開前（省略形）と展開後（部品の組み合わせ）で同じ挙動になる", () => {
    const run = (effects: Effect[]) => {
      const c = plain("r", {
        abilities: [{ id: "r_a1", name: "r", color: "red", ct: 5, cost: [{ gauge: 20, when: { useCount: { ability: "self", scope: "turn", gte: 1 } } }], effects }],
      });
      const b = new Battle(makeInput({ front1: c }, { corrections: { r: { startGauge: 100 } } }));
      const ok = [1, 2, 3, 4].map(() => b.apply(use("r", "r_a1")).ok);
      return { ok, ct: b.state.chars.r!.ct.r_a1, gauge: b.state.chars.r!.gauge };
    };
    const when = { useCount: { ability: "self", scope: "turn" as const, lte: 2 } };
    const short = run([{ type: "recast", when }]);
    const long = run([{ type: "if", cond: when, then: [{ type: "changeCT", target: "self", abilities: "self", setTo: 0 }] }]);
    expect(short).toEqual(long);
    expect(short).toEqual({ ok: [true, true, true, false], ct: 5, gauge: 60 });
  });
});
