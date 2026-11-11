/**
 * エンジンの型。src/engine/ はフレームワーク非依存の純粋な TypeScript（§3-1）。
 */
import type { Category, Color, Element, EventType, GaugeBlockSource, GaugeMeans, Phase, Polarity, Position, SourceKind } from "../schema/common";
import type { Character } from "../schema/character";
import type { BuffSlot } from "../schema/buffSlot";
import type { CharCorrection, Op, Party, Quest, Settings } from "../schema/chart";
import type { Assist } from "../schema/dsl";

/** 隊列の枠の番号。0 = 英霊、1〜4 = メイン 1〜4（前衛 1・2、後衛 1・2）、5・6 = サブ 1・2 */
export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const MAIN_SLOTS: SlotIndex[] = [0, 1, 2, 3, 4];
export const SUB_SLOTS: SlotIndex[] = [5, 6];
export const ALL_SLOTS: SlotIndex[] = [0, 1, 2, 3, 4, 5, 6];

export function slotPosition(i: SlotIndex): Position {
  if (i === 0) return "hero";
  if (i <= 2) return "front";
  if (i <= 4) return "back";
  return "sub";
}

export const SLOT_LABEL: Record<SlotIndex, string> = {
  0: "英霊",
  1: "前衛1",
  2: "前衛2",
  3: "後衛1",
  4: "後衛2",
  5: "サブ1",
  6: "サブ2",
};

export type BuffDuration =
  | { type: "turns"; remaining: number }
  | { type: "count"; remaining: number; consumeOn: "attack" | "damaged" }
  | { type: "permanent" };

export interface BuffInstance {
  uid: number;
  /** 表示名（バフ名・状態名） */
  name: string;
  /** buff = 枠を持つバフ・デバフ、status = 効果量を持たない状態効果（addStatus） */
  kind: "buff" | "status";
  slot: string | null;
  /** 1 段分の効果量 */
  amount: number | null;
  polarity: Polarity;
  duration: BuffDuration;
  /** 持続が不明（turns: null）。永続として扱う */
  durationUnknown?: boolean;
  /** 消去不可（§10.2 undispellable）。解除効果で消えず、サブに下がっても残る */
  undispellable: boolean;
  /** 累積型（§7.1）。1 段ごとに 1 つの BuffInstance を持つ */
  stack?: { max: number | null | "unknown"; duration: "perStack" | "refresh" | "unknown" };
  /** gaugeGainBlocked の止める手段（§8.3） */
  blockSources?: GaugeBlockSource[];
  appliedTurn: number;
  appliedPhase: Phase;
  appliedSeq: number;
  /** 付与元 */
  sourceChar: string | null;
  sourceLabel: string;
}

export interface CharState {
  id: string;
  hp: number;
  gauge: number;
  ct: Record<string, number>;
  tokens: Record<string, number>;
  buffs: BuffInstance[];
  knockedOut: boolean;
  /** 一度でもメインに出たか（戦闘開始時のメインを含む） */
  hasEntered: boolean;
}

export interface EnemyState {
  element: Element | null;
  buffs: BuffInstance[];
}

export interface BattleEvent {
  seq: number;
  turn: number;
  phase: Phase;
  type: EventType;
  sourceKind: SourceKind;
  /** 発生源キャラ。トークンのイベントはトークンの持ち主 */
  actor: string | null;
  /** 発生源キャラの属性（§4.7。すべてのイベントが持つ） */
  sourceElement: Element | null;
  /** ダメージの属性（damage のみ。§10.2） */
  element?: Element;
  category?: Category;
  color?: Color;
  ability?: string;
  assist?: string;
  /** abilityActivated の経路 */
  route?: "use" | "effect";
  /** 対象キャラ ID、または "enemy" */
  target?: string;
  /** 通常攻撃の連撃数 */
  combo?: number;
  /** 通常攻撃・バーストの発生元（§4.7 burst の source） */
  origin?: "attackPhase" | "ability";
  /** バーストで消費したゲージ量 */
  gaugeConsumed?: number;
  /** ゲージ・トークンの増減量 */
  amount?: number;
  means?: GaugeMeans;
  /** トークン名 */
  token?: string;
  slot?: string | null;
  buff?: string;
  polarity?: Polarity;
  /** 累積型の累積数（付与後・期限切れ後） */
  stacks?: number;
  /** 被弾回数 */
  count?: number;
  /** バフの持続（付与・上書き時は付与した持続、消費時は残り回数）。ガントチャート用 */
  durationType?: "turns" | "count" | "permanent";
  remaining?: number;
  /** 付与元の表示名 */
  label?: string;
  /** enterBattle の経路 */
  via?: "replenish" | "swap";
  /** 処理した操作の番号（チャート上の位置） */
  opIndex: number;
}

export type WarningCode =
  | "buffMissed"
  | "buffShortened"
  | "debuffFloor"
  | "amountUnknown"
  | "unknownSlot"
  | "opInvalid"
  | "noSub"
  | "countBuffNotKept"
  | "comboRateMissing"
  | "stepLimit"
  | "customMissing"
  | "dataError"
  | "tokenOverflow"
  | "stackMax"
  | "stackDurationUnknown"
  | "durationUnknown"
  | "burstUnset";

export interface Warning {
  code: WarningCode;
  message: string;
  opIndex: number;
  turn: number;
  charId?: string;
}

export type UnusableReason =
  | "phase"
  | "notInMain"
  | "knockedOut"
  | "ct"
  | "perTurn"
  | "perBattle"
  | "cost"
  | "cond"
  | "chosenAlly"
  | "unknown";

export const UNUSABLE_LABEL: Record<UnusableReason, string> = {
  phase: "行動フェーズではない",
  notInMain: "メインにいない",
  knockedOut: "戦闘不能",
  ct: "CT 中",
  perTurn: "1 ターンの回数上限",
  perBattle: "戦闘中の回数上限",
  cost: "コスト不足",
  cond: "条件不足",
  chosenAlly: "対象の味方がいない",
  unknown: "アビリティが見つからない",
};

export interface BattleState {
  turn: number;
  phase: Phase;
  /** 隊列。ALL_SLOTS の順。空き枠は null */
  formation: (string | null)[];
  chars: Record<string, CharState>;
  enemy: EnemyState;
  burstMode: "fire" | "hold";
  log: BattleEvent[];
  warnings: Warning[];
  nextUid: number;
  /** 今ターンの攻撃フェーズを実行済みか */
  attacked: boolean;
  /** 一度だけ出す警告のキー */
  warnedOnce: string[];
}

export interface EngineInput {
  party: Party;
  quest: Quest;
  characters: Record<string, Character>;
  buffSlots: BuffSlot[];
  corrections: Record<string, CharCorrection>;
  settings: Settings;
}

export interface EngineOptions {
  /** 乱数（§3-2）。省略時は最低保証（連撃 1 段、確率発動はしない） */
  rng?: () => number;
  /** 1 アクションあたりの処理ステップ上限（§3-8） */
  stepLimit?: number;
  /** 通常表示用に comboOverride を使うか（成功確率の計算では false。§9） */
  useComboOverride?: boolean;
}

export interface AttackAction {
  charId: string;
  kind: "normal" | "burst";
  combo?: number;
}

export interface OpResult {
  op: Op;
  opIndex: number;
  /** 操作を実行できたか。false なら操作は無視された（記録は残す） */
  ok: boolean;
  reasons: UnusableReason[];
  /** 攻撃フェーズの各キャラの行動 */
  attackActions?: AttackAction[];
  /** この操作で発生したイベントの範囲 [from, to) */
  eventRange: [number, number];
}

/** アシストに「持ち主」を付けたもの（ユーザー定義アシストを含む） */
export interface OwnedAssist {
  owner: string;
  assist: Assist;
  /** 持ち主のアシスト内での並び（§6.1-2） */
  index: number;
  user: boolean;
}
