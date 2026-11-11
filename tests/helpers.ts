/**
 * テスト用のヘルパー。tests/ の架空キャラはエンジンの単体テスト専用（初期リリースのデータには使わない。§15.2）。
 */
import { Character } from "../src/schema/character";
import { BuffSlotFile } from "../src/schema/buffSlot";
import { DEFAULT_SETTINGS, type CharCorrection, type Op, type Party, type Settings } from "../src/schema/chart";
import type { Character as CharacterT } from "../src/schema/character";
import type { EngineInput } from "../src/engine";
import buffSlotsJson from "../src/content/buffSlots.json";
import eveJson from "../src/content/characters/eve.json";
import beethovenJson from "../src/content/characters/beethoven.json";
import shaitanJson from "../src/content/characters/shaitan.json";
import amonJson from "../src/content/characters/amon.json";
import artemisJson from "../src/content/characters/artemis.json";

/**
 * 枠の一覧。実データ（src/content/buffSlots.json）に、架空キャラの単体テスト専用の枠を足したもの。
 * テスト専用の枠は実データには入れない（初期 5 体が使わない仕組み：ゲージ上昇量アップ・デバフ下限など）。
 */
export const realBuffSlots = BuffSlotFile.parse(buffSlotsJson).slots;
export const buffSlots = [
  ...realBuffSlots,
  ...BuffSlotFile.parse({
    slots: [
      { id: "test_gaugeRateUp", name: "バーストゲージ上昇量UP（テスト用）", polarity: "buff", engineEffect: "gaugeRate" },
      { id: "test_turnEndGauge", name: "ターン終了時ゲージ上昇（テスト用）", polarity: "buff", engineEffect: "turnEndGauge" },
      { id: "atkDownA", name: "攻撃力ダウン A 枠（テスト用）", polarity: "debuff", floorGroup: "atkDown", floor: 50 },
      { id: "atkDownB", name: "攻撃力ダウン B 枠（テスト用）", polarity: "debuff", floorGroup: "atkDown", floor: 50 },
      { id: "atkDownC", name: "攻撃力ダウン C 枠（テスト用）", polarity: "debuff", floorGroup: "atkDown", floor: 50 },
    ],
  }).slots,
];
/** 初期リリースの 5 体（§15.2） */
export const eve = Character.parse(eveJson);
export const beethoven = Character.parse(beethovenJson);
export const shaitan = Character.parse(shaitanJson);
export const amon = Character.parse(amonJson);
export const artemis = Character.parse(artemisJson);

type CharInput = Omit<CharacterT, "kind" | "element" | "burst" | "abilities" | "assists"> &
  Partial<Pick<CharacterT, "kind" | "element" | "burst" | "abilities" | "assists">>;

/** 架空キャラ（Zod で検証してから返す） */
export function char(c: CharInput): CharacterT {
  return Character.parse({
    kind: "kamihime",
    element: "thunder",
    burst: { effects: [{ type: "damage", target: "allEnemies", category: "burst" }] },
    abilities: [],
    assists: [],
    ...c,
  });
}

/** 赤・雷・CT 0 の攻撃アビを持つキャラ（イヴのアシストのカウンター用） */
export function redThunder(id: string, extra: Partial<CharInput> = {}): CharacterT {
  return char({
    id,
    name: id,
    abilities: [{ id: `${id}_red`, name: "赤アビ", color: "red", ct: 0, effects: [{ type: "damage", target: "enemy", category: "ability" }] }],
    ...extra,
  });
}

export function plain(id: string, extra: Partial<CharInput> = {}): CharacterT {
  return char({ id, name: id, ...extra });
}

export function makeInput(
  slots: Partial<Record<keyof Party, CharacterT>>,
  opts: { corrections?: Record<string, CharCorrection>; settings?: Partial<Settings>; enemyElement?: EngineInput["quest"]["enemyElement"] } = {},
): EngineInput {
  const party: Party = { hero: null, front1: null, front2: null, back1: null, back2: null, sub1: null, sub2: null };
  const characters: Record<string, CharacterT> = {};
  for (const [k, c] of Object.entries(slots)) {
    if (!c) continue;
    party[k as keyof Party] = c.id;
    characters[c.id] = c;
  }
  return {
    party,
    quest: { enemyElement: opts.enemyElement ?? null },
    characters,
    buffSlots,
    corrections: opts.corrections ?? {},
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
  };
}

export const use = (charId: string, abilityId: string, chosenAlly?: string): Op => ({
  type: "useAbility",
  charId,
  abilityId,
  ...(chosenAlly ? { chosenAlly } : {}),
});
export const attack = (comboOverride?: Record<string, 1 | 2 | 3>): Op => ({ type: "attack", ...(comboOverride ? { comboOverride } : {}) });
export const nextTurn: Op = { type: "nextTurn" };
export const hold: Op = { type: "setBurst", mode: "hold" };
export const fire: Op = { type: "setBurst", mode: "fire" };
/** 攻撃 → 次のターン */
export const endTurn = (comboOverride?: Record<string, 1 | 2 | 3>): Op[] => [attack(comboOverride), nextTurn];

export function times<T>(n: number, x: T): T[] {
  return Array.from({ length: n }, () => x);
}
