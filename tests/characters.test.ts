/**
 * §16.1-8 初期リリースの 5 体のうち、ベートーヴェン・シャイターン・アモン・アルテミスの「主に確かめる仕組み」（§15.2）。
 * イヴは tests/eve.test.ts。定義は src/content/characters/、資料は CHARACTER.md。
 */
import { describe, expect, it } from "vitest";
import { Battle } from "../src/engine";
import type { BattleEvent } from "../src/engine";
import { amon, artemis, attack, beethoven, eve, makeInput, nextTurn, plain, shaitan, times, use } from "./helpers";
import type { Character } from "../src/schema/character";

/** 赤・黄・青・緑の CT 0 のアビを持つ雷属性の架空キャラ（旋律・カウンター用。エンジンの単体テスト専用） */
const m = plain("m", {
  abilities: (["red", "yellow", "blue", "green"] as const).map((color) => ({
    id: `m_${color}`,
    name: color,
    color,
    ct: 0,
    effects: [],
  })),
});

const evs = (b: Battle, type: string, f: (e: BattleEvent) => boolean = () => true) => b.state.log.filter((e) => e.type === type && f(e));
const assistCount = (b: Battle, id: string, turn?: number) => evs(b, "assistTriggered", (e) => e.assist === id && (turn === undefined || e.turn === turn)).length;
const endTurn = (b: Battle) => {
  b.apply(attack());
  b.apply(nextTurn);
};
const tok = (b: Battle, id: string) => b.state.chars[id]!.tokens;
const noDataErrors = (b: Battle) => expect(b.state.warnings.filter((w) => ["dataError", "customMissing", "stepLimit", "unknownSlot"].includes(w.code))).toEqual([]);

// ---------------------------------------------------------------- ベートーヴェン

describe("ベートーヴェン", () => {
  const setup = (opts: { exclusiveWeapon?: boolean; party?: Partial<Record<"front2" | "back1", Character>> } = {}) =>
    new Battle(
      makeInput(
        { hero: beethoven, front1: m, ...opts.party },
        opts.exclusiveWeapon !== undefined ? { corrections: { beethoven: { options: { exclusiveWeapon: opts.exclusiveWeapon } } } } : {},
      ),
    );

  it("アシスト 1：自分以外の雷属性キャラが使用したアビの色で旋律。合計 3 つまで、超えた分は破棄して警告", () => {
    const b = setup();
    b.apply(use("m", "m_red"));
    b.apply(use("m", "m_yellow"));
    b.apply(use("m", "m_blue"));
    expect(tok(b, "beethoven")).toMatchObject({ 紅の旋律: 1, 黄の旋律: 1, 蒼の旋律: 1 });
    b.apply(use("m", "m_green"));
    expect(tok(b, "beethoven").翠の旋律).toBe(0);
    expect(b.state.warnings.some((w) => w.code === "tokenOverflow")).toBe(true);
    // 破棄された分は tokenAdded に記録しない
    expect(evs(b, "tokenAdded", (e) => e.token === "翠の旋律")).toHaveLength(0);
    noDataErrors(b);
  });

  it("アシスト 1：効果で発動したアビ（イヴのバーストのアビ 1）では旋律は入らない", () => {
    const b = new Battle(makeInput({ hero: beethoven, front1: eve }, { corrections: { eve: { startGauge: 100 } } }));
    b.apply(attack());
    expect(evs(b, "abilityActivated", (e) => e.ability === "eve_a1")).toHaveLength(1);
    expect(tok(b, "beethoven").紅の旋律).toBe(0);
  });

  it("アビ 1：旋律 3 つが条件。紅×3 → 紅の譜面＋敵ランダムに 5 回。全部違う → 含まれない色の譜面。それ以外 → 異常耐性 UP", () => {
    const b = setup();
    expect(b.apply(use("beethoven", "beethoven_a1")).reasons).toContain("cond");
    for (const op of times(3, use("m", "m_red"))) b.apply(op);
    const from = b.state.log.length;
    expect(b.apply(use("beethoven", "beethoven_a1")).ok).toBe(true);
    expect(b.state.log.slice(from).filter((e) => e.type === "damage")).toHaveLength(5);
    expect(tok(b, "beethoven")).toMatchObject({ 紅の旋律: 0, 紅の譜面: 1 });
    // 黄/蒼/翠 → 紅の譜面 + 敵全体に 2 回
    for (const c of ["m_yellow", "m_blue", "m_green"]) b.apply(use("m", c));
    b.apply(use("beethoven", "beethoven_a1"));
    expect(tok(b, "beethoven").紅の譜面).toBe(2);
    // 紅/紅/黄 → それ以外：旋律は消去、譜面は作らない
    for (const c of ["m_red", "m_red", "m_yellow"]) b.apply(use("m", c));
    b.apply(use("beethoven", "beethoven_a1"));
    expect(tok(b, "beethoven")).toMatchObject({ 紅の旋律: 0, 黄の旋律: 0, 紅の譜面: 2 });
    expect(b.state.chars.m!.buffs.map((x) => x.name)).toContain("異常耐性UP");
  });

  it("アビ 1：譜面は 1 色 5 個まで。破棄されても追加効果は発動する", () => {
    const b = setup();
    for (let i = 0; i < 6; i++) {
      for (const op of times(3, use("m", "m_red"))) b.apply(op);
      const from = b.state.log.length;
      b.apply(use("beethoven", "beethoven_a1"));
      expect(b.state.log.slice(from).filter((e) => e.type === "damage")).toHaveLength(5);
    }
    expect(tok(b, "beethoven").紅の譜面).toBe(5);
  });

  it("アビ 4（EX）：戦闘を通した発動順に紅 → 黄 → 蒼 → 翠 → 紅", () => {
    const b = setup();
    const got: string[] = [];
    for (let i = 0; i < 5; i++) {
      const from = b.state.log.length;
      b.state.chars.beethoven!.ct.beethoven_a4 = 0; // CT 2 を待たずに確かめる
      b.apply(use("beethoven", "beethoven_a4"));
      got.push(b.state.log.slice(from).find((e) => e.type === "tokenAdded")!.token!);
    }
    expect(got).toEqual(["紅の譜面", "黄の譜面", "蒼の譜面", "翠の譜面", "紅の譜面"]);
  });

  it("アビ 3：譜面の色と数だけ、自分以外の味方のその色のアビの CT を減らす。1 ターン 1 回まで", () => {
    const b = new Battle(makeInput({ hero: beethoven, front1: eve, front2: m }));
    b.apply(use("eve", "eve_a3")); // 黄 CT 2（m の黄で旋律が入るのを避けるため、イヴで CT を作る）
    b.state.chars.beethoven!.tokens.黄の譜面 = 1;
    b.state.chars.eve!.ct.eve_a2 = 5;
    b.state.chars.beethoven!.tokens.紅の譜面 = 3;
    b.apply(use("beethoven", "beethoven_a3"));
    expect(b.state.chars.eve!.ct.eve_a2).toBe(2);
    expect(b.state.chars.eve!.ct.eve_a3).toBe(1);
    expect(b.state.chars.beethoven!.ct.beethoven_a3).toBe(8); // 自分は減らない
    b.state.chars.beethoven!.ct.beethoven_a3 = 0;
    expect(b.apply(use("beethoven", "beethoven_a3")).reasons).toContain("perTurn");
    // 譜面は消費しない
    expect(tok(b, "beethoven").紅の譜面).toBe(3);
  });

  it("アシスト 2：ターン終了時、黄の譜面 2 つ以上でゲージ UP を譜面の数だけ（専用武器で +15）。その後、譜面と旋律をすべて消去", () => {
    for (const [weapon, per] of [[false, 10], [true, 15]] as const) {
      const b = setup({ exclusiveWeapon: weapon });
      b.state.chars.beethoven!.tokens.黄の譜面 = 2;
      b.apply(use("m", "m_red")); // 旋律 1 つ
      b.apply({ type: "setBurst", mode: "hold" });
      b.apply(attack()); // 通常攻撃で +10
      const g = b.state.chars.m!.gauge;
      b.apply(nextTurn);
      expect(b.state.chars.m!.gauge - g).toBe(per * 2);
      expect(tok(b, "beethoven")).toMatchObject({ 黄の譜面: 0, 紅の旋律: 0 });
    }
  });

  it("専用武器は選ばなければ「あり」とみなす（既定 true。黄の譜面のゲージ UP は 1 回 +15）", () => {
    const b = setup();
    b.state.chars.beethoven!.tokens.黄の譜面 = 2;
    b.apply({ type: "setBurst", mode: "hold" });
    b.apply(attack());
    const g = b.state.chars.m!.gauge;
    b.apply(nextTurn);
    expect(b.state.chars.m!.gauge - g).toBe(30);
  });

  it("アシスト 2：色の処理順は蒼 → 黄 → 翠 → 紅", () => {
    const b = setup();
    Object.assign(b.state.chars.beethoven!.tokens, { 紅の譜面: 1, 黄の譜面: 1, 蒼の譜面: 1, 翠の譜面: 1 });
    const from = b.state.log.length;
    endTurn(b);
    const seq = b.state.log
      .slice(from)
      .filter((e) => e.assist === "beethoven_assist2" && ["buffApplied", "heal", "damage"].includes(e.type))
      .map((e) => (e.type === "buffApplied" ? e.buff : e.type));
    expect(seq.indexOf("攻撃DOWN")).toBeLessThan(seq.indexOf("攻撃UP"));
    expect(seq.indexOf("攻撃UP")).toBeLessThan(seq.indexOf("heal"));
    expect(seq.indexOf("heal")).toBeLessThan(seq.indexOf("damage"));
    // 紅の譜面 1 つ → 6 ヒット
    expect(seq.filter((x) => x === "damage")).toHaveLength(6);
  });

  it("アビ 2：アシスト 2 と同じ効果を、譜面を消費せずに発動（共有の効果 useEffects）", () => {
    const b = setup();
    b.state.chars.beethoven!.tokens.紅の譜面 = 2;
    const from = b.state.log.length;
    b.apply(use("beethoven", "beethoven_a2"));
    expect(b.state.log.slice(from).filter((e) => e.type === "damage")).toHaveLength(12);
    expect(tok(b, "beethoven").紅の譜面).toBe(2);
    noDataErrors(b);
  });

  it("バースト：雷ダメージと自分のアビの CT -1（既定の効果。英霊のバーストはユーザー定義だが初期版は固定）", () => {
    const b = new Battle(makeInput({ hero: beethoven, front1: m }, { corrections: { beethoven: { startGauge: 100 } } }));
    b.apply(use("beethoven", "beethoven_a4")); // CT 2
    b.apply(attack());
    expect(b.state.chars.beethoven!.ct.beethoven_a4).toBe(1);
    expect(b.state.warnings.some((w) => w.code === "burstUnset")).toBe(false);
  });
});

// ---------------------------------------------------------------- シャイターン

describe("シャイターン", () => {
  const setup = (startGauge = 0) => new Battle(makeInput({ front1: shaitan, front2: m }, { corrections: { shaitan: { startGauge } } }));
  const ct = (b: Battle) => b.state.chars.shaitan!.ct;

  it("アビ 2 の使用：アシスト 1 後半でアビ 2 がさらに 1 回発動。発動のたびにアビ 1 の CT -1、アビ 3 の CT -2（常時効果）", () => {
    const b = setup();
    b.apply(use("shaitan", "shaitan_a1")); // CT 50。リミッター解除、アビ 2・3 の CT 0
    b.apply(use("shaitan", "shaitan_a3")); // CT 6
    b.apply(use("shaitan", "shaitan_a2"));
    expect(evs(b, "abilityActivated", (e) => e.ability === "shaitan_a2").map((e) => e.route)).toEqual(["use", "effect"]);
    expect(ct(b).shaitan_a1).toBe(48);
    expect(ct(b).shaitan_a3).toBe(2);
    // アシスト 1 後半で発動したアビ 2 は「使用」ではない
    expect(evs(b, "abilityUsed", (e) => e.ability === "shaitan_a2")).toHaveLength(1);
    noDataErrors(b);
  });

  it("アシスト 1 前半：リミッター解除中、アビ 2 の使用はこのターンの 1・2 回目だけ即リキャ", () => {
    const b = setup();
    b.apply(use("shaitan", "shaitan_a1"));
    expect(b.apply(use("shaitan", "shaitan_a2")).ok).toBe(true);
    expect(ct(b).shaitan_a2).toBe(0);
    expect(b.apply(use("shaitan", "shaitan_a2")).ok).toBe(true);
    expect(ct(b).shaitan_a2).toBe(0);
    expect(b.apply(use("shaitan", "shaitan_a2")).ok).toBe(true);
    expect(ct(b).shaitan_a2).toBe(99);
    // 非表示のトークンはターン開始時に 0 に戻る
    expect(tok(b, "shaitan").shaitan_limiterUses).toBe(2);
    endTurn(b);
    expect(tok(b, "shaitan").shaitan_limiterUses).toBe(0);
  });

  it("アシスト 1 前半：リミッター解除の前に同じターンで使った分は数えない", () => {
    const b = setup();
    b.apply(use("shaitan", "shaitan_a2")); // リミッター解除前（CT 99 になる）
    b.apply(use("shaitan", "shaitan_a1")); // アビ 2 の CT 0
    b.apply(use("shaitan", "shaitan_a2"));
    expect(ct(b).shaitan_a2).toBe(0);
    b.apply(use("shaitan", "shaitan_a2"));
    expect(ct(b).shaitan_a2).toBe(0);
  });

  it("アシスト 1 後半：味方の赤アビ使用でアビ 2 を発動（1 ターン 15 回まで）", () => {
    const b = setup();
    for (const op of times(20, use("m", "m_red"))) b.apply(op);
    expect(evs(b, "abilityActivated", (e) => e.ability === "shaitan_a2" && e.turn === 1)).toHaveLength(15);
  });

  it("アシスト 2：雷属性キャラの赤アビ使用 5 回ごとにアビ 2 の CT 0・雷属性の味方のゲージ +20", () => {
    const b = setup();
    b.apply(use("shaitan", "shaitan_a2")); // 赤 1 回目。CT 99
    for (const op of times(3, use("m", "m_red"))) b.apply(op);
    expect(ct(b).shaitan_a2).toBe(99);
    b.apply(use("m", "m_red")); // 5 回目
    expect(ct(b).shaitan_a2).toBe(0);
    expect(b.state.chars.m!.gauge).toBe(20);
  });

  it("アビ 1：n 回目の発動で n ターン（5 まで）。付け直すと残りに足さず置き換える", () => {
    const b = setup();
    const limiter = () => b.state.chars.shaitan!.buffs.filter((x) => x.name === "リミッター解除");
    b.apply(use("shaitan", "shaitan_a1"));
    expect(limiter().map((x) => x.duration)).toEqual([{ type: "turns", remaining: 1 }]);
    ct(b).shaitan_a1 = 0;
    b.apply(use("shaitan", "shaitan_a1"));
    expect(limiter().map((x) => x.duration)).toEqual([{ type: "turns", remaining: 2 }]);
    expect(evs(b, "buffOverwritten", (e) => e.buff === "リミッター解除")).toHaveLength(1);
  });

  it("バースト：アビ 2 を発動（使用には数えないのでアシスト 1 後半・アシスト 2 は数えない）", () => {
    const b = setup(100);
    b.apply(use("shaitan", "shaitan_a1")); // a1 CT 50
    b.apply(attack());
    expect(evs(b, "abilityActivated", (e) => e.ability === "shaitan_a2").map((e) => e.route)).toEqual(["effect"]);
    expect(ct(b).shaitan_a1).toBe(49);
    expect(assistCount(b, "shaitan_assist1_redUse")).toBe(0);
  });
});

// ---------------------------------------------------------------- アモン

describe("アモン", () => {
  const setup = () => new Battle(makeInput({ front1: amon, front2: m }));
  const useM = (b: Battle, n: number) => {
    for (let i = 0; i < n; i++) b.apply(use("m", "m_blue"));
  };

  it("アシスト 2：雷属性キャラのアビ使用 8 回ごとに連理魔力 +1（1 ターン 10 回まで）。付与のたびにアビ 2 の CT 0", () => {
    const b = setup();
    b.apply(use("amon", "amon_a2")); // CT 5
    useM(b, 6); // 7 回目まで
    expect(tok(b, "amon").連理魔力).toBe(0);
    useM(b, 1); // 8 回目
    expect(tok(b, "amon").連理魔力).toBe(1);
    expect(b.state.chars.amon!.ct.amon_a2).toBe(0);
    useM(b, 100);
    expect(tok(b, "amon").連理魔力).toBe(10);
  });

  it("アシスト 1 前半：連理魔力 1・11・21 個で永続バフを付け直し、大きい段階で上書きする", () => {
    const b = setup();
    useM(b, 8);
    const amt = () => b.state.chars.m!.buffs.find((x) => x.name === "状態異常付与率UP")?.amount;
    expect(amt()).toBe(15);
    useM(b, 80); // このターンに 10 個まで
    endTurn(b);
    useM(b, 8); // 11 個目
    expect(amt()).toBe(30);
    expect(evs(b, "buffOverwritten", (e) => e.buff === "状態異常付与率UP" && e.target === "m")).toHaveLength(1);
  });

  it("アビ 2：戦闘を通した発動回数でヒット数が決まる（1〜9 回：1、10 回目から 2）", () => {
    const b = setup();
    const hits: number[] = [];
    for (let i = 0; i < 10; i++) {
      b.state.chars.amon!.ct.amon_a2 = 0;
      const from = b.state.log.length;
      b.apply(use("amon", "amon_a2"));
      hits.push(b.state.log.slice(from).filter((e) => e.type === "damage" && e.ability === "amon_a2").length);
    }
    // アシスト 1 後半などの発動は無いので、使用回数 = 発動回数
    expect(hits).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 2]);
  });

  it("アシスト 1 後半：ターン終了時、そのターンの雷属性キャラの赤アビ使用回数に応じて破滅雷撃を発動", () => {
    const b = setup();
    for (const op of times(10, use("m", "m_red"))) b.apply(op);
    const from = b.state.log.length;
    endTurn(b);
    expect(b.state.log.slice(from).filter((e) => e.type === "abilityActivated" && e.ability === "amon_a2" && e.phase === "turnEnd")).toHaveLength(2);
  });

  it("アシスト 3・アビ 4：連理魔力 30 個獲得で消去不可の防御 2 倍など。以降は自分のアビ使用で破滅雷撃を発動。アビ 4 は戦闘中 1 回、破滅雷撃を 5 回発動", () => {
    const b = setup();
    expect(b.apply(use("amon", "amon_a4")).reasons).toContain("cond");
    for (let t = 0; t < 3; t++) {
      useM(b, 80);
      endTurn(b);
    }
    expect(tok(b, "amon").連理魔力).toBe(30);
    expect(assistCount(b, "amon_assist3_reach30")).toBe(1);
    expect(b.state.chars.m!.buffs.find((x) => x.name === "防御2倍")?.undispellable).toBe(true);
    const from = b.state.log.length;
    expect(b.apply(use("amon", "amon_a4")).ok).toBe(true);
    const acts = b.state.log.slice(from).filter((e) => e.type === "abilityActivated" && e.ability === "amon_a2");
    // アビ 4 の 5 回 + アシスト 3 後半（自分のアビ使用）の 1 回
    expect(acts).toHaveLength(6);
    b.state.chars.amon!.ct.amon_a4 = 0;
    expect(b.apply(use("amon", "amon_a4")).reasons).toContain("perBattle");
    noDataErrors(b);
  });

  it("アシスト 2：5 の倍数回目の発動で状態異常 1 つ回復（自分の発動回数は今回を含めて数える）", () => {
    const b = setup();
    b.apply({ type: "attack" });
    b.apply({
      type: "enemyPhase",
      events: [{ type: "effect", subject: null, effect: { type: "addDebuff", target: "allAllies", buff: "毒", slot: "dmgDealtDown", amount: 1, duration: { turns: 9 } } }],
    });
    b.apply(nextTurn);
    useM(b, 8 * 4);
    expect(b.state.chars.m!.buffs.some((x) => x.name === "毒")).toBe(true);
    useM(b, 8); // 5 回目の発動
    expect(b.state.chars.m!.buffs.some((x) => x.name === "毒")).toBe(false);
  });
});

// ---------------------------------------------------------------- アルテミス

describe("アルテミス", () => {
  const setup = (party: Partial<Record<"front2" | "back1", Character>> = { front2: m }) => new Battle(makeInput({ front1: artemis, ...party }));

  it("アシスト 1：戦闘開始時に反想 5。アシスト 3（サブでも有効）：パーティ全体が雷属性ならアビ性能 UP など", () => {
    const b = setup();
    expect(tok(b, "artemis").反想).toBe(5);
    expect(b.state.chars.m!.buffs.map((x) => x.name)).toEqual(expect.arrayContaining(["アビリティ性能UP", "アビリティダメージプラス"]));
  });

  it("アシスト 3：雷属性以外がいれば付かない（partyAll）。サブにいても発動する（activeIn: both）", () => {
    const fire = plain("f", { element: "fire" });
    expect(setup({ front2: fire }).state.chars.f!.buffs).toEqual([]);
    const sub = new Battle(makeInput({ front1: m, sub1: artemis }));
    expect(sub.state.chars.m!.buffs.map((x) => x.name)).toContain("アビリティ性能UP");
  });

  it("アビ 2：反想 1 消費・1 ターン 2 回まで・味方全体ゲージ +15", () => {
    const b = setup();
    b.apply(use("artemis", "artemis_a2"));
    b.apply(use("artemis", "artemis_a2"));
    expect(b.state.chars.m!.gauge).toBe(30);
    expect(tok(b, "artemis").反想).toBe(3);
    expect(b.apply(use("artemis", "artemis_a2")).reasons).toContain("perTurn");
  });

  it("アビ 3：戦闘中 1 回目の使用で雷属性キャラの赤アビの CT 0", () => {
    const b = new Battle(makeInput({ front1: artemis, front2: eve }));
    b.apply(use("eve", "eve_a1")); // CT 1
    b.apply(use("artemis", "artemis_a3"));
    expect(b.state.chars.eve!.ct.eve_a1).toBe(0);
    b.apply(use("eve", "eve_a1"));
    b.apply(use("artemis", "artemis_a3")); // 2 回目は効かない
    expect(b.state.chars.eve!.ct.eve_a1).toBe(1);
  });

  it("アビ 4：反想 10 消費。消費数は戦闘を通した合計（sum）で、段階は範囲で 1 つだけ", () => {
    const b = setup();
    b.state.chars.artemis!.tokens.反想 = 40;
    b.apply(use("artemis", "artemis_a4")); // 合計 10：段階なし
    expect(b.state.enemy.buffs).toEqual([]);
    b.apply(use("artemis", "artemis_a4")); // 合計 20：水属性攻撃 DOWN
    expect(b.state.enemy.buffs.map((x) => x.name)).toEqual(["水属性攻撃DOWN"]);
    b.apply(use("artemis", "artemis_a4")); // 合計 30：与ダメージ DOWN
    expect(b.state.enemy.buffs.map((x) => x.name)).toEqual(["水属性攻撃DOWN", "与ダメージDOWN"]);
    expect(evs(b, "tokenConsumed", (e) => e.token === "反想").map((e) => e.amount)).toEqual([10, 10, 10]);
    noDataErrors(b);
  });

  it("アビ 1：消費した反想の数で 1 ターンの使用回数が増える（0〜10 個：1 回、11 個以上：2 回）", () => {
    const b = setup();
    expect(b.apply(use("artemis", "artemis_a1")).ok).toBe(true);
    expect(b.apply(use("artemis", "artemis_a1")).reasons).toContain("cond");
    b.state.chars.artemis!.tokens.反想 = 20;
    b.apply(use("artemis", "artemis_a4")); // 10 消費
    b.apply(use("artemis", "artemis_a2")); // 1 消費 → 合計 11
    expect(b.apply(use("artemis", "artemis_a1")).ok).toBe(true);
    expect(b.apply(use("artemis", "artemis_a1")).reasons).toContain("cond");
  });

  it("アシスト 2：反想を消費すると、消費数の段階の効果を 1 回だけ付与（永続）", () => {
    const b = setup();
    b.apply(use("artemis", "artemis_a2"));
    b.apply(use("artemis", "artemis_a2"));
    const atk = b.state.chars.m!.buffs.filter((x) => x.name === "攻撃UP");
    expect(atk).toHaveLength(1);
    expect(atk[0]!.duration).toEqual({ type: "permanent" });
    expect(assistCount(b, "artemis_assist2")).toBe(2);
  });

  it("アシスト 1：4 の倍数ターン終了時に反想 5、雷属性キャラのアビ使用 10 回ごと（戦闘全体）に反想 2。バーストで反想 3", () => {
    const b = setup();
    for (let t = 0; t < 3; t++) endTurn(b);
    expect(tok(b, "artemis").反想).toBe(5);
    endTurn(b); // T4 終了
    expect(tok(b, "artemis").反想).toBe(10);
    for (const op of times(9, use("m", "m_blue"))) b.apply(op);
    expect(tok(b, "artemis").反想).toBe(10);
    b.apply(use("m", "m_blue"));
    expect(tok(b, "artemis").反想).toBe(12);
    b.state.chars.artemis!.gauge = 100;
    b.apply(attack());
    expect(tok(b, "artemis").反想).toBe(15);
  });
});

// ---------------------------------------------------------------- 5 体の編成

describe("初期リリースの 5 体の編成（§15.2）", () => {
  it("英霊ベートーヴェン + イヴ・シャイターン・アモン・アルテミスで数ターン操作しても、データの誤りや処理上限にならない", () => {
    const b = new Battle(makeInput({ hero: beethoven, front1: eve, front2: shaitan, back1: amon, back2: artemis }));
    for (let t = 0; t < 4; t++) {
      for (const [c, a] of [
        ["eve", "eve_a2"],
        ["eve", "eve_a2"],
        ["eve", "eve_a1"],
        ["shaitan", "shaitan_a1"],
        ["shaitan", "shaitan_a2"],
        ["amon", "amon_a1"],
        ["artemis", "artemis_a2"],
        ["artemis", "artemis_a1"],
        ["beethoven", "beethoven_a1"],
        ["beethoven", "beethoven_a4"],
        ["eve", "eve_a3"],
      ] as const) {
        b.apply(use(c, a));
      }
      endTurn(b);
    }
    expect(b.state.turn).toBe(5);
    noDataErrors(b);
    // 使用と発動の区別：イヴのアシスト 1 は赤アビの使用で数え、シャイターンのアシスト 1 後半による発動は数えない
    const redUsed = evs(b, "abilityUsed", (e) => e.color === "red" && e.turn === 1).length;
    expect(assistCount(b, "eve_assist1", 1)).toBe(Math.floor(redUsed / 5));
  });
});
