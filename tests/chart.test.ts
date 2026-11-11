import { describe, expect, it } from "vitest";
import { currentBranch, currentPath, deleteBranch, newChart, recordOp, splitTurns } from "../src/chart/tree";
import { initHistory, pushHistory, redo, undo } from "../src/chart/history";
import { chartToJson, parseChartJson } from "../src/chart/storage";
import type { Op } from "../src/schema/chart";

const op = (abilityId: string): Op => ({ type: "useAbility", charId: "eve", abilityId });

function build(ops: Op[]) {
  let chart = newChart();
  let cursor: string | null = null;
  for (const o of ops) ({ chart, cursor } = recordOp(chart, cursor, o));
  return { chart, cursor };
}

describe("ブランチ（§4.12）", () => {
  it("先端では追記する", () => {
    const { chart } = build([op("a"), op("b"), op("c")]);
    expect(currentPath(chart).map((n) => (n.op as { abilityId: string }).abilityId)).toEqual(["a", "b", "c"]);
    expect(chart.branches).toHaveLength(1);
  });

  it("途中に戻って同じ操作なら既存の続きをたどる", () => {
    const { chart } = build([op("a"), op("b")]);
    const first = currentPath(chart)[0]!.id;
    const r = recordOp(chart, first, op("b"));
    expect(r.branched).toBe(false);
    expect(r.chart).toBe(chart);
    expect(r.cursor).toBe(currentPath(chart)[1]!.id);
  });

  it("途中に戻って違う操作をすると新しいブランチができ、共通部分は共有する", () => {
    const { chart } = build([op("a"), op("b"), op("c")]);
    const first = currentPath(chart)[0]!.id;
    const r = recordOp(chart, first, op("x"));
    expect(r.branched).toBe(true);
    expect(r.chart.branches.map((b) => b.name)).toEqual(["本線", "本線-2"]);
    expect(currentBranch(r.chart).name).toBe("本線-2");
    const p = currentPath(r.chart);
    expect(p[0]!.id).toBe(first);
    expect(r.chart.nodes).toHaveLength(4);
  });

  it("ブランチを削除すると、そのブランチだけが使っていたノードを消す", () => {
    const { chart } = build([op("a"), op("b")]);
    const first = currentPath(chart)[0]!.id;
    const r = recordOp(chart, first, op("x"));
    const del = deleteBranch(r.chart, r.chart.currentBranch);
    expect(del.branches).toHaveLength(1);
    expect(del.nodes).toHaveLength(2);
  });

  it("ターンは nextTurn で区切る", () => {
    const ops: Op[] = [op("a"), { type: "attack" }, { type: "nextTurn" }, op("b")];
    expect(splitTurns(ops.map((o) => ({ op: o }))).map((t) => t.length)).toEqual([3, 1]);
  });
});

describe("Undo / Redo（§14.3）", () => {
  it("スナップショットで戻す・やり直す。新しい編集で Redo は消える", () => {
    let h = initHistory({ chart: newChart(), cursor: null });
    const r1 = recordOp(h.present.chart, h.present.cursor, op("a"));
    h = pushHistory(h, r1, "a");
    const r2 = recordOp(h.present.chart, h.present.cursor, op("b"));
    h = pushHistory(h, r2, "b");
    const u = undo(h)!;
    expect(u.label).toBe("b");
    expect(currentPath(u.history.present.chart)).toHaveLength(1);
    const rd = redo(u.history)!;
    expect(currentPath(rd.history.present.chart)).toHaveLength(2);
    const h2 = pushHistory(u.history, recordOp(u.history.present.chart, u.history.present.cursor, op("c")), "c");
    expect(h2.future).toHaveLength(0);
  });
});

describe("JSON 入出力（§4.10）", () => {
  it("往復でき、不正なデータは読み込まない", () => {
    const { chart } = build([op("a")]);
    const r = parseChartJson(chartToJson(chart));
    expect(r.ok).toBe(true);
    expect(parseChartJson('{"version":1}').ok).toBe(false);
    const bad = { ...chart, nodes: [{ id: "x", parent: "x", op: { type: "nextTurn" } }], branches: [{ ...chart.branches[0]!, tip: "x" }] };
    expect(parseChartJson(JSON.stringify(bad)).ok).toBe(false);
  });
});
