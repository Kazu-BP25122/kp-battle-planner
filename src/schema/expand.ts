/**
 * 省略形の展開（§6 即リキャ `recast`、§10.2 共有の効果 `useEffects`）。
 * 読み込み時に部品の組み合わせへ展開し、エンジンは展開後の部品だけを扱う。
 */
import type { Assist, Effect } from "./dsl";
import type { Character } from "./character";

export class ExpandError extends Error {}

/** recast → if when then [changeCT(self, abilities self, setTo 0)] */
export function expandRecast(e: Extract<Effect, { type: "recast" }>): Effect {
  const out: Effect = {
    type: "if",
    cond: e.when,
    then: [{ type: "changeCT", target: "self", abilities: "self", setTo: 0 }],
  };
  if (e.note !== undefined) out.note = e.note;
  return out;
}

/**
 * 効果の配列を展開する。shared はキャラの sharedEffects。
 * inShared が true なら useEffects を禁止する（呼び出し先の中で useEffects は使えない。§10.2）。
 */
export function expandEffects(effects: readonly Effect[], shared: Record<string, Effect[]> | undefined, inShared = false): Effect[] {
  const out: Effect[] = [];
  for (const e of effects) {
    switch (e.type) {
      case "recast":
        out.push(expandRecast(e));
        break;
      case "useEffects": {
        if (inShared) throw new ExpandError(`sharedEffects の中で useEffects は使えない（${e.id}）`);
        const body = shared?.[e.id];
        if (!body) throw new ExpandError(`sharedEffects に「${e.id}」が無い`);
        out.push(...expandEffects(body, shared, true));
        break;
      }
      case "if": {
        const x: Effect = { ...e, then: expandEffects(e.then, shared, inShared) };
        if (e.else) x.else = expandEffects(e.else, shared, inShared);
        out.push(x);
        break;
      }
      case "switch": {
        const x: Effect = { ...e, cases: e.cases.map((c) => ({ cond: c.cond, then: expandEffects(c.then, shared, inShared) })) };
        if (e.default) x.default = expandEffects(e.default, shared, inShared);
        out.push(x);
        break;
      }
      case "repeat":
        out.push({ ...e, effects: expandEffects(e.effects, shared, inShared) });
        break;
      default:
        out.push(e);
    }
  }
  return out;
}

export function expandAssist(a: Assist, shared: Record<string, Effect[]> | undefined): Assist {
  return { ...a, effects: expandEffects(a.effects, shared) };
}

const cache = new WeakMap<Character, Character>();

/** キャラ定義の省略形をすべて展開する（結果はキャッシュする。展開済みのものを渡しても同じ結果） */
export function expandCharacter(c: Character): Character {
  const hit = cache.get(c);
  if (hit) return hit;
  const shared = c.sharedEffects;
  const out: Character = {
    ...c,
    abilities: c.abilities.map((a) => ({ ...a, effects: expandEffects(a.effects, shared) })),
    burst: { ...c.burst, ...(c.burst.effects ? { effects: expandEffects(c.burst.effects, shared) } : {}) },
  };
  if (c.assists) out.assists = c.assists.map((a) => expandAssist(a, shared));
  cache.set(c, out);
  cache.set(out, out);
  return out;
}

/** 効果の木に省略形が残っていないか */
export function hasShorthand(effects: readonly Effect[]): boolean {
  return effects.some((e) => {
    if (e.type === "recast" || e.type === "useEffects") return true;
    if (e.type === "if") return hasShorthand(e.then) || hasShorthand(e.else ?? []);
    if (e.type === "switch") return e.cases.some((c) => hasShorthand(c.then)) || hasShorthand(e.default ?? []);
    if (e.type === "repeat") return hasShorthand(e.effects);
    return false;
  });
}
