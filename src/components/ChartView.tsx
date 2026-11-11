import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartData } from "../schema/chart";
import type { Catalog } from "../chart/input";
import { setNodeMemo, splitTurns, type Cursor } from "../chart/tree";
import { chartToJson, parseChartJson } from "../chart/storage";
import { createMonteCarlo, UNUSABLE_LABEL, type MonteCarloResult, type Warning } from "../engine";
import type { Commit } from "./App";
import type { ChartModel } from "./model";
import { charName, eventLogLines, failureLabel, opLabel, PHASE_LABEL } from "./labels";
import type { BattleEvent } from "../engine";

interface Props {
  catalog: Catalog;
  chart: ChartData;
  model: ChartModel;
  cursor: Cursor;
  jumpTo: (c: Cursor) => void;
  commit: Commit;
  notify: (msg: string) => void;
}

const WARNING_LABEL: Record<Warning["code"], string> = {
  buffMissed: "MISS",
  buffShortened: "持続の上書き",
  debuffFloor: "デバフ下限",
  amountUnknown: "効果量不明",
  unknownSlot: "未登録の枠",
  opInvalid: "使えない操作",
  noSub: "サブなし",
  countBuffNotKept: "回数制バフ",
  comboRateMissing: "連撃率未入力",
  stepLimit: "処理上限",
  customMissing: "専用処理なし",
  dataError: "データ",
  tokenOverflow: "トークン破棄",
  stackMax: "累積上限",
  stackDurationUnknown: "累積の持続不明",
  durationUnknown: "持続不明",
  burstUnset: "バースト未設定",
};

export function ChartView({ catalog, chart, model, cursor, jumpTo, commit, notify }: Props) {
  const steps = model.full.steps;
  const warnings = model.full.battle.state.warnings;
  const rows = useMemo(() => model.path.map((node, i) => ({ node, op: node.op, step: steps[i]!, index: i })), [model.path, steps]);
  const turns = splitTurns(rows);
  // 開いている行（表示設定なので履歴には積まない。§14.3）。"start" は戦闘開始の行
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const log = model.full.battle.state.log;
  // 戦闘開始〜1 ターン目のターン開始処理（操作の前）に起きたこと
  const startEvents = useMemo(() => log.filter((e) => e.opIndex < 0), [log]);

  return (
    <div className="chartview">
      <section>
        <h2>ターン表</h2>
        <table className="turntable">
          <thead>
            <tr>
              <th>T</th>
              <th>#</th>
              <th>操作</th>
              <th>結果</th>
              <th>メモ</th>
            </tr>
          </thead>
          <tbody>
            <tr className={`${cursor === null ? "current" : ""}${open.has("start") ? " open" : ""}`} onClick={() => toggle("start")} aria-expanded={open.has("start")} title="クリックでログを開く">
              <td colSpan={5} className="muted">
                <span className="caret">{open.has("start") ? "▼" : "▶"}</span> 戦闘開始
              </td>
            </tr>
            {open.has("start") && (
              <OpDetail colSpan={5} catalog={catalog} events={startEvents} current={cursor === null} onBack={() => jumpTo(null)} />
            )}
            {turns.map((t, ti) => {
              // 開いた行の下にログの行が入るので、ターンの列はその分も縦に結合する
              const span = t.length + t.filter((r) => open.has(r.node.id)).length;
              return t.map((r, k) => {
                const ws = warnings.filter((w) => w.opIndex === r.index);
                const acts = r.step.result.attackActions;
                const bursts = acts?.filter((a) => a.kind === "burst") ?? [];
                const events = log.slice(...r.step.result.eventRange);
                const entered = events.filter((e) => e.type === "enterBattle");
                const isOpen = open.has(r.node.id);
                return [
                  <tr
                    key={r.node.id}
                    className={`${r.node.id === cursor ? "current" : ""}${r.step.result.ok ? "" : " invalid"}${isOpen ? " open" : ""}`}
                    onClick={() => toggle(r.node.id)}
                    aria-expanded={isOpen}
                    title="クリックでこの操作で起きたことを開く"
                  >
                    {k === 0 && (
                      <td rowSpan={span} className="turncol" onClick={(e) => e.stopPropagation()}>
                        {ti + 1}
                      </td>
                    )}
                    <td className="muted">
                      <span className="caret">{isOpen ? "▼" : "▶"}</span> {r.index + 1}
                    </td>
                    <td>{opLabel(catalog, r.op)}</td>
                    <td>
                      {!r.step.result.ok && <span className="badge danger">使用不可：{r.step.result.reasons.map((x) => UNUSABLE_LABEL[x]).join("・")}</span>}
                      {acts && (
                        <span>
                          {r.step.state.burstMode === "fire" ? "発動" : "温存"}：
                          {acts.map((a) => (
                            <span key={a.charId} className={a.kind === "burst" ? "badge burst" : "act"}>
                              {charName(catalog, a.charId)}
                              {a.kind === "burst" ? "B" : `${a.combo ?? 1}`}
                            </span>
                          ))}
                          {bursts.length >= 2 && <span className="badge">リンク {bursts.length}人</span>}
                        </span>
                      )}
                      {entered.map((e) => (
                        <span key={e.seq} className="badge">
                          {charName(catalog, e.actor)} 登場
                        </span>
                      ))}
                      {ws
                        .filter((w) => w.code !== "opInvalid")
                        .map((w, i) => (
                          <div key={i} className="warn small">
                            ⚠ {w.message}
                          </div>
                        ))}
                    </td>
                    <td
                      onClick={(e) => {
                        e.stopPropagation();
                        const memo = window.prompt("メモ", r.node.memo ?? "");
                        if (memo !== null && memo !== (r.node.memo ?? "")) commit({ chart: setNodeMemo(chart, r.node.id, memo), cursor }, "メモを変更");
                      }}
                      className="memo"
                      title="クリックでメモを編集"
                    >
                      {r.node.memo ?? <span className="muted">＋</span>}
                    </td>
                  </tr>,
                  isOpen && <OpDetail key={`${r.node.id}-log`} colSpan={4} catalog={catalog} events={events} current={r.node.id === cursor} onBack={() => jumpTo(r.node.id)} />,
                ];
              });
            })}
          </tbody>
        </table>
        {model.path.length === 0 && <p className="muted">まだ操作がない。プレイ画面で操作すると記録される。</p>}
      </section>

      <SuccessPanel catalog={catalog} model={model} />

      <section>
        <h2>警告（{warnings.length}）</h2>
        {warnings.length === 0 ? (
          <p className="muted">なし</p>
        ) : (
          <ul className="warnings">
            {warnings.map((w, i) => (
              <li key={i} onClick={() => w.opIndex >= 0 && jumpTo(model.path[w.opIndex]?.id ?? null)}>
                <span className="badge">{WARNING_LABEL[w.code]}</span> T{w.turn}
                {w.opIndex >= 0 ? `・${w.opIndex + 1}手目` : ""}：{w.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <IoPanel chart={chart} commit={commit} notify={notify} />
    </div>
  );
}

/** 開いた行：その操作で起きたこと（イベントログ）と、この時点に戻るボタン */
function OpDetail({ colSpan, catalog, events, current, onBack }: { colSpan: number; catalog: Catalog; events: readonly BattleEvent[]; current: boolean; onBack: () => void }) {
  const lines = eventLogLines(catalog, events);
  return (
    <tr className="opdetail">
      <td colSpan={colSpan}>
        <div className="opdetail-head">
          <button onClick={onBack} disabled={current} title="プレイ画面をこの操作の直後の状態に戻す">
            {current ? "今この時点を表示中" : "この時点に戻る"}
          </button>
        </div>
        {lines.length === 0 ? (
          <p className="muted small">この操作で起きたことはない。</p>
        ) : (
          <ol className="eventlog">
            {lines.map((l, i) => (
              <li key={l.key} className={l.byAssist ? "by-assist" : ""}>
                {(i === 0 || lines[i - 1]!.phase !== l.phase) && <span className="phase">{PHASE_LABEL[l.phase]}</span>}
                {l.text}
                {l.times > 1 && <span className="times"> ×{l.times}</span>}
              </li>
            ))}
          </ol>
        )}
      </td>
    </tr>
  );
}

/** 成功確率（§9）。ブラウザを止めないよう少しずつ実行する */
function SuccessPanel({ catalog, model }: { catalog: Catalog; model: ChartModel }) {
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(false);
  const [stale, setStale] = useState(false);
  const cancel = useRef(false);
  const total = 10000;

  // チャートデータが変わったら古い結果は無効（§14.3）
  useEffect(() => {
    if (result) setStale(true);
    cancel.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.full]);

  const run = () => {
    cancel.current = false;
    setRunning(true);
    setStale(false);
    const mc = createMonteCarlo(model.input, model.path.map((n) => n.op), { seed: Date.now() & 0xffffffff });
    let done = 0;
    const tick = () => {
      if (cancel.current) {
        setRunning(false);
        return;
      }
      const n = Math.min(500, total - done);
      mc.runBatch(n);
      done += n;
      setResult(mc.result());
      if (done < total) setTimeout(tick, 0);
      else setRunning(false);
    };
    setTimeout(tick, 0);
  };

  return (
    <section>
      <h2>成功確率</h2>
      <button className="primary" onClick={run} disabled={running || model.path.length === 0}>
        {running ? "計算中…" : `計算する（${total.toLocaleString()} 回）`}
      </button>
      {result && (
        <div className={stale ? "stale" : ""}>
          {stale && <p className="warn">チャートが変わったため、この結果は古い。再計算してください。</p>}
          <p className="big">
            {((result.successes / Math.max(1, result.trials)) * 100).toFixed(1)}%
            <small>
              （{result.successes.toLocaleString()} / {result.trials.toLocaleString()}）
            </small>
          </p>
          {result.missingComboRates.length > 0 && (
            <p className="warn small">連撃率が未入力のキャラ（常に 1 段として計算）：{result.missingComboRates.map((id) => charName(catalog, id)).join("、")}</p>
          )}
          <p className="small">
            予定外のバースト：{result.unexpectedBursts.toLocaleString()} 回（{result.trialsWithUnexpected.toLocaleString()} 試行）
          </p>
          {result.failures.length > 0 && (
            <table className="failures">
              <thead>
                <tr>
                  <th>位置</th>
                  <th>キャラ</th>
                  <th>原因</th>
                  <th>回数</th>
                </tr>
              </thead>
              <tbody>
                {result.failures.map((f) => (
                  <tr key={`${f.opIndex}:${f.charId}:${f.reason}`}>
                    <td>
                      T{f.turn}・{f.opIndex + 1}手目
                    </td>
                    <td>{charName(catalog, f.charId)}</td>
                    <td>{failureLabel(f.reason)}</td>
                    <td>
                      {f.count.toLocaleString()}（{((f.count / result.trials) * 100).toFixed(1)}%）
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

function IoPanel({ chart, commit, notify }: { chart: ChartData; commit: Commit; notify: (m: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const exportJson = () => {
    const blob = new Blob([chartToJson(chart)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chart-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <section>
      <h2>保存・読み込み</h2>
      <p className="small muted">チャートはブラウザ（localStorage）に自動保存される。JSON には全ブランチが含まれる。</p>
      <button onClick={exportJson}>JSON 出力</button>{" "}
      <button onClick={() => fileRef.current?.click()}>JSON 読み込み</button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const r = parseChartJson(await f.text());
          if (!r.ok) {
            notify(`読み込めなかった：${r.error.split("\n")[0]}`);
            return;
          }
          const tip = r.chart.branches.find((b) => b.id === r.chart.currentBranch)!.tip;
          commit({ chart: r.chart, cursor: tip }, `${f.name} の読み込み`);
          notify(`${f.name} を読み込んだ`);
        }}
      />
    </section>
  );
}
