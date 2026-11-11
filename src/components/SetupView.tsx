import { useEffect, useState } from "react";
import { z } from "zod";
import { CharCorrection, PARTY_SLOTS, type ChartData, type PartySlot, type Settings } from "../schema/chart";
import { Assist } from "../schema/dsl";
import { ELEMENTS, ELEMENT_LABEL, type Element } from "../schema/common";
import type { Catalog } from "../chart/input";
import type { Cursor } from "../chart/tree";
import type { Commit } from "./App";
import { charName } from "./labels";

interface Props {
  catalog: Catalog;
  chart: ChartData;
  cursor: Cursor;
  commit: Commit;
}

const SLOT_NAME: Record<PartySlot, string> = {
  hero: "英霊",
  front1: "前衛1",
  front2: "前衛2",
  back1: "後衛1",
  back2: "後衛2",
  sub1: "サブ1",
  sub2: "サブ2",
};

/** 確定（blur / Enter）した時点で 1 操作にする数値入力（§14.3） */
function NumberField({ value, onCommit, label, min, max }: { value: number | undefined; onCommit: (v: number | undefined) => void; label: string; min?: number; max?: number }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  const done = () => {
    const v = text.trim() === "" ? undefined : Number(text);
    if (v !== undefined && Number.isNaN(v)) return setText(value === undefined ? "" : String(value));
    if (v !== value) onCommit(v);
  };
  return (
    <label className="numfield">
      {label}
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        onChange={(e) => setText(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

function AssistEditor({ value, onCommit }: { value: unknown[] | undefined; onCommit: (v: z.infer<typeof Assist>[] | undefined) => void }) {
  const initial = value && value.length ? JSON.stringify(value, null, 2) : "";
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(initial), [initial]);
  return (
    <div className="assisteditor">
      <textarea
        rows={text ? 8 : 2}
        value={text}
        placeholder='[{ "id": "acc1", "trigger": { "event": "battleStart" }, "effects": [{ "type": "gaugeUp", "target": "self", "amount": 20 }] }]'
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text === initial) return;
          if (text.trim() === "") {
            setError(null);
            onCommit(undefined);
            return;
          }
          try {
            // 詳細入力も DSL の部品名だけで書かれていることを Zod で確かめる（§3-4、§4.10）
            const r = z.array(Assist).safeParse(JSON.parse(text));
            if (!r.success) {
              setError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
              return;
            }
            setError(null);
            onCommit(r.data);
          } catch (e) {
            setError(`JSON として読めない: ${(e as Error).message}`);
          }
        }}
      />
      {error && <pre className="error">{error}</pre>}
    </div>
  );
}

export function SetupView({ catalog, chart, cursor, commit }: Props) {
  const all = Object.values(catalog.characters);
  const used = new Set(Object.values(chart.party).filter(Boolean));
  const partyIds = PARTY_SLOTS.map((s) => chart.party[s]).filter((x): x is string => !!x);

  const setCorrection = (id: string, patch: Partial<z.infer<typeof CharCorrection>>, label: string) => {
    const cur = { ...(chart.corrections[id] ?? {}), ...patch };
    for (const k of Object.keys(cur) as (keyof typeof cur)[]) if (cur[k] === undefined) delete cur[k];
    const r = CharCorrection.safeParse(cur);
    if (!r.success) {
      window.alert(r.error.issues.map((i) => i.message).join("\n"));
      return;
    }
    const corrections = { ...chart.corrections };
    if (Object.keys(r.data).length === 0) delete corrections[id];
    else corrections[id] = r.data;
    commit({ chart: { ...chart, corrections }, cursor }, label);
  };

  const setSetting = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    commit({ chart: { ...chart, settings: { ...chart.settings, [k]: v } }, cursor }, `設定 ${k} を変更`);

  return (
    <div className="setup">
      <section>
        <h2>編成</h2>
        <p className="small muted">編成を変えても操作の記録は消えない。使えなくなった操作はチャート上で警告になる。</p>
        <div className="partygrid">
          {PARTY_SLOTS.map((slot) => (
            <label key={slot}>
              {SLOT_NAME[slot]}
              <select
                value={chart.party[slot] ?? ""}
                onChange={(e) => {
                  const v = e.target.value || null;
                  commit({ chart: { ...chart, party: { ...chart.party, [slot]: v } }, cursor }, `${SLOT_NAME[slot]}を${v ? charName(catalog, v) : "空き"}に変更`);
                }}
              >
                <option value="">（空き）</option>
                {all
                  .filter((c) => (slot === "hero" ? c.kind === "hero" : c.kind === "princess"))
                  .map((c) => (
                    <option key={c.id} value={c.id} disabled={used.has(c.id) && chart.party[slot] !== c.id}>
                      {c.name}（{ELEMENT_LABEL[c.element]}）
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
        {all.length < 5 && <p className="small warn">登録済みのキャラは {all.length} 体。初期リリースの 5 体の人選は未確定（AGENTS.md §15.2）。</p>}
      </section>

      <section>
        <h2>クエスト</h2>
        <div className="form-row">
          <label>
            敵の名前
            <input
              defaultValue={chart.quest.enemyName ?? ""}
              key={chart.quest.enemyName ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v === (chart.quest.enemyName ?? "")) return;
                const quest = { ...chart.quest };
                if (v) quest.enemyName = v;
                else delete quest.enemyName;
                commit({ chart: { ...chart, quest }, cursor }, "敵の名前を変更");
              }}
            />
          </label>
          <label>
            敵の属性
            <select
              value={chart.quest.enemyElement ?? ""}
              onChange={(e) => commit({ chart: { ...chart, quest: { ...chart.quest, enemyElement: (e.target.value || null) as Element | null } }, cursor }, "敵の属性を変更")}
            >
              <option value="">（なし）</option>
              {ELEMENTS.map((el) => (
                <option key={el} value={el}>
                  {ELEMENT_LABEL[el]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section>
        <h2>ユーザー補正</h2>
        <p className="small muted">連撃率は成功確率の計算に使う（未入力なら常に 1 段）。詳細入力は効果 DSL のアシスト（JSON）をキャラ単位で追加できる。</p>
        {partyIds.length === 0 && <p className="muted">編成するとここに表示される。</p>}
        {partyIds.map((id) => {
          const c = chart.corrections[id] ?? {};
          return (
            <fieldset key={id} className="correction">
              <legend>{charName(catalog, id)}</legend>
              <div className="form-row">
                <NumberField label="2段攻撃率 %" value={c.doubleRate} min={0} max={100} onCommit={(v) => setCorrection(id, { doubleRate: v }, `${charName(catalog, id)}の 2 段攻撃率を変更`)} />
                <NumberField label="3段攻撃率 %" value={c.tripleRate} min={0} max={100} onCommit={(v) => setCorrection(id, { tripleRate: v }, `${charName(catalog, id)}の 3 段攻撃率を変更`)} />
              </div>
              <details>
                <summary>詳細入力（ユーザー定義アシスト）</summary>
                <AssistEditor value={c.assists} onCommit={(v) => setCorrection(id, { assists: v }, `${charName(catalog, id)}の詳細入力を変更`)} />
              </details>
            </fieldset>
          );
        })}
      </section>

      <section>
        <h2>仮置き仕様の切り替え</h2>
        <p className="small muted">実機で未確認の挙動。チャートごとに保存され、共有先でも同じ結果になる。</p>
        <label className="setting">
          <input type="checkbox" checked={chart.settings.assistReentry} onChange={(e) => setSetting("assistReentry", e.target.checked)} />
          同じタイミング内で前のアシストに戻って発動する（§6.1-3）
        </label>
        <label className="setting">
          アシストが生んだイベント（§6.1-4）
          <select value={chart.settings.assistEventOrder} onChange={(e) => setSetting("assistEventOrder", e.target.value as Settings["assistEventOrder"])}>
            <option value="queue">後回し（queue）</option>
            <option value="interrupt">割り込み（interrupt）</option>
          </select>
        </label>
        <label className="setting">
          アシストの判定タイミング（§6）
          <select value={chart.settings.assistTiming} onChange={(e) => setSetting("assistTiming", e.target.value as Settings["assistTiming"])}>
            <option value="afterAbility">アビの効果をすべて処理した後</option>
            <option value="perEffect">効果ごと</option>
          </select>
        </label>
      </section>
    </div>
  );
}
