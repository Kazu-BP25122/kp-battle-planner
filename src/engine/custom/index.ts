/**
 * キャラ専用処理（逃げ道。§10.1 custom）。DSL で表現できない効果だけをここに置く。
 * 追加したら、CHARACTER.md §2「DSL で書けない効果」に記録し、対応するテストを必ず追加すること（§13）。
 */
import type { Ctx, Exec } from "../context";

export type CustomEffect = (ctx: Ctx, exec: Exec, params: Record<string, unknown>) => void;

export const customEffects: Record<string, CustomEffect> = {
  /**
   * ベートーヴェン：キュアボトルを 1 つ生成。アイテムは初期版の対象外なので何もしない（CHARACTER.md §4）。
   */
  beethoven_cureBottle: () => {},
  /**
   * アルテミス アビ 4：敵のチャージターンを全て消去。敵 CT は初期版の対象外なので何もしない（CHARACTER.md §2）。
   * TODO(spec): 敵 CT を扱うときに部品を追加する
   */
  artemis_enemyChargeReset: () => {},
};

export const CUSTOM_EFFECT_IDS: ReadonlySet<string> = new Set(Object.keys(customEffects));
