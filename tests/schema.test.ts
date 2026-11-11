import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Character } from "../src/schema/character";
import { BuffSlotList } from "../src/schema/buffSlot";
import { EffectList } from "../src/schema/dsl";
import { buffSlots } from "./helpers";
import type { Effect } from "../src/schema/dsl";

const dir = join(__dirname, "../src/content/characters");

/** 効果の木から枠 ID を集める */
function slotsIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => slotsIn(v, out));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ((o.type === "addBuff" || o.type === "addDebuff") && typeof o.slot === "string") out.add(o.slot);
    Object.values(o).forEach((v) => slotsIn(v, out));
  }
  return out;
}

describe("コンテンツデータの検証（§12）", () => {
  it("buffSlots.json がスキーマを満たす", () => {
    expect(() => BuffSlotList.parse(JSON.parse(readFileSync(join(__dirname, "../src/content/buffSlots.json"), "utf8")))).not.toThrow();
  });

  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    it(`characters/${f} がスキーマを満たし、ファイル名と ID が一致し、枠 ID が登録済み`, () => {
      const c = Character.parse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      expect(`${c.id}.json`).toBe(f);
      const known = new Set(buffSlots.map((s) => s.id));
      for (const s of slotsIn(c)) expect(known.has(s), `未登録の枠: ${s}`).toBe(true);
    });
  }
});

describe("DSL のスキーマ（§10）", () => {
  it("if / switch の入れ子は 3 段まで", () => {
    const nest = (n: number): Effect => (n === 0 ? { type: "heal", target: "self" } : { type: "if", cond: { turnCount: { gte: 1 } }, then: [nest(n - 1)] });
    expect(EffectList.safeParse([nest(3)]).success).toBe(true);
    expect(EffectList.safeParse([nest(4)]).success).toBe(false);
  });

  it("未知の部品やコードは受け付けない（§3-4）", () => {
    expect(EffectList.safeParse([{ type: "eval", code: "alert(1)" }]).success).toBe(false);
    expect(EffectList.safeParse([{ type: "damage", target: "enemy", extra: 1 }]).success).toBe(false);
  });
});
