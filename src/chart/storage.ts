/**
 * チャートの保存（localStorage）と JSON 入出力（§4.10）。
 * 読み込み時は必ず Zod で検証し、通らないデータは読み込まない。
 */
import { ChartData } from "../schema/chart";
import { pathTo } from "./tree";

export const STORAGE_KEY = "kp-battle-planner:chart";

export type ParseResult = { ok: true; chart: ChartData } | { ok: false; error: string };

export function parseChart(raw: unknown): ParseResult {
  const r = ChartData.safeParse(raw);
  if (!r.success) {
    return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n") };
  }
  try {
    // 木の循環を検出する
    for (const b of r.data.branches) pathTo(r.data, b.tip);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return { ok: true, chart: r.data };
}

export function parseChartJson(text: string): ParseResult {
  try {
    return parseChart(JSON.parse(text));
  } catch (e) {
    return { ok: false, error: `JSON として読めない: ${(e as Error).message}` };
  }
}

export function chartToJson(chart: ChartData): string {
  return JSON.stringify(chart, null, 2);
}

export function loadFromStorage(storage: Pick<Storage, "getItem">): ParseResult | null {
  const text = storage.getItem(STORAGE_KEY);
  if (text === null) return null;
  return parseChartJson(text);
}

export function saveToStorage(storage: Pick<Storage, "setItem">, chart: ChartData): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(chart));
}
