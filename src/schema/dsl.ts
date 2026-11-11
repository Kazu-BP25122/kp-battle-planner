/**
 * 効果記述 DSL（§10）の Zod スキーマ。
 * 部品を追加したら、ここ・engine の registry・AGENTS.md §10.1 を同時に更新すること。
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

// ---------------------------------------------------------------- 対象（target）

export const AlliesWhere = z
  .object({
    element: oneOrMany(Element).optional(),
    position: oneOrMany(Position).optional(),
    /** true なら自分を除く */
    excludeSelf: z.boolean().optional(),
  })
  .strict();
export type AlliesWhere = z.infer<typeof AlliesWhere>;

export const Target = z.union([
  z.enum(["self", "allAllies", "chosenAlly", "enemy"]),
  z.object({ alliesWhere: AlliesWhere }).strict(),
]);
export type Target = z.infer<typeof Target>;

/** 攻撃するキャラの指定（performAttack.attacker）。敵・chosenAlly 以外の対象と同じ書き方 */
export const AttackerTarget = z.union([
  z.enum(["self", "allAllies", "chosenAlly"]),
  z.object({ alliesWhere: AlliesWhere }).strict(),
]);

// ---------------------------------------------------------------- イベントの絞り込み

export const EventFilter = z
  .object({
    /** 発生源キャラ。"self" はアシスト・アビの持ち主、"other" は持ち主以外、それ以外はキャラ ID */
    actor: z.string().optional(),
    element: oneOrMany(Element).optional(),
    category: oneOrMany(Category).optional(),
    color: oneOrMany(Color).optional(),
    sourceKind: oneOrMany(SourceKind).optional(),
    ability: z.string().optional(),
    assist: z.string().optional(),
    slot: z.string().optional(),
    polarity: Polarity.optional(),
    means: oneOrMany(GaugeMeans).optional(),
    /** 対象キャラ（gaugeChanged・buffApplied など）。"self" / キャラ ID / "enemy" */
    target: z.string().optional(),
    origin: z.enum(["attackPhase", "ability"]).optional(),
    route: z.enum(["replenish", "swap"]).optional(),
  })
  .strict();
export type EventFilter = z.infer<typeof EventFilter>;

// ---------------------------------------------------------------- 条件（cond）

const CountCond = z
  .object({
    event: EventType,
    filter: EventFilter.optional(),
    scope: z.enum(["turn", "battle"]),
  })
  .extend(NumCompare.shape)
  .strict();

const UseCountCond = z
  .object({
    /** "self" はこのアビリティ自身 */
    ability: z.string(),
    scope: z.enum(["turn", "battle"]),
  })
  .extend(NumCompare.shape)
  .strict();

const SubjectRef = z.enum(["self", "chosenAlly"]);

export type Condition =
  | { count: z.infer<typeof CountCond> }
  | { useCount: z.infer<typeof UseCountCond> }
  | { token: { name: string; target?: "self" | "chosenAlly" } & NumCompare }
  | { hpRate: { target?: "self" | "chosenAlly" } & NumCompare }
  | { gauge: { target?: "self" | "chosenAlly" } & NumCompare }
  | { hasBuff: { target?: "self" | "chosenAlly" | "enemy"; slot?: string; buff?: string } }
  | { hasDebuff: { target?: "self" | "chosenAlly" | "enemy"; slot?: string; buff?: string } }
  | { turnCount: NumCompare }
  | { element: { of?: "self" | "chosenAlly" | "enemy"; is: z.infer<typeof Element> | z.infer<typeof Element>[] } }
  | { position: { target?: "self" | "chosenAlly"; is: z.infer<typeof Position> | z.infer<typeof Position>[] } }
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition };

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ count: CountCond }).strict(),
    z.object({ useCount: UseCountCond }).strict(),
    z
      .object({
        token: z.object({ name: z.string(), target: SubjectRef.optional() }).extend(NumCompare.shape).strict(),
      })
      .strict(),
    z.object({ hpRate: z.object({ target: SubjectRef.optional() }).extend(NumCompare.shape).strict() }).strict(),
    // TODO(spec): §10.1 の条件一覧に gauge は無いが、§4.7・§6.1-3 で「ゲージ 100 以上なら」の例があるため追加。AGENTS.md への追記を確認中
    z.object({ gauge: z.object({ target: SubjectRef.optional() }).extend(NumCompare.shape).strict() }).strict(),
    z
      .object({
        hasBuff: z
          .object({ target: z.enum(["self", "chosenAlly", "enemy"]).optional(), slot: z.string().optional(), buff: z.string().optional() })
          .strict(),
      })
      .strict(),
    z
      .object({
        hasDebuff: z
          .object({ target: z.enum(["self", "chosenAlly", "enemy"]).optional(), slot: z.string().optional(), buff: z.string().optional() })
          .strict(),
      })
      .strict(),
    z.object({ turnCount: NumCompare }).strict(),
    z
      .object({
        element: z
          .object({ of: z.enum(["self", "chosenAlly", "enemy"]).optional(), is: oneOrMany(Element) })
          .strict(),
      })
      .strict(),
    z.object({ position: z.object({ target: SubjectRef.optional(), is: oneOrMany(Position) }).strict() }).strict(),
    z.object({ and: z.array(Condition) }).strict(),
    z.object({ or: z.array(Condition) }).strict(),
    z.object({ not: Condition }).strict(),
  ]),
);

// ---------------------------------------------------------------- 持続

export const Duration = z.union([
  z.object({ turns: z.number().int().positive() }).strict(),
  z
    .object({
      count: z.number().int().positive(),
      /**
       * 何で消費するか。attack = 行動単位の攻撃（通常攻撃・バースト・ダメージを伴うアビ。§7）、damaged = 被弾
       * TODO(spec): §7 消費対象の細部は実機未確認
       */
      consumeOn: z.enum(["attack", "damaged"]).optional(),
    })
    .strict(),
  z.object({ permanent: z.literal(true) }).strict(),
]);
export type Duration = z.infer<typeof Duration>;

// ---------------------------------------------------------------- 効果（effect）

const BuffFields = {
  target: Target,
  /** 表示名 */
  buff: z.string(),
  /** 枠 ID（buffSlots.json） */
  slot: z.string(),
  /** 実数値。未調査なら null（§7.2） */
  amount: z.number().nullable(),
  duration: Duration,
  /** false なら解除不可（消去不可の固有効果など） */
  removable: z.boolean().optional(),
};

type BuffEffectFields = {
  target: Target;
  buff: string;
  slot: string;
  amount: number | null;
  duration: Duration;
  removable?: boolean;
};

export type Effect =
  | { type: "damage"; target?: "enemy"; category?: z.infer<typeof Category>; hits?: number }
  | {
      type: "performAttack";
      attacker: z.infer<typeof AttackerTarget>;
      kind: "normal" | "burst";
      times?: number;
      gaugeAfter?: "zero" | "keep";
    }
  | {
      type: "addStatus";
      target: Target;
      status: string;
      sources?: z.infer<typeof GaugeBlockSource>[];
      duration?: Duration;
      polarity?: z.infer<typeof Polarity>;
      removable?: boolean;
    }
  | { type: "heal"; target: Target }
  | ({ type: "addBuff" } & BuffEffectFields)
  | ({ type: "addDebuff" } & BuffEffectFields)
  | { type: "removeDebuff"; target: Target; count?: number | "all" }
  | { type: "gaugeUp"; target: Target; amount: number }
  | { type: "gaugeDown"; target: Target; amount: number }
  | { type: "changeCT"; target: Target; abilities: "all" | string[]; amount: number }
  | { type: "addToken"; target?: Target; token: string; amount: number }
  | { type: "consumeToken"; target?: Target; token: string; amount: number }
  | { type: "swapWithSub"; target: Target }
  | { type: "retire"; target: Target }
  | { type: "if"; cond: Condition; then: Effect[]; else?: Effect[] }
  | { type: "switch"; cases: { cond: Condition; then: Effect[] }[]; default?: Effect[] }
  | { type: "custom"; id: string; params?: Record<string, unknown> };

export const Effect: z.ZodType<Effect> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal("damage"),
        target: z.literal("enemy").optional(),
        category: Category.optional(),
        hits: z.number().int().positive().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("performAttack"),
        attacker: AttackerTarget,
        kind: z.enum(["normal", "burst"]),
        times: z.number().int().positive().optional(),
        gaugeAfter: z.enum(["zero", "keep"]).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("addStatus"),
        target: Target,
        status: z.string(),
        sources: z.array(GaugeBlockSource).optional(),
        duration: Duration.optional(),
        polarity: Polarity.optional(),
        removable: z.boolean().optional(),
      })
      .strict(),
    z.object({ type: z.literal("heal"), target: Target }).strict(),
    z.object({ type: z.literal("addBuff"), ...BuffFields }).strict(),
    z.object({ type: z.literal("addDebuff"), ...BuffFields }).strict(),
    z
      .object({
        type: z.literal("removeDebuff"),
        target: Target,
        count: z.union([z.number().int().positive(), z.literal("all")]).optional(),
      })
      .strict(),
    z.object({ type: z.literal("gaugeUp"), target: Target, amount: z.number() }).strict(),
    z.object({ type: z.literal("gaugeDown"), target: Target, amount: z.number() }).strict(),
    z
      .object({
        type: z.literal("changeCT"),
        target: Target,
        abilities: z.union([z.literal("all"), z.array(z.string())]),
        amount: z.number().int(),
      })
      .strict(),
    z
      .object({ type: z.literal("addToken"), target: Target.optional(), token: z.string(), amount: z.number().int() })
      .strict(),
    z
      .object({ type: z.literal("consumeToken"), target: Target.optional(), token: z.string(), amount: z.number().int() })
      .strict(),
    z.object({ type: z.literal("swapWithSub"), target: Target }).strict(),
    z.object({ type: z.literal("retire"), target: Target }).strict(),
    z.object({ type: z.literal("if"), cond: Condition, then: z.array(Effect), else: z.array(Effect).optional() }).strict(),
    z
      .object({
        type: z.literal("switch"),
        cases: z.array(z.object({ cond: Condition, then: z.array(Effect) }).strict()),
        default: z.array(Effect).optional(),
      })
      .strict(),
    z.object({ type: z.literal("custom"), id: z.string(), params: z.record(z.string(), z.unknown()).optional() }).strict(),
  ]),
);

/** 分岐の入れ子の深さ（§10.2 3 段を超える場合は custom に回す） */
export function branchDepth(effects: Effect[]): number {
  let max = 0;
  for (const e of effects) {
    if (e.type === "if") {
      max = Math.max(max, 1 + Math.max(branchDepth(e.then), branchDepth(e.else ?? [])));
    } else if (e.type === "switch") {
      const inner = Math.max(0, ...e.cases.map((c) => branchDepth(c.then)), branchDepth(e.default ?? []));
      max = Math.max(max, 1 + inner);
    }
  }
  return max;
}

export const MAX_BRANCH_DEPTH = 3;

export const EffectList = z
  .array(Effect)
  .refine((effects) => branchDepth(effects) <= MAX_BRANCH_DEPTH, {
    message: `if / switch の入れ子は ${MAX_BRANCH_DEPTH} 段まで（§10.2）。超える場合は custom を使う`,
  });

// ---------------------------------------------------------------- コスト・回数制限・トリガー

export const Cost = z.union([
  z.object({ type: z.literal("gauge"), amount: z.number().positive(), cond: Condition.optional() }).strict(),
  z
    .object({ type: z.literal("token"), token: z.string(), amount: z.number().int().positive(), cond: Condition.optional() })
    .strict(),
]);
export type Cost = z.infer<typeof Cost>;

export const Limit = z
  .object({
    perTurn: z.number().int().positive().optional(),
    perBattle: z.number().int().positive().optional(),
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

export const Assist = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    trigger: Trigger,
    cond: Condition.optional(),
    cost: z.array(Cost).optional(),
    limit: Limit.optional(),
    /** 有効範囲（§4.4）。既定 main */
    activeIn: z.enum(["main", "sub", "both"]).optional(),
    effects: EffectList,
  })
  .strict();
export type Assist = z.infer<typeof Assist>;
