import type { Catalog } from "../chart/input";
import type { ManualEvent, Op } from "../schema/chart";
import type { BattleEvent, FailureReason } from "../engine";
import { UNUSABLE_LABEL, missLabel } from "../engine";
import type { Phase } from "../schema/common";
import { abilityDisplayName, assistDisplayName } from "../schema/character";
import { ELEMENT_LABEL } from "../schema/common";

export const PHASE_LABEL: Record<Phase, string> = {
  turnStart: "ターン開始",
  action: "行動フェーズ",
  attack: "攻撃フェーズ",
  enemy: "敵フェーズ",
  turnEnd: "ターンエンド",
};

export function charName(catalog: Catalog, id: string | null | undefined): string {
  if (!id) return "-";
  if (id === "enemy") return "敵";
  return catalog.characters[id]?.name ?? id;
}

export function abilityName(catalog: Catalog, charId: string, abilityId: string): string {
  return abilityDisplayName(catalog.characters[charId], abilityId);
}

export function manualLabel(catalog: Catalog, e: ManualEvent): string {
  switch (e.type) {
    case "damaged":
      return `${charName(catalog, e.target)} 被弾 ×${e.count}`;
    case "knockedOut":
      return `${charName(catalog, e.target)} 戦闘不能`;
    case "hpRate":
      return `${charName(catalog, e.target)} HP ${e.value}%`;
    case "effect": {
      const eff = e.effect;
      const who = e.subject ? charName(catalog, e.subject) : "敵";
      if (eff.type === "addDebuff" || eff.type === "addBuff") return `${who}に ${eff.buff}${eff.amount !== null ? ` ${eff.amount}` : ""}`;
      if (eff.type === "addStatus") return `${who}に ${eff.status}`;
      return `${who}に効果 ${eff.type}`;
    }
  }
}

export function opLabel(catalog: Catalog, op: Op): string {
  switch (op.type) {
    case "useAbility":
      return `${charName(catalog, op.charId)} ${abilityName(catalog, op.charId, op.abilityId)}${op.chosenAlly ? ` → ${charName(catalog, op.chosenAlly)}` : ""}`;
    case "setBurst":
      return `バースト${op.mode === "fire" ? "発動" : "温存"}`;
    case "attack": {
      const o = op.comboOverride ? Object.entries(op.comboOverride).map(([id, n]) => `${charName(catalog, id)}${n}段`) : [];
      return `攻撃${o.length ? `（${o.join("・")}）` : ""}`;
    }
    case "enemyPhase":
      return `敵フェーズ：${op.events.map((e) => manualLabel(catalog, e)).join("、") || "なし"}`;
    case "nextTurn":
      return "次のターンへ";
  }
}

const MEANS_LABEL: Record<string, string> = {
  normalAttack: "通常攻撃",
  chain: "連鎖",
  effect: "効果",
  turnEnd: "ターン終了",
  damaged: "被弾",
  cost: "コスト",
  burst: "バースト",
  correction: "補正",
};

/** 通知に出すイベント（ゲームの演出の代わり。§14.0） */
export function eventNotice(catalog: Catalog, e: BattleEvent): string | null {
  switch (e.type) {
    case "assistTriggered": {
      const def = catalog.characters[e.actor ?? ""];
      // キャラ定義に無いアシストはユーザー補正の詳細入力（§4.9）
      if (!def?.assists?.some((a) => a.id === e.assist)) return `${charName(catalog, e.actor)}のユーザー定義アシスト発動`;
      return `${charName(catalog, e.actor)}のアシスト「${assistDisplayName(catalog.characters[e.actor ?? ""], e.assist ?? "")}」発動`;
    }
    case "burst":
      return `${charName(catalog, e.actor)} バースト（消費 ${fmt(e.gaugeConsumed ?? 0)}${e.origin === "ability" ? "・アビ効果" : ""}）`;
    case "gaugeChanged":
      return `${charName(catalog, e.target)} ゲージ ${e.amount! > 0 ? "+" : ""}${fmt(e.amount ?? 0)}（${MEANS_LABEL[e.means ?? ""] ?? e.means}）`;
    case "buffMissed":
      return `${missLabel(e.polarity ?? "buff")}：${charName(catalog, e.target)}の「${e.buff}」`;
    case "enterBattle":
      return `${charName(catalog, e.actor)} 登場（${e.via === "swap" ? "交代" : "補充"}）`;
    case "swappedOut":
      return `${charName(catalog, e.actor)} サブへ`;
    case "knockedOut":
      return `${charName(catalog, e.actor)} 戦闘不能`;
    case "abilityActivated":
      if (e.route !== "effect") return null;
      return `${charName(catalog, e.actor)}「${abilityName(catalog, e.actor ?? "", e.ability ?? "")}」発動`;
    case "tokenAdded":
    case "tokenConsumed": {
      // 非表示のトークン（内部カウンター）は通知しない
      if (catalog.characters[e.actor ?? ""]?.tokens?.find((t) => t.name === e.token)?.hidden) return null;
      return `${charName(catalog, e.actor)} ${e.token} ${e.type === "tokenAdded" ? "+" : "-"}${e.amount}`;
    }
    case "normalAttack":
      return `${charName(catalog, e.actor)} 通常攻撃 ${e.combo}段${e.origin === "ability" ? "（アビ効果）" : ""}`;
    default:
      return null;
  }
}

const CATEGORY_LABEL: Record<string, string> = { normal: "通常攻撃", ability: "アビリティ", burst: "バースト" };

function assistLabel(catalog: Catalog, charId: string | null, assistId: string): string {
  const def = catalog.characters[charId ?? ""];
  if (!def?.assists?.some((a) => a.id === assistId)) return "ユーザー定義アシスト";
  return assistDisplayName(def, assistId);
}

function durationText(e: BattleEvent): string {
  if (e.durationType === "permanent") return "永続";
  if (e.durationType === "turns" && e.remaining !== undefined) return `${e.remaining}T`;
  if (e.durationType === "count" && e.remaining !== undefined) return `${e.remaining}回`;
  return "";
}

/**
 * イベントログの 1 行（チャート表示で、操作によって起きたことを並べる。§14.1）。
 * 表示しないイベント（使用と同時に記録される発動・非表示のトークン）は null。
 * ID は出さず、キャラ名・アビ名・アシスト名で表示する。
 */
export function eventLogLine(catalog: Catalog, e: BattleEvent): string | null {
  const who = charName(catalog, e.actor);
  const tgt = charName(catalog, e.target);
  const ab = () => abilityName(catalog, e.actor ?? "", e.ability ?? "");
  switch (e.type) {
    case "battleStart":
      return "戦闘開始";
    case "turnStart":
      return `T${e.turn} ターン開始`;
    case "turnEnd":
      return "ターン終了時";
    case "abilityUsed":
      return `${who}「${ab()}」使用`;
    case "abilityActivated":
      return e.route === "effect" ? `${who}「${ab()}」発動` : null;
    case "normalAttack":
      return `${who} 通常攻撃 ${e.combo ?? 1}段${e.origin === "ability" ? "（アビ効果）" : ""}`;
    case "burst":
      return `${who} バースト（ゲージ ${fmt(e.gaugeConsumed ?? 0)} 消費${e.origin === "ability" ? "・アビ効果" : ""}）`;
    case "damage": {
      // 通常攻撃のダメージは「通常攻撃 n 段」の行に含める（段数 = ヒット数）
      if (e.sourceKind === "normalAttack") return null;
      const parts = [CATEGORY_LABEL[e.category ?? ""] ?? e.category, e.element ? `${ELEMENT_LABEL[e.element]}属性` : ""].filter(Boolean);
      return `${who} ダメージ（${parts.join("・")}）`;
    }
    case "damaged":
      return `${tgt} 被弾 ×${e.count ?? 1}`;
    case "heal":
      return `${tgt} 回復`;
    case "gaugeChanged": {
      const n = e.amount ?? 0;
      const base = `${tgt} バーストゲージ ${fmt(Math.abs(n))} ${n >= 0 ? "上昇" : "減少"}`;
      // 通常攻撃によるものは直前の「通常攻撃 n 段」の行で分かるので手段を書かない
      return e.means === "normalAttack" ? base : `${base}（${MEANS_LABEL[e.means ?? ""] ?? e.means}）`;
    }
    case "buffApplied":
    case "buffOverwritten": {
      const extra = [e.amount !== undefined ? `${e.amount}` : "", durationText(e), e.stacks !== undefined ? `累積${e.stacks}` : ""].filter(Boolean).join("・");
      return `${tgt}に「${e.buff}」${e.type === "buffApplied" ? "付与" : "上書き"}${extra ? `（${extra}）` : ""}`;
    }
    case "buffMissed":
      return `${tgt}の「${e.buff}」${missLabel(e.polarity ?? "buff")}`;
    case "buffConsumed":
      return `${tgt}の「${e.buff}」消費（残り ${e.remaining ?? 0} 回）`;
    case "buffExpired":
      return `${tgt}の「${e.buff}」期限切れ${e.stacks !== undefined ? `（残り累積${e.stacks}）` : ""}`;
    case "buffRemoved":
      return `${tgt}の「${e.buff}」解除`;
    case "assistTriggered":
      return `${who}のアシスト「${assistLabel(catalog, e.actor, e.assist ?? "")}」発動`;
    case "enterBattle":
      return `${who} 登場（${e.via === "swap" ? "交代" : "補充"}）`;
    case "swappedOut":
      return `${who} サブへ`;
    case "knockedOut":
      return `${who} 戦闘不能`;
    case "tokenAdded":
    case "tokenConsumed":
      if (catalog.characters[e.actor ?? ""]?.tokens?.find((t) => t.name === e.token)?.hidden) return null;
      return `${who} ${e.token} ${e.type === "tokenAdded" ? "+" : "-"}${e.amount}`;
  }
}

/** イベントログの行。同じ行が続いたら 1 行にまとめて回数を付ける（多段ヒットなど） */
export interface LogLine {
  key: number;
  phase: Phase;
  text: string;
  times: number;
  /** アシストが起こしたイベント */
  byAssist: boolean;
}

export function eventLogLines(catalog: Catalog, events: readonly BattleEvent[]): LogLine[] {
  const out: LogLine[] = [];
  for (const e of events) {
    const text = eventLogLine(catalog, e);
    if (text === null) continue;
    const last = out[out.length - 1];
    if (last && last.text === text && last.phase === e.phase) {
      last.times++;
      continue;
    }
    out.push({ key: e.seq, phase: e.phase, text, times: 1, byAssist: e.sourceKind === "assist" && e.type !== "assistTriggered" });
  }
  return out;
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function failureLabel(r: FailureReason): string {
  if (r === "burstMissed") return "予定のバーストが通常攻撃になった";
  if (r === "stepLimit") return "処理ステップ上限";
  return UNUSABLE_LABEL[r];
}
