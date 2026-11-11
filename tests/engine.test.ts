import { describe, expect, it } from "vitest";
import { Battle, replay } from "../src/engine";
import { attack, endTurn, hold, makeInput, nextTurn, plain, redThunder, use } from "./helpers";
import type { Effect } from "../src/schema/dsl";

const gaugeAbility = (id: string, amount: number, target: "self" | "allAllies" = "self") => ({
  id,
  name: id,
  color: "blue" as const,
  ct: 0,
  effects: [{ type: "gaugeUp", target, amount } as Effect],
});

describe("ターン進行と CT（§5、§6）", () => {
  it("CT3 のアビを T1 に使用 → T4 に再使用可", () => {
    const a = plain("a", { abilities: [{ id: "x", name: "x", color: "red", ct: 3, effects: [] }] });
    const b = new Battle(makeInput({ front1: a }));
    expect(b.apply(use("a", "x")).ok).toBe(true);
    for (const op of endTurn()) b.apply(op); // T1 終了で 2
    expect(b.state.chars.a!.ct.x).toBe(2);
    for (const op of endTurn()) b.apply(op); // T2 終了で 1
    expect(b.apply(use("a", "x")).reasons).toContain("ct");
    for (const op of endTurn()) b.apply(op); // T3 終了で 0
    expect(b.state.turn).toBe(4);
    expect(b.apply(use("a", "x")).ok).toBe(true);
  });

  it("1 ターン上限・戦闘上限", () => {
    const a = plain("a", { abilities: [{ id: "x", name: "x", color: "red", ct: 0, limit: { perTurn: 2, perBattle: 3 }, effects: [] }] });
    const b = new Battle(makeInput({ front1: a }));
    expect(b.apply(use("a", "x")).ok).toBe(true);
    expect(b.apply(use("a", "x")).ok).toBe(true);
    expect(b.apply(use("a", "x")).reasons).toContain("perTurn");
    for (const op of endTurn()) b.apply(op);
    expect(b.apply(use("a", "x")).ok).toBe(true);
    expect(b.apply(use("a", "x")).reasons).toContain("perBattle");
  });

  it("攻撃前に次のターンへは進めない。攻撃後にアビは使えない", () => {
    const a = plain("a", { abilities: [{ id: "x", name: "x", color: "red", ct: 0, effects: [] }] });
    const b = new Battle(makeInput({ front1: a }));
    expect(b.apply(nextTurn).ok).toBe(false);
    b.apply(attack());
    expect(b.apply(use("a", "x")).reasons).toContain("phase");
    expect(b.state.warnings.some((w) => w.code === "opInvalid")).toBe(true);
  });
});

describe("バーストゲージ（§8）", () => {
  it("通常攻撃：10 × (1 + 上昇量アップ) × 連撃数", () => {
    const a = plain("a");
    const input = makeInput({ front1: a }, { corrections: { a: { gaugeRate: 50 } } });
    const b = new Battle(input);
    b.apply(attack({ a: 3 }));
    expect(b.state.chars.a!.gauge).toBe(45);
  });

  it("gaugeUp 効果にも受け手の上昇量アップが乗る", () => {
    const a = plain("a", { abilities: [gaugeAbility("g", 20)] });
    const b = new Battle(makeInput({ front1: a }, { corrections: { a: { gaugeRate: 50 } } }));
    b.apply(use("a", "g"));
    expect(b.state.chars.a!.gauge).toBe(30);
  });

  it("フルバースト：100・90・80・70・60 で全員がバーストする。連鎖 +10 は上昇量アップが乗らない", () => {
    const ids = ["h", "f1", "f2", "b1", "b2"];
    const chars = ids.map((id) => plain(id));
    const corrections = Object.fromEntries(ids.map((id, i) => [id, { startGauge: 100 - i * 10, gaugeRate: 100 }]));
    const b = new Battle(makeInput({ hero: chars[0], front1: chars[1], front2: chars[2], back1: chars[3], back2: chars[4] }, { corrections }));
    const r = b.apply(attack());
    expect(r.attackActions!.map((x) => x.kind)).toEqual(["burst", "burst", "burst", "burst", "burst"]);
    // バーストは通常攻撃の代わり（normalAttack イベントは出ない）
    expect(b.state.log.some((e) => e.type === "normalAttack")).toBe(false);
    const chainToB2 = b.state.log.filter((e) => e.type === "gaugeChanged" && e.means === "chain" && e.target === "b2");
    expect(chainToB2.map((e) => e.amount)).toEqual([10, 10, 10, 10]);
  });

  it("温存なら 100 以上でも通常攻撃", () => {
    const a = plain("a");
    const b = new Battle(makeInput({ front1: a }, { corrections: { a: { startGauge: 100 } } }));
    b.apply(hold);
    expect(b.apply(attack()).attackActions![0]!.kind).toBe("normal");
    expect(b.state.chars.a!.gauge).toBe(100);
  });

  it("subtract100 は余剰が残り、consumeAll は全消費する（上限 200）", () => {
    const s = plain("s", { gaugeMax: 200 });
    const c = plain("c", { gaugeMax: 200, burstConsume: "consumeAll" });
    const b = new Battle(makeInput({ front1: s, front2: c }, { corrections: { s: { startGauge: 180 }, c: { startGauge: 150 } } }));
    b.apply(attack());
    expect(b.state.chars.s!.gauge).toBe(80);
    expect(b.state.chars.c!.gauge).toBe(0);
    const ev = b.state.log.filter((e) => e.type === "burst");
    expect(ev.map((e) => e.gaugeConsumed)).toEqual([100, 160]); // c は s の連鎖 +10 で 160
  });

  it("gaugeGainBlocked：通常攻撃だけ止める", () => {
    const a = plain("a", {
      abilities: [gaugeAbility("g", 20)],
      assists: [
        {
          id: "demerit",
          trigger: { event: "battleStart" },
          effects: [{ type: "addStatus", target: "self", status: "gaugeGainBlocked", sources: ["normalAttack"], undispellable: true }],
        },
      ],
    });
    const b = new Battle(makeInput({ front1: a }));
    b.apply(attack());
    expect(b.state.chars.a!.gauge).toBe(0);
    b.apply(nextTurn);
    b.apply(use("a", "g"));
    expect(b.state.chars.a!.gauge).toBe(20);
  });
});

describe("アビ効果の攻撃（§10.2）", () => {
  it("performAttack(normal)：ゲージが上がり、通常攻撃として数え、その場ではバーストしない", () => {
    const a = plain("a", {
      abilities: [{ id: "pa", name: "pa", color: "red", ct: 0, effects: [{ type: "performAttack", attacker: "self", kind: "normal" }] }],
    });
    const b = new Battle(makeInput({ front1: a }, { corrections: { a: { startGauge: 95 } } }));
    b.apply(use("a", "pa"));
    expect(b.state.chars.a!.gauge).toBe(100);
    expect(b.state.log.filter((e) => e.type === "burst")).toHaveLength(0);
    expect(b.state.log.filter((e) => e.type === "normalAttack" && e.origin === "ability")).toHaveLength(1);
    expect(b.state.log.filter((e) => e.type === "damage" && e.category === "normal")).toHaveLength(1);
    expect(b.state.log.filter((e) => e.type === "damage" && e.category === "ability")).toHaveLength(0);
    // 攻撃フェーズで改めてバースト
    expect(b.apply(attack()).attackActions![0]!.kind).toBe("burst");
  });

  it("即時バースト：ゲージは 0（keep なら残る）、連鎖は起きない", () => {
    const a = plain("a", {
      abilities: [{ id: "ib", name: "ib", color: "red", ct: 0, effects: [{ type: "performAttack", attacker: "self", kind: "burst" }] }],
    });
    const k = plain("k", {
      abilities: [{ id: "kb", name: "kb", color: "red", ct: 0, effects: [{ type: "performAttack", attacker: "self", kind: "burst", gaugeAfter: "keep" }] }],
    });
    const c = plain("c");
    const b = new Battle(makeInput({ front1: a, front2: k, back1: c }, { corrections: { a: { startGauge: 100 }, k: { startGauge: 100 } } }));
    b.apply(use("a", "ib"));
    b.apply(use("k", "kb"));
    expect(b.state.chars.a!.gauge).toBe(0);
    expect(b.state.chars.k!.gauge).toBe(100);
    expect(b.state.chars.c!.gauge).toBe(0);
    expect(b.state.log.filter((e) => e.type === "burst").map((e) => e.origin)).toEqual(["ability", "ability"]);
  });

  it("回数制バフはアビの通常攻撃で消費され、警告が出る（仮置き）", () => {
    const a = plain("a", {
      abilities: [
        { id: "buff", name: "buff", color: "red", ct: 0, effects: [{ type: "addBuff", target: "self", buff: "次の攻撃UP", slot: "atkUp", amount: 50, duration: { count: 1 } }] },
        { id: "pa", name: "pa", color: "red", ct: 0, effects: [{ type: "performAttack", attacker: "self", kind: "normal" }] },
      ],
    });
    const b = new Battle(makeInput({ front1: a }));
    b.apply(use("a", "buff"));
    expect(b.state.chars.a!.buffs).toHaveLength(1);
    b.apply(use("a", "pa"));
    expect(b.state.chars.a!.buffs).toHaveLength(0);
    expect(b.state.warnings.some((w) => w.code === "countBuffNotKept")).toBe(true);
  });
});

describe("条件の評価時点（§4.7）", () => {
  it("10 ヒットのアビで「5 回ごと」のアシストは 5 件目と 10 件目でだけ発動する", () => {
    const a = plain("a", {
      abilities: [{ id: "multi", name: "multi", color: "red", ct: 0, effects: [{ type: "damage", target: "enemy", category: "ability", hits: 10 }] }],
      assists: [
        {
          id: "every5",
          trigger: { event: "damage", filter: { category: "ability" } },
          cond: { count: { event: "damage", filter: { category: "ability" }, scope: "turn", multipleOf: 5 } },
          effects: [{ type: "gaugeUp", target: "self", amount: 1 }],
        },
      ],
    });
    const b = new Battle(makeInput({ front1: a }));
    b.apply(use("a", "multi"));
    expect(b.state.log.filter((e) => e.type === "assistTriggered")).toHaveLength(2);
    expect(b.state.log.filter((e) => e.type === "abilityUsed")).toHaveLength(1);
  });

  it("アシストの判定はアビの効果をすべて処理した後（afterAbility）", () => {
    const a = plain("a", {
      abilities: [
        {
          id: "x",
          name: "x",
          color: "red",
          ct: 0,
          effects: [
            { type: "damage", target: "enemy", category: "ability" },
            { type: "gaugeUp", target: "self", amount: 50 },
          ],
        },
      ],
      assists: [{ id: "chk", trigger: { event: "damage" }, cond: { gauge: { gte: 50 } }, effects: [{ type: "addToken", name: "t", amount: 1 }] }],
      tokens: [{ name: "t" }],
    });
    const after = new Battle(makeInput({ front1: a }));
    after.apply(use("a", "x"));
    expect(after.state.chars.a!.tokens.t).toBe(1);
    const per = new Battle(makeInput({ front1: a }, { settings: { assistTiming: "perEffect" } }));
    per.apply(use("a", "x"));
    expect(per.state.chars.a!.tokens.t).toBe(0);
  });
});

describe("アシストの処理順（§6.1）", () => {
  // 英霊 A：ゲージ 100 以上ならトークン。メイン 3 の B：英霊のゲージ +100
  const heroA = plain("ha", {
    kind: "hero",
    tokens: [{ name: "t" }],
    assists: [{ id: "A", trigger: { event: "turnStart" }, cond: { gauge: { gte: 100 } }, effects: [{ type: "addToken", name: "t", amount: 1 }] }],
  });
  const mainB = plain("mb", {
    assists: [{ id: "B", trigger: { event: "turnStart" }, effects: [{ type: "gaugeUp", target: { alliesWhere: { position: "hero" } }, amount: 100 }] }],
  });

  it("assistReentry: true なら、後ろのアシストで条件を満たした前のアシストが同じタイミングで発動する", () => {
    const b = new Battle(makeInput({ hero: heroA, back1: mainB }));
    expect(b.state.chars.ha!.tokens.t).toBe(1);
    const order = b.state.log.filter((e) => e.type === "assistTriggered").map((e) => e.assist);
    expect(order).toEqual(["B", "A"]);
  });

  it("assistReentry: false なら戻らない", () => {
    const b = new Battle(makeInput({ hero: heroA, back1: mainB }, { settings: { assistReentry: false } }));
    expect(b.state.chars.ha!.tokens.t).toBe(0);
  });

  it("編成順 → アシストの並び順で処理する", () => {
    const x = plain("x", {
      assists: [
        { id: "x1", trigger: { event: "turnStart" }, effects: [] },
        { id: "x2", trigger: { event: "turnStart" }, effects: [] },
      ],
    });
    const y = plain("y", { assists: [{ id: "y1", trigger: { event: "turnStart" }, effects: [] }] });
    const b = new Battle(makeInput({ front1: y, back2: x }));
    expect(b.state.log.filter((e) => e.type === "assistTriggered").map((e) => e.assist)).toEqual(["y1", "x1", "x2"]);
  });

  it("queue：アシストが生んだイベントは後回し。interrupt：その場で処理", () => {
    // P：turnStart でダメージ。Q：turnStart で何もしない。R：ダメージで発動
    const p = plain("p", { assists: [{ id: "P", trigger: { event: "turnStart" }, effects: [{ type: "damage", target: "enemy", category: "ability" }] }] });
    const q = plain("q", {
      assists: [
        { id: "Q", trigger: { event: "turnStart" }, effects: [] },
        { id: "R", trigger: { event: "damage" }, effects: [] },
      ],
    });
    const queue = new Battle(makeInput({ front1: p, front2: q }));
    expect(queue.state.log.filter((e) => e.type === "assistTriggered").map((e) => e.assist)).toEqual(["P", "Q", "R"]);
    const intr = new Battle(makeInput({ front1: p, front2: q }, { settings: { assistEventOrder: "interrupt" } }));
    expect(intr.state.log.filter((e) => e.type === "assistTriggered").map((e) => e.assist)).toEqual(["P", "R", "Q"]);
  });

  it("止まらない連鎖はステップ上限で止めて警告する（§3-8）", () => {
    const loop = plain("l", {
      assists: [
        { id: "L1", trigger: { event: "damage", filter: { category: "ability" } }, effects: [{ type: "damage", target: "enemy", category: "normal" }] },
        { id: "L2", trigger: { event: "damage", filter: { category: "normal" } }, effects: [{ type: "damage", target: "enemy", category: "ability" }] },
      ],
      abilities: [{ id: "x", name: "x", color: "red", ct: 0, effects: [{ type: "damage", target: "enemy", category: "ability" }] }],
    });
    const b = new Battle(makeInput({ front1: loop }));
    const r = b.apply(use("l", "x"));
    expect(r.ok).toBe(false);
    expect(b.state.warnings.some((w) => w.code === "stepLimit")).toBe(true);
  });
});

describe("バフ・デバフ（§7）", () => {
  const buffer = (id: string, amount: number | null, turns: number, slot = "atkUp") => ({
    id,
    name: id,
    color: "green" as const,
    ct: 0,
    effects: [{ type: "addBuff", target: "self", buff: `攻撃UP${amount}`, slot, amount, duration: { turns } } as Effect],
  });
  const a = plain("a", { abilities: [buffer("b30", 30, 3), buffer("b20", 20, 3), buffer("b30s", 30, 1), buffer("bnull", null, 2), buffer("gr", 50, 2, "test_gaugeRateUp")] });

  it("小さい効果は MISS で既存の持続も更新しない", () => {
    const b = new Battle(makeInput({ front1: a }));
    b.apply(use("a", "b30"));
    b.apply(use("a", "b20"));
    expect(b.state.chars.a!.buffs).toHaveLength(1);
    expect(b.state.chars.a!.buffs[0]!.amount).toBe(30);
    expect(b.state.log.some((e) => e.type === "buffMissed")).toBe(true);
    expect(b.state.warnings.some((w) => w.code === "buffMissed")).toBe(true);
  });

  it("同じ効果量なら上書きされ、持続が短くなったら警告", () => {
    const b = new Battle(makeInput({ front1: a }));
    b.apply(use("a", "b30"));
    b.apply(use("a", "b30s"));
    expect(b.state.chars.a!.buffs[0]!.duration).toEqual({ type: "turns", remaining: 1 });
    expect(b.state.warnings.some((w) => w.code === "buffShortened")).toBe(true);
  });

  it("効果量が不明なら判定できない旨を警告する", () => {
    const b = new Battle(makeInput({ front1: a }));
    b.apply(use("a", "b30"));
    b.apply(use("a", "bnull"));
    expect(b.state.warnings.some((w) => w.code === "amountUnknown")).toBe(true);
  });

  it("ターン制は行動中に付与したらそのターン終了で 1 減る。敵フェーズ中に付与したものは減らさない", () => {
    const b = new Battle(makeInput({ front1: a }));
    b.apply(use("a", "b30s"));
    b.apply(attack());
    b.apply({
      type: "enemyPhase",
      events: [{ type: "effect", subject: "a", effect: { type: "addDebuff", target: "self", buff: "攻撃DOWN", slot: "atkDownA", amount: 20, duration: { turns: 1 } } }],
    });
    b.apply(nextTurn);
    expect(b.state.chars.a!.buffs.map((x) => x.name)).toEqual(["攻撃DOWN"]);
    for (const op of endTurn()) b.apply(op);
    expect(b.state.chars.a!.buffs).toHaveLength(0);
  });

  it("ゲージ上昇量アップのバフは通常攻撃に乗る", () => {
    const b = new Battle(makeInput({ front1: a }));
    b.apply(use("a", "gr"));
    b.apply(attack());
    expect(b.state.chars.a!.gauge).toBe(15);
  });

  it("デバフの合計下限に達していたら効果なしを警告する", () => {
    const deb = (slot: string, amount: number): Effect => ({ type: "addDebuff", target: "enemy", buff: slot, slot, amount, duration: { turns: 3 } });
    const d = plain("d", { abilities: [{ id: "x", name: "x", color: "purple", ct: 0, effects: [deb("atkDownA", 30), deb("atkDownB", 20), deb("atkDownC", 10)] }] });
    const b = new Battle(makeInput({ front1: d }));
    b.apply(use("d", "x"));
    expect(b.state.enemy.buffs).toHaveLength(3);
    expect(b.state.warnings.filter((w) => w.code === "debuffFloor")).toHaveLength(1);
  });
});

describe("交代と補充（§4.4）", () => {
  const swapper = plain("s", { abilities: [{ id: "sw", name: "交代", color: "blue", ct: 0, effects: [{ type: "swapWithSub", target: "self" }] }] });

  it("交代アビ：即時にサブ 1 とスワップし、入ったキャラは同じターンに行動できる", () => {
    const sub1 = plain("u1", { abilities: [{ id: "u", name: "u", color: "red", ct: 0, effects: [] }] });
    const sub2 = plain("u2");
    const b = new Battle(makeInput({ front1: swapper, sub1, sub2 }));
    b.apply(use("s", "sw"));
    expect(b.state.formation.slice(0, 2)).toEqual([null, "u1"]);
    expect(b.state.formation.slice(5)).toEqual(["s", "u2"]);
    expect(b.apply(use("u1", "u")).ok).toBe(true);
    const r = b.apply(attack());
    expect(r.attackActions!.map((x) => x.charId)).toEqual(["u1"]);
  });

  it("戦闘不能はターンエンドで補充。枠の並び順でサブ 1 → サブ 2", () => {
    const m = ["m1", "m2", "m3", "m4"].map((id) => plain(id));
    const b = new Battle(makeInput({ front1: m[0], front2: m[1], back1: m[2], back2: m[3], sub1: plain("u1"), sub2: plain("u2") }));
    b.apply(attack());
    b.apply({ type: "enemyPhase", events: [{ type: "knockedOut", target: "m4" }, { type: "knockedOut", target: "m2" }] });
    expect(b.state.formation[2]).toBe("m2"); // まだ補充されない
    b.apply(nextTurn);
    expect(b.state.formation).toEqual([null, "m1", "u1", "m3", "u2", null, null]);
    expect(b.state.log.filter((e) => e.type === "enterBattle").map((e) => e.via)).toEqual(["replenish", "replenish"]);
  });

  it("サブ待機中は CT が進まない", () => {
    const s = plain("s", {
      abilities: [
        { id: "sw", name: "交代", color: "blue", ct: 0, effects: [{ type: "swapWithSub", target: "self" }] },
        { id: "big", name: "big", color: "red", ct: 5, effects: [] },
      ],
    });
    const u = plain("u", { abilities: [{ id: "back", name: "back", color: "blue", ct: 0, effects: [{ type: "swapWithSub", target: "self" }] }] });
    const b = new Battle(makeInput({ front1: s, sub1: u }));
    b.apply(use("s", "big"));
    b.apply(use("s", "sw"));
    for (const op of endTurn()) b.apply(op);
    for (const op of endTurn()) b.apply(op);
    expect(b.state.chars.s!.ct.big).toBe(5);
    b.apply(use("u", "back"));
    expect(b.state.formation[1]).toBe("s");
    for (const op of endTurn()) b.apply(op);
    expect(b.state.chars.s!.ct.big).toBe(4);
  });
});

describe("再生（§4.10）", () => {
  it("replay は操作ごとの状態を返し、使えない操作も記録は残す", () => {
    const a = redThunder("a");
    const r = replay(makeInput({ front1: a }), [use("a", "a_red"), use("a", "nope"), attack(), nextTurn]);
    expect(r.steps.map((s) => s.result.ok)).toEqual([true, false, true, true]);
    expect(r.steps[3]!.state.turn).toBe(2);
    expect(r.initial.turn).toBe(1);
  });
});
