import { z } from "zod";
import { Category, Color, Element } from "./common";
import { Assist, Condition, Cost, EffectList, Limit } from "./dsl";

export const Ability = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    color: Color,
    ct: z.number().int().min(0),
    /**
     * 攻撃区分（§4.1）。ダメージ効果の区分を省略したときの継承元。
     * TODO(spec): §11 DMG を伴わないアビの区分（「なし」を追加するか）は未確定。省略可にしておく
     */
    category: Category.optional(),
    cond: Condition.optional(),
    cost: z.array(Cost).optional(),
    limit: Limit.optional(),
    effects: EffectList,
  })
  .strict();
export type Ability = z.infer<typeof Ability>;

export const Character = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]+$/, "ID は英小文字・数字・_・- のみ"),
    name: z.string(),
    /** 神姫 / 英霊 */
    kind: z.enum(["princess", "hero"]),
    element: Element,
    rarity: z.string().optional(),
    /** バーストゲージ上限（§8.1） */
    gaugeMax: z.union([z.literal(100), z.literal(200)]).optional(),
    /** バースト時のゲージ消費方式（§8.2） */
    burstConsume: z.enum(["subtract100", "consumeAll"]).optional(),
    tokens: z.array(z.object({ name: z.string(), max: z.number().int().positive().optional() }).strict()).optional(),
    burst: z.object({ name: z.string().optional(), description: z.string().optional(), effects: EffectList }).strict(),
    abilities: z.array(Ability),
    /** 並び順 = キャラ詳細画面の上から順（§6.1-2） */
    assists: z.array(Assist),
    /** 実数値などの出典（§7.2） */
    source: z.union([z.string(), z.array(z.string())]).optional(),
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const abilityIds = new Set<string>();
    for (const a of c.abilities) {
      if (abilityIds.has(a.id)) ctx.addIssue({ code: "custom", message: `アビリティ ID が重複: ${a.id}` });
      abilityIds.add(a.id);
    }
    const assistIds = new Set<string>();
    for (const a of c.assists) {
      if (assistIds.has(a.id)) ctx.addIssue({ code: "custom", message: `アシスト ID が重複: ${a.id}` });
      assistIds.add(a.id);
    }
  });
export type Character = z.infer<typeof Character>;

export const characterGaugeMax = (c: Character) => c.gaugeMax ?? 100;
export const characterBurstConsume = (c: Character) => c.burstConsume ?? "subtract100";
