/**
 * 数値の部品（§10.2、DSL_PARTS.md §6）と、条件と共通の集計（useCount・count・token）。
 */
import type { CountRef, NumOrValue, TokenRef, UseCountRef } from "../schema/dsl";
import type { Ctx, Exec } from "./context";
import { countEvents } from "./query";
import { tokenCount } from "./tokens";

/**
 * アビの使用回数（kind: used = abilityUsed）・発動回数（activated = abilityActivated）。
 * 評価する時点のログで数える（§6 コスト）。効果の中では今回を含み、コスト・使用条件では含まない。
 */
export function useCountOf(ctx: Ctx, exec: Exec, ref: UseCountRef): number {
  const abilityId = ref.ability === "self" ? exec.ability : ref.ability;
  if (abilityId === undefined) return 0;
  return countEvents(ctx.state.log, {
    event: (ref.kind ?? "used") === "used" ? "abilityUsed" : "abilityActivated",
    filter: { ability: abilityId, source: "self" },
    scope: ref.scope,
    turn: ctx.state.turn,
    owner: exec.self,
    ...(exec.window ? { window: exec.window } : {}),
  });
}

export function countOf(ctx: Ctx, exec: Exec, ref: CountRef): number {
  return countEvents(ctx.state.log, {
    event: ref.event,
    scope: ref.scope,
    turn: ctx.state.turn,
    owner: exec.self,
    ...(ref.filter ? { filter: ref.filter } : {}),
    ...(ref.sum ? { sum: ref.sum } : {}),
    ...(exec.window ? { window: exec.window } : {}),
  });
}

export function tokenOf(ctx: Ctx, exec: Exec, ref: TokenRef): number {
  const id = ref.target === "chosenAlly" ? exec.chosenAlly : exec.self;
  if (id === undefined) return 0;
  return tokenCount(ctx, id, { name: ref.name, group: ref.group });
}

/** 数または数値の部品を評価する。計算の順は mul → add → min / max */
export function evalValue(ctx: Ctx, exec: Exec, v: NumOrValue): number {
  if (typeof v === "number") return v;
  let n: number;
  if ("useCount" in v) n = useCountOf(ctx, exec, v.useCount);
  else if ("count" in v) n = countOf(ctx, exec, v.count);
  else n = tokenOf(ctx, exec, v.token);
  if (v.mul !== undefined) n *= v.mul;
  if (v.add !== undefined) n += v.add;
  if (v.min !== undefined) n = Math.max(v.min, n);
  if (v.max !== undefined) n = Math.min(v.max, n);
  return n;
}
