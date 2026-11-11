/**
 * 条件部品の登録表（§10.1、DSL_PARTS.md §4）。部品を追加したら schema/dsl.ts・AGENTS.md・DSL_PARTS.md も更新する。
 * 回数の条件はイベントログで数え（§4.7）、状態の条件は判定する瞬間の現在の値で見る。
 */
import type { Condition } from "../../schema/dsl";
import type { Ctx, Exec } from "../context";
import { activeMainIds, slotOf } from "../context";
import { compareNum, matchesFilter, pickCompare } from "../query";
import { slotPosition } from "../types";
import type { BuffInstance } from "../types";
import { countOf, tokenOf, useCountOf } from "../values";

type Subject = "self" | "chosenAlly" | "enemy" | undefined;

function subjectId(exec: Exec, s: Subject): string | null {
  if (s === undefined || s === "self") return exec.self;
  if (s === "enemy") return "enemy";
  return exec.chosenAlly ?? null;
}

function buffsOf(ctx: Ctx, id: string | null): BuffInstance[] {
  if (id === null) return [];
  if (id === "enemy") return ctx.state.enemy.buffs;
  return ctx.state.chars[id]?.buffs ?? [];
}

const isOneOf = <T>(v: T, is: T | T[]): boolean => (Array.isArray(is) ? is.includes(v) : is === v);

/** キャラのオプションの値（§4.2、§4.9）。未選択なら定義の default */
export function optionValue(ctx: Ctx, charId: string, optionId: string): boolean | string | number | undefined {
  const chosen = ctx.input.corrections[charId]?.options?.[optionId];
  if (chosen !== undefined) return chosen;
  return ctx.input.characters[charId]?.options?.find((o) => o.id === optionId)?.default;
}

export function evalCondition(ctx: Ctx, exec: Exec, cond: Condition): boolean {
  if ("and" in cond) return cond.and.every((c) => evalCondition(ctx, exec, c));
  if ("or" in cond) return cond.or.some((c) => evalCondition(ctx, exec, c));
  if ("not" in cond) return !evalCondition(ctx, exec, cond.not);

  if ("count" in cond) return compareNum(countOf(ctx, exec, cond.count), pickCompare(cond.count));
  if ("useCount" in cond) {
    // TODO(spec): §10.2・§11「奇数回目」は今回の使用を含めて数える（仮置き）。効果の中では abilityUsed 記録後なので含まれる
    return compareNum(useCountOf(ctx, exec, cond.useCount), pickCompare(cond.useCount));
  }
  if ("token" in cond) return compareNum(tokenOf(ctx, exec, cond.token), pickCompare(cond.token));
  if ("hpRate" in cond) {
    const id = subjectId(exec, cond.hpRate.target);
    const c = id ? ctx.state.chars[id] : undefined;
    return c ? compareNum(c.hp, pickCompare(cond.hpRate)) : false;
  }
  if ("gauge" in cond) {
    const id = subjectId(exec, cond.gauge.target);
    const c = id ? ctx.state.chars[id] : undefined;
    return c ? compareNum(c.gauge, pickCompare(cond.gauge)) : false;
  }
  if ("hasBuff" in cond || "hasDebuff" in cond) {
    const spec = "hasBuff" in cond ? cond.hasBuff : cond.hasDebuff;
    const polarity = "hasBuff" in cond ? "buff" : "debuff";
    const id = subjectId(exec, spec.target);
    const found = buffsOf(ctx, id).filter(
      (b) => b.kind === "buff" && b.polarity === polarity && (spec.slot === undefined || b.slot === spec.slot) && (spec.buff === undefined || b.name === spec.buff),
    );
    if (spec.stacks !== undefined) return compareNum(found.length, spec.stacks);
    return found.length > 0;
  }
  if ("hasStatus" in cond) {
    const id = subjectId(exec, cond.hasStatus.target);
    return buffsOf(ctx, id).some((b) => b.kind === "status" && b.name === cond.hasStatus.status);
  }
  if ("turnCount" in cond) return compareNum(ctx.state.turn, cond.turnCount);
  if ("element" in cond) {
    const id = subjectId(exec, cond.element.target);
    const el = id === "enemy" ? ctx.state.enemy.element : id ? ctx.input.characters[id]?.element ?? null : null;
    return el !== null && isOneOf(el, cond.element.is);
  }
  if ("position" in cond) {
    const id = subjectId(exec, cond.position.target);
    const s = id && id !== "enemy" ? slotOf(ctx, id) : null;
    return s !== null && isOneOf(slotPosition(s), cond.position.is);
  }
  if ("trigger" in cond) {
    // アシストを発動させたイベントの項目（§10.2）。アシストの外では常に偽
    return exec.triggerEvent !== undefined && matchesFilter(exec.triggerEvent, cond.trigger, exec.self);
  }
  if ("partyAll" in cond) {
    // TODO(spec): §11 partyAll にサブを含めるか未確定。含めない（メインの戦闘不能でないキャラ）で仮置き
    const ids = activeMainIds(ctx);
    const want = cond.partyAll.element;
    return ids.every((id) => want === undefined || isOneOf(ctx.input.characters[id]!.element, want));
  }
  if ("option" in cond) {
    if (exec.self === "enemy") return false;
    return optionValue(ctx, exec.self, cond.option.id) === cond.option.is;
  }
  const _exhaustive: never = cond;
  throw new Error(`未知の条件: ${JSON.stringify(_exhaustive)}`);
}
