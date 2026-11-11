# SETUP.md — 開発環境の構築手順

仕様は [AGENTS.md](./AGENTS.md)、環境構築はこのファイル（AGENTS.md §16.3）。

## 1. 前提

| ツール | バージョン | 確認コマンド |
|---|---|---|
| Node.js | 24 系（`.nvmrc` と `package.json` の `engines` で固定） | `node -v` → `v24.x.x` |
| npm | 11 系（Node.js 24 に同梱） | `npm -v` → `11.x.x` |
| Git | 任意の最近のもの | `git --version` |

- Windows / macOS / Linux のいずれでも同じ手順で動く（Windows 11 + Git Bash / PowerShell で確認済み）。
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
AGENTS.md            仕様書兼作業ガイド
SETUP.md             このファイル
astro.config.mjs     Astro の設定（React 連携）
vitest.config.ts     テストの設定（tests/**/*.test.{ts,tsx}）
src/
  engine/            計算エンジン。純粋な TypeScript で UI に依存しない（§3-1）
    effects/         効果部品の登録表（registry）
    conditions/      条件部品
    custom/          キャラ専用処理（逃げ道）
  schema/            Zod スキーマ（キャラ定義・効果 DSL・バフ枠・チャートデータ）
  chart/             操作の記録の木・ブランチ・Undo/Redo・保存（UI 非依存）
  content/
    characters/      1 キャラ 1 ファイルの JSON
    eidolons/        幻獣（定義項目が未確定のため空）
    buffSlots.json   バフ・デバフの枠
  content.config.ts  Content Collections の定義（ビルド時に Zod で検証）
  components/        React の UI（プレイ画面・チャート・ガント・編成）
  pages/             Astro のページ
  styles/            CSS
tests/
  cases/             実プレイで確認した正解データ（§13。まだ無い）
  *.test.ts(x)       Vitest のテスト。tests/ の架空キャラはエンジンの単体テスト専用
```

## 5. キャラデータの追加（AGENTS.md §12）

1. `src/content/characters/<id>.json` を作る。`id` は英小文字・数字・`_`・`-` のみで、ファイル名と一致させる。
2. 形式は `src/schema/character.ts`（効果 DSL は `src/schema/dsl.ts`）。例は `src/content/characters/eve.json`。
3. バフ・デバフの枠 ID は `src/content/buffSlots.json` に登録済みのものを使う。無ければ枠を追加する。
4. 実数値の出典を `source` に書く。
5. 検証する：
   ```sh
   npm test
   npm run check
   ```
   `tests/schema.test.ts` が全キャラの JSON をスキーマ・ファイル名・枠 ID で検証する。ビルド（`npm run build`）でも Content Collections が同じスキーマで検証する。

## 6. テストケースの追加（AGENTS.md §13）

- 実プレイの記録は `tests/cases/` に置く（形式：チャートデータ §4.10 + 各時点の期待値）。**まだ記録が無いため、読み込むテストは未作成**（初期 5 体の人選待ち。§15）。
- エンジンの部品を追加したら、`tests/engine.test.ts` などに対応するテストを追加する。

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

`.github/workflows/ci.yml`：`main` への push と pull request で `npm ci` → `npm run check` → `npm test` → `npm run build` を実行する。デプロイは Cloudflare Pages の Git 連携で行う想定（未設定）。

## 8. よくあるトラブル

| 症状 | 対処 |
|---|---|
| エディタで `Cannot find module 'astro:content'` | `npx astro sync` を実行して型定義を生成する |
| `npm ci` が `engines` の警告を出す | Node.js 24 を使う（`node -v` を確認） |
| `npm run dev` が `Another astro dev server is already running.` で止まる | 前に起動した開発サーバーが残っている。表示された PID を止めるか、`npx astro dev stop` を実行する（置き換えるなら `npx astro dev --force`） |

---
最終更新：2026-11-11
