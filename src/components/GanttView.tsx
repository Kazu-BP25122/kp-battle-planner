import { useMemo, useState } from "react";
import type { ChartData } from "../schema/chart";
import type { Catalog } from "../chart/input";
import type { Cursor } from "../chart/tree";
import type { BattleEvent } from "../engine";
import type { Phase } from "../schema/common";
import type { ChartModel } from "./model";
import { charName } from "./labels";

interface Props {
  catalog: Catalog;
  chart: ChartData;
  model: ChartModel;
  jumpTo: (c: Cursor) => void;
}

/** ターンを 行動・攻撃・敵 の 3 区間に分ける（§14.2 横軸） */
const SEG: Record<Phase, number> = { turnStart: 0, action: 0, attack: 1, enemy: 2, turnEnd: 2 };
const colOf = (turn: number, phase: Phase) => (turn - 1) * 3 + SEG[phase];

type EndKind = "expired" | "removed" | "consumed" | "overwritten" | "shortened" | "open";

interface Bar {
  start: number;
  end: number;
  name: string;
  amount?: number;
  polarity: "buff" | "debuff";
  durationType?: "turns" | "count" | "permanent";
  remaining: number[];
  label?: string;
  opIndex: number;
  endKind: EndKind;
  endOp?: number;
}

interface Row {
  key: string;
  entity: string;
  title: string;
  bars: Bar[];
  misses: { col: number; ev: BattleEvent }[];
}

const BUFF_EVENTS = new Set(["buffApplied", "buffOverwritten", "buffMissed", "buffConsumed", "buffExpired", "buffRemoved"]);

/**
 * イベントログだけから棒を組み立てる（UI 側で持続を計算しない。§14.2 データ源）
 */
function buildRows(log: readonly BattleEvent[], lastCol: number, shortened: Set<string>, slotName: (s: string) => string): Row[] {
  const rows = new Map<string, Row>();
  const open = new Map<string, Bar>();
  for (const e of log) {
    if (!BUFF_EVENTS.has(e.type) || !e.target) continue;
    const key = `${e.target}|${e.slot ?? `status:${e.buff}`}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, entity: e.target, title: e.slot ? slotName(e.slot) : e.buff ?? "", bars: [], misses: [] };
      rows.set(key, row);
    }
    const col = colOf(e.turn, e.phase);
    const close = (kind: EndKind) => {
      const b = open.get(key);
      if (!b) return;
      b.end = Math.max(b.start, col);
      b.endKind = kind;
      b.endOp = e.opIndex;
      open.delete(key);
    };
    switch (e.type) {
      case "buffApplied":
      case "buffOverwritten": {
        if (e.type === "buffOverwritten") close(shortened.has(`${e.opIndex}|${e.target}`) ? "shortened" : "overwritten");
        const bar: Bar = {
          start: col,
          end: lastCol,
          name: e.buff ?? "",
          polarity: e.polarity ?? "buff",
          remaining: e.remaining !== undefined ? [e.remaining] : [],
          opIndex: e.opIndex,
          endKind: "open",
          ...(e.amount !== undefined ? { amount: e.amount } : {}),
          ...(e.durationType ? { durationType: e.durationType } : {}),
          ...(e.label ? { label: e.label } : {}),
        };
        row.bars.push(bar);
        open.set(key, bar);
        break;
      }
      case "buffMissed":
        row.misses.push({ col, ev: e });
        break;
      case "buffConsumed": {
        const b = open.get(key);
        if (b && e.remaining !== undefined) b.remaining.push(e.remaining);
        if (e.remaining === 0) close("consumed");
        break;
      }
      case "buffExpired":
        close("expired");
        break;
      case "buffRemoved":
        close("removed");
        break;
    }
  }
  return [...rows.values()];
}

const END_LABEL: Record<EndKind, string> = {
  expired: "期限切れ",
  removed: "解除",
  consumed: "消費",
  overwritten: "上書き",
  shortened: "上書きで持続が短くなった",
  open: "継続中",
};

export function GanttView({ catalog, chart, model, jumpTo }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const log = model.full.battle.state.log;
  const lastTurn = model.full.battle.state.turn;
  const cols = lastTurn * 3;
  const slotName = (s: string) => catalog.buffSlots.find((x) => x.id === s)?.name ?? s;

  const rows = useMemo(() => {
    const shortened = new Set(model.full.battle.state.warnings.filter((w) => w.code === "buffShortened").map((w) => `${w.opIndex}|${w.charId ?? "enemy"}`));
    return buildRows(log, cols - 1, shortened, slotName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, cols, model.full]);

  // 列ごとの隊列（サブで待機中の行をグレーにするため）
  const subCols = useMemo(() => {
    const m = new Map<string, Set<number>>();
    const states = [model.full.initial, ...model.full.steps.map((s) => s.state)];
    let prevCol = 0;
    let prevFormation = states[0]!.formation;
    const mark = (from: number, to: number, formation: (string | null)[]) => {
      formation.forEach((id, i) => {
        if (!id || i < 5) return;
        const set = m.get(id) ?? new Set<number>();
        for (let c = from; c <= to; c++) set.add(c);
        m.set(id, set);
      });
    };
    for (const s of states.slice(1)) {
      const c = colOf(s.turn, s.phase);
      mark(prevCol, c - 1, prevFormation);
      prevCol = c;
      prevFormation = s.formation;
    }
    mark(prevCol, cols - 1, prevFormation);
    return m;
  }, [model.full, cols]);

  const entities = ["enemy", ...Object.values(chart.party).filter((x): x is string => !!x)];
  const jump = (opIndex: number) => jumpTo(opIndex < 0 ? null : model.path[opIndex]?.id ?? null);
  const grid = { gridTemplateColumns: `repeat(${cols}, minmax(14px, 1fr))` };

  if (rows.length === 0) return <p className="empty-state">バフ・デバフはまだ付与されていない。</p>;

  return (
    <div className="gantt">
      <p className="small muted">
        通常表示（連撃は最低保証）の結果。1 ターンを「行動・攻撃・敵」の 3 区間で表示。× は MISS、棒をクリックすると付与した操作に戻る。
      </p>
      <div className="gantt-row header">
        <div className="gantt-label" />
        <div className="gantt-cells" style={grid}>
          {Array.from({ length: lastTurn }, (_, t) => (
            <div key={t} className="gantt-turn" style={{ gridColumn: `${t * 3 + 1} / span 3` }}>
              T{t + 1}
              <div className="gantt-seg">
                <span>行</span>
                <span>攻</span>
                <span>敵</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {entities.map((ent) => {
        const entRows = rows.filter((r) => r.entity === ent);
        if (entRows.length === 0) return null;
        const isCollapsed = collapsed.has(ent);
        const subs = subCols.get(ent);
        return (
          <div key={ent} className="gantt-group">
            <button
              className="gantt-entity"
              onClick={() => {
                const next = new Set(collapsed);
                if (isCollapsed) next.delete(ent);
                else next.add(ent);
                setCollapsed(next);
              }}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? "▶" : "▼"} {charName(catalog, ent)}（{entRows.length}）
            </button>
            {!isCollapsed &&
              entRows.map((r) => (
                <div key={r.key} className="gantt-row">
                  <div className="gantt-label" title={r.title}>
                    {r.title}
                  </div>
                  <div className="gantt-cells" style={grid}>
                    {subs &&
                      [...subs].map((c) => (
                        <div key={`s${c}`} className="gantt-sub" style={{ gridColumn: `${c + 1}`, gridRow: 1 }} title="サブで待機中（バフ解除の扱いは仮置き §4.4）" />
                      ))}
                    {r.bars.map((b, i) => (
                      <button
                        key={i}
                        className={`gantt-bar ${b.polarity} end-${b.endKind}`}
                        style={{ gridColumn: `${b.start + 1} / ${b.end + 2}`, gridRow: 1 }}
                        onClick={() => jump(b.opIndex)}
                        title={[
                          b.name,
                          b.label ? `付与元：${b.label}` : "",
                          b.amount !== undefined ? `効果量：${b.amount}` : "効果量：不明",
                          b.durationType === "count" ? `残り回数：${b.remaining.join(" → ")}` : b.durationType === "turns" ? `${b.remaining[0]} ターン` : "永続",
                          `終了：${END_LABEL[b.endKind]}`,
                        ]
                          .filter(Boolean)
                          .join("\n")}
                      >
                        {b.name}
                        {b.durationType === "count" && <small> ×{b.remaining[b.remaining.length - 1]}</small>}
                      </button>
                    ))}
                    {r.misses.map((m, i) => (
                      <button
                        key={`m${i}`}
                        className="gantt-miss"
                        style={{ gridColumn: `${m.col + 1}`, gridRow: 1 }}
                        onClick={() => jump(m.ev.opIndex)}
                        title={`MISS：${m.ev.buff}${m.ev.label ? `（${m.ev.label}）` : ""}`}
                      >
                        ×
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
