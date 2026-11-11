import { z } from "zod";
import { Polarity } from "./common";

/**
 * バフ・デバフの枠（§7.2）。src/content/buffSlots.json に登録する。
 */
export const BuffSlot = z
  .object({
    id: z.string(),
    name: z.string(),
    polarity: Polarity,
    /** 効果量の単位（% / 固定値 など） */
    unit: z.enum(["percent", "flat", "none"]),
    /** ダメージ計算用の参考情報（初期版のエンジンは使わない） */
    stacking: z.enum(["additive", "multiplicative"]).optional(),
    /** ダメージ計算用の参考情報：上限 */
    cap: z.number().optional(),
    /**
     * デバフの合計下限のグループ（§7.2）。同じグループのデバフ量の合計が floor に達したら「効果なし」を表示する
     */
    floorGroup: z.string().optional(),
    floor: z.number().optional(),
    /**
     * エンジンが意味を解釈する枠。
     * - gaugeRate: バーストゲージ上昇量アップ（% を受け手側で合算。§8.3）
     * - turnEndGauge: ターン終了時のゲージ上昇（奮励など。効果量 = 上昇量。§5-5-3）
     */
    engineEffect: z.enum(["gaugeRate", "turnEndGauge"]).optional(),
    /** 仕様で確定していない枠（提供情報に無いもの）なら true */
    provisional: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .strict()
  .refine((s) => (s.floor === undefined) === (s.floorGroup === undefined), {
    message: "floor と floorGroup は両方指定する",
  });
export type BuffSlot = z.infer<typeof BuffSlot>;

export const BuffSlotList = z.array(BuffSlot).superRefine((list, ctx) => {
  const ids = new Set<string>();
  for (const s of list) {
    if (ids.has(s.id)) ctx.addIssue({ code: "custom", message: `枠 ID が重複: ${s.id}` });
    ids.add(s.id);
  }
});
