/**
 * 操作の記録の木とブランチ（§4.12）。フレームワーク非依存。
 * チャートデータは不変データとして扱い、変更は新しいオブジェクトを返す（§14.3 スナップショット方式）。
 */
import type { Branch, ChartData, ChartNode, Op, Party } from "../schema/chart";
import { CHART_VERSION, DEFAULT_SETTINGS } from "../schema/chart";

export const MAIN_BRANCH_NAME = "本線";

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export const EMPTY_PARTY: Party = { hero: null, front1: null, front2: null, back1: null, back2: null, sub1: null, sub2: null };

export function newChart(party: Party = EMPTY_PARTY): ChartData {
  const branch: Branch = { id: newId(), name: MAIN_BRANCH_NAME, tip: null };
  return {
    version: CHART_VERSION,
    party,
    quest: { enemyElement: null },
    nodes: [],
    branches: [branch],
    currentBranch: branch.id,
    corrections: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * プレイのリセット：操作の記録（全ブランチ）を消して、戦闘開始の状態に戻す。
 * 編成・クエスト・ユーザー補正・設定は残す。履歴（§14.3）に積むので Undo で元に戻せる。
 */
export function resetPlay(chart: ChartData): ChartData {
  const branch: Branch = { id: newId(), name: MAIN_BRANCH_NAME, tip: null };
  return { ...chart, nodes: [], branches: [branch], currentBranch: branch.id };
}

export function nodeMap(chart: ChartData): Map<string, ChartNode> {
  return new Map(chart.nodes.map((n) => [n.id, n]));
}

/** 根から tip までのノード列 */
export function pathTo(chart: ChartData, tip: string | null, map = nodeMap(chart)): ChartNode[] {
  const out: ChartNode[] = [];
  const seen = new Set<string>();
  let id = tip;
  while (id !== null) {
    if (seen.has(id)) throw new Error("操作の記録の木が循環している");
    seen.add(id);
    const n = map.get(id);
    if (!n) throw new Error(`ノードが見つからない: ${id}`);
    out.push(n);
    id = n.parent;
  }
  return out.reverse();
}

export function currentBranch(chart: ChartData): Branch {
  return chart.branches.find((b) => b.id === chart.currentBranch) ?? chart.branches[0]!;
}

export function currentPath(chart: ChartData): ChartNode[] {
  return pathTo(chart, currentBranch(chart).tip);
}

export function opsEqual(a: Op, b: Op): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** 表示位置。null = 最初の操作の前 */
export type Cursor = string | null;

function uniqueBranchName(chart: ChartData, base: string): string {
  const names = new Set(chart.branches.map((b) => b.name));
  for (let i = 2; ; i++) {
    const name = `${base}-${i}`;
    if (!names.has(name)) return name;
  }
}

/**
 * 操作を記録する（§4.12、§14.0 巻き戻しとブランチ）。
 * - 先端にいれば、そのまま追記する
 * - 途中に戻っていて同じ操作なら、既存の続きをたどる
 * - 違う操作なら、その時点から新しいブランチを自動で作る（元のブランチは残す）
 */
export function recordOp(chart: ChartData, cursor: Cursor, op: Op): { chart: ChartData; cursor: Cursor; branched: boolean } {
  const branch = currentBranch(chart);
  if (cursor === branch.tip) {
    const node: ChartNode = { id: newId(), parent: cursor, op };
    return {
      chart: { ...chart, nodes: [...chart.nodes, node], branches: chart.branches.map((b) => (b.id === branch.id ? { ...b, tip: node.id } : b)) },
      cursor: node.id,
      branched: false,
    };
  }
  const path = currentPath(chart);
  const idx = cursor === null ? -1 : path.findIndex((n) => n.id === cursor);
  const next = path[idx + 1];
  if (next && opsEqual(next.op, op)) return { chart, cursor: next.id, branched: false };

  // 他のブランチに同じ続きがあれば、そのブランチに切り替えてたどる
  const map = nodeMap(chart);
  const sibling = chart.nodes.find((n) => n.parent === cursor && opsEqual(n.op, op));
  if (sibling) {
    const other = chart.branches.find((b) => pathTo(chart, b.tip, map).some((n) => n.id === sibling.id));
    if (other) return { chart: { ...chart, currentBranch: other.id }, cursor: sibling.id, branched: false };
  }

  const node: ChartNode = { id: newId(), parent: cursor, op };
  const nb: Branch = { id: newId(), name: uniqueBranchName(chart, branch.name), tip: node.id };
  return {
    chart: { ...chart, nodes: [...chart.nodes, node], branches: [...chart.branches, nb], currentBranch: nb.id },
    cursor: node.id,
    branched: true,
  };
}

/** どのブランチからも使われていないノードを消す */
export function gcNodes(chart: ChartData): ChartData {
  const map = nodeMap(chart);
  const keep = new Set<string>();
  for (const b of chart.branches) for (const n of pathTo(chart, b.tip, map)) keep.add(n.id);
  if (keep.size === chart.nodes.length) return chart;
  return { ...chart, nodes: chart.nodes.filter((n) => keep.has(n.id)) };
}

export function deleteBranch(chart: ChartData, branchId: string): ChartData {
  if (chart.branches.length <= 1) return chart;
  const branches = chart.branches.filter((b) => b.id !== branchId);
  const currentBranch = chart.currentBranch === branchId ? branches[0]!.id : chart.currentBranch;
  return gcNodes({ ...chart, branches, currentBranch });
}

export function renameBranch(chart: ChartData, branchId: string, name: string): ChartData {
  return { ...chart, branches: chart.branches.map((b) => (b.id === branchId ? { ...b, name } : b)) };
}

export function updateBranch(chart: ChartData, branchId: string, patch: Partial<Pick<Branch, "name" | "memo">>): ChartData {
  return { ...chart, branches: chart.branches.map((b) => (b.id === branchId ? { ...b, ...patch } : b)) };
}

export function switchBranch(chart: ChartData, branchId: string): ChartData {
  return { ...chart, currentBranch: branchId };
}

/** 今の位置から新しいブランチを作る（中身は今の位置までの操作を共有する） */
export function forkBranch(chart: ChartData, cursor: Cursor, name?: string): ChartData {
  const branch = currentBranch(chart);
  const nb: Branch = { id: newId(), name: name ?? uniqueBranchName(chart, branch.name), tip: cursor };
  return { ...chart, branches: [...chart.branches, nb], currentBranch: nb.id };
}

export function setNodeMemo(chart: ChartData, nodeId: string, memo: string): ChartData {
  return { ...chart, nodes: chart.nodes.map((n) => (n.id === nodeId ? (memo ? { ...n, memo } : { id: n.id, parent: n.parent, op: n.op }) : n)) };
}

/** ターンごとの区切り（nextTurn で区切る。§4.10） */
export function splitTurns<T extends { op: Op }>(items: readonly T[]): T[][] {
  const turns: T[][] = [[]];
  for (const it of items) {
    turns[turns.length - 1]!.push(it);
    if (it.op.type === "nextTurn") turns.push([]);
  }
  return turns;
}
