import type { ChartData } from "../schema/chart";
import { deleteBranch, forkBranch, switchBranch, updateBranch, type Cursor } from "../chart/tree";
import type { Commit } from "./App";
import type { ChartModel } from "./model";
import { PHASE_LABEL } from "./labels";

interface Props {
  chart: ChartData;
  cursor: Cursor;
  model: ChartModel;
  commit: Commit;
}

/** ブランチの切り替えメニュー（§14.0 巻き戻しとブランチ） */
export function BranchBar({ chart, cursor, model, commit }: Props) {
  const branch = chart.branches.find((b) => b.id === chart.currentBranch)!;
  return (
    <div className="branchbar">
      <label>
        ブランチ
        <select
          value={chart.currentBranch}
          onChange={(e) => {
            const next = switchBranch(chart, e.target.value);
            const tip = next.branches.find((b) => b.id === e.target.value)!.tip;
            commit({ chart: next, cursor: tip }, `ブランチを「${next.branches.find((b) => b.id === e.target.value)!.name}」に切り替え`);
          }}
        >
          {chart.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <span className="where">
        T{model.state.turn}・{PHASE_LABEL[model.state.phase]}
        {!model.atTip && <em>（巻き戻し中：{model.cursorIndex + 1}/{model.path.length} 手目）</em>}
      </span>
      <button
        onClick={() => {
          const name = window.prompt("ブランチ名", branch.name);
          if (name && name !== branch.name) commit({ chart: updateBranch(chart, branch.id, { name }), cursor }, `ブランチ名を「${name}」に変更`);
        }}
      >
        名前を変更
      </button>
      <button
        onClick={() => {
          const memo = window.prompt("ブランチのメモ", branch.memo ?? "");
          if (memo !== null && memo !== (branch.memo ?? "")) commit({ chart: updateBranch(chart, branch.id, { memo }), cursor }, "ブランチのメモを変更");
        }}
      >
        メモ
      </button>
      <button
        onClick={() => {
          const next = forkBranch(chart, cursor);
          commit({ chart: next, cursor }, `ブランチ「${next.branches[next.branches.length - 1]!.name}」を作成`);
        }}
        title="今の位置から別案のブランチを作る"
      >
        ここから分岐
      </button>
      <button
        disabled={chart.branches.length <= 1}
        onClick={() => {
          if (!window.confirm(`ブランチ「${branch.name}」を削除する？`)) return;
          const next = deleteBranch(chart, branch.id);
          commit({ chart: next, cursor: next.branches.find((b) => b.id === next.currentBranch)!.tip }, `ブランチ「${branch.name}」を削除`);
        }}
      >
        削除
      </button>
      {branch.memo && <span className="memo">📝 {branch.memo}</span>}
    </div>
  );
}
