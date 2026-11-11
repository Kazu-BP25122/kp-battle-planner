/**
 * キャラ定義（§4.2、DSL_PARTS.md §1）。src/content/characters/<id>.json はこの形で書く。
 */
import { z } from "zod";
import { Color, Element, Kind } from "./common";
import { Assist, Condition, Cost, Effect, EffectList, Limit } from "./dsl";

const note = z.string().optional();

export const Ability = z
  .object({
    id: z.string(),
    name: z.string(),
    color: Color,
    ct: z.number().int().min(0),
    /** 使用条件（§6）。使う前に評価する */
    usable: Condition.optional(),
    cost: z.array(Cost).optional(),
    limit: Limit.optional(),
    /** EX 枠のアビ（§4.2）。初期版は定義のアビで固定 */
    ex: z.boolean().optional(),
    effects: EffectList,
    note,
  })
  .strict();
export type Ability = z.infer<typeof Ability>;

export const TokenDef = z
  .object({
    name: z.string(),
    group: z.string().optional(),
    /** この種類の上限。超えて付与した分は破棄（§4.2） */
    max: z.number().int().positive().optional(),
    initial: z.number().int().min(0).optional(),
    /** 画面に表示しない（内部カウンター） */
    hidden: z.boolean().optional(),
    note,
  })
  .strict();
export type TokenDef = z.infer<typeof TokenDef>;

export const TokenGroup = z
  .object({
    name: z.string(),
    /** グループ内の合計の上限。省略で上限なし */
    max: z.number().int().positive().optional(),
    note,
  })
  .strict();
export type TokenGroup = z.infer<typeof TokenGroup>;

/** キャラのオプション（§4.2）。ユーザーがチャートごとに選ぶ */
export const CharOption = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.literal("boolean"),
    default: z.boolean(),
    note,
  })
  .strict();
export type CharOption = z.infer<typeof CharOption>;

export const Burst = z
  .object({
    name: z.string().optional(),
    /** 省略時はバースト区分の自属性ダメージ 1 ヒットとして扱う（§4.9） */
    effects: EffectList.optional(),
    /** ユーザーが効果を上書きできる（英霊のみ。§4.2）。effects は既定の効果 */
    userDefined: z.boolean().optional(),
    note,
  })
  .strict();
export type Burst = z.infer<typeof Burst>;

export const Character = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]+$/, "ID は英小文字・数字・_・- のみ"),
    name: z.string(),
    kind: Kind,
    element: Element,
    rarity: z.string().optional(),
    /** バーストゲージ上限（§8.1） */
    gaugeMax: z.union([z.literal(100), z.literal(200)]).optional(),
    /** バースト時のゲージ消費方式（§8.2） */
    burstConsume: z.enum(["subtract100", "consumeAll"]).optional(),
    burst: Burst,
    abilities: z.array(Ability),
    /** 並び順 = キャラ詳細画面の上から順（§6.1-2） */
    assists: z.array(Assist).optional(),
    tokens: z.array(TokenDef).optional(),
    tokenGroups: z.array(TokenGroup).optional(),
    options: z.array(CharOption).optional(),
    /** 複数の場所で使う効果。useEffects で呼び出す（読み込み時に展開。§10.2） */
    sharedEffects: z.record(z.string(), z.array(Effect)).optional(),
    /** 実数値などの出典（§7.2） */
    source: z.union([z.string(), z.array(z.string())]).optional(),
    note,
  })
  .strict()
  .superRefine((c, ctx) => {
    const dup = (label: string, ids: string[]) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) ctx.addIssue({ code: "custom", message: `${label}が重複: ${id}` });
        seen.add(id);
      }
    };
    dup("アビリティ ID ", c.abilities.map((a) => a.id));
    dup("アシスト ID ", (c.assists ?? []).map((a) => a.id));
    dup("トークン名 ", (c.tokens ?? []).map((t) => t.name));
    dup("トークングループ名 ", (c.tokenGroups ?? []).map((t) => t.name));
    dup("オプション ID ", (c.options ?? []).map((t) => t.id));
    if (c.burst.userDefined && c.kind !== "hero") {
      ctx.addIssue({ code: "custom", message: "burst.userDefined は英霊（kind: hero）にだけ使う（§4.2）" });
    }
  });
export type Character = z.infer<typeof Character>;

export const characterGaugeMax = (c: Character) => c.gaugeMax ?? 100;
export const characterBurstConsume = (c: Character) => c.burstConsume ?? "subtract100";
