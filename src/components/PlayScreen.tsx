import { useMemo, useState } from "react";
import type { ChartData, ManualEvent, Op } from "../schema/chart";
import type { Character } from "../schema/character";
import { characterGaugeMax } from "../schema/character";
import { COLOR_LABEL, ELEMENT_LABEL, type Element } from "../schema/common";
import type { Catalog } from "../chart/input";
import type { Cursor } from "../chart/tree";
import { UNUSABLE_LABEL, abilityUnusableReasons, affinity, planReplenish, SLOT_LABEL, type BuffInstance, type SlotIndex } from "../engine";
import type { ChartModel } from "./model";
import { charName, eventNotice, fmt, manualLabel, PHASE_LABEL } from "./labels";

interface Props {
  catalog: Catalog;
  chart: ChartData;
  model: ChartModel;
  record: (ops: Op[], label?: string) => void;
  setCursor: (c: Cursor) => void;
  openChart: () => void;
  /** プレイのリセット（操作の記録を消して戦闘開始に戻す） */
  onReset: () => void;
}

const AFFINITY_LABEL = { advantage: "有利", neutral: "", disadvantage: "不利" } as const;

function BuffChips({ buffs }: { buffs: BuffInstance[] }) {
  if (buffs.length === 0) return null;
  return (
    <ul className="chips">
      {buffs.map((b) => (
        <li key={b.uid} className={`chip ${b.polarity}`} title={`${b.sourceLabel}${b.amount !== null ? `／効果量 ${b.amount}` : ""}`}>
          {b.name}
          {b.amount !== null && b.kind === "buff" ? ` ${b.amount}` : ""}
          <small>{b.duration.type === "turns" ? ` ${b.duration.remaining}T` : b.duration.type === "count" ? ` ${b.duration.remaining}回` : " 永続"}</small>
        </li>
      ))}
    </ul>
  );
}

export function PlayScreen({ catalog, chart, model, record, setCursor, openChart, onReset }: Props) {
  const { state, live } = model;
  const [openChar, setOpenChar] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [combo, setCombo] = useState<Record<string, 1 | 2 | 3>>({});
  const [pending, setPending] = useState<ManualEvent[]>([]);

  const actionPhase = state.phase === "action" && !state.attacked;
  const preview = useMemo(() => (actionPhase ? live.previewAttack(Object.keys(combo).length ? combo : undefined) : []), [live, actionPhase, combo]);
  const willBurst = new Set(preview.filter((a) => a.kind === "burst").map((a) => a.charId));

  // 直前の操作で起きたこと（ゲームの演出の代わりの通知）
  const lastStep = model.cursorIndex >= 0 ? model.full.steps[model.cursorIndex] : undefined;
  const notices = useMemo(() => {
    if (!lastStep) return [];
    const [from, to] = lastStep.result.eventRange;
    return model.full.battle.state.log
      .slice(from, to)
      .map((e) => eventNotice(catalog, e))
      .filter((s): s is string => s !== null);
  }, [lastStep, model.full, catalog]);
  const opWarnings = model.full.battle.state.warnings.filter((w) => w.opIndex === model.cursorIndex && model.cursorIndex >= 0);

  const mainSlots: SlotIndex[] = [0, 1, 2, 3, 4];
  const enemyEl = chart.quest.enemyElement;
  const mainIds = mainSlots.map((s) => state.formation[s]).filter((x): x is string => !!x && !state.chars[x]!.knockedOut);

  const koPending = pending.filter((e): e is Extract<ManualEvent, { type: "knockedOut" }> => e.type === "knockedOut").map((e) => e.target);
  const replenishPlan = planReplenish(state.formation, (id) => state.chars[id]!.knockedOut || koPending.includes(id));

  const renderChar = (slot: SlotIndex) => {
    const id = state.formation[slot];
    if (!id) {
      return (
        <div key={slot} className="charcard empty">
          <span className="slot">{SLOT_LABEL[slot]}</span> 空き
        </div>
      );
    }
    const c = state.chars[id]!;
    const d: Character | undefined = catalog.characters[id];
    if (!d) return null;
    const max = characterGaugeMax(d);
    const aff = enemyEl ? affinity(d.element, enemyEl, "player") : "neutral";
    const open = openChar === id;
    return (
      <div key={slot} className={`charcard${c.knockedOut ? " ko" : ""}${open ? " open" : ""}`}>
        <button className="charhead" onClick={() => setOpenChar(open ? null : id)} aria-expanded={open}>
          <span className="slot">{SLOT_LABEL[slot]}</span>
          <span className={`el el-${d.element}`}>{ELEMENT_LABEL[d.element]}</span>
          <strong>{d.name}</strong>
          {AFFINITY_LABEL[aff] && <span className={`aff ${aff}`}>{AFFINITY_LABEL[aff]}</span>}
          {c.knockedOut && <span className="badge danger">戦闘不能</span>}
          <span className="hp">HP {c.hp}%</span>
        </button>
        <div className="gauge" title={`バーストゲージ ${fmt(c.gauge)} / ${max}`}>
          <div className="gaugebar" style={{ width: `${Math.min(100, (c.gauge / max) * 100)}%` }} />
          <span>
            {fmt(c.gauge)}
            {max === 200 ? " / 200" : ""}
          </span>
          {willBurst.has(id) && <span className="badge burst">バースト予定</span>}
        </div>
        <div className="abilityicons">
          {d.abilities.map((a) => {
            const ct = c.ct[a.id] ?? 0;
            return (
              <span key={a.id} className={`abicon color-${a.color}${ct > 0 ? " cooling" : ""}`} title={`${a.name}（${COLOR_LABEL[a.color]}・CT${a.ct}）`}>
                {ct > 0 ? ct : "●"}
              </span>
            );
          })}
          {Object.entries(c.tokens)
            .filter(([k]) => !d.tokens?.find((t) => t.name === k)?.hidden)
            .map(([k, v]) => (
            <span key={k} className="token">
              {k}×{v}
            </span>
          ))}
        </div>
        <BuffChips buffs={c.buffs} />
        {open && (
          <ul className="abilitylist">
            {d.abilities.length === 0 && <li className="muted">アビリティ未登録</li>}
            {d.abilities.map((a) => {
              const needs = JSON.stringify(a).includes('"chosenAlly"');
              const target = chosen[`${id}:${a.id}`];
              const reasons = abilityUnusableReasons(live.ctx, id, a.id, target);
              const usable = reasons.length === 0;
              return (
                <li key={a.id} className={usable ? "" : "disabled"}>
                  <button
                    className={`use color-${a.color}`}
                    disabled={!usable}
                    onClick={() => record([{ type: "useAbility", charId: id, abilityId: a.id, ...(needs && target ? { chosenAlly: target } : {}) }])}
                  >
                    {a.name}
                  </button>
                  <span className="meta">
                    {COLOR_LABEL[a.color]}・CT{a.ct}
                    {(c.ct[a.id] ?? 0) > 0 ? `（残り ${c.ct[a.id]}）` : ""}
                  </span>
                  {needs && (
                    <select value={target ?? ""} onChange={(e) => setChosen({ ...chosen, [`${id}:${a.id}`]: e.target.value })} aria-label="対象の味方">
                      <option value="">対象を選ぶ</option>
                      {mainIds.map((m) => (
                        <option key={m} value={m}>
                          {charName(catalog, m)}
                        </option>
                      ))}
                    </select>
                  )}
                  {!usable && <span className="reasons">{reasons.map((r) => UNUSABLE_LABEL[r]).join("・")}</span>}
                  {a.note && <p className="desc">{a.note}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  const hasParty = Object.values(chart.party).some((v) => v !== null);
  if (!hasParty) {
    return <p className="empty-state">「編成・設定」タブでキャラを編成してください。</p>;
  }

  return (
    <div className="play">
      <section className="field">
        <div className="turninfo">
          <span className="turn">TURN {state.turn}</span>
          <span>{PHASE_LABEL[state.phase]}</span>
          <button className="link" onClick={openChart}>
            チャートを見る →
          </button>
          <button onClick={onReset} disabled={chart.nodes.length === 0} title="操作の記録をすべて消して戦闘開始に戻す（編成・補正・設定は残る。「戻す」で取り消せる）">
            リセット
          </button>
        </div>
        <div className="enemy">
          <h2>
            {chart.quest.enemyName || "敵"}
            {enemyEl && <span className={`el el-${enemyEl}`}>{ELEMENT_LABEL[enemyEl as Element]}</span>}
          </h2>
          <BuffChips buffs={state.enemy.buffs} />
        </div>

        {!model.atTip && (
          <div className="rewind">
            巻き戻し中。ここから違う操作をすると新しいブランチが作られる（元の記録は残る）。
            <button onClick={() => setCursor(model.path[model.path.length - 1]?.id ?? null)}>先端へ戻る</button>
          </div>
        )}

        <div className="notices" aria-live="polite">
          {opWarnings.map((w, i) => (
            <div key={`w${i}`} className="notice warn">
              ⚠ {w.message}
            </div>
          ))}
          {notices.slice(-12).map((n, i) => (
            <div key={i} className="notice">
              {n}
            </div>
          ))}
        </div>

        {actionPhase && (
          <div className="attackpanel">
            <div className="burstmode" role="group" aria-label="バースト">
              <button
                className={state.burstMode === "fire" ? "on" : ""}
                onClick={() => state.burstMode !== "fire" && record([{ type: "setBurst", mode: "fire" }])}
              >
                バースト発動
              </button>
              <button
                className={state.burstMode === "hold" ? "on" : ""}
                onClick={() => state.burstMode !== "hold" && record([{ type: "setBurst", mode: "hold" }])}
              >
                温存
              </button>
            </div>
            <details>
              <summary>連撃数の指定（通常表示用）</summary>
              {mainIds.map((id) => (
                <label key={id} className="combo">
                  {charName(catalog, id)}
                  <select
                    value={combo[id] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      const next = { ...combo };
                      if (v) next[id] = Number(v) as 1 | 2 | 3;
                      else delete next[id];
                      setCombo(next);
                    }}
                  >
                    <option value="">既定（1段）</option>
                    <option value="2">2段</option>
                    <option value="3">3段</option>
                  </select>
                </label>
              ))}
            </details>
            <p className="preview">
              このまま攻撃すると：
              {preview.length === 0
                ? "—"
                : preview.map((a) => `${charName(catalog, a.charId)}${a.kind === "burst" ? "【バースト】" : `通常${a.combo ?? 1}段`}`).join(" → ")}
            </p>
            <button
              className="primary attack"
              onClick={() => {
                record([{ type: "attack", ...(Object.keys(combo).length ? { comboOverride: combo } : {}) }]);
                setCombo({});
              }}
            >
              攻撃
            </button>
          </div>
        )}

        {state.phase === "enemy" && (
          <EnemyPanel
            catalog={catalog}
            mainIds={mainIds}
            pending={pending}
            setPending={setPending}
            plan={replenishPlan}
            onNext={() => {
              const ops: Op[] = pending.length ? [{ type: "enemyPhase", events: pending }, { type: "nextTurn" }] : [{ type: "nextTurn" }];
              record(ops, `T${state.turn} の敵フェーズ入力と次のターンへ`);
              setPending([]);
            }}
          />
        )}
      </section>

      <section className="party" aria-label="パーティ">
        {mainSlots.map(renderChar)}
        <div className="subs">
          <h3>サブ</h3>
          {([5, 6] as SlotIndex[]).map((s) => {
            const id = state.formation[s];
            const c = id ? state.chars[id] : undefined;
            return (
              <div key={s} className="subrow">
                <span className="slot">{SLOT_LABEL[s]}</span> {id ? charName(catalog, id) : "空き"}
                {c && (
                  <span className="muted">
                    {" "}
                    ゲージ {fmt(c.gauge)}・{c.hasEntered ? "登場済み" : "未登場"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

interface EnemyPanelProps {
  catalog: Catalog;
  mainIds: string[];
  pending: ManualEvent[];
  setPending: (e: ManualEvent[]) => void;
  plan: ReturnType<typeof planReplenish>;
  onNext: () => void;
}

/** 敵フェーズの入力パネル（§14.0、§4.10 手入力イベント） */
function EnemyPanel({ catalog, mainIds, pending, setPending, plan, onNext }: EnemyPanelProps) {
  const [kind, setKind] = useState<"damaged" | "knockedOut" | "hpRate" | "gaugeBlock" | "debuff">("damaged");
  const [target, setTarget] = useState(mainIds[0] ?? "");
  const [num, setNum] = useState(1);
  const [slot, setSlot] = useState("defDownA");
  const [turns, setTurns] = useState(1);
  const debuffSlots = catalog.buffSlots.filter((s) => s.polarity === "debuff");

  const add = () => {
    if (!target) return;
    let e: ManualEvent;
    switch (kind) {
      case "damaged":
        e = { type: "damaged", target, count: Math.max(1, Math.floor(num)) };
        break;
      case "knockedOut":
        e = { type: "knockedOut", target };
        break;
      case "hpRate":
        e = { type: "hpRate", target, value: Math.min(100, Math.max(0, num)) };
        break;
      case "gaugeBlock":
        // TODO(spec): §8.3 敵の「上昇無効」デバフが止める範囲は未確定。all で仮置き
        e = { type: "effect", subject: target, effect: { type: "addStatus", target: "self", status: "gaugeGainBlocked", sources: ["all"], polarity: "debuff", duration: { turns } } };
        break;
      case "debuff": {
        const s = catalog.buffSlots.find((x) => x.id === slot);
        e = { type: "effect", subject: target, effect: { type: "addDebuff", target: "self", buff: s?.name ?? slot, slot, amount: num, duration: { turns } } };
        break;
      }
    }
    setPending([...pending, e]);
  };

  return (
    <div className="enemypanel">
      <h3>敵フェーズの入力</h3>
      <div className="form-row">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="種類">
          <option value="damaged">被弾</option>
          <option value="knockedOut">戦闘不能</option>
          <option value="hpRate">HP 割合</option>
          <option value="gaugeBlock">ゲージ上昇無効</option>
          <option value="debuff">デバフ付与</option>
        </select>
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="対象">
          {mainIds.map((id) => (
            <option key={id} value={id}>
              {charName(catalog, id)}
            </option>
          ))}
        </select>
        {(kind === "damaged" || kind === "hpRate" || kind === "debuff") && (
          <input type="number" value={num} onChange={(e) => setNum(Number(e.target.value))} aria-label={kind === "damaged" ? "回数" : kind === "hpRate" ? "HP%" : "効果量"} style={{ width: "5em" }} />
        )}
        {kind === "debuff" && (
          <select value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="枠">
            {debuffSlots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {(kind === "gaugeBlock" || kind === "debuff") && (
          <label>
            <input type="number" min={1} value={turns} onChange={(e) => setTurns(Math.max(1, Number(e.target.value)))} style={{ width: "4em" }} />
            ターン
          </label>
        )}
        <button onClick={add}>追加</button>
      </div>
      {pending.length > 0 && (
        <ul className="pending">
          {pending.map((e, i) => (
            <li key={i}>
              {manualLabel(catalog, e)}
              <button className="link" onClick={() => setPending(pending.filter((_, j) => j !== i))} aria-label="削除">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {plan.fills.length > 0 && (
        <div className="replenish">
          <strong>ターンエンドの補充：</strong>
          {plan.fills.map((f) => (
            <span key={f.slot}>
              {SLOT_LABEL[f.slot as SlotIndex]}：{charName(catalog, f.outId)} → {f.inId ? charName(catalog, f.inId) : "空き"}
            </span>
          ))}
          <small>（補充されたキャラは次のターンから行動。枠の行動順を引き継ぐ）</small>
        </div>
      )}
      <button className="primary" onClick={onNext}>
        次のターンへ
      </button>
    </div>
  );
}
