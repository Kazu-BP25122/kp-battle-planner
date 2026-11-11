/**
 * UI のスモークテスト：各画面がチャートデータから例外なく描画できることを確かめる（サーバー側描画）。
 * 操作の動きはブラウザで確認すること。
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { newChart, recordOp, type Cursor } from "../src/chart/tree";
import type { ChartData, Op } from "../src/schema/chart";
import type { Catalog } from "../src/chart/input";
import { useChartModel } from "../src/components/model";
import { PlayScreen } from "../src/components/PlayScreen";
import { ChartView } from "../src/components/ChartView";
import { GanttView } from "../src/components/GanttView";
import { SetupView } from "../src/components/SetupView";
import { BranchBar } from "../src/components/BranchBar";
import { buffSlots, eve, redThunder, use } from "./helpers";

const a = redThunder("a");
const catalog: Catalog = { characters: { eve, a }, buffSlots };
const noop = () => {};
const render = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");

function Screens({ chart, cursor }: { chart: ChartData; cursor: Cursor }) {
  const model = useChartModel(chart, cursor, catalog);
  return (
    <>
      <BranchBar chart={chart} cursor={cursor} model={model} commit={noop} />
      <PlayScreen catalog={catalog} chart={chart} model={model} record={noop} setCursor={noop} openChart={noop} />
      <ChartView catalog={catalog} chart={chart} model={model} cursor={cursor} jumpTo={noop} commit={noop} notify={noop} />
      <GanttView catalog={catalog} chart={chart} model={model} jumpTo={noop} />
      <SetupView catalog={catalog} chart={chart} cursor={cursor} commit={noop} />
    </>
  );
}

function build(ops: Op[]) {
  let chart = newChart({ hero: null, front1: "eve", front2: "a", back1: null, back2: null, sub1: null, sub2: null });
  let cursor: Cursor = null;
  for (const op of ops) ({ chart, cursor } = recordOp(chart, cursor, op));
  return { chart, cursor };
}

describe("UI スモーク", () => {
  it("空のチャート", () => {
    const { chart, cursor } = build([]);
    expect(render(<Screens chart={chart} cursor={cursor} />)).toContain("イヴ");
  });

  it("行動・攻撃・敵フェーズ・次のターンを含むチャート（巻き戻し中を含む）", () => {
    const ops: Op[] = [
      use("eve", "eve_ability3"),
      use("a", "a_red"),
      { type: "attack" },
      { type: "enemyPhase", events: [{ type: "damaged", target: "a", count: 2 }, { type: "knockedOut", target: "a" }] },
      { type: "nextTurn" },
      use("eve", "eve_ability3"),
    ];
    const { chart, cursor } = build(ops);
    const html = render(<Screens chart={chart} cursor={cursor} />);
    expect(html).toContain("TURN 2");
    expect(html).toContain("バーストダメージUP");
    const first = chart.nodes[0]!.id;
    expect(render(<Screens chart={chart} cursor={first} />)).toContain("巻き戻し中");
    // 敵フェーズの入力パネル
    expect(render(<Screens chart={chart} cursor={chart.nodes[2]!.id} />)).toContain("敵フェーズの入力");
  });
});
