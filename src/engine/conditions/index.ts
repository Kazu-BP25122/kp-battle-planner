/**
 * 条件部品の登録表（§10.1）。部品を追加したら schema/dsl.ts と AGENTS.md も更新する。
 */
import type { Condition } from "../../schema/dsl";
import type { Ctx, Exec } from "../context";
import { slotOf } from "../context";
import { compareNum, countEvents } from "../query";
import { slotPosition } from "../types";
import type { BuffInstance } from "../types";

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

export function evalCondition(ctx: Ctx, exec: Exec, cond: Condition): boolean {
  if ("and" in cond) return cond.and.every((c) => evalCondition(ctx, exec, c));
  if ("or" in cond) return cond.or.some((c) => evalCondition(ctx, exec, c));
  if ("not" in cond) return !evalCondition(ctx, exec, cond.not);

  if ("count" in cond) {
    const { event, filter, scope, ...cmp } = cond.count;
    const q = { event, scope, turn: ctx.state.turn, owner: exec.self, ...(filter ? { filter } : {}), ...(exec.seqLimit !== undefined ? { seqLimit: exec.seqLimit } : {}) };
    return compareNum(countEvents(ctx.state.log, q), cmp);
  }
  if ("useCount" in cond) {
    const { ability, scope, ...cmp } = cond.useCount;
    const abilityId = ability === "self" ? exec.ability : ability;
    if (abilityId === undefined) return false;
    const q = {
      event: "abilityUsed" as const,
      filter: { actor: "self", ability: abilityId },
      scope,
      turn: ctx.state.turn,
      owner: exec.self,
      ...(exec.seqLimit !== undefined ? { seqLimit: exec.seqLimit } : {}),
    };
    // TODO(spec): §10.2・§11「奇数回目」は今回の使用を含めて数える（仮置き）
    const n = countEvents(ctx.state.log, q) + (exec.pendingUse && abilityId === exec.ability ? 1 : 0);
    return compareNum(n, cmp);
  }
  if ("token" in cond) {
    const { name, target, ...cmp } = cond.token;
    const id = subjectId(exec, target);
    const c = id ? ctx.state.chars[id] : undefined;
    return c ? compareNum(c.tokens[name] ?? 0, cmp) : false;
  }
  if ("hpRate" in cond) {
    const { target, ...cmp } = cond.hpRate;
    const id = subjectId(exec, target);
    const c = id ? ctx.state.chars[id] : undefined;
    return c ? compareNum(c.hp, cmp) : false;
  }
  if ("gauge" in cond) {
    const { target, ...cmp } = cond.gauge;
    const id = subjectId(exec, target);
    const c = id ? ctx.state.chars[id] : undefined;
    return c ? compareNum(c.gauge, cmp) : false;
  }
  if ("hasBuff" in cond || "hasDebuff" in cond) {
    const spec = "hasBuff" in cond ? cond.hasBuff : cond.hasDebuff;
    const polarity = "hasBuff" in cond ? "buff" : "debuff";
    const id = subjectId(exec, spec.target);
    return buffsOf(ctx, id).some(
      (b) =>
        b.polarity === polarity &&
        (spec.slot === undefined || b.slot === spec.slot) &&
        (spec.buff === undefined || b.name === spec.buff),
    );
  }
  if ("turnCount" in cond) return compareNum(ctx.state.turn, cond.turnCount);
  if ("element" in cond) {
    const id = subjectId(exec, cond.element.of);
    const el = id === "enemy" ? ctx.state.enemy.element : id ? ctx.input.characters[id]?.element ?? null : null;
    if (el === null) return false;
    return Array.isArray(cond.element.is) ? cond.element.is.includes(el) : cond.element.is === el;
  }
  if ("position" in cond) {
    const id = subjectId(exec, cond.position.target);
    const s = id && id !== "enemy" ? slotOf(ctx, id) : null;
    if (s === null) return false;
    const pos = slotPosition(s);
    return Array.isArray(cond.position.is) ? cond.position.is.includes(pos) : cond.position.is === pos;
  }
  const _exhaustive: never = cond;
  throw new Error(`未知の条件: ${JSON.stringify(_exhaustive)}`);
}
