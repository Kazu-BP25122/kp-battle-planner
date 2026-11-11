import type { Target } from "../schema/dsl";
import type { Ctx, Exec } from "./context";
import { activeMainIds, isActiveMain, slotOf } from "./context";
import { slotPosition } from "./types";

/**
 * 対象部品（§10.1）を ID の列に解決する。敵は "enemy"。
 * TODO(spec): §11「味方全体」の対象にサブは含まれるか未確定。メイン（英霊を含む・戦闘不能を除く）だけとする
 */
export function resolveTargets(ctx: Ctx, exec: Exec, target: Target | undefined): string[] {
  const t = target ?? "self";
  if (t === "self") return [exec.self];
  if (t === "enemy") return ["enemy"];
  if (t === "allAllies") return activeMainIds(ctx);
  if (t === "chosenAlly") return exec.chosenAlly && isActiveMain(ctx, exec.chosenAlly) ? [exec.chosenAlly] : [];
  const w = t.alliesWhere;
  return activeMainIds(ctx).filter((id) => {
    if (w.excludeSelf && id === exec.self) return false;
    if (w.element !== undefined) {
      const el = ctx.input.characters[id]!.element;
      if (Array.isArray(w.element) ? !w.element.includes(el) : w.element !== el) return false;
    }
    if (w.position !== undefined) {
      const pos = slotPosition(slotOf(ctx, id)!);
      if (Array.isArray(w.position) ? !w.position.includes(pos) : w.position !== pos) return false;
    }
    return true;
  });
}

/** 効果の木に chosenAlly が含まれるか（使用時に対象の選択が必要か） */
export function needsChosenAlly(value: unknown): boolean {
  return JSON.stringify(value).includes('"chosenAlly"');
}
