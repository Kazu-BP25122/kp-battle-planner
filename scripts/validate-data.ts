/**
 * データ検証コマンド（AGENTS.md §16.1 手順 2）：npm run validate:data
 * src/content/characters/*.json と src/content/buffSlots.json を Zod スキーマで検証し、
 * スキーマだけでは見られない参照（枠・トークン・アビ・アシスト・オプション・共有の効果・custom）と入れ子の段数を検査する。
 * 問題があれば一覧を出して終了コード 1 で終わる。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadContent } from "../src/schema/loadContent";
import { CUSTOM_EFFECT_IDS } from "../src/engine/custom";

const root = join(import.meta.dirname, "..");
const charDir = join(root, "src/content/characters");
const files = readdirSync(charDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((name) => ({ name, text: readFileSync(join(charDir, name), "utf8") }));
const slots = { name: "buffSlots.json", text: readFileSync(join(root, "src/content/buffSlots.json"), "utf8") };

const { characters, buffSlots, issues } = loadContent(files, slots, CUSTOM_EFFECT_IDS);

if (issues.length > 0) {
  console.error(`データの検証で ${issues.length} 件の問題が見つかった：`);
  for (const i of issues) console.error(`  ${i.file} ${i.path}: ${i.message}`);
  process.exit(1);
}
console.log(`OK: キャラ ${characters.length} 体（${characters.map((c) => c.id).join(", ")}）、枠 ${buffSlots.length} 件`);
