import type { Catalog } from "../chart/input";
import type { ManualEvent, Op } from "../schema/chart";
import type { BattleEvent, FailureReason } from "../engine";
import { UNUSABLE_LABEL } from "../engine";
import type { Phase } from "../schema/common";
import { abilityDisplayName, assistDisplayName } from "../schema/character";

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
      return `MISS：${charName(catalog, e.target)}の「${e.buff}」`;
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

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function failureLabel(r: FailureReason): string {
  if (r === "burstMissed") return "予定のバーストが通常攻撃になった";
  if (r === "stepLimit") return "処理ステップ上限";
  return UNUSABLE_LABEL[r];
}
