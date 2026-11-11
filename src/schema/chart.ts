/**
 * チャートデータ（§4.10）。保存・共有・Undo/Redo・テストケースの単位。
 * これ以外はすべてエンジンが再計算する派生データ（§3-7）。
 */
import { z } from "zod";
import { Element } from "./common";
import { Assist, Effect } from "./dsl";

/** 2：キャラ定義・効果 DSL の形式変更（AGENTS.md 2026-11-11 版）。1 のデータは読み込まない */
export const CHART_VERSION = 2;

const CharId = z.string();

export const Party = z
  .object({
    hero: CharId.nullable(),
    front1: CharId.nullable(),
    front2: CharId.nullable(),
    back1: CharId.nullable(),
    back2: CharId.nullable(),
    sub1: CharId.nullable(),
    sub2: CharId.nullable(),
  })
  .strict()
  .refine(
    (p) => {
      const ids = Object.values(p).filter((v): v is string => v !== null);
      return new Set(ids).size === ids.length;
    },
    { message: "同名キャラは編成に入れられない（§4.4）" },
  );
export type Party = z.infer<typeof Party>;

/** 隊列の並び（左から）。§4.4 の行動順・補充順・§6.1 のアシスト処理順に使う */
export const PARTY_SLOTS = ["hero", "front1", "front2", "back1", "back2", "sub1", "sub2"] as const;
export type PartySlot = (typeof PARTY_SLOTS)[number];

export const Quest = z
  .object({
    enemyName: z.string().optional(),
    enemyElement: Element.nullable(),
    enemyCtMax: z.number().int().positive().optional(),
  })
  .strict();
export type Quest = z.infer<typeof Quest>;

/** 敵フェーズの手入力イベント（§4.10、§4.11） */
export const ManualEvent = z.union([
  z.object({ type: z.literal("damaged"), target: CharId, count: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("knockedOut"), target: CharId }).strict(),
  z.object({ type: z.literal("hpRate"), target: CharId, value: z.number().min(0).max(100) }).strict(),
  /**
   * 効果の手入力（敵のデバフ付与など）。subject のキャラを「self」として効果を処理する。
   * subject が null なら敵を self とみなす（敵自身へのバフなど）
   */
  z.object({ type: z.literal("effect"), subject: CharId.nullable(), effect: Effect }).strict(),
]);
export type ManualEvent = z.infer<typeof ManualEvent>;

export const Op = z.union([
  z.object({ type: z.literal("useAbility"), charId: CharId, abilityId: z.string(), chosenAlly: CharId.optional() }).strict(),
  z.object({ type: z.literal("setBurst"), mode: z.enum(["fire", "hold"]) }).strict(),
  z
    .object({
      type: z.literal("attack"),
      /** 連撃数の上書き（キャラ ID → 段数）。通常表示だけに使い、成功確率の計算では使わない（§9） */
      comboOverride: z.record(CharId, z.union([z.literal(1), z.literal(2), z.literal(3)])).optional(),
    })
    .strict(),
  z.object({ type: z.literal("enemyPhase"), events: z.array(ManualEvent) }).strict(),
  z.object({ type: z.literal("nextTurn") }).strict(),
]);
export type Op = z.infer<typeof Op>;

export const ChartNode = z
  .object({
    id: z.string(),
    parent: z.string().nullable(),
    op: Op,
    memo: z.string().optional(),
  })
  .strict();
export type ChartNode = z.infer<typeof ChartNode>;

export const Branch = z
  .object({
    id: z.string(),
    name: z.string(),
    /** 先端のノード ID。操作がまだ無ければ null */
    tip: z.string().nullable(),
    memo: z.string().optional(),
  })
  .strict();
export type Branch = z.infer<typeof Branch>;

export const CharCorrection = z
  .object({
    /** 開始時ゲージ（§4.9、§8.0） */
    startGauge: z.number().min(0).optional(),
    /** ゲージ上昇量アップ +%（§8.3。受け手側で合算） */
    gaugeRate: z.number().optional(),
    /** 2 段攻撃率（%） */
    doubleRate: z.number().min(0).max(100).optional(),
    /** 3 段攻撃率（%） */
    tripleRate: z.number().min(0).max(100).optional(),
    /** 詳細入力：ユーザー定義アシスト（§4.9） */
    assists: z.array(Assist).optional(),
    /** キャラのオプション（§4.2、§4.9）。未選択なら定義の default */
    options: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])).optional(),
    /**
     * ユーザー定義のバースト（burst.userDefined のキャラのみ。§4.9）。
     * 初期版は入力 UI を作らない（§15.3）が、データ形式とエンジンは対応しておく
     */
    burst: z.array(Effect).optional(),
  })
  .strict()
  .refine((c) => (c.doubleRate ?? 0) + (c.tripleRate ?? 0) <= 100, { message: "2 段・3 段攻撃率の合計は 100% 以下" });
export type CharCorrection = z.infer<typeof CharCorrection>;

export const Settings = z
  .object({
    assistReentry: z.boolean(),
    assistEventOrder: z.enum(["queue", "interrupt"]),
    assistTiming: z.enum(["afterAbility", "perEffect"]),
  })
  .strict();
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  assistReentry: true,
  assistEventOrder: "queue",
  assistTiming: "afterAbility",
};

export const ChartData = z
  .object({
    version: z.literal(CHART_VERSION),
    party: Party,
    quest: Quest,
    nodes: z.array(ChartNode),
    branches: z.array(Branch).min(1),
    currentBranch: z.string(),
    corrections: z.record(CharId, CharCorrection),
    settings: Settings,
  })
  .strict()
  .superRefine((c, ctx) => {
    const ids = new Set(c.nodes.map((n) => n.id));
    if (ids.size !== c.nodes.length) ctx.addIssue({ code: "custom", message: "ノード ID が重複している" });
    for (const n of c.nodes) {
      if (n.parent !== null && !ids.has(n.parent)) ctx.addIssue({ code: "custom", message: `親ノードが無い: ${n.id}` });
    }
    for (const b of c.branches) {
      if (b.tip !== null && !ids.has(b.tip)) ctx.addIssue({ code: "custom", message: `ブランチの先端が無い: ${b.name}` });
    }
    if (!c.branches.some((b) => b.id === c.currentBranch)) {
      ctx.addIssue({ code: "custom", message: "currentBranch が branches に無い" });
    }
  });
export type ChartData = z.infer<typeof ChartData>;
