/**
 * 固有トークン（§4.2）。上限（種類・グループ）を超えて付与した分は破棄する。
 * 付与・消費は tokenAdded / tokenConsumed イベントとして記録する（§4.7）。トークンのイベントの発生源キャラは持ち主。
 */
import type { Ctx, Exec } from "./context";
import { charLabel, emit, warn } from "./context";

export interface TokenSelector {
  name?: string | undefined;
  group?: string | undefined;
}

function tokenNamesOf(ctx: Ctx, charId: string, sel: TokenSelector): string[] {
  const def = ctx.input.characters[charId];
  if (sel.group !== undefined) return (def?.tokens ?? []).filter((t) => t.group === sel.group).map((t) => t.name);
  return sel.name !== undefined ? [sel.name] : [];
}

/** 所持数（group ならグループの合計） */
export function tokenCount(ctx: Ctx, charId: string, sel: TokenSelector): number {
  const c = ctx.state.chars[charId];
  if (!c) return 0;
  return tokenNamesOf(ctx, charId, sel).reduce((n, name) => n + (c.tokens[name] ?? 0), 0);
}

/** トークンを付与する。戻り値は実際に増えた数 */
export function addToken(ctx: Ctx, exec: Exec, charId: string, name: string, amount: number): number {
  const c = ctx.state.chars[charId];
  if (!c || amount <= 0) return 0;
  const def = ctx.input.characters[charId];
  const t = def?.tokens?.find((x) => x.name === name);
  if (!t) warn(ctx, "dataError", `${charLabel(ctx, charId)}にトークン「${name}」が定義されていない`, charId);
  const cur = c.tokens[name] ?? 0;
  let room = Infinity;
  if (t?.max !== undefined) room = Math.min(room, t.max - cur);
  if (t?.group !== undefined) {
    const g = def?.tokenGroups?.find((x) => x.name === t.group);
    if (g?.max !== undefined) room = Math.min(room, g.max - tokenCount(ctx, charId, { group: g.name }));
  }
  const added = Math.max(0, Math.min(amount, room));
  if (added < amount) {
    // TODO(spec): §11 上限で破棄されたときに警告表示するか（表示する方向で仮置き）
    warn(ctx, "tokenOverflow", `${charLabel(ctx, charId)}の「${name}」が上限のため ${amount - added} 個破棄された`, charId);
  }
  if (added === 0) return 0;
  c.tokens[name] = cur + added;
  emit(ctx, {
    type: "tokenAdded",
    sourceKind: exec.sourceKind,
    actor: charId,
    token: name,
    amount: added,
    ...(exec.ability ? { ability: exec.ability } : {}),
    ...(exec.assist ? { assist: exec.assist } : {}),
  });
  return added;
}

/**
 * トークンを消費する。amount が "all" なら全部。group を指定したら、グループ内の種類を定義の順に消費する。
 * 戻り値は実際に減った数の合計。
 * TODO(spec): グループ全体から数を指定して消費するときの順番は未定義（定義の順で仮置き）
 */
export function consumeToken(ctx: Ctx, exec: Exec, charId: string, sel: TokenSelector, amount: number | "all"): number {
  const c = ctx.state.chars[charId];
  if (!c) return 0;
  let left = amount === "all" ? Infinity : amount;
  let total = 0;
  for (const name of tokenNamesOf(ctx, charId, sel)) {
    if (left <= 0) break;
    const cur = c.tokens[name] ?? 0;
    const take = Math.min(cur, left);
    if (take <= 0) continue;
    c.tokens[name] = cur - take;
    left -= take;
    total += take;
    emit(ctx, {
      type: "tokenConsumed",
      sourceKind: exec.sourceKind,
      actor: charId,
      token: name,
      amount: take,
      ...(exec.ability ? { ability: exec.ability } : {}),
      ...(exec.assist ? { assist: exec.assist } : {}),
    });
  }
  return total;
}
