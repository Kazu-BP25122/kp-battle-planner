# DSL_PARTS.md — 効果 DSL 部品リファレンス

キャラ定義 JSON で使う部品の説明書。

- キャラ・アビリティ・アシスト・バースト・効果のどれにも `note`（説明文。処理には使わない）を付けられる。
- バフ・デバフの `slot` には、枠の一覧（`src/content/buffSlots.json`）にある ID を使う。

---

## 1. 定義の骨組み

### キャラ
```json
{
  "id": "eve",
  "name": "神代の始祖イヴ",
  "kind": "kamihime",
  "element": "thunder",
  "gaugeMax": 100,
  "burstConsume": "subtract100",
  "burst": { ... },
  "abilities": [ ... ],
  "assists": [ ... ],
  "tokens": [ ... ],
  "tokenGroups": [ ... ],
  "options": [ ... ],
  "sharedEffects": { ... },
  "source": "出典"
}
```
| 項目 | 必須 | 値 | 説明 |
|---|---|---|---|
| `id` | ○ | 英小文字 | キャラ ID |
| `name` | ○ | 文字列 | 名前 |
| `kind` | ○ | `kamihime` / `hero` | 神姫 / 英霊 |
| `element` | ○ | 属性 | キャラの属性 |
| `gaugeMax` | | `100` / `200` | ゲージ上限。省略時 `100` |
| `burstConsume` | | `subtract100` / `consumeAll` | バースト時のゲージ消費。`subtract100` は 100 だけ消費、`consumeAll` は全消費。省略時 `subtract100` |
| `burst` | ○ | バースト | |
| `abilities` | ○ | アビリティの配列 | 画面の上から順 |
| `assists` | | アシストの配列 | 画面の上から順。同時に発動したときの処理順になる |
| `tokens` | | トークンの配列 | 固有トークン |
| `tokenGroups` | | トークングループの配列 | 上限を共有するトークンのまとまり |
| `options` | | オプションの配列 | ユーザーが選ぶ装備などの選択肢 |
| `sharedEffects` | | `{ ID: 効果の配列 }` | 複数の場所で使う効果。`useEffects` で呼び出す |
| `source` | | 文字列 | 出典 |

### アビリティ
```json
{
  "id": "eve_a2",
  "name": "クルーエルディザスター+",
  "color": "red",
  "ct": 5,
  "usable": { 条件 },
  "cost": [ ... ],
  "limit": { "perTurn": 1 },
  "ex": false,
  "effects": [ ... ]
}
```
| 項目 | 必須 | 値 | 説明 |
|---|---|---|---|
| `id` | ○ | `<キャラ ID>_a<番号>` | アビ ID |
| `name` | ○ | 文字列 | 名前 |
| `color` | ○ | 色 | アビの色 |
| `ct` | ○ | 数 | 使用間隔。`0` なら何度でも使える |
| `usable` | | 条件 | 満たさないと使えない |
| `cost` | | コストの配列 | 使うときに払う |
| `limit` | | `{ "perTurn": n, "perBattle": n }` | 使用回数の上限（数・数値部品） |
| `ex` | | 真偽 | EX 枠のアビ |
| `effects` | ○ | 効果の配列 | 使用・発動したときの効果 |

### アシスト
```json
{
  "id": "eve_assist1",
  "name": "ミシックプレビレッジ",
  "trigger": { "event": "abilityUsed", "filter": { ... } },
  "cond": { 条件 },
  "limit": { "perTurn": 10 },
  "activeIn": "main",
  "origin": { "kind": "assist", "index": 1 },
  "effects": [ ... ]
}
```
| 項目 | 必須 | 値 | 説明 |
|---|---|---|---|
| `id` | ○ | `<キャラ ID>_assist<番号>` | アシスト ID |
| `name` | | 文字列 | 名前 |
| `trigger` | ○ | トリガー | 発動のきっかけ |
| `cond` | | 条件 | 満たさなければ発動しない |
| `limit` | | `{ "perTurn": n }` | 発動回数の上限 |
| `activeIn` | | `main` / `sub` / `both` | 有効な位置。省略時 `main` |
| `origin` | | `{ "kind": "assist", "index": n }` / `{ "kind": "ability", "id": アビ ID }` | 1 つのアシストを分けて書いたときの元のアシスト、またはアビの説明文にある常時効果の元のアビ |
| `effects` | ○ | 効果の配列 | 発動したときの効果 |

- 効果の一部だけが条件で追加される場合は、`cond` ではなく効果の中の `if` に書く。

### バースト
```json
{ "name": "破滅の雷+", "effects": [ ... ], "userDefined": false }
```
| 項目 | 必須 | 値 | 説明 |
|---|---|---|---|
| `name` | | 文字列 | 名前 |
| `effects` | ○ | 効果の配列 | バーストの効果 |
| `userDefined` | | 真偽 | ユーザーが効果を上書きできる（英霊）。`effects` は既定の効果 |

### コスト
```json
{ "gauge": 20, "when": { 条件 } }
{ "token": { "name": "雷光", "amount": 3 } }
{ "hpRate": 10 }
```
| 項目 | 説明 |
|---|---|
| `gauge` | バーストゲージを払う |
| `token` | トークンを払う（`name`、`amount`） |
| `hpRate` | HP 割合を払う |
| `when` | この条件を満たすときだけ払う。使う前に評価するので、`useCount` に今回の使用は入らない |

払えないときは使えない。

### トークン
```json
{ "name": "紅の旋律", "group": "旋律", "max": 5, "initial": 0, "hidden": false }
```
| 項目 | 説明 |
|---|---|
| `name` | トークン名 |
| `group` | 属するグループ名 |
| `max` | この種類の上限。超えて付与した分は破棄 |
| `initial` | 開始時の数。省略時 `0` |
| `hidden` | 画面に表示しない |

### トークングループ
```json
{ "name": "旋律", "max": 3 }
```
| 項目 | 説明 |
|---|---|
| `name` | グループ名 |
| `max` | グループ内の合計の上限。超えて付与した分は破棄。省略で上限なし |

### オプション
```json
{ "id": "exclusiveWeapon", "name": "専用武器", "type": "boolean", "default": false }
```
ユーザーがチャートごとに選ぶ。条件 `option` で参照する。

---

## 2. 効果

効果は配列に並べ、上から順に処理する。

### damage — ダメージ
```json
{ "type": "damage", "target": "allEnemies", "category": "ability", "hits": 1, "element": "thunder" }
```
| 項目 | 必須 | 説明 |
|---|---|---|
| `target` | ○ | 対象 |
| `category` | ○ | 攻撃区分 |
| `hits` | | ヒット数（数・数値部品）。省略時 `1`。ヒットごとに `damage` イベントを記録 |
| `element` | | ダメージの属性。省略時はキャラの属性 |

ダメージ量は計算しない。全属性ダメージは属性ごとに `damage` を並べる。

### performAttack — 通常攻撃・バーストを行う
```json
{ "type": "performAttack", "attacker": "self", "kind": "normal", "times": 1 }
{ "type": "performAttack", "attacker": "self", "kind": "burst", "gaugeAfter": "keep" }
```
| 項目 | 説明 |
|---|---|
| `attacker` | 攻撃するキャラ（対象と同じ書き方） |
| `kind` | `normal`（通常攻撃）/ `burst`（バースト） |
| `times` | 回数 |
| `gaugeAfter` | `burst` のみ。`zero`（0 に戻す。既定）/ `keep`（減らさない） |

攻撃フェーズの攻撃と同じく、ゲージ上昇・連撃・回数制バフの消費が起きる。

### activateAbility — アビを発動させる
```json
{ "type": "activateAbility", "character": "self", "ability": "eve_a1" }
```
| 項目 | 説明 |
|---|---|
| `character` | アビを持つキャラ |
| `ability` | アビ ID |

使用回数には数えない（発動回数には数える）。CT は変わらない。

### changeCT — CT を変える
```json
{ "type": "changeCT", "target": "self", "abilities": "all", "amount": -1 }
{ "type": "changeCT", "target": "self", "abilities": ["eve_a2"], "setTo": 0 }
```
| 項目 | 説明 |
|---|---|
| `target` | 対象のキャラ |
| `abilities` | `"self"`（このアビ）/ `"all"`（全アビ）/ アビ ID の配列 / `{ "color": 色 }` |
| `amount` | 増減（数・数値部品）。`setTo` とどちらか一方 |
| `setTo` | その値にする |

0 未満・最大値超えにはしない。

### addBuff / addDebuff — バフ・デバフを付ける
```json
{ "type": "addBuff", "target": "allAllies", "buff": "攻撃力UP", "slot": "atkUp", "amount": 30,
  "duration": { "turns": 3 }, "stack": { "max": null, "duration": "perStack" }, "categories": ["ability"] }
```
| 項目 | 必須 | 説明 |
|---|---|---|
| `target` | ○ | 対象 |
| `buff` | ○ | 名前（画面の表記どおり） |
| `slot` | ○ | 枠 ID（`buffSlots.json` の ID）。同じ枠のものは重複ルール（上書き・CANCEL／MISS）で判定 |
| `amount` | ○ | 効果量（実数値）。不明なら `null` |
| `duration` | ○ | 持続 |
| `stack` | | 累積型にする |
| `categories` | | 乗る攻撃区分の配列 |
| `undispellable` | | `true` で消去不可（解除効果で消えず、サブに下がっても残る） |

### addStatus — 状態を付ける
```json
{ "type": "addStatus", "target": "allAllies", "status": "サステイン", "duration": { "turns": 2 } }
{ "type": "addStatus", "target": "self", "status": "gaugeGainBlocked", "sources": ["normalAttack"], "duration": { "permanent": true } }
```
| 項目 | 説明 |
|---|---|
| `target` | 対象 |
| `status` | 状態の名前 |
| `duration` | 持続 |
| `sources` | `gaugeGainBlocked` のみ。止める手段：`normalAttack` / `damaged` / `chain` / `effect` / `turnEnd` / `all` |

効果量を持たない状態（サステイン、リミッター解除、ゲージ上昇無効など）に使う。同じ名前の状態がすでに付いていれば、持続を新しい値に置き換える（足さない）。

| 項目 | 説明 |
|---|---|
| `undispellable` | `true` で消去不可 |
| `polarity` | `buff` / `debuff`。省略時は、敵に付けたら `debuff`、味方に付けたら `buff`（仮置き。`removeDebuff` で消えるかに影響する） |

### removeStatus — 状態を解除する
```json
{ "type": "removeStatus", "target": "self", "status": "リミッター解除" }
```

### removeDebuff — デバフ・状態異常を解除する
```json
{ "type": "removeDebuff", "target": "allAllies", "count": 1 }
```
| 項目 | 説明 |
|---|---|
| `count` | 解除する数。`"all"` で全部。消去不可のものは消えない。累積型は全段まとめて 1 個と数え、古い順に消す（仮置き） |

### heal — 回復
```json
{ "type": "heal", "target": "allAllies" }
```
記録だけ。HP 割合は変えない。

### gaugeUp / gaugeDown — ゲージを増減する
```json
{ "type": "gaugeUp", "target": "allAllies", "amount": 20 }
{ "type": "gaugeDown", "target": "self", "amount": 20 }
```
| 項目 | 説明 |
|---|---|
| `amount` | 量（数・数値部品）。`gaugeUp` は省略時 `20`（説明文に量の記載がないときに省略する） |
| `fixed` | `gaugeUp` のみ。`true` なら受け手の上昇量アップを乗せない |

### addToken / consumeToken — トークンを増減する
```json
{ "type": "addToken", "target": "self", "name": "紅の譜面", "amount": 1 }
{ "type": "consumeToken", "target": "self", "group": "旋律", "amount": "all" }
```
| 項目 | 説明 |
|---|---|
| `name` | トークン名 |
| `group` | `consumeToken` のみ。グループ全体を対象にする |
| `amount` | 数。`consumeToken` は `"all"` で全部 |

上限を超えて付与した分は破棄。

### swapWithSub — サブと交代する
```json
{ "type": "swapWithSub", "target": "self" }
```
生存しているサブの先頭と即時に入れ替える。

### retire — 退場する
```json
{ "type": "retire", "target": "self" }
```

### if — 条件で分岐する
```json
{ "type": "if", "cond": { 条件 }, "then": [ 効果 ], "else": [ 効果 ] }
```
`else` は省略可。`if` を並べると、当てはまったものをすべて実行する。

### switch — どれか 1 つを選ぶ
```json
{ "type": "switch",
  "cases": [ { "cond": { 条件 }, "then": [ 効果 ] }, { "cond": { 条件 }, "then": [ 効果 ] } ],
  "default": [ 効果 ] }
```
上から判定し、最初に当てはまった 1 つだけを実行する。どれにも当てはまらなければ `default`。

### repeat — 繰り返す
```json
{ "type": "repeat", "times": { "token": { "name": "蒼の譜面" } }, "effects": [ 効果 ] }
```
`times`（数・数値部品）回だけ繰り返す。0 回なら何もしない。

### recast — 条件付きの即リキャ（省略形）
```json
{ "type": "recast", "when": { "useCount": { "ability": "self", "scope": "turn", "lte": 2 } } }
```
`when` を満たすとき、このアビの CT を 0 にする。読み込み時に `if` と `changeCT`（`setTo: 0`）へ展開される。

### useEffects — 共有の効果を呼び出す（省略形）
```json
{ "type": "useEffects", "id": "scoreEffects" }
```
キャラの `sharedEffects` の同じ ID の効果に置き換わる。呼び出し先の中で `useEffects` は使えない。

### custom — 専用処理
```json
{ "type": "custom", "id": "beethoven_cureBottle" }
```
部品で書けない効果のための専用処理を ID で呼ぶ。

入れ子は 3 段まで。いちばん外の効果の配列を 1 段目とし、`if` の `then`・`else`、`switch` の `cases`・`default`、`repeat` の `effects` に入るたびに 1 段増える（`if` の中の `repeat` の中の効果が 3 段目）。それより深くなるときは、条件を `and` でまとめて外側に出す。

---

## 3. 対象

| 書き方 | 説明 |
|---|---|
| `"self"` | 自分 |
| `"allAllies"` | 味方全体 |
| `{ "alliesWhere": { "element": 属性, "position": ポジション, "excludeSelf": true, "includeSub": true } }` | 条件で絞った味方。項目はどれか 1 つ以上。`includeSub` でサブも含める |
| `"chosenAlly"` | プレイヤーが選ぶ味方 1 体 |
| `"enemy"` | 敵単体 |
| `"allEnemies"` | 敵全体 |
| `"randomEnemy"` | 敵ランダム |

---

## 4. 条件

### useCount — アビの回数
```json
{ "useCount": { "ability": "self", "scope": "turn", "kind": "used", "gte": 1 } }
```
| 項目 | 説明 |
|---|---|
| `ability` | `"self"`（このアビ）/ アビ ID |
| `scope` | 範囲 |
| `kind` | `used`（使用回数。既定）/ `activated`（発動回数。効果で発動した分も含む） |
| 比較 | 比較の書き方 |

効果の中では今回の使用を含めて数える。コスト・使用条件の中では含めない。

### count — イベントの回数
```json
{ "count": { "event": "abilityUsed", "filter": { "color": "red", "sourceElement": "thunder" }, "scope": "turn", "multipleOf": 5 } }
```
| 項目 | 説明 |
|---|---|
| `event` | イベント |
| `sum` | `"amount"` を付けると、件数ではなくイベントの `amount`（トークンの数など）の合計を数える |
| `filter` | フィルター |
| `scope` | 範囲 |
| 比較 | 比較の書き方 |

処理中のイベントの時点までに起きた件数で数える。

### token — トークンの数
```json
{ "token": { "name": "雷光", "gte": 3 } }
{ "token": { "group": "旋律", "gte": 3 } }
```
`name`（種類）か `group`（グループの合計）。

### hasStatus / hasBuff / hasDebuff — 付いているか
```json
{ "hasStatus": { "target": "self", "status": "リミッター解除" } }
{ "hasBuff": { "target": "self", "buff": "ダメージ上限UP", "stacks": { "gte": 3 } } }
```
`stacks` は累積数の比較（任意）。

### gauge / hpRate / turnCount — 値
```json
{ "gauge": { "target": "self", "gte": 100 } }
{ "hpRate": { "target": "self", "gte": 50 } }
{ "turnCount": { "gte": 3 } }
```

### element / position — 属性・ポジション
```json
{ "element": { "target": "self", "is": "thunder" } }
{ "position": { "target": "self", "is": "front" } }
```

### trigger — 発動させたイベントの中身
```json
{ "trigger": { "color": "red" } }
```
アシストの効果の中で使う。項目名はフィルターと同じ。

### partyAll — パーティ全員が条件を満たすか
```json
{ "partyAll": { "element": "thunder" } }
```

### option — ユーザーが選んだオプション
```json
{ "option": { "id": "exclusiveWeapon", "is": true } }
```

### and / or / not — 組み合わせ
```json
{ "and": [ 条件, 条件 ] }
{ "or": [ 条件, 条件 ] }
{ "not": 条件 }
```

---

## 5. 比較

条件の `useCount`・`count`・`token`・`gauge`・`hpRate`・`turnCount`・`stacks` に付ける。

| 項目 | 意味 | 例 |
|---|---|---|
| `gte` | 以上 | `"gte": 15` |
| `lte` | 以下 | `"lte": 2` |
| `eq` | ちょうど | `"eq": 3` |
| `multipleOf` | N の倍数（N 回ごと） | `"multipleOf": 5` |
| `parity` | `odd`（奇数）/ `even`（偶数） | `"parity": "odd"` |
| `mod` | N で割った余りが M | `"mod": { "by": 4, "eq": 1 }` |

---

## 6. 数値部品

数を書く欄（`hits`、`amount`、`times`、`duration.turns` など）に、数の代わりに書ける。

```json
{ "useCount": { "ability": "self", "scope": "battle", "kind": "activated" }, "min": 1, "max": 10 }
{ "token": { "name": "紅の譜面" }, "mul": 6 }
{ "count": { "event": "damage", "filter": { "category": "ability" }, "scope": "turn" } }
```
| 部品 | 返す値 |
|---|---|
| `useCount` | アビの使用回数・発動回数 |
| `count` | イベントの件数 |
| `token` | トークンの数 |

| 計算 | 意味 |
|---|---|
| `mul` | 掛ける（`-1` で符号を反転） |
| `add` | 足す |
| `min` / `max` | 範囲に収める |

計算の順は `mul` → `add` → `min` / `max`。

---

## 7. 持続・累積

### 持続（duration）
| 書き方 | 説明 |
|---|---|
| `{ "turns": N }` | N ターン。ターンエンド処理で減る |
| `{ "turns": 数値部品 }` | 回数などで決まるターン数 |
| `{ "count": N }` | N 回まで。対象のイベントで減る。`"consumeOn": "attack"`（既定。行動単位の攻撃）/ `"damaged"`（被弾）で減らすきっかけを指定する |
| `{ "permanent": true }` | 永続。解除されるまで続く |
| `{ "turns": null }` | 不明（エンジンは永続として扱い、チャート上に「持続が不明」と表示する。仮置き） |

### 累積（stack）
```json
"stack": { "max": null, "duration": "perStack" }
```
| 項目 | 値 | 説明 |
|---|---|---|
| `max` | 数 / `null` / `"unknown"` | 累積の上限。`null` は上限なし |
| `duration` | `perStack` / `refresh` / `unknown` | `perStack`：1 段ずつ別々に切れる。`refresh`：重ねるたびに全体の持続を更新。`unknown`：不明（`perStack` として扱う） |

同じ `buff` 名のものを付けると、上書き・CANCEL／MISS の判定をせずに累積数が 1 増える。

---

## 8. トリガー

```json
"trigger": { "event": "abilityUsed", "filter": { "color": "red" } }
```

### イベント
| イベント | 起きるとき |
|---|---|
| `battleStart` | 戦闘開始時 |
| `turnStart` | ターン開始時 |
| `turnEnd` | ターン終了時 |
| `abilityUsed` | アビの使用（プレイヤーの操作） |
| `abilityActivated` | アビの発動（使用したときと、効果で発動したとき） |
| `normalAttack` | 通常攻撃 1 行動 |
| `burst` | バースト 1 回 |
| `damage` | ダメージ 1 ヒット |
| `damaged` | 被弾 |
| `heal` | 回復 |
| `gaugeChanged` | ゲージの増減 |
| `buffApplied` / `buffOverwritten` / `buffMissed` / `buffConsumed` / `buffExpired` / `buffRemoved` | バフ・デバフ・状態の付与・上書き・MISS・消費・期限切れ・解除 |
| `assistTriggered` | アシストの発動 |
| `enterBattle` | メインに出た |
| `swappedOut` | 交代でサブに下がった |
| `knockedOut` | 戦闘不能 |
| `tokenAdded` | トークンの付与（`token`、`amount`） |
| `tokenConsumed` | トークンの消費（`token`、`amount`） |

`assistTriggered` はアシストの効果より先に記録されるので、効果の中で数える自分の発動回数は今回を含む。

### フィルター
| 項目 | 値 | 説明 |
|---|---|---|
| `ability` | アビ ID | このアビのイベントだけ |
| `color` | 色 | アビの色 |
| `sourceElement` | 属性 | イベントを起こしたキャラの属性 |
| `element` | 属性 | ダメージの属性（`damage` のみ） |
| `category` | 攻撃区分 | ダメージの攻撃区分 |
| `source` | `self` / `others` | 持ち主から見て、自分か自分以外か |
| `route` | `use` / `effect` | 発動の経路（`abilityActivated` のみ） |
| `token` | トークン名 | トークンの種類（`tokenAdded`・`tokenConsumed` のみ） |
| `assist` | アシスト ID | アシストの種類（`assistTriggered` のみ） |
| `sourceKind` | `ability` / `assist` / `burst` / `normalAttack` / `eidolon` / `manual` / `system` | 発生源の種類 |
| `slot` / `buff` / `polarity` | 枠 ID / バフ名 / `buff`・`debuff` | バフ・デバフのイベント（`buff*`）の枠・名前・極性 |
| `means` | `normalAttack` / `chain` / `effect` / `turnEnd` / `damaged` / `cost` / `burst` / `correction` | ゲージの増減の手段（`gaugeChanged` のみ） |
| `target` | `"self"` / キャラ ID / `"enemy"` | 対象（`gaugeChanged`・`heal`・`buff*` など）。`"self"` は持ち主 |
| `origin` | `attackPhase` / `ability` | 通常攻撃・バーストの発生元（`normalAttack`・`burst`） |
| `via` | `replenish` / `swap` | 登場の経路（`enterBattle` のみ） |

- `sourceKind` 以下は、AGENTS.md §4.7「`filter` は上表のどの項目でも絞り込める」によりイベントの項目をそのまま絞り込みに使えるようにしたもの。
- `tokenAdded`・`tokenConsumed` の発生源キャラ（`source` で見るキャラ）は**トークンの持ち主**。

### 範囲（scope）
| 値 | 説明 |
|---|---|
| `turn` | 今ターン |
| `battle` | 戦闘全体 |

---

## 9. 値の一覧

| 種類 | 値 |
|---|---|
| 属性 | `fire`（火）/ `water`（水）/ `wind`（風）/ `thunder`（雷）/ `light`（光）/ `dark`（闇）/ `phantom`（幻） |
| 色 | `red`（赤）/ `yellow`（黄）/ `blue`（青）/ `green`（緑）/ `purple`（紫） |
| 攻撃区分 | `normal`（通常攻撃）/ `ability`（アビリティ）/ `burst`（バースト） |
| 種別 | `kamihime`（神姫）/ `hero`（英霊） |
| ポジション | `hero` / `front` / `back` / `sub` |

## 10. 省略したときの値

| 項目 | 値 |
|---|---|
| `gaugeMax` | `100` |
| `burstConsume` | `subtract100` |
| `damage` の `hits` | `1` |
| `damage` の `element` | キャラの属性 |
| `useCount` の `kind` | `used` |
| `activeIn` | `main` |
| トークンの `initial` | `0` |
| `gaugeUp` の `amount` | `20` |
