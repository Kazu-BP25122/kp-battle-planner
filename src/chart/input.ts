import type { BuffSlot } from "../schema/buffSlot";
import type { Character } from "../schema/character";
import type { ChartData } from "../schema/chart";
import type { EngineInput } from "../engine/types";

export interface Catalog {
  characters: Record<string, Character>;
  buffSlots: BuffSlot[];
}

/** チャートデータ + キャラ定義 → エンジンの入力 */
export function toEngineInput(chart: ChartData, catalog: Catalog): EngineInput {
  const characters: Record<string, Character> = {};
  for (const id of Object.values(chart.party)) {
    if (id && catalog.characters[id]) characters[id] = catalog.characters[id];
  }
  return {
    party: chart.party,
    quest: chart.quest,
    characters,
    buffSlots: catalog.buffSlots,
    corrections: chart.corrections,
    settings: chart.settings,
  };
}
