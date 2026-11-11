import { z } from "zod";

/** 属性（§4.1） */
export const ELEMENTS = ["fire", "water", "wind", "thunder", "light", "dark", "phantom"] as const;
export const Element = z.enum(ELEMENTS);
export type Element = z.infer<typeof Element>;

export const ELEMENT_LABEL: Record<Element, string> = {
  fire: "火",
  water: "水",
  wind: "風",
  thunder: "雷",
  light: "光",
  dark: "闇",
  phantom: "幻",
};

/** アビリティの色（§4.1） */
export const COLORS = ["red", "yellow", "blue", "green", "purple"] as const;
export const Color = z.enum(COLORS);
export type Color = z.infer<typeof Color>;

export const COLOR_LABEL: Record<Color, string> = {
  red: "赤",
  yellow: "黄",
  blue: "青",
  green: "緑",
  purple: "紫",
};

/** 攻撃区分（§4.1）。個々のダメージに付く */
export const Category = z.enum(["normal", "ability", "burst"]);
export type Category = z.infer<typeof Category>;

/** フェーズ（§4.7） */
export const Phase = z.enum(["turnStart", "action", "attack", "enemy", "turnEnd"]);
export type Phase = z.infer<typeof Phase>;

/** ポジション（§4.4） */
export const Position = z.enum(["hero", "front", "back", "sub"]);
export type Position = z.infer<typeof Position>;

/**
 * イベントの種類（§4.7）。アシストのトリガー名と共通。
 * 追加したら AGENTS.md §4.7 の表も同時に更新すること。
 */
export const EVENT_TYPES = [
  "battleStart",
  "turnStart",
  "turnEnd",
  "abilityUsed",
  "normalAttack",
  "burst",
  "damage",
  "damaged",
  "heal",
  "gaugeChanged",
  "buffApplied",
  "buffOverwritten",
  "buffMissed",
  "buffConsumed",
  "buffExpired",
  "buffRemoved",
  "assistTriggered",
  "enterBattle",
  "swappedOut",
  "knockedOut",
] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

/** イベントの発生源の種類（§4.7） */
export const SourceKind = z.enum(["ability", "assist", "burst", "normalAttack", "eidolon", "manual", "system"]);
export type SourceKind = z.infer<typeof SourceKind>;

/** ゲージ増減の手段（§4.7 gaugeChanged / §8.3 gaugeGainBlocked の sources） */
export const GaugeMeans = z.enum(["normalAttack", "chain", "effect", "turnEnd", "damaged", "cost", "burst", "correction"]);
export type GaugeMeans = z.infer<typeof GaugeMeans>;

/** gaugeGainBlocked が止める手段（§8.3） */
export const GaugeBlockSource = z.enum(["normalAttack", "damaged", "chain", "effect", "turnEnd", "all"]);
export type GaugeBlockSource = z.infer<typeof GaugeBlockSource>;

export const Polarity = z.enum(["buff", "debuff"]);
export type Polarity = z.infer<typeof Polarity>;

/** 数値の比較（条件で共通に使う） */
export const NumCompare = z
  .object({
    gte: z.number().optional(),
    lte: z.number().optional(),
    eq: z.number().optional(),
    multipleOf: z.number().int().positive().optional(),
    parity: z.enum(["odd", "even"]).optional(),
  })
  .strict();
export type NumCompare = z.infer<typeof NumCompare>;
