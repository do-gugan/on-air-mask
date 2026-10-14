# 設計メモ

開発者向けの内部構造のメモです。利用方法はリポジトリ直下の README を参照してください。

## 文字単位のマスク
- CSS Custom Highlight API（`CSS.highlights` と `::highlight()`）で文字範囲にスタイルを当てる。DOM は一切書き換えないので、React / Vue などの差分更新と衝突しない。
- 要素ごとに TreeWalker でテキストノードを連結し、「残す部分」を判定したうえで、それ以外を Range に変換する。
- 判定に失敗した要素は本体全体をマスクする（fail closed）。
- 中身の書き換えは、document 全体を見る MutationObserver で追従する。コールバックは描画前に同期で走るので、生の文字が描画されることはない。
- `<input>` などの文字を持たない要素は、`:is(input,textarea,select,img,…)` に限定した要素単位のマスクを併用する。
- ぼかしは `color: transparent` と `text-shadow`（元の文字色）による「ぼかし風」の表示。塗りつぶしは `background-color` で文字幅の帯を描く。

## 保持のしくみ
| 種類 | 保存先 | 寿命 |
|---|---|---|
| セッション（既定） | `chrome.storage.session` | ブラウザを閉じるまで。リロードや遷移では消えない |
| サイト設定として保存 | `chrome.storage.local` | 永続 |

ルールはオリジン単位で保存される。1つのルールは次の形をしている。

`{ id, name?, selector, mode, blurPx, spreadPx, fillSource?, fillColor?, keep?: { type, n?, pattern? }, scope, path, disabled?, createdAt }`

ぼかし量を全体設定で持っていた v0.3 以前のルールは、当時の全体設定値で補って表示・描画する。

## 要素単位のマスクと全般
- **適用方法**：要素に直接 style を付けず、`<html>` 直下に注入した `<style>` に書き出す。CSS ルールなので、後から追加された行、仮想スクロールで描画される要素、SPA 遷移後の要素にもそのまま当たる。
- **詳細度対策**：`:is(sel):not(#_sbm_):not(#_sbm_)` の形で ID 2個分の詳細度を足し、ページ側の `!important` 指定に負けにくくしている。
- **ぼかし**：`filter: blur()` に加え、`clip-path: inset(-はみ出し)` で滲みの範囲を調整する。マージン等は触らないので、レイアウトは変わらない。
- **塗りつぶし**：要素の背景を指定色で不透明にし、ページ内に置いた SVG フィルター（`feFlood` → `feComposite in=SourceAlpha`）で要素の矩形ぴったりを一色にする。中の画像や文字の形も残らない。親とページの背景色は、適用時点の計算値をルールに保存する。万一フィルターの参照が外れても、背景色と文字の透明化は残る。
- **ハイライト**：マスク本体とは別の Shadow DOM レイヤーに枠を描くので、filter には巻き込まれない。表示するのはパネルで付けた名前だけで、ページの文字は出さない。
- **リロード時のフラッシュ対策**：ルールがあるオリジンにだけ `guard.css`（`html:not([data-sbm-ready]){opacity:0}`）を `document_start` で動的登録する。content script がルールを適用し終えた時点で `data-sbm-ready` を付けてページを表示する。
- **候補生成**：次の情報から候補を作り、一致件数と安定度で並べる。
  - id
  - テスト用属性（`data-testid` など）や `name`、`itemprop`
  - 意味のあるクラス
  - 一意な祖先を起点にした文脈セレクタ
  - nth-of-type による構造パス（最終手段）

  次のものは除外する。
  - CSS-in-JS や CSS Modules のハッシュクラス
  - 自動生成の id
  - Tailwind のユーティリティクラス
  - 状態で値が変わる `data-state` など

