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
import { amon, artemis, beethoven, buffSlots, eve, redThunder, shaitan, use } from "./helpers";

const a = redThunder("a");
const catalog: Catalog = { characters: { eve, a, beethoven, shaitan, amon, artemis }, buffSlots };
const noop = () => {};
const render = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");

function Screens({ chart, cursor }: { chart: ChartData; cursor: Cursor }) {
  const model = useChartModel(chart, cursor, catalog);
  return (
    <>
      <BranchBar chart={chart} cursor={cursor} model={model} commit={noop} />
      <PlayScreen catalog={catalog} chart={chart} model={model} record={noop} setCursor={noop} openChart={noop} onReset={noop} />
      <ChartView catalog={catalog} chart={chart} model={model} cursor={cursor} jumpTo={noop} commit={noop} notify={noop} />
      <GanttView catalog={catalog} chart={chart} model={model} jumpTo={noop} />
      <SetupView catalog={catalog} chart={chart} cursor={cursor} commit={noop} />
    </>
  );
}

function build(ops: Op[], party: Parameters<typeof newChart>[0] = { hero: null, front1: "eve", front2: "a", back1: null, back2: null, sub1: null, sub2: null }) {
  let chart = newChart(party);
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
      use("eve", "eve_a3"),
      use("a", "a_red"),
      { type: "attack" },
      { type: "enemyPhase", events: [{ type: "damaged", target: "a", count: 2 }, { type: "knockedOut", target: "a" }] },
      { type: "nextTurn" },
      use("eve", "eve_a3"),
    ];
    const { chart, cursor } = build(ops);
    const html = render(<Screens chart={chart} cursor={cursor} />);
    expect(html).toContain("TURN 2");
    expect(html).toContain("バーストダメージプラス");
    const first = chart.nodes[0]!.id;
    expect(render(<Screens chart={chart} cursor={first} />)).toContain("巻き戻し中");
    // 敵フェーズの入力パネル
    expect(render(<Screens chart={chart} cursor={chart.nodes[2]!.id} />)).toContain("敵フェーズの入力");
  });

  it("初期リリースの 5 体の編成（§15.2）：トークン・累積バフ・アビの発動を含むチャート", () => {
    const ops: Op[] = [use("eve", "eve_a2"), use("artemis", "artemis_a3"), use("shaitan", "shaitan_a1"), use("shaitan", "shaitan_a2"), use("artemis", "artemis_a2"), { type: "attack" }, { type: "nextTurn" }];
    const { chart, cursor } = build(ops, { hero: "beethoven", front1: "eve", front2: "shaitan", back1: "amon", back2: "artemis", sub1: null, sub2: null });
    const html = render(<Screens chart={chart} cursor={cursor} />);
    expect(html).toContain("ベートーヴェン");
    expect(html).toContain("紅の旋律");
    expect(html).toContain("累積2");
    expect(html).not.toContain("shaitan_limiterUses"); // 非表示のトークン
  });
});
