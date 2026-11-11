import type { Character } from "../schema/character";
import type { BuffSlot } from "../schema/buffSlot";
import type { Category, SourceKind } from "../schema/common";
import { PARTY_SLOTS } from "../schema/chart";
import type {
  BattleEvent,
  BattleState,
  CharState,
  EngineInput,
  EngineOptions,
  OwnedAssist,
  SlotIndex,
  Warning,
  WarningCode,
} from "./types";
import { MAIN_SLOTS, SUB_SLOTS } from "./types";

export const DEFAULT_STEP_LIMIT = 1000;

export class StepLimitError extends Error {
  constructor() {
    super("1 アクションあたりの処理ステップ上限を超えた（アシストの連鎖が止まらない可能性。§3-8）");
  }
}

/** エンジン全体の実行コンテキスト */
export interface Ctx {
  state: BattleState;
  input: EngineInput;
  slots: Map<string, BuffSlot>;
  rng: (() => number) | null;
  stepLimit: number;
  steps: number;
  opIndex: number;
  /** アシスト判定待ちのイベント（§6.1-4） */
  queue: BattleEvent[];
  useComboOverride: boolean;
  comboOverride: Record<string, number> | undefined;
  /** トリガーのイベント種類 → アシスト */
  assistsByEvent: Map<string, OwnedAssist[]>;
}

/** 1 つの効果を処理するときの文脈 */
export interface Exec {
  /** 効果の持ち主（"self"）。敵を self とする手入力は "enemy" */
  self: string;
  sourceKind: SourceKind;
  ability?: string;
  assist?: string;
  /** ダメージ効果の区分を省略したときの継承元（§4.1） */
  defaultCategory: Category;
  chosenAlly?: string;
  /** 付与元の表示名 */
  label: string;
  /** 今回の使用を useCount に含める（コスト判定時。§10.2 今回の使用を含めて数える） */
  pendingUse?: boolean;
  /** count 条件で数えるイベントの通し番号の上限（§4.7 条件の評価時点） */
  seqLimit?: number;
  /** この効果処理で持ち主がダメージを与えたか（回数制バフの消費に使う） */
  dealtDamage: boolean;
  /** アビ効果の performAttack 中か */
  inAbility?: boolean;
}

export function createCtx(input: EngineInput, options: EngineOptions = {}): Ctx {
  const slots = new Map(input.buffSlots.map((s) => [s.id, s]));
  const state: BattleState = {
    turn: 1,
    phase: "turnStart",
    formation: PARTY_SLOTS.map(() => null),
    chars: {},
    enemy: { element: input.quest.enemyElement, buffs: [] },
    burstMode: "fire",
    log: [],
    warnings: [],
    nextUid: 1,
    attacked: false,
  };
  const ctx: Ctx = {
    state,
    input,
    slots,
    rng: options.rng ?? null,
    stepLimit: options.stepLimit ?? DEFAULT_STEP_LIMIT,
    steps: 0,
    opIndex: -1,
    queue: [],
    useComboOverride: options.useComboOverride ?? true,
    comboOverride: undefined,
    assistsByEvent: new Map(),
  };

  PARTY_SLOTS.forEach((slotName, i) => {
    const id = input.party[slotName];
    if (id === null) return;
    const def = input.characters[id];
    if (!def) {
      warn(ctx, "dataError", `キャラ定義が見つからない: ${id}`);
      return;
    }
    state.formation[i] = id;
    state.chars[id] = initialCharState(def, i <= 4);
  });

  // アシストをトリガーごとに索引する。ユーザー定義アシスト（§4.9）は持ち主のアシストの後ろに並べる
  for (const id of Object.keys(state.chars)) {
    const def = input.characters[id]!;
    const own: OwnedAssist[] = def.assists.map((assist, index) => ({ owner: id, assist, index, user: false }));
    const userAssists = input.corrections[id]?.assists ?? [];
    userAssists.forEach((assist, k) => own.push({ owner: id, assist, index: def.assists.length + k, user: true }));
    for (const oa of own) {
      const list = ctx.assistsByEvent.get(oa.assist.trigger.event) ?? [];
      list.push(oa);
      ctx.assistsByEvent.set(oa.assist.trigger.event, list);
    }
  }
  return ctx;
}

export function initialCharState(def: Character, inMain: boolean): CharState {
  const ct: Record<string, number> = {};
  for (const a of def.abilities) ct[a.id] = 0;
  const tokens: Record<string, number> = {};
  for (const t of def.tokens ?? []) tokens[t.name] = 0;
  return { id: def.id, hp: 100, gauge: 0, ct, tokens, buffs: [], knockedOut: false, hasEntered: inMain };
}

// ---------------------------------------------------------------- 参照ヘルパー

export function def(ctx: Ctx, id: string): Character {
  const d = ctx.input.characters[id];
  if (!d) throw new Error(`キャラ定義が見つからない: ${id}`);
  return d;
}

export function charState(ctx: Ctx, id: string): CharState {
  const c = ctx.state.chars[id];
  if (!c) throw new Error(`キャラが編成にいない: ${id}`);
  return c;
}

export function slotOf(ctx: Ctx, id: string): SlotIndex | null {
  const i = ctx.state.formation.indexOf(id);
  return i < 0 ? null : (i as SlotIndex);
}

/** メインにいて戦闘不能でないか（英霊を含む） */
export function isActiveMain(ctx: Ctx, id: string): boolean {
  const s = slotOf(ctx, id);
  return s !== null && s <= 4 && !ctx.state.chars[id]!.knockedOut;
}

/** メイン（英霊を含む）で戦闘不能でないキャラを隊列順に */
export function activeMainIds(ctx: Ctx): string[] {
  const out: string[] = [];
  for (const i of MAIN_SLOTS) {
    const id = ctx.state.formation[i];
    if (id && !ctx.state.chars[id]!.knockedOut) out.push(id);
  }
  return out;
}

export function subIds(ctx: Ctx): string[] {
  const out: string[] = [];
  for (const i of SUB_SLOTS) {
    const id = ctx.state.formation[i];
    if (id && !ctx.state.chars[id]!.knockedOut) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------- イベント・警告

export function emit(ctx: Ctx, e: Omit<BattleEvent, "seq" | "turn" | "phase" | "opIndex" | "element"> & { element?: BattleEvent["element"] }): BattleEvent {
  const element = e.element !== undefined ? e.element : e.actor && ctx.input.characters[e.actor] ? ctx.input.characters[e.actor]!.element : null;
  const ev: BattleEvent = {
    ...e,
    element,
    seq: ctx.state.log.length,
    turn: ctx.state.turn,
    phase: ctx.state.phase,
    opIndex: ctx.opIndex,
  };
  ctx.state.log.push(ev);
  if (ctx.assistsByEvent.has(ev.type)) ctx.queue.push(ev);
  return ev;
}

export function warn(ctx: Ctx, code: WarningCode, message: string, charId?: string): void {
  const w: Warning = { code, message, opIndex: ctx.opIndex, turn: ctx.state.turn };
  if (charId !== undefined) w.charId = charId;
  ctx.state.warnings.push(w);
}

export function step(ctx: Ctx): void {
  ctx.steps++;
  if (ctx.steps > ctx.stepLimit) throw new StepLimitError();
}

export function charLabel(ctx: Ctx, id: string | null): string {
  if (id === null) return "-";
  if (id === "enemy") return "敵";
  return ctx.input.characters[id]?.name ?? id;
}
