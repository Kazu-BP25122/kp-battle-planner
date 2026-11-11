/**
 * テスト用のヘルパー。tests/ の架空キャラはエンジンの単体テスト専用（初期リリースのデータには使わない。§15.2）。
 */
import { Character } from "../src/schema/character";
import { BuffSlotList } from "../src/schema/buffSlot";
import { DEFAULT_SETTINGS, type CharCorrection, type Op, type Party, type Settings } from "../src/schema/chart";
import type { Character as CharacterT } from "../src/schema/character";
import type { EngineInput } from "../src/engine";
import buffSlotsJson from "../src/content/buffSlots.json";
import eveJson from "../src/content/characters/eve.json";

export const buffSlots = BuffSlotList.parse(buffSlotsJson);
export const eve = Character.parse(eveJson);

type CharInput = Omit<CharacterT, "kind" | "element" | "burst" | "abilities" | "assists"> &
  Partial<Pick<CharacterT, "kind" | "element" | "burst" | "abilities" | "assists">>;

/** 架空キャラ（Zod で検証してから返す） */
export function char(c: CharInput): CharacterT {
  return Character.parse({
    kind: "princess",
    element: "thunder",
    burst: { effects: [{ type: "damage", target: "enemy", category: "burst" }] },
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
    abilities: [{ id: `${id}_red`, name: "赤アビ", color: "red", ct: 0, category: "ability", effects: [{ type: "damage", target: "enemy" }] }],
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
