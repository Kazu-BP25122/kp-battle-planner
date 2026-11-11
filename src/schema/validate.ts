/**
 * スキーマだけでは見られないデータの検査（§16.1 手順 2）。
 * - slot が buffSlots.json にあるか（極性も一致するか）
 * - トークン・トークングループ・アビ・アシスト・オプション・共有の効果・custom の参照先があるか
 * - 省略形を展開した後の入れ子が 3 段以内か
 * scripts/validate-data.ts と tests/ の両方から使う。
 */
import type { BuffSlot } from "./buffSlot";
import type { Character } from "./character";
import { MAX_EFFECT_DEPTH, effectDepth, type Effect } from "./dsl";
import { ExpandError, expandCharacter } from "./expand";

export interface DataIssue {
  file: string;
  path: string;
  message: string;
}

export interface ValidateContext {
  buffSlots: readonly BuffSlot[];
  /** 検査するキャラすべて（他キャラのアビ・アシストの参照先を探すため） */
  characters: readonly Character[];
  /** エンジンに登録済みの custom の ID */
  customIds: ReadonlySet<string>;
}

type Where = "ability" | "assist" | "burst" | "shared";

export function validateCharacter(c: Character, vc: ValidateContext, file = `${c.id}.json`): DataIssue[] {
  const issues: DataIssue[] = [];
  const add = (path: string, message: string) => issues.push({ file, path, message });

  const slots = new Map(vc.buffSlots.map((s) => [s.id, s]));
  const tokens = new Set((c.tokens ?? []).map((t) => t.name));
  const groups = new Set((c.tokenGroups ?? []).map((g) => g.name));
  const ownAbilities = new Set(c.abilities.map((a) => a.id));
  const allAbilities = new Set(vc.characters.flatMap((x) => x.abilities.map((a) => a.id)));
  const allAssists = new Set(vc.characters.flatMap((x) => (x.assists ?? []).map((a) => a.id)));
  const options = new Set((c.options ?? []).map((o) => o.id));
  const shared = c.sharedEffects ?? {};

  for (const t of c.tokens ?? []) {
    if (t.group !== undefined && !groups.has(t.group)) add(`tokens.${t.name}`, `トークングループ「${t.group}」が tokenGroups に無い`);
  }

  const checkTokenRef = (path: string, ref: { name?: unknown; group?: unknown; target?: unknown }) => {
    if (ref.target === "chosenAlly") return; // 他キャラのトークンは検査できない
    if (typeof ref.name === "string" && !tokens.has(ref.name)) add(path, `トークン「${ref.name}」が tokens に無い`);
    if (typeof ref.group === "string" && !groups.has(ref.group)) add(path, `トークングループ「${ref.group}」が tokenGroups に無い`);
  };

  const checkFilter = (path: string, f: Record<string, unknown>, where: Where) => {
    if (typeof f.ability === "string") {
      if (f.ability === "self") {
        if (where !== "ability") add(path, "フィルターの ability: \"self\" はアビの中でだけ使える。アシストではアビ ID を直接書く（§10.2）");
      } else if (!allAbilities.has(f.ability)) add(path, `アビ「${f.ability}」が見つからない`);
    }
    if (typeof f.assist === "string" && !allAssists.has(f.assist)) add(path, `アシスト「${f.assist}」が見つからない`);
    if (typeof f.token === "string" && !tokens.has(f.token)) add(path, `トークン「${f.token}」が tokens に無い`);
  };

  /** JSON の木を歩いて参照を検査する */
  const walk = (node: unknown, path: string, where: Where): void => {
    if (Array.isArray(node)) {
      node.forEach((x, i) => walk(x, `${path}[${i}]`, where));
      return;
    }
    if (node === null || typeof node !== "object") return;
    const o = node as Record<string, unknown>;

    if (typeof o.type === "string") {
      const e = o as unknown as Effect;
      switch (e.type) {
        case "addBuff":
        case "addDebuff": {
          const s = slots.get(e.slot);
          const pol = e.type === "addBuff" ? "buff" : "debuff";
          if (!s) add(path, `枠「${e.slot}」が buffSlots.json に無い（§7.2）`);
          else if (s.polarity !== pol) add(path, `枠「${e.slot}」の極性は ${s.polarity}（${e.type} と一致しない）`);
          break;
        }
        case "addToken":
          checkTokenRef(path, { name: e.name, target: e.target });
          break;
        case "consumeToken":
          checkTokenRef(path, { name: e.name, group: e.group, target: e.target });
          break;
        case "activateAbility":
          if (e.character === "self" && !ownAbilities.has(e.ability)) add(path, `アビ「${e.ability}」がこのキャラに無い`);
          else if (e.character !== "self" && !allAbilities.has(e.ability)) add(path, `アビ「${e.ability}」が見つからない`);
          break;
        case "changeCT":
          if (e.abilities === "self" && where !== "ability") add(path, "changeCT の abilities: \"self\" はアビの中でだけ使える");
          if (Array.isArray(e.abilities)) {
            for (const id of e.abilities) {
              const pool = e.target === "self" ? ownAbilities : allAbilities;
              if (!pool.has(id)) add(path, `アビ「${id}」が見つからない`);
            }
          }
          break;
        case "useEffects":
          if (!(e.id in shared)) add(path, `sharedEffects に「${e.id}」が無い`);
          break;
        case "custom":
          if (!vc.customIds.has(e.id)) add(path, `専用処理「${e.id}」がエンジンに登録されていない（src/engine/custom）`);
          break;
      }
    }
    if ("useCount" in o && typeof o.useCount === "object" && o.useCount !== null) {
      const ab = (o.useCount as { ability?: unknown }).ability;
      if (ab === "self") {
        if (where !== "ability") add(path, "useCount の ability: \"self\" はアビの中でだけ使える");
      } else if (typeof ab === "string" && !ownAbilities.has(ab)) add(path, `アビ「${ab}」がこのキャラに無い`);
    }
    if ("token" in o && typeof o.token === "object" && o.token !== null && !("amount" in (o.token as object))) {
      checkTokenRef(`${path}.token`, o.token as Record<string, unknown>);
    }
    if ("token" in o && typeof o.token === "object" && o.token !== null && "amount" in (o.token as object)) {
      // コストのトークン
      checkTokenRef(`${path}.token`, { name: (o.token as { name?: unknown }).name });
    }
    if ("count" in o && typeof o.count === "object" && o.count !== null) {
      const f = (o.count as { filter?: unknown }).filter;
      if (f && typeof f === "object") checkFilter(`${path}.count.filter`, f as Record<string, unknown>, where);
    }
    if ("trigger" in o && typeof o.trigger === "object" && o.trigger !== null) {
      const t = o.trigger as Record<string, unknown>;
      // アシストの trigger（{event, filter}）と条件の trigger（フィルター）
      const f = "event" in t ? (t.filter as Record<string, unknown> | undefined) : t;
      if (f) checkFilter(`${path}.trigger`, f, where);
    }
    if ("option" in o && typeof o.option === "object" && o.option !== null) {
      const id = (o.option as { id?: unknown }).id;
      if (typeof id === "string" && !options.has(id)) add(`${path}.option`, `オプション「${id}」が options に無い`);
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === "trigger" && where !== "assist") continue;
      walk(v, `${path}.${k}`, where);
    }
  };

  c.abilities.forEach((a, i) => walk(a, `abilities[${i}](${a.id})`, "ability"));
  (c.assists ?? []).forEach((a, i) => walk(a, `assists[${i}](${a.id})`, "assist"));
  walk(c.burst, "burst", "burst");
  for (const [k, v] of Object.entries(shared)) walk(v, `sharedEffects.${k}`, "shared");

  // 省略形を展開した後の入れ子の段数
  try {
    const x = expandCharacter(c);
    const lists: [string, readonly Effect[]][] = [
      ...x.abilities.map((a) => [`abilities(${a.id})`, a.effects] as [string, Effect[]]),
      ...(x.assists ?? []).map((a) => [`assists(${a.id})`, a.effects] as [string, Effect[]]),
      ["burst", x.burst.effects ?? []],
    ];
    for (const [p, effects] of lists) {
      const d = effectDepth(effects);
      if (d > MAX_EFFECT_DEPTH) add(p, `展開後の入れ子が ${d} 段（${MAX_EFFECT_DEPTH} 段まで。§10.2）`);
    }
  } catch (e) {
    if (e instanceof ExpandError) add("sharedEffects", e.message);
    else throw e;
  }
  return issues;
}

export function validateAll(vc: ValidateContext, files?: readonly string[]): DataIssue[] {
  return vc.characters.flatMap((c, i) => validateCharacter(c, vc, files?.[i]));
}
