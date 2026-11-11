import { useMemo } from "react";
import type { Catalog } from "../chart/input";
import { toEngineInput } from "../chart/input";
import { currentBranch, currentPath, type Cursor } from "../chart/tree";
import type { ChartData, ChartNode } from "../schema/chart";
import { Battle, replay, stateAt, type BattleState, type EngineInput, type ReplayResult } from "../engine";

export interface ChartModel {
  input: EngineInput;
  path: ChartNode[];
  /** 表示位置の操作の番号（-1 = 最初の操作の前） */
  cursorIndex: number;
  atTip: boolean;
  full: ReplayResult;
  /** 表示位置の状態 */
  state: BattleState;
  /** 表示位置まで再生した戦闘（使用可否・予測に使う） */
  live: Battle;
  branchName: string;
}

/** チャートデータから派生データをすべて再計算する（§3-7） */
export function useChartModel(chart: ChartData, cursor: Cursor, catalog: Catalog): ChartModel {
  const input = useMemo(() => toEngineInput(chart, catalog), [chart.party, chart.quest, chart.corrections, chart.settings, catalog]);
  const path = useMemo(() => currentPath(chart), [chart.nodes, chart.branches, chart.currentBranch]);
  const full = useMemo(() => replay(input, path.map((n) => n.op)), [input, path]);
  const found = cursor === null ? -1 : path.findIndex((n) => n.id === cursor);
  const cursorIndex = cursor !== null && found < 0 ? path.length - 1 : found;
  const live = useMemo(() => {
    const b = new Battle(input);
    for (const n of path.slice(0, cursorIndex + 1)) b.apply(n.op);
    return b;
  }, [input, path, cursorIndex]);
  return {
    input,
    path,
    cursorIndex,
    atTip: cursorIndex === path.length - 1,
    full,
    state: stateAt(full, cursorIndex),
    live,
    branchName: currentBranch(chart).name,
  };
}
