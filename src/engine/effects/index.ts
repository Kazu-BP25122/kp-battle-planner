/**
 * 効果部品の登録表（registry。§10.1）。キャラ定義 JSON は効果を名前で参照するだけで、実処理はここに置く（§3-4）。
 * 部品を追加したら schema/dsl.ts・AGENTS.md §10.1・テストを同時に更新する。
 */
import type { Effect } from "../../schema/dsl";
import type { Ctx, Exec } from "../context";
import { charLabel, emit, slotOf, step, warn } from "../context";
import { evalCondition } from "../conditions";
import { resolveTargets } from "../targets";
import { applyBuff, buffList, removeBuff } from "../buffs";
import { gainGauge, loseGauge } from "../gauge";
import { performAttack } from "../attack";
import { knockOut, swapWithSub } from "../formation";
import { customEffects } from "../custom";

type Handler<T extends Effect["type"]> = (ctx: Ctx, exec: Exec, e: Extract<Effect, { type: T }>) => void;
type Registry = { [K in Effect["type"]]: Handler<K> };

const registry: Registry = {
  damage(ctx, exec, e) {
    const hits = e.hits ?? 1;
    const category = e.category ?? exec.defaultCategory;
    for (let i = 0; i < hits; i++) {
      emit(ctx, {
        type: "damage",
        sourceKind: exec.sourceKind,
        actor: exec.self === "enemy" ? null : exec.self,
        category,
        target: "enemy",
        ...(exec.ability ? { ability: exec.ability } : {}),
        ...(exec.assist ? { assist: exec.assist } : {}),
      });
    }
    if (hits > 0) exec.dealtDamage = true;
  },

  performAttack(ctx, exec, e) {
    const attackers = resolveTargets(ctx, exec, e.attacker);
    // TODO(spec): §11「味方全体が即座にバースト」の撃つ順番は編成順と仮定（resolveTargets は隊列順）
    for (const id of attackers) {
      for (let i = 0; i < (e.times ?? 1); i++) {
        performAttack(ctx, exec, id, e.kind, { origin: "ability", ...(e.gaugeAfter ? { gaugeAfter: e.gaugeAfter } : {}) });
      }
    }
  },

  addStatus(ctx, exec, e) {
    for (const id of resolveTargets(ctx, exec, e.target)) {
      applyBuff(ctx, exec, id, {
        name: e.status,
        kind: "status",
        slot: null,
        amount: null,
        // TODO(spec): 状態効果の極性の既定値は未定義。指定が無ければ buff（removeDebuff で消えない）とする
        polarity: e.polarity ?? "buff",
        duration: e.duration,
        removable: e.removable ?? true,
        ...(e.sources ? { blockSources: e.sources } : {}),
      });
    }
  },

  heal(ctx, exec, e) {
    // §4.11 回復はイベントの記録だけ行い、HP 割合は変えない
    for (const id of resolveTargets(ctx, exec, e.target)) {
      emit(ctx, { type: "heal", sourceKind: exec.sourceKind, actor: exec.self === "enemy" ? null : exec.self, target: id });
    }
  },

  addBuff(ctx, exec, e) {
    for (const id of resolveTargets(ctx, exec, e.target)) {
      applyBuff(ctx, exec, id, { name: e.buff, kind: "buff", slot: e.slot, amount: e.amount, polarity: "buff", duration: e.duration, removable: e.removable ?? true });
    }
  },

  addDebuff(ctx, exec, e) {
    for (const id of resolveTargets(ctx, exec, e.target)) {
      applyBuff(ctx, exec, id, { name: e.buff, kind: "buff", slot: e.slot, amount: e.amount, polarity: "debuff", duration: e.duration, removable: e.removable ?? true });
    }
  },

  removeDebuff(ctx, exec, e) {
    for (const id of resolveTargets(ctx, exec, e.target)) {
      const list = buffList(ctx, id);
      if (!list) continue;
      // TODO(spec): §11「状態異常 1 個回復」で消す順番は未確定。古い順とする
      const removable = list.filter((b) => b.polarity === "debuff" && b.removable);
      const n = e.count === "all" ? removable.length : Math.min(e.count ?? 1, removable.length);
      for (const b of removable.slice(0, n)) removeBuff(ctx, exec, id, b.uid, "buffRemoved");
    }
  },

  gaugeUp(ctx, exec, e) {
    // §8.3 効果による gaugeUp は受け手の上昇量アップを掛ける
    for (const id of resolveTargets(ctx, exec, e.target)) {
      if (id === "enemy") continue;
      gainGauge(ctx, exec, id, e.amount, "effect", true);
    }
  },

  gaugeDown(ctx, exec, e) {
    for (const id of resolveTargets(ctx, exec, e.target)) {
      if (id === "enemy") continue;
      loseGauge(ctx, exec, id, e.amount, "effect");
    }
  },

  changeCT(ctx, exec, e) {
    for (const id of resolveTargets(ctx, exec, e.target)) {
      const c = ctx.state.chars[id];
      if (!c) continue;
      const ids = e.abilities === "all" ? Object.keys(c.ct) : e.abilities;
      for (const a of ids) {
        if (c.ct[a] === undefined) continue;
        // §6 CT は 0 未満にしない
        c.ct[a] = Math.max(0, c.ct[a]! + e.amount);
      }
    }
  },

  addToken(ctx, exec, e) {
    for (const id of resolveTargets(ctx, exec, e.target)) {
      const c = ctx.state.chars[id];
      if (!c) continue;
      const max = ctx.input.characters[id]?.tokens?.find((t) => t.name === e.token)?.max;
      // TODO(spec): §11 トークンの最大数は未確定。定義に max があれば上限とする
      const next = (c.tokens[e.token] ?? 0) + e.amount;
      c.tokens[e.token] = Math.max(0, max !== undefined ? Math.min(max, next) : next);
    }
  },

  consumeToken(ctx, exec, e) {
    for (const id of resolveTargets(ctx, exec, e.target)) {
      const c = ctx.state.chars[id];
      if (!c) continue;
      c.tokens[e.token] = Math.max(0, (c.tokens[e.token] ?? 0) - e.amount);
    }
  },

  swapWithSub(ctx, exec, e) {
    for (const id of resolveTargets(ctx, exec, e.target)) {
      if (id === "enemy") continue;
      swapWithSub(ctx, exec, id);
    }
  },

  retire(ctx, exec, e) {
    // TODO(spec): §11 retire の補充タイミングは未確定。戦闘不能と同じくターンエンド処理で補充する
    for (const id of resolveTargets(ctx, exec, e.target)) {
      if (id === "enemy" || slotOf(ctx, id) === null) continue;
      knockOut(ctx, exec, id);
    }
  },

  if(ctx, exec, e) {
    if (evalCondition(ctx, exec, e.cond)) runEffects(ctx, exec, e.then);
    else if (e.else) runEffects(ctx, exec, e.else);
  },

  switch(ctx, exec, e) {
    for (const c of e.cases) {
      if (evalCondition(ctx, exec, c.cond)) {
        runEffects(ctx, exec, c.then);
        return;
      }
    }
    if (e.default) runEffects(ctx, exec, e.default);
  },

  custom(ctx, exec, e) {
    const fn = customEffects[e.id];
    if (!fn) {
      warn(ctx, "customMissing", `専用処理「${e.id}」が登録されていない（${charLabel(ctx, exec.self)}）`);
      return;
    }
    fn(ctx, exec, e.params ?? {});
  },
};

export function runEffect(ctx: Ctx, exec: Exec, e: Effect): void {
  step(ctx);
  (registry[e.type] as (ctx: Ctx, exec: Exec, e: Effect) => void)(ctx, exec, e);
}

/** effects 配列は上から順に処理する（§10.2） */
export function runEffects(ctx: Ctx, exec: Exec, effects: readonly Effect[]): void {
  for (const e of effects) runEffect(ctx, exec, e);
}
