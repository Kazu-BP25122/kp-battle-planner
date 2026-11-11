/**
 * キャラ専用処理（逃げ道。§10.1 custom）。DSL で表現できない効果だけをここに置く。
 * 追加したら、対応するテストを必ず追加すること（§13）。
 */
import type { Ctx, Exec } from "../context";

export type CustomEffect = (ctx: Ctx, exec: Exec, params: Record<string, unknown>) => void;

export const customEffects: Record<string, CustomEffect> = {};
