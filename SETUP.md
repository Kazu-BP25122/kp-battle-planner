# SETUP.md — 開発環境の構築手順

仕様は [AGENTS/AGENTS.md](./AGENTS/AGENTS.md)、環境構築はこのファイル（AGENTS.md §16.3）。

## 1. 前提

| ツール | バージョン | 確認コマンド |
|---|---|---|
| Node.js | 24 系（`.nvmrc` と `package.json` の `engines` で固定） | `node -v` → `v24.x.x` |
| npm | 11 系（Node.js 24 に同梱） | `npm -v` → `11.x.x` |
| Git | 任意の最近のもの | `git --version` |

- Windows / macOS / Linux のいずれでも同じ手順で動く（Windows 11 + Git Bash / PowerShell で確認済み）。
- §2 で指定のない開発ツールとして選んだもの：
  - パッケージマネージャー：npm（Node.js に同梱され、追加のインストールが要らないため）
  - TypeScript のスクリプト実行：`tsx`（データ検証コマンド `scripts/validate-data.ts` を、ビルドせずにそのまま実行するため。`src/` の拡張子なしの import をそのまま解決できる）
- nvm を使う場合は、リポジトリ直下で `nvm use`（nvm-windows は `nvm use 24`）。

## 2. 取得と初期設定

```sh
git clone <このリポジトリの URL> kp-battle-planner
cd kp-battle-planner
npm ci
```

- 環境変数は不要（`.env` は使わない）。

## 3. 日常のコマンド

| 目的 | コマンド | 成功したときの表示 |
|---|---|---|
| 開発サーバー | `npm run dev` | `astro v7.x ready` と `Local http://localhost:4321/`。ブラウザで開く |
| データ検証 | `npm run validate:data` | `OK: キャラ 5 体（amon, artemis, beethoven, eve, shaitan）、枠 N 件`。問題があれば一覧を出して終了コード 1 |
| テスト（全体） | `npm test` | `Test Files N passed` / `Tests N passed` |
| テスト（1 ファイル） | `npx vitest run tests/eve.test.ts` | 同上 |
| テスト（監視モード） | `npm run test:watch` | 変更のたびに再実行される |
| 型チェック | `npm run check` | `0 errors` |
| 本番ビルド | `npm run build` | `1 page(s) built` と `Complete!`。出力は `dist/` |
| ビルド結果の確認 | `npm run preview` | `http://localhost:4321/` で `dist/` を配信（※未確認） |

- Lint・整形ツールはまだ導入していない。
- `npm run check` の前に型定義（`.astro/`）が必要だが、`astro check` が自動で生成する。エディタで `astro:content` が見つからないと出たら `npx astro sync` を実行する。

## 4. ディレクトリ

```
SETUP.md             このファイル
CLAUDE.md            エージェント向けの入口（AGENTS/AGENTS.md を読み込ませる）
AGENTS/              仕様と資料（編集するときはクライアントに確認する）
  AGENTS.md          仕様書兼作業ガイド
  CHARACTER.md       キャラごとの資料・確定状況・検証の記録
  CHARACTER_DATA_GUIDE.md  説明文からキャラ定義 JSON を作る手順
  DSL_PARTS.md       効果 DSL の部品の一覧表
astro.config.mjs     Astro の設定（React 連携）
vitest.config.ts     テストの設定（tests/**/*.test.{ts,tsx}）
src/
  engine/            計算エンジン。純粋な TypeScript で UI に依存しない（§3-1）
    effects/         効果部品の登録表（registry）
    conditions/      条件部品
    custom/          キャラ専用処理（逃げ道）
  schema/            Zod スキーマ（キャラ定義・効果 DSL・バフ枠・チャートデータ）、省略形の展開（expand.ts）、参照の検査（validate.ts）
  chart/             操作の記録の木・ブランチ・Undo/Redo・保存（UI 非依存）
  content/
    characters/      1 キャラ 1 ファイルの JSON（初期リリースの 5 体）
    eidolons/        幻獣（定義項目が未確定のため空）
    buffSlots.json   バフ・デバフの枠（{ note, slots: [...] } の形）
  content.config.ts  Content Collections の定義（ビルド時に Zod で検証）
  components/        React の UI（プレイ画面・チャート・ガント・編成）
  pages/             Astro のページ
  styles/            CSS
scripts/
  validate-data.ts   データ検証コマンド（npm run validate:data）
tests/
  cases/             実プレイで確認した正解データ（§13。まだ無い）
  *.test.ts(x)       Vitest のテスト。tests/ の架空キャラはエンジンの単体テスト専用
```

## 5. キャラデータの追加（AGENTS.md §12）

1. 作り方は `AGENTS/CHARACTER_DATA_GUIDE.md`、部品の項目は `AGENTS/DSL_PARTS.md` に従う。資料と確定状況は `AGENTS/CHARACTER.md` に節を作って書く。
2. `src/content/characters/<id>.json` を作る。`id` は英小文字・数字・`_`・`-` のみで、ファイル名と一致させる。形式は `src/schema/character.ts`（効果 DSL は `src/schema/dsl.ts`）。
3. バフ・デバフの枠 ID は `src/content/buffSlots.json` の `slots` に登録済みのものを使う。無ければ枠を追加してから使う。
4. 専用処理（`custom`）を使うときは `src/engine/custom/index.ts` に登録する。
5. 検証する：
   ```sh
   npm run validate:data
   npm test
   ```
   `validate:data` はスキーマに加えて、枠・トークン・アビ・アシスト・オプション・共有の効果・custom の参照先と、省略形（`recast`・`useEffects`）を展開した後の入れ子の段数（3 段まで）を検査する。`tests/schema.test.ts` も同じ検査を行う。ビルド（`npm run build`）でも Content Collections がスキーマで検証する。
6. キャラの主な仕組みのテストを `tests/characters.test.ts`（イヴは `tests/eve.test.ts`）に足す。

## 6. テストケースの追加（AGENTS.md §13）

- 実プレイの記録は `tests/cases/` に置く（形式：チャートデータ §4.10 + 各時点の期待値）。**まだ記録が届いていないため、読み込むテストは未作成**（AGENTS.md §16.1 手順 13）。
- エンジンの部品を追加したら、`tests/parts.test.ts`（部品単位）や `tests/engine.test.ts` に対応するテストを追加する。架空キャラ用の枠は `tests/helpers.ts` に置き、実データ（`buffSlots.json`）には入れない。

## 7. デプロイ

### Cloudflare Pages（未設定。設定するときの値）

| 項目 | 値 |
|---|---|
| フレームワーク プリセット | Astro |
| ビルドコマンド | `npm run build` |
| 出力ディレクトリ | `dist` |
| 環境変数 | `NODE_VERSION` = `24` |

※ Cloudflare Pages 側の設定はまだ行っていない（未確認の手順）。

### GitHub Actions

`.github/workflows/ci.yml`：`main` への push と pull request で `npm ci` → `npm run validate:data` → `npm run check` → `npm test` → `npm run build` を実行する。デプロイは Cloudflare Pages の Git 連携で行う想定（未設定）。

## 8. よくあるトラブル

| 症状 | 対処 |
|---|---|
| エディタで `Cannot find module 'astro:content'` | `npx astro sync` を実行して型定義を生成する |
| `npm ci` が `engines` の警告を出す | Node.js 24 を使う（`node -v` を確認） |
| `npm install` で `npm warn install-scripts esbuild ... (postinstall)` と出る | npm 11 がインストールスクリプトを止めている警告。`tsx`（esbuild）はそのまま動くので無視してよい（`npm run validate:data` が動くことで確認） |
| `npm run dev` が `Another astro dev server is already running.` で止まる | 前に起動した開発サーバーが残っている。表示された PID を止めるか、`npx astro dev stop` を実行する（置き換えるなら `npx astro dev --force`） |

---
最終更新：2026-11-11
