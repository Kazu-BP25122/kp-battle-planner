/**
 * 表示名：通知・警告・付与元に ID が出ないこと（§4.2 分けたアシスト・アビの常時効果の表示）
 */
import { describe, expect, it } from "vitest";
import { Battle } from "../src/engine";
import { assistDisplayName } from "../src/schema/character";
import { eventNotice } from "../src/components/labels";
import type { Catalog } from "../src/chart/input";
import { amon, artemis, attack, beethoven, buffSlots, eve, makeInput, nextTurn, shaitan, use } from "./helpers";

const chars = [beethoven, eve, shaitan, amon, artemis];
const catalog: Catalog = { characters: Object.fromEntries(chars.map((c) => [c.id, c])), buffSlots };
const allIds = chars.flatMap((c) => [...c.abilities.map((a) => a.id), ...(c.assists ?? []).map((a) => a.id)]);

describe("表示名", () => {
  it("名前の無いアシストは、分けた元のアシスト名・「アシスト n」・「<アビ名>（常時効果）」で表示する", () => {
    expect(assistDisplayName(shaitan, "shaitan_assist1_limiterReset")).toBe("アシスト1");
    expect(assistDisplayName(shaitan, "shaitan_a3_passive")).toBe("ジャースウサハム（常時効果）");
    expect(assistDisplayName(amon, "amon_assist1_turnEnd")).toBe("ヴォルトパニッシュメント");
    expect(assistDisplayName(amon, "amon_a2_passive")).toBe("破滅雷撃+（常時効果）");
  });

  it("5 体で数ターン操作しても、通知・警告・付与元にアビ・アシストの ID が出ない", () => {
    const b = new Battle(makeInput({ hero: beethoven, front1: eve, front2: shaitan, back1: amon, back2: artemis }, { corrections: { eve: { startGauge: 100 }, shaitan: { startGauge: 100 } } }));
    for (let t = 0; t < 3; t++) {
      for (const [c, a] of [["eve", "eve_a2"], ["eve", "eve_a2"], ["eve", "eve_a2"], ["shaitan", "shaitan_a1"], ["shaitan", "shaitan_a2"], ["amon", "amon_a2"], ["artemis", "artemis_a2"], ["beethoven", "beethoven_a1"]] as const) b.apply(use(c, a));
      b.apply(attack());
      b.apply(nextTurn);
    }
    const texts = [
      ...b.state.log.map((e) => eventNotice(catalog, e)).filter((x): x is string => x !== null),
      ...b.state.warnings.map((w) => w.message),
      ...Object.values(b.state.chars).flatMap((c) => c.buffs.map((x) => x.sourceLabel)),
    ];
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) for (const id of allIds) expect(t, t).not.toContain(id);
  });
});
