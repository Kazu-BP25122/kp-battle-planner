/**
 * 効果 DSL の部品の単体テスト（§10、DSL_PARTS.md）。架空キャラはエンジンの単体テスト専用（§15.2）。
 */
import { describe, expect, it } from "vitest";
import { Battle } from "../src/engine";
import type { Effect } from "../src/schema/dsl";
import { attack, makeInput, nextTurn, plain, use } from "./helpers";

const ab = (id: string, effects: Effect[], extra: Record<string, unknown> = {}) => ({ id, name: id, color: "red" as const, ct: 0, effects, ...extra });
const endTurn = (b: Battle) => {
  b.apply(attack());
  b.apply(nextTurn);
};

describe("条件の評価時点（§4.7）", () => {
  it("10 ヒットのアビで「5 回ごと」のアシストは 5 件目と 10 件目でだけ発動する", () => {
    const c = plain("c", {
      tokens: [{ name: "t" }],
      abilities: [ab("hit10", [{ type: "damage", target: "enemy", category: "ability", hits: 10 }])],
      assists: [
        {
          id: "every5",
          trigger: { event: "damage" },
          cond: { count: { event: "damage", filter: { category: "ability" }, scope: "turn", multipleOf: 5 } },
          effects: [{ type: "addToken", target: "self", name: "t", amount: 1 }],
        },
      ],
    });
    const b = new Battle(makeInput({ front1: c }));
    b.apply(use("c", "hit10"));
    expect(b.state.chars.c!.tokens.t).toBe(2);
  });

  it("count の sum は件数ではなく amount の合計を数える", () => {
    const c = plain("c", {
      tokens: [{ name: "t", initial: 20 }, { name: "u" }],
      abilities: [ab("eat", [{ type: "consumeToken", target: "self", name: "t", amount: 7 }])],
      assists: [
        {
          id: "sum",
          trigger: { event: "tokenConsumed", filter: { token: "t", source: "self" } },
          cond: { count: { event: "tokenConsumed", filter: { token: "t" }, scope: "battle", sum: "amount", gte: 14 } },
          effects: [{ type: "addToken", target: "self", name: "u", amount: 1 }],
        },
      ],
    });
    const b = new Battle(makeInput({ front1: c }));
    b.apply(use("c", "eat"));
    expect(b.state.chars.c!.tokens.u).toBe(0);
    b.apply(use("c", "eat"));
    expect(b.state.chars.c!.tokens.u).toBe(1);
  });
});

describe("トークン（§4.2）", () => {
  it("種類の上限・グループの上限を超えた分は破棄。グループ全体を all で消費", () => {
    const c = plain("c", {
      tokenGroups: [{ name: "g", max: 4 }],
      tokens: [
        { name: "x", group: "g", max: 3 },
        { name: "y", group: "g" },
      ],
      abilities: [
        ab("addX", [{ type: "addToken", target: "self", name: "x", amount: 5 }]),
        ab("addY", [{ type: "addToken", target: "self", name: "y", amount: 5 }]),
        ab("clear", [{ type: "consumeToken", target: "self", group: "g", amount: "all" }]),
      ],
    });
    const b = new Battle(makeInput({ front1: c }));
    b.apply(use("c", "addX"));
    b.apply(use("c", "addY"));
    expect(b.state.chars.c!.tokens).toEqual({ x: 3, y: 1 });
    expect(b.state.log.filter((e) => e.type === "tokenAdded").map((e) => e.amount)).toEqual([3, 1]);
    b.apply(use("c", "clear"));
    expect(b.state.chars.c!.tokens).toEqual({ x: 0, y: 0 });
    expect(b.state.log.filter((e) => e.type === "tokenConsumed").map((e) => [e.token, e.amount])).toEqual([
      ["x", 3],
      ["y", 1],
    ]);
  });

  it("トークンのコスト：足りなければ使えない", () => {
    const c = plain("c", { tokens: [{ name: "t", initial: 1 }], abilities: [ab("x", [], { cost: [{ token: { name: "t", amount: 2 } }] })] });
    const b = new Battle(makeInput({ front1: c }));
    expect(b.apply(use("c", "x")).reasons).toContain("cost");
  });
});

describe("累積型のバフ（§7.1）", () => {
  const stackBuff = (max: number | null | "unknown", duration: "perStack" | "refresh" | "unknown", turns: number): Effect => ({
    type: "addBuff",
    target: "self",
    buff: "累積",
    slot: "atkUp",
    amount: 10,
    duration: { turns },
    stack: { max, duration },
  });

  it("上限に達したら累積数は増えない（警告）", () => {
    const c = plain("c", { abilities: [ab("s", [stackBuff(2, "perStack", 3)])] });
    const b = new Battle(makeInput({ front1: c }));
    for (let i = 0; i < 3; i++) b.apply(use("c", "s"));
    expect(b.state.chars.c!.buffs).toHaveLength(2);
    expect(b.state.warnings.some((w) => w.code === "stackMax")).toBe(true);
  });

  it("refresh は重ねるたびに全体の持続を更新する。unknown は perStack として扱い警告する", () => {
    const r = plain("r", { abilities: [ab("s", [stackBuff(null, "refresh", 2)])] });
    const b = new Battle(makeInput({ front1: r }));
    b.apply(use("r", "s"));
    endTurn(b);
    b.apply(use("r", "s"));
    expect(b.state.chars.r!.buffs.map((x) => x.duration)).toEqual([
      { type: "turns", remaining: 2 },
      { type: "turns", remaining: 2 },
    ]);
    const u = plain("u", { abilities: [ab("s", [stackBuff("unknown", "unknown", 2)])] });
    const b2 = new Battle(makeInput({ front1: u }));
    b2.apply(use("u", "s"));
    b2.apply(use("u", "s"));
    expect(b2.state.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["stackDurationUnknown", "stackMax"]));
  });

  it("hasBuff の stacks で累積数を比べる", () => {
    const c = plain("c", {
      tokens: [{ name: "ok" }],
      abilities: [
        ab("s", [stackBuff(null, "perStack", 3)]),
        ab("chk", [{ type: "if", cond: { hasBuff: { target: "self", buff: "累積", stacks: { gte: 3 } } }, then: [{ type: "addToken", target: "self", name: "ok", amount: 1 }] }]),
      ],
    });
    const b = new Battle(makeInput({ front1: c }));
    b.apply(use("c", "s"));
    b.apply(use("c", "s"));
    b.apply(use("c", "chk"));
    expect(b.state.chars.c!.tokens.ok).toBe(0);
    b.apply(use("c", "s"));
    b.apply(use("c", "chk"));
    expect(b.state.chars.c!.tokens.ok).toBe(1);
  });
});

describe("状態・持続", () => {
  it("removeStatus・hasStatus、持続不明（turns: null）は永続として扱い警告する", () => {
    const c = plain("c", {
      abilities: [
        ab("on", [{ type: "addStatus", target: "self", status: "S", duration: { turns: null } }]),
        ab("off", [{ type: "removeStatus", target: "self", status: "S" }], { usable: { hasStatus: { target: "self", status: "S" } } }),
      ],
    });
    const b = new Battle(makeInput({ front1: c }));
    expect(b.apply(use("c", "off")).reasons).toContain("cond");
    b.apply(use("c", "on"));
    expect(b.state.warnings.some((w) => w.code === "durationUnknown")).toBe(true);
    endTurn(b);
    expect(b.state.chars.c!.buffs.map((x) => x.name)).toEqual(["S"]);
    b.apply(use("c", "off"));
    expect(b.state.chars.c!.buffs).toEqual([]);
  });

  it("消去不可（undispellable）は removeDebuff で消えず、交代で下がっても残る", () => {
    const c = plain("c", {
      abilities: [
        ab("deb", [
          { type: "addDebuff", target: "self", buff: "呪い", slot: "dmgDealtDown", amount: 1, duration: { turns: 5 }, undispellable: true },
          { type: "addBuff", target: "self", buff: "攻撃UP", slot: "atkUp", amount: 1, duration: { turns: 5 } },
        ]),
        ab("cure", [{ type: "removeDebuff", target: "self", count: "all" }]),
        ab("swap", [{ type: "swapWithSub", target: "self" }]),
      ],
    });
    const b = new Battle(makeInput({ front1: c, sub1: plain("s") }));
    b.apply(use("c", "deb"));
    b.apply(use("c", "cure"));
    expect(b.state.chars.c!.buffs.map((x) => x.name).sort()).toEqual(["呪い", "攻撃UP"].sort());
    b.apply(use("c", "swap"));
    // TODO(spec): §4.4 交代時のバフは「原則解除、消去不可は保持」で仮置き
    expect(b.state.chars.c!.buffs.map((x) => x.name)).toEqual(["呪い"]);
  });
});

describe("条件の部品", () => {
  it("option：ユーザーが選んだオプション。未選択なら default", () => {
    const c = plain("c", {
      options: [{ id: "w", name: "専用武器", type: "boolean", default: false }],
      abilities: [ab("g", [{ type: "if", cond: { option: { id: "w", is: true } }, then: [{ type: "gaugeUp", target: "self", amount: 15 }], else: [{ type: "gaugeUp", target: "self", amount: 10 }] }])],
    });
    const b0 = new Battle(makeInput({ front1: c }));
    b0.apply(use("c", "g"));
    expect(b0.state.chars.c!.gauge).toBe(10);
    const b1 = new Battle(makeInput({ front1: c }, { corrections: { c: { options: { w: true } } } }));
    b1.apply(use("c", "g"));
    expect(b1.state.chars.c!.gauge).toBe(15);
  });

  it("trigger：アシストを発動させたイベントの項目。source: others は自分以外", () => {
    const c = plain("c", {
      tokens: [{ name: "red" }, { name: "other" }],
      abilities: [ab("mine", [])],
      assists: [
        {
          id: "t",
          trigger: { event: "abilityUsed", filter: { source: "others" } },
          effects: [
            { type: "if", cond: { trigger: { color: "red" } }, then: [{ type: "addToken", target: "self", name: "red", amount: 1 }], else: [{ type: "addToken", target: "self", name: "other", amount: 1 }] },
          ],
        },
      ],
    });
    const d = plain("d", { abilities: [ab("r", []), { ...ab("y", []), color: "yellow" as const }] });
    const b = new Battle(makeInput({ front1: c, front2: d }));
    b.apply(use("c", "mine"));
    b.apply(use("d", "r"));
    b.apply(use("d", "y"));
    expect(b.state.chars.c!.tokens).toEqual({ red: 1, other: 1 });
  });

  it("gaugeUp の量は省略時 +20。fixed なら上昇量アップを乗せない", () => {
    const c = plain("c", {
      abilities: [ab("g", [{ type: "gaugeUp", target: "self" }]), ab("f", [{ type: "gaugeUp", target: "self", amount: 10, fixed: true }])],
    });
    const b = new Battle(makeInput({ front1: c }, { corrections: { c: { gaugeRate: 50 } } }));
    b.apply(use("c", "g"));
    expect(b.state.chars.c!.gauge).toBe(30);
    b.apply(use("c", "f"));
    expect(b.state.chars.c!.gauge).toBe(40);
  });

  it("数値の部品：mul → add → min / max。changeCT の amount、repeat の times", () => {
    const c = plain("c", {
      tokens: [{ name: "t", initial: 3 }, { name: "n" }],
      abilities: [
        ab("long", [], { ct: 9 }),
        ab("cut", [
          { type: "changeCT", target: "self", abilities: ["long"], amount: { token: { name: "t" }, mul: -2, add: 1 } },
          { type: "repeat", times: { token: { name: "t" }, max: 2 }, effects: [{ type: "addToken", target: "self", name: "n", amount: 1 }] },
        ]),
      ],
    });
    const b = new Battle(makeInput({ front1: c }));
    b.apply(use("c", "long"));
    b.apply(use("c", "cut"));
    expect(b.state.chars.c!.ct.long).toBe(4); // 9 + (3 × -2 + 1)
    expect(b.state.chars.c!.tokens.n).toBe(2);
  });

  it("バーストの効果が未設定なら自属性ダメージ 1 ヒットとして扱い、警告する（§4.9）", () => {
    const c = plain("c", { burst: {} });
    const b = new Battle(makeInput({ front1: c }, { corrections: { c: { startGauge: 100 } } }));
    b.apply(attack());
    expect(b.state.log.filter((e) => e.type === "damage" && e.category === "burst")).toHaveLength(1);
    expect(b.state.warnings.some((w) => w.code === "burstUnset")).toBe(true);
  });

  it("ユーザー定義のバースト（英霊・userDefined）はユーザー補正の効果で上書きする", () => {
    const h = plain("h", { kind: "hero", burst: { userDefined: true, effects: [{ type: "damage", target: "allEnemies", category: "burst" }] } });
    const b = new Battle(
      makeInput({ hero: h }, { corrections: { h: { startGauge: 100, burst: [{ type: "damage", target: "allEnemies", category: "burst", hits: 3 }] } } }),
    );
    b.apply(attack());
    expect(b.state.log.filter((e) => e.type === "damage" && e.category === "burst")).toHaveLength(3);
  });
});
