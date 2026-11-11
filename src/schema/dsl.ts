/**
 * 効果記述 DSL（§10）の Zod スキーマ。部品の項目は DSL_PARTS.md に合わせる。
 * 部品を追加したら、ここ・engine の registry・AGENTS.md §10・DSL_PARTS.md を同時に更新すること。
 * データにコードを書かせない（§3-4）。custom も ID で参照するだけ。
 */
import { z } from "zod";
import {
  Category,
  Color,
  Element,
  EventType,
  GaugeBlockSource,
  GaugeMeans,
  NumCompare,
  Polarity,
  Position,
  SourceKind,
} from "./common";

const oneOrMany = <T extends z.ZodType>(s: T) => z.union([s, z.array(s)]);
type OneOrMany<T> = T | T[];
const note = z.string().optional();
const Scope = z.enum(["turn", "battle"]);
type Scope = z.infer<typeof Scope>;

// ---------------------------------------------------------------- 対象（target）

export const AlliesWhere = z
  .object({
    element: oneOrMany(Element).optional(),
    position: oneOrMany(Position).optional(),
    /** 自分を除く（「自分以外の味方全体」） */
    excludeSelf: z.boolean().optional(),
    /** サブも含める（「サブメンバー含む」）。なければメインだけ */
    includeSub: z.boolean().optional(),
  })
  .strict();
export type AlliesWhere = z.infer<typeof AlliesWhere>;

export const TARGET_NAMES = ["self", "allAllies", "chosenAlly", "enemy", "allEnemies", "randomEnemy"] as const;
export const Target = z.union([z.enum(TARGET_NAMES), z.object({ alliesWhere: AlliesWhere }).strict()]);
export type Target = z.infer<typeof Target>;

/** 攻撃するキャラの指定（performAttack.attacker）。味方の対象と同じ書き方 */
export const AttackerTarget = z.union([
  z.enum(["self", "allAllies", "chosenAlly"]),
  z.object({ alliesWhere: AlliesWhere }).strict(),
]);

/** 敵の対象（damage.target）。初期版は敵 1 体として扱う（§10.2） */
export const EnemyTarget = z.enum(["enemy", "allEnemies", "randomEnemy"]);

// ---------------------------------------------------------------- イベントの絞り込み（§4.7、DSL_PARTS.md §8）

export const EventFilter = z
  .object({
    ability: z.string().optional(),
    color: oneOrMany(Color).optional(),
    /** イベントを起こしたキャラの属性 */
    sourceElement: oneOrMany(Element).optional(),
    /** ダメージの属性（damage のみ） */
    element: oneOrMany(Element).optional(),
    category: oneOrMany(Category).optional(),
    /** 持ち主から見て、発生源キャラが自分か自分以外か */
    source: z.enum(["self", "others"]).optional(),
    /** 発動の経路（abilityActivated のみ） */
    route: z.enum(["use", "effect"]).optional(),
    /** トークン名（tokenAdded・tokenConsumed のみ） */
    token: z.string().optional(),
    /** アシスト ID（assistTriggered のみ） */
    assist: z.string().optional(),
    // 以下は §4.7「filter は上表のどの項目でも絞り込める」による追加の項目（DSL_PARTS.md §8 に記載）
    sourceKind: oneOrMany(SourceKind).optional(),
    slot: z.string().optional(),
    buff: z.string().optional(),
    polarity: Polarity.optional(),
    means: oneOrMany(GaugeMeans).optional(),
    /** 対象キャラ（gaugeChanged・buff* など）。"self" は持ち主 */
    target: z.string().optional(),
    /** 通常攻撃・バーストの発生元 */
    origin: z.enum(["attackPhase", "ability"]).optional(),
    /** 登場の経路（enterBattle のみ） */
    via: z.enum(["replenish", "swap"]).optional(),
  })
  .strict();
export type EventFilter = z.infer<typeof EventFilter>;

// ---------------------------------------------------------------- 数値の部品（§10.2、DSL_PARTS.md §6）

const Calc = {
  mul: z.number().optional(),
  add: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
};
type Calc = { mul?: number; add?: number; min?: number; max?: number };

const UseCountRef = z
  .object({ ability: z.string(), scope: Scope, kind: z.enum(["used", "activated"]).optional() })
  .strict();
const CountRef = z
  .object({ event: EventType, filter: EventFilter.optional(), scope: Scope, sum: z.literal("amount").optional() })
  .strict();
const TokenSubject = z.enum(["self", "chosenAlly"]);
const TokenRef = z
  .object({ name: z.string().optional(), group: z.string().optional(), target: TokenSubject.optional() })
  .strict()
  .refine((t) => (t.name === undefined) !== (t.group === undefined), { message: "token は name か group のどちらか一方を書く" });

export type UseCountRef = z.infer<typeof UseCountRef>;
export type CountRef = z.infer<typeof CountRef>;
export type TokenRef = z.infer<typeof TokenRef>;

export type ValuePart = ({ useCount: UseCountRef } | { count: CountRef } | { token: TokenRef }) & Calc;
export const ValuePart: z.ZodType<ValuePart> = z.union([
  z.object({ useCount: UseCountRef, ...Calc }).strict(),
  z.object({ count: CountRef, ...Calc }).strict(),
  z.object({ token: TokenRef, ...Calc }).strict(),
]);
/** 数、または数値の部品 */
export const NumOrValue = z.union([z.number(), ValuePart]);
export type NumOrValue = number | ValuePart;

// ---------------------------------------------------------------- 条件（cond。DSL_PARTS.md §4）

const Subject = z.enum(["self", "chosenAlly", "enemy"]);
type Subject = z.infer<typeof Subject>;
const AllySubject = z.enum(["self", "chosenAlly"]);
type AllySubject = z.infer<typeof AllySubject>;

export type Condition =
  | { count: CountRef & NumCompare }
  | { useCount: UseCountRef & NumCompare }
  | { token: TokenRef & NumCompare }
  | { hpRate: { target?: AllySubject } & NumCompare }
  | { gauge: { target?: AllySubject } & NumCompare }
  | { hasBuff: { target?: Subject; buff?: string; slot?: string; stacks?: NumCompare } }
  | { hasDebuff: { target?: Subject; buff?: string; slot?: string; stacks?: NumCompare } }
  | { hasStatus: { target?: Subject; status: string } }
  | { turnCount: NumCompare }
  | { element: { target?: Subject; is: OneOrMany<z.infer<typeof Element>> } }
  | { position: { target?: AllySubject; is: OneOrMany<z.infer<typeof Position>> } }
  | { trigger: EventFilter }
  | { partyAll: { element?: OneOrMany<z.infer<typeof Element>> } }
  | { option: { id: string; is: boolean | string | number } }
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition };

const HasBuffSpec = z
  .object({ target: Subject.optional(), buff: z.string().optional(), slot: z.string().optional(), stacks: NumCompare.optional() })
  .strict();

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ count: CountRef.extend(NumCompare.shape).strict() }).strict(),
    z.object({ useCount: UseCountRef.extend(NumCompare.shape).strict() }).strict(),
    z
      .object({
        token: z
          .object({ name: z.string().optional(), group: z.string().optional(), target: TokenSubject.optional() })
          .extend(NumCompare.shape)
          .strict()
          .refine((t) => (t.name === undefined) !== (t.group === undefined), { message: "token は name か group のどちらか一方を書く" }),
      })
      .strict(),
    z.object({ hpRate: z.object({ target: AllySubject.optional() }).extend(NumCompare.shape).strict() }).strict(),
    z.object({ gauge: z.object({ target: AllySubject.optional() }).extend(NumCompare.shape).strict() }).strict(),
    z.object({ hasBuff: HasBuffSpec }).strict(),
    z.object({ hasDebuff: HasBuffSpec }).strict(),
    z.object({ hasStatus: z.object({ target: Subject.optional(), status: z.string() }).strict() }).strict(),
    z.object({ turnCount: NumCompare }).strict(),
    z.object({ element: z.object({ target: Subject.optional(), is: oneOrMany(Element) }).strict() }).strict(),
    z.object({ position: z.object({ target: AllySubject.optional(), is: oneOrMany(Position) }).strict() }).strict(),
    z.object({ trigger: EventFilter }).strict(),
    z.object({ partyAll: z.object({ element: oneOrMany(Element).optional() }).strict() }).strict(),
    z.object({ option: z.object({ id: z.string(), is: z.union([z.boolean(), z.string(), z.number()]) }).strict() }).strict(),
    z.object({ and: z.array(Condition) }).strict(),
    z.object({ or: z.array(Condition) }).strict(),
    z.object({ not: Condition }).strict(),
  ]),
);

// ---------------------------------------------------------------- 持続・累積（DSL_PARTS.md §7）

export type Duration =
  | { turns: number | ValuePart | null }
  | { count: number; consumeOn?: "attack" | "damaged" }
  | { permanent: true };
export const Duration: z.ZodType<Duration> = z.union([
  /** turns: null は不明 */
  z.object({ turns: z.union([z.number().int().positive(), ValuePart, z.null()]) }).strict(),
  z
    .object({
      count: z.number().int().positive(),
      /**
       * 何で消費するか。attack = 行動単位の攻撃（§7）、damaged = 被弾。省略時 attack
       * TODO(spec): §7 消費対象の細部は実機未確認
       */
      consumeOn: z.enum(["attack", "damaged"]).optional(),
    })
    .strict(),
  z.object({ permanent: z.literal(true) }).strict(),
]);

export const Stack = z
  .object({
    max: z.union([z.number().int().positive(), z.null(), z.literal("unknown")]),
    duration: z.enum(["perStack", "refresh", "unknown"]),
  })
  .strict();
export type Stack = z.infer<typeof Stack>;

// ---------------------------------------------------------------- 効果（effect。DSL_PARTS.md §2）

type TargetT = Target;
type BuffEffectFields = {
  target: TargetT;
  buff: string;
  slot: string;
  amount: number | null;
  duration: Duration;
  stack?: Stack;
  categories?: z.infer<typeof Category>[];
  undispellable?: boolean;
  note?: string | undefined;
};

export type Effect =
  | {
      type: "damage";
      target: z.infer<typeof EnemyTarget>;
      category: z.infer<typeof Category>;
      hits?: NumOrValue;
      element?: z.infer<typeof Element>;
      note?: string | undefined;
    }
  | {
      type: "performAttack";
      attacker: z.infer<typeof AttackerTarget>;
      kind: "normal" | "burst";
      times?: number;
      gaugeAfter?: "zero" | "keep";
      note?: string | undefined;
    }
  | { type: "activateAbility"; character: string; ability: string; note?: string | undefined }
  | {
      type: "changeCT";
      target: TargetT;
      abilities: "self" | "all" | string[] | { color: z.infer<typeof Color> };
      amount?: NumOrValue;
      setTo?: number;
      note?: string | undefined;
    }
  | ({ type: "addBuff" } & BuffEffectFields)
  | ({ type: "addDebuff" } & BuffEffectFields)
  | {
      type: "addStatus";
      target: TargetT;
      status: string;
      duration?: Duration;
      sources?: z.infer<typeof GaugeBlockSource>[];
      undispellable?: boolean;
      polarity?: z.infer<typeof Polarity>;
      note?: string | undefined;
    }
  | { type: "removeStatus"; target: TargetT; status: string; note?: string | undefined }
  | { type: "removeDebuff"; target: TargetT; count?: number | "all"; note?: string | undefined }
  | { type: "heal"; target: TargetT; note?: string | undefined }
  | { type: "gaugeUp"; target: TargetT; amount?: NumOrValue; fixed?: boolean; note?: string | undefined }
  | { type: "gaugeDown"; target: TargetT; amount: NumOrValue; note?: string | undefined }
  | { type: "addToken"; target?: TargetT; name: string; amount: NumOrValue; note?: string | undefined }
  | { type: "consumeToken"; target?: TargetT; name?: string; group?: string; amount: NumOrValue | "all"; note?: string | undefined }
  | { type: "swapWithSub"; target: TargetT; note?: string | undefined }
  | { type: "retire"; target: TargetT; note?: string | undefined }
  | { type: "if"; cond: Condition; then: Effect[]; else?: Effect[]; note?: string | undefined }
  | { type: "switch"; cases: { cond: Condition; then: Effect[] }[]; default?: Effect[]; note?: string | undefined }
  | { type: "repeat"; times: NumOrValue; effects: Effect[]; note?: string | undefined }
  /** 省略形：読み込み時に if + changeCT(setTo 0) へ展開する（§6 即リキャ） */
  | { type: "recast"; when: Condition; note?: string | undefined }
  /** 省略形：読み込み時に sharedEffects の効果へ展開する（§10.2） */
  | { type: "useEffects"; id: string; note?: string | undefined }
  | { type: "custom"; id: string; params?: Record<string, unknown>; note?: string | undefined };

const BuffFields = {
  target: Target,
  buff: z.string(),
  slot: z.string(),
  amount: z.number().nullable(),
  duration: Duration,
  stack: Stack.optional(),
  categories: z.array(Category).optional(),
  undispellable: z.boolean().optional(),
  note,
};

export const Effect: z.ZodType<Effect> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal("damage"),
        target: EnemyTarget,
        category: Category,
        hits: NumOrValue.optional(),
        element: Element.optional(),
        note,
      })
      .strict(),
    z
      .object({
        type: z.literal("performAttack"),
        attacker: AttackerTarget,
        kind: z.enum(["normal", "burst"]),
        times: z.number().int().positive().optional(),
        gaugeAfter: z.enum(["zero", "keep"]).optional(),
        note,
      })
      .strict(),
    z.object({ type: z.literal("activateAbility"), character: z.string(), ability: z.string(), note }).strict(),
    z
      .object({
        type: z.literal("changeCT"),
        target: Target,
        abilities: z.union([z.literal("self"), z.literal("all"), z.array(z.string()), z.object({ color: Color }).strict()]),
        amount: NumOrValue.optional(),
        setTo: z.number().int().min(0).optional(),
        note,
      })
      .strict()
      .refine((e) => (e.amount === undefined) !== (e.setTo === undefined), { message: "changeCT は amount か setTo のどちらか一方を書く" }),
    z.object({ type: z.literal("addBuff"), ...BuffFields }).strict(),
    z.object({ type: z.literal("addDebuff"), ...BuffFields }).strict(),
    z
      .object({
        type: z.literal("addStatus"),
        target: Target,
        status: z.string(),
        duration: Duration.optional(),
        sources: z.array(GaugeBlockSource).optional(),
        undispellable: z.boolean().optional(),
        polarity: Polarity.optional(),
        note,
      })
      .strict(),
    z.object({ type: z.literal("removeStatus"), target: Target, status: z.string(), note }).strict(),
    z
      .object({
        type: z.literal("removeDebuff"),
        target: Target,
        count: z.union([z.number().int().positive(), z.literal("all")]).optional(),
        note,
      })
      .strict(),
    z.object({ type: z.literal("heal"), target: Target, note }).strict(),
    z.object({ type: z.literal("gaugeUp"), target: Target, amount: NumOrValue.optional(), fixed: z.boolean().optional(), note }).strict(),
    z.object({ type: z.literal("gaugeDown"), target: Target, amount: NumOrValue, note }).strict(),
    z.object({ type: z.literal("addToken"), target: Target.optional(), name: z.string(), amount: NumOrValue, note }).strict(),
    z
      .object({
        type: z.literal("consumeToken"),
        target: Target.optional(),
        name: z.string().optional(),
        group: z.string().optional(),
        amount: z.union([NumOrValue, z.literal("all")]),
        note,
      })
      .strict()
      .refine((e) => (e.name === undefined) !== (e.group === undefined), { message: "consumeToken は name か group のどちらか一方を書く" }),
    z.object({ type: z.literal("swapWithSub"), target: Target, note }).strict(),
    z.object({ type: z.literal("retire"), target: Target, note }).strict(),
    z.object({ type: z.literal("if"), cond: Condition, then: z.array(Effect), else: z.array(Effect).optional(), note }).strict(),
    z
      .object({
        type: z.literal("switch"),
        cases: z.array(z.object({ cond: Condition, then: z.array(Effect) }).strict()),
        default: z.array(Effect).optional(),
        note,
      })
      .strict(),
    z.object({ type: z.literal("repeat"), times: NumOrValue, effects: z.array(Effect), note }).strict(),
    z.object({ type: z.literal("recast"), when: Condition, note }).strict(),
    z.object({ type: z.literal("useEffects"), id: z.string(), note }).strict(),
    z.object({ type: z.literal("custom"), id: z.string(), params: z.record(z.string(), z.unknown()).optional(), note }).strict(),
  ]),
);

/**
 * 入れ子の段数（§10.2、DSL_PARTS.md §2）。いちばん外の効果の配列を 1 段目とし、
 * if の then・else、switch の cases・default、repeat の effects に入るたびに 1 段増える。
 * recast は if に展開されるので、中の changeCT を 1 段深いものとして数える。
 */
export function effectDepth(effects: readonly Effect[], level = 1): number {
  let max = effects.length > 0 ? level : 0;
  for (const e of effects) {
    if (e.type === "if") max = Math.max(max, effectDepth(e.then, level + 1), effectDepth(e.else ?? [], level + 1));
    else if (e.type === "switch") {
      for (const c of e.cases) max = Math.max(max, effectDepth(c.then, level + 1));
      max = Math.max(max, effectDepth(e.default ?? [], level + 1));
    } else if (e.type === "repeat") max = Math.max(max, effectDepth(e.effects, level + 1));
    else if (e.type === "recast") max = Math.max(max, level + 1);
  }
  return max;
}

export const MAX_EFFECT_DEPTH = 3;

export const EffectList = z.array(Effect).refine((effects) => effectDepth(effects) <= MAX_EFFECT_DEPTH, {
  message: `効果の入れ子は ${MAX_EFFECT_DEPTH} 段まで（§10.2）。超える場合は条件を and でまとめるか custom を使う`,
});

// ---------------------------------------------------------------- コスト・回数制限・トリガー

/** コスト（§6 条件付きコスト）。when は使う前に評価する */
export const Cost = z.union([
  z.object({ gauge: z.number().positive(), when: Condition.optional() }).strict(),
  z
    .object({
      token: z.object({ name: z.string(), amount: z.number().int().positive() }).strict(),
      when: Condition.optional(),
    })
    .strict(),
  z.object({ hpRate: z.number().positive(), when: Condition.optional() }).strict(),
]);
export type Cost = z.infer<typeof Cost>;

export const Limit = z
  .object({
    perTurn: NumOrValue.optional(),
    perBattle: NumOrValue.optional(),
  })
  .strict();
export type Limit = z.infer<typeof Limit>;

export const Trigger = z
  .object({
    event: EventType,
    filter: EventFilter.optional(),
  })
  .strict();
export type Trigger = z.infer<typeof Trigger>;

/** 1 つのアシストを分けて書いたときの元のアシスト、またはアビの常時効果の元のアビ（§4.2） */
export const AssistOrigin = z.union([
  z.object({ kind: z.literal("assist"), index: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("ability"), id: z.string() }).strict(),
]);
export type AssistOrigin = z.infer<typeof AssistOrigin>;

export const Assist = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    trigger: Trigger,
    cond: Condition.optional(),
    cost: z.array(Cost).optional(),
    limit: Limit.optional(),
    /** 有効範囲（§4.4）。既定 main */
    activeIn: z.enum(["main", "sub", "both"]).optional(),
    origin: AssistOrigin.optional(),
    effects: EffectList,
    note,
  })
  .strict();
export type Assist = z.infer<typeof Assist>;
