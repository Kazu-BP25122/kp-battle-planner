/**
 * 効果部品の登録表（registry。§10.1、DSL_PARTS.md §2）。キャラ定義 JSON は効果を名前で参照するだけで、実処理はここに置く（§3-4）。
 * 部品を追加したら schema/dsl.ts・AGENTS.md §10・DSL_PARTS.md・テストを同時に更新する。
 * 省略形（recast・useEffects）は読み込み時に展開済み（schema/expand.ts）なので、ここには来ない。
 */
import type { Duration, Effect } from "../../schema/dsl";
import type { Ctx, Exec } from "../context";
import { charLabel, emit, slotOf, step, warn } from "../context";
import { evalCondition } from "../conditions";
import { resolveTargets } from "../targets";
import { applyBuff, buffList, removeBuff, removeDebuffs } from "../buffs";
import { gainGauge, loseGauge } from "../gauge";
import { performAttack } from "../attack";
import { knockOut, swapWithSub } from "../formation";
import { addToken, consumeToken } from "../tokens";
import { evalValue } from "../values";
import { customEffects } from "../custom";
import type { BuffDuration } from "../types";

type Handler<T extends Effect["type"]> = (ctx: Ctx, exec: Exec, e: Extract<Effect, { type: T }>) => void;
type Registry = { [K in Effect["type"]]: Handler<K> };

/** gaugeUp の量の既定値（説明文に記載がなければ +20。§8.3） */
export const DEFAULT_GAUGE_UP = 20;

/** 持続を実際の値にする（数値の部品はここで評価する） */
export function resolveDuration(ctx: Ctx, exec: Exec, d: Duration | undefined): { duration: BuffDuration; unknown: boolean } {
  if (d === undefined || "permanent" in d) return { duration: { type: "permanent" }, unknown: false };
  if ("count" in d) return { duration: { type: "count", remaining: d.count, consumeOn: d.consumeOn ?? "attack" }, unknown: false };
  if (d.turns === null) return { duration: { type: "permanent" }, unknown: true };
  const n = Math.floor(evalValue(ctx, exec, d.turns));
  // 0 ターン以下になる場合は付与しない扱いにはせず、1 ターンとして扱う
  // TODO(spec): 数値の部品で持続が 0 以下になる場合の扱いは未定義
  return { duration: { type: "turns", remaining: Math.max(1, n) }, unknown: false };
}

const actorOf = (exec: Exec) => (exec.self === "enemy" ? null : exec.self);

const registry: Registry = {
  damage(ctx, exec, e) {
    const hits = Math.max(0, Math.floor(evalValue(ctx, exec, e.hits ?? 1)));
    // ダメージの属性は、指定がなければ発生源キャラの属性（§10.2）
    const element = e.element ?? (exec.self !== "enemy" ? ctx.input.characters[exec.self]?.element : undefined) ?? ctx.state.enemy.element ?? undefined;
    // 敵全体・敵ランダムも初期版は敵 1 体分のヒット数だけ記録する（§10.2）
    for (let i = 0; i < hits; i++) {
      emit(ctx, {
        type: "damage",
        sourceKind: exec.sourceKind,
        actor: actorOf(exec),
        category: e.category,
        ...(element ? { element } : {}),
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

  activateAbility(ctx, exec, e) {
    const charId = e.character === "self" ? exec.self : e.character;
    activateAbility(ctx, exec, charId, e.ability);
  },

  changeCT(ctx, exec, e) {
    const delta = e.amount !== undefined ? evalValue(ctx, exec, e.amount) : 0;
    for (const id of resolveTargets(ctx, exec, e.target)) {
      const d = ctx.input.characters[id];
      const c = ctx.state.chars[id];
      if (!d || !c) continue;
      let abilities = d.abilities;
      if (e.abilities === "self") abilities = abilities.filter((a) => a.id === exec.ability);
      else if (Array.isArray(e.abilities)) {
        const ids = e.abilities;
        abilities = abilities.filter((a) => ids.includes(a.id));
      } else if (e.abilities !== "all") {
        const color = e.abilities.color;
        abilities = abilities.filter((a) => a.color === color);
      }
      for (const a of abilities) {
        const next = e.setTo !== undefined ? e.setTo : (c.ct[a.id] ?? 0) + delta;
        // §10.2 0 未満にも最大値超えにもしない
        c.ct[a.id] = Math.min(a.ct, Math.max(0, next));
      }
    }
  },

  addBuff(ctx, exec, e) {
    const { duration, unknown } = resolveDuration(ctx, exec, e.duration);
    for (const id of resolveTargets(ctx, exec, e.target)) {
      applyBuff(ctx, exec, id, {
        name: e.buff,
        kind: "buff",
        slot: e.slot,
        amount: e.amount,
        polarity: "buff",
        duration,
        durationUnknown: unknown,
        undispellable: e.undispellable ?? false,
        ...(e.stack ? { stack: e.stack } : {}),
      });
    }
  },

  addDebuff(ctx, exec, e) {
    const { duration, unknown } = resolveDuration(ctx, exec, e.duration);
    for (const id of resolveTargets(ctx, exec, e.target)) {
      applyBuff(ctx, exec, id, {
        name: e.buff,
        kind: "buff",
        slot: e.slot,
        amount: e.amount,
        polarity: "debuff",
        duration,
        durationUnknown: unknown,
        undispellable: e.undispellable ?? false,
        ...(e.stack ? { stack: e.stack } : {}),
      });
    }
  },

  addStatus(ctx, exec, e) {
    const { duration, unknown } = resolveDuration(ctx, exec, e.duration);
    for (const id of resolveTargets(ctx, exec, e.target)) {
      applyBuff(ctx, exec, id, {
        name: e.status,
        kind: "status",
        slot: null,
        amount: null,
        // TODO(spec): 状態効果の極性は説明文から決まらない。指定が無ければ、敵に付けたものはデバフ、味方に付けたものはバフとする
        polarity: e.polarity ?? (id === "enemy" ? "debuff" : "buff"),
        duration,
        durationUnknown: unknown,
        undispellable: e.undispellable ?? false,
        ...(e.sources ? { blockSources: e.sources } : {}),
      });
    }
  },

  removeStatus(ctx, exec, e) {
    for (const id of resolveTargets(ctx, exec, e.target)) {
      const list = buffList(ctx, id);
      if (!list) continue;
      for (const b of list.filter((x) => x.kind === "status" && x.name === e.status)) removeBuff(ctx, exec, id, b.uid, "buffRemoved");
    }
  },

  removeDebuff(ctx, exec, e) {
    for (const id of resolveTargets(ctx, exec, e.target)) removeDebuffs(ctx, exec, id, e.count ?? 1);
  },

  heal(ctx, exec, e) {
    // §4.11 回復はイベントの記録だけ行い、HP 割合は変えない
    for (const id of resolveTargets(ctx, exec, e.target)) {
      emit(ctx, {
        type: "heal",
        sourceKind: exec.sourceKind,
        actor: actorOf(exec),
        target: id,
        ...(exec.ability ? { ability: exec.ability } : {}),
        ...(exec.assist ? { assist: exec.assist } : {}),
      });
    }
  },

  gaugeUp(ctx, exec, e) {
    // §8.3 効果による gaugeUp は受け手の上昇量アップを掛ける（fixed なら掛けない）。量の記載がなければ +20
    const amount = evalValue(ctx, exec, e.amount ?? DEFAULT_GAUGE_UP);
    for (const id of resolveTargets(ctx, exec, e.target)) {
      if (id === "enemy") continue;
      gainGauge(ctx, exec, id, amount, "effect", !e.fixed);
    }
  },

  gaugeDown(ctx, exec, e) {
    const amount = evalValue(ctx, exec, e.amount);
    for (const id of resolveTargets(ctx, exec, e.target)) {
      if (id === "enemy") continue;
      loseGauge(ctx, exec, id, amount, "effect");
    }
  },

  addToken(ctx, exec, e) {
    const amount = Math.floor(evalValue(ctx, exec, e.amount));
    for (const id of resolveTargets(ctx, exec, e.target)) {
      if (id === "enemy") continue;
      addToken(ctx, exec, id, e.name, amount);
    }
  },

  consumeToken(ctx, exec, e) {
    const amount = e.amount === "all" ? "all" : Math.floor(evalValue(ctx, exec, e.amount));
    for (const id of resolveTargets(ctx, exec, e.target)) {
      if (id === "enemy") continue;
      consumeToken(ctx, exec, id, { name: e.name, group: e.group }, amount);
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

  repeat(ctx, exec, e) {
    // 回数は始める前に 1 回だけ評価する（繰り返しの中でトークンが変わっても回数は変えない）
    const n = Math.max(0, Math.floor(evalValue(ctx, exec, e.times)));
    for (let i = 0; i < n; i++) runEffects(ctx, exec, e.effects);
  },

  recast(ctx, exec) {
    warn(ctx, "dataError", `省略形 recast が展開されていない（${exec.label}）`);
  },

  useEffects(ctx, exec, e) {
    warn(ctx, "dataError", `省略形 useEffects「${e.id}」が展開されていない（${exec.label}）`);
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

/**
 * アビの発動（activateAbility。§10.2）。abilityActivated（経路 effect）だけを記録し、abilityUsed は記録しない。
 * 発動したアビの CT は変えない（確定）。
 * TODO(spec): §10.2・§11 コストを払わず、1 ターン上限・戦闘上限にも数えない（仮置き）
 * 発動したアビの効果で生じたイベントのアシストは、キューに積まれ、発動元の処理が終わってから判定される（§6）。
 */
export function activateAbility(ctx: Ctx, parent: Exec, charId: string, abilityId: string): void {
  const d = ctx.input.characters[charId];
  const ab = d?.abilities.find((a) => a.id === abilityId);
  if (!d || !ab || !ctx.state.chars[charId]) {
    warn(ctx, "dataError", `発動するアビ「${abilityId}」が見つからない（${charLabel(ctx, charId)}）`);
    return;
  }
  emit(ctx, { type: "abilityActivated", sourceKind: parent.sourceKind, actor: charId, ability: ab.id, color: ab.color, route: "effect" });
  const exec: Exec = {
    self: charId,
    sourceKind: "ability",
    ability: ab.id,
    defaultCategory: "ability",
    label: `${d.name} ${ab.name}（発動）`,
    dealtDamage: false,
  };
  if (parent.chosenAlly !== undefined) exec.chosenAlly = parent.chosenAlly;
  if (parent.window !== undefined) exec.window = parent.window;
  runEffects(ctx, exec, ab.effects);
}

export function runEffect(ctx: Ctx, exec: Exec, e: Effect): void {
  step(ctx);
  (registry[e.type] as (ctx: Ctx, exec: Exec, e: Effect) => void)(ctx, exec, e);
}

/** effects 配列は上から順に処理する（§10.2） */
export function runEffects(ctx: Ctx, exec: Exec, effects: readonly Effect[]): void {
  for (const e of effects) runEffect(ctx, exec, e);
}
