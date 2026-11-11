import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuffSlot } from "../schema/buffSlot";
import type { Character } from "../schema/character";
import type { ChartData, Op } from "../schema/chart";
import type { Catalog } from "../chart/input";
import { initHistory, pushHistory, redo, undo, type History } from "../chart/history";
import { currentBranch, newChart, recordOp, type Cursor } from "../chart/tree";
import { loadFromStorage, saveToStorage } from "../chart/storage";
import { useChartModel } from "./model";
import { opLabel } from "./labels";
import { PlayScreen } from "./PlayScreen";
import { ChartView } from "./ChartView";
import { GanttView } from "./GanttView";
import { SetupView } from "./SetupView";
import { BranchBar } from "./BranchBar";

interface Props {
  characters: Character[];
  buffSlots: BuffSlot[];
}

type Tab = "play" | "chart" | "gantt" | "setup";
const TABS: { id: Tab; label: string }[] = [
  { id: "play", label: "プレイ" },
  { id: "chart", label: "チャート" },
  { id: "gantt", label: "ガント" },
  { id: "setup", label: "編成・設定" },
];

function initialHistory(): { history: History; loadError: string | null } {
  let chart: ChartData = newChart();
  let loadError: string | null = null;
  try {
    const r = loadFromStorage(window.localStorage);
    if (r?.ok) chart = r.chart;
    else if (r && !r.ok) loadError = `保存データを読み込めなかった：\n${r.error}`;
  } catch {
    // localStorage が使えない環境
  }
  return { history: initHistory({ chart, cursor: currentBranch(chart).tip }), loadError };
}

/** チャートを変更する操作（履歴に積む） */
export type Commit = (next: { chart: ChartData; cursor: Cursor }, label: string) => void;

export default function App({ characters, buffSlots }: Props) {
  const catalog: Catalog = useMemo(() => ({ characters: Object.fromEntries(characters.map((c) => [c.id, c])), buffSlots }), [characters, buffSlots]);
  const init = useRef<ReturnType<typeof initialHistory>>(null);
  if (init.current === null) init.current = initialHistory();
  const [history, setHistory] = useState<History>(init.current.history);
  const [tab, setTab] = useState<Tab>("play");
  const [toast, setToast] = useState<string | null>(init.current.loadError);
  const { chart, cursor } = history.present;
  const model = useChartModel(chart, cursor, catalog);

  useEffect(() => {
    try {
      saveToStorage(window.localStorage, chart);
    } catch {
      // 保存できなくても動作は続ける
    }
  }, [chart]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // 最新の履歴（更新関数の外で副作用を起こすため ref で参照する）
  const historyRef = useRef(history);
  historyRef.current = history;
  const apply = useCallback((h: History) => {
    historyRef.current = h;
    setHistory(h);
  }, []);

  const commit: Commit = useCallback((next, label) => apply(pushHistory(historyRef.current, next, label)), [apply]);
  const setCursor = useCallback((c: Cursor) => apply({ ...historyRef.current, present: { ...historyRef.current.present, cursor: c } }), [apply]);

  /** プレイ画面の操作を記録する（§4.10）。複数の操作を 1 件の履歴にまとめられる */
  const record = useCallback(
    (ops: Op[], label?: string) => {
      const h = historyRef.current;
      let snap = h.present;
      let branched = false;
      for (const op of ops) {
        const r = recordOp(snap.chart, snap.cursor, op);
        branched ||= r.branched;
        snap = { chart: r.chart, cursor: r.cursor };
      }
      if (branched) setToast(`新しいブランチ「${currentBranch(snap.chart).name}」を作成した`);
      apply(pushHistory(h, snap, label ?? `T${model.state.turn} の ${ops.map((o) => opLabel(catalog, o)).join("・")}`));
    },
    [apply, catalog, model.state.turn],
  );

  const doUndo = useCallback(() => {
    const r = undo(historyRef.current);
    if (!r) return;
    apply(r.history);
    setToast(`「${r.label}」を取り消した`);
  }, [apply]);
  const doRedo = useCallback(() => {
    const r = redo(historyRef.current);
    if (!r) return;
    apply(r.history);
    setToast(`「${r.label}」をやり直した`);
  }, [apply]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // テキスト入力中はブラウザ標準の Undo を優先する（§14.3）
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  const jumpTo = useCallback(
    (c: Cursor) => {
      setCursor(c);
      setTab("play");
    },
    [setCursor],
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1>神姫PROJECT チャート作成</h1>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "tab active" : "tab"} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="undo">
          <button onClick={doUndo} disabled={history.past.length === 0} title="元に戻す（Ctrl+Z）">
            ↶ 戻す
          </button>
          <button onClick={doRedo} disabled={history.future.length === 0} title="やり直す（Ctrl+Shift+Z / Ctrl+Y）">
            ↷ やり直す
          </button>
        </div>
      </header>
      <BranchBar chart={chart} cursor={cursor} model={model} commit={commit} />
      <main>
        {tab === "play" && <PlayScreen catalog={catalog} chart={chart} model={model} record={record} setCursor={setCursor} openChart={() => setTab("chart")} />}
        {tab === "chart" && <ChartView catalog={catalog} chart={chart} model={model} jumpTo={jumpTo} commit={commit} cursor={cursor} notify={setToast} />}
        {tab === "gantt" && <GanttView catalog={catalog} chart={chart} model={model} jumpTo={jumpTo} />}
        {tab === "setup" && <SetupView catalog={catalog} chart={chart} cursor={cursor} commit={commit} />}
      </main>
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}
