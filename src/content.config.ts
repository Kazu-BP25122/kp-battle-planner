import { defineCollection } from "astro:content";
import { glob, file } from "astro/loaders";
import { Character } from "./schema/character";
import { BuffSlot } from "./schema/buffSlot";

// キャラ定義はビルド時に Zod で検証する（§2、§12）
const characters = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/characters" }),
  schema: Character,
});

// buffSlots.json は { note, slots: [...] } の形（§7.2）。slots の各要素を 1 エントリとして読む
const buffSlots = defineCollection({
  loader: file("./src/content/buffSlots.json", { parser: (text) => JSON.parse(text).slots }),
  schema: BuffSlot,
});

export const collections = { characters, buffSlots };
