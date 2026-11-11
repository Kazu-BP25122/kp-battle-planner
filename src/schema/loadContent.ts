/**
 * src/content のキャラ定義と枠を、ファイルの中身から検証付きで読み込む（Node から使う。scripts/ と tests/）。
 * ファイルの読み出し自体は呼び出し側が行い、ここは純粋な処理だけにする。
 */
import { BuffSlotFile, type BuffSlot } from "./buffSlot";
import { Character } from "./character";
import { validateAll, type DataIssue } from "./validate";

export interface RawFile {
  name: string;
  text: string;
}

export interface LoadedContent {
  characters: Character[];
  buffSlots: BuffSlot[];
  issues: DataIssue[];
}

function zodIssues(file: string, error: { issues: { path: PropertyKey[]; message: string }[] }): DataIssue[] {
  return error.issues.map((i) => ({ file, path: i.path.map(String).join(".") || "(root)", message: i.message }));
}

export function loadContent(characterFiles: readonly RawFile[], buffSlotsFile: RawFile, customIds: ReadonlySet<string>): LoadedContent {
  const issues: DataIssue[] = [];
  let buffSlots: BuffSlot[] = [];
  const slots = BuffSlotFile.safeParse(JSON.parse(buffSlotsFile.text));
  if (slots.success) buffSlots = slots.data.slots;
  else issues.push(...zodIssues(buffSlotsFile.name, slots.error));

  const characters: Character[] = [];
  const names: string[] = [];
  for (const f of characterFiles) {
    let raw: unknown;
    try {
      raw = JSON.parse(f.text);
    } catch (e) {
      issues.push({ file: f.name, path: "(root)", message: `JSON として読めない: ${(e as Error).message}` });
      continue;
    }
    const r = Character.safeParse(raw);
    if (!r.success) {
      issues.push(...zodIssues(f.name, r.error));
      continue;
    }
    if (`${r.data.id}.json` !== f.name) issues.push({ file: f.name, path: "id", message: `ファイル名と id（${r.data.id}）が一致しない` });
    characters.push(r.data);
    names.push(f.name);
  }
  issues.push(...validateAll({ buffSlots, characters, customIds }, names));
  return { characters, buffSlots, issues };
}
