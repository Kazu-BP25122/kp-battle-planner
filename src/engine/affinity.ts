/**
 * 属性相性（§4.8）。相性の表はここに 1 か所だけ置く。
 * 初期版はダメージを計算しないため、表示と条件判定に使う。
 */
import type { Element } from "../schema/common";

export type Affinity = "advantage" | "neutral" | "disadvantage";

/**
 * 4 属性の有利関係（各属性が次の属性に有利）。
 * TODO(spec): §4.8・§11 循環「火 → 風 → 雷 → 水 → 火」は推定。明記されているのは「火 → 風が有利」「火 → 水が不利」のみ
 */
const FOUR_CYCLE: Element[] = ["fire", "wind", "thunder", "water"];

/** 倍率（提供情報。実機確認は未）。ダメージ計算を追加するときのために記録しておく */
export const AFFINITY_MULTIPLIER: Record<Affinity, { dealt: number; taken: number }> = {
  advantage: { dealt: 1.48, taken: 0.75 },
  neutral: { dealt: 1.0, taken: 1.0 },
  disadvantage: { dealt: 0.75, taken: 1.48 },
};

/**
 * 攻撃側の属性から見た相性。side は攻撃側がプレイヤーか敵か（光・闇の非対称性）。
 */
export function affinity(attacker: Element, defender: Element, side: "player" | "enemy"): Affinity {
  const ai = FOUR_CYCLE.indexOf(attacker);
  const di = FOUR_CYCLE.indexOf(defender);
  if (ai >= 0 && di >= 0) {
    if ((ai + 1) % 4 === di) return "advantage";
    if ((di + 1) % 4 === ai) return "disadvantage";
    return "neutral";
  }
  // 光・闇：プレイヤー側だけが一方的に有利補正を受ける
  if (side === "player") {
    if ((attacker === "light" && defender === "dark") || (attacker === "dark" && defender === "light")) return "advantage";
    // 幻属性の敵：プレイヤー側の光・闇は有利、4 属性は等倍
    if (defender === "phantom" && (attacker === "light" || attacker === "dark")) return "advantage";
  }
  // TODO(spec): §11 光 → 光・闇 → 闇、プレイヤー側の幻属性の相性は未確定。等倍とする
  return "neutral";
}
