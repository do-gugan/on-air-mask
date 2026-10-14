# ストア申請メタデータ

Chrome ウェブストアと Edge アドオンへの申請で入力する内容をまとめたものです。ダッシュボードの項目名や必須かどうかは変わることがあるので、申請時の画面表示を優先してください。

URL はすべて記入済みです。デモページの URL は、GitHub Pages を有効にすると使えるようになります。

## 共通

| 項目 | 内容 |
|---|---|
| 名前 | manifest から自動で入る（日本語「配信マスク」／英語「On-Air Mask」） |
| 短い説明 | manifest から自動で入る（`_locales/*/messages.json` の `extDesc`。日英とも132文字以内） |
| 詳しい説明 | [description.ja.txt](description.ja.txt) と [description.en.txt](description.en.txt) をそのまま貼る（日本語1,091文字、英語2,386文字）。末尾の投げ銭ページの URL は記入済み |
| 言語 | 既定は英語（manifest の `default_locale`）。日本語の掲載情報も追加する |
| ホームページ | https://github.com/do-gugan/on-air-mask |
| サポート | https://github.com/do-gugan/on-air-mask/issues |
| プライバシーポリシー | https://github.com/do-gugan/on-air-mask/blob/main/PRIVACY.md |
| 成人向けコンテンツ | なし |

### 提出用 zip の作り方
リポジトリには、ストアの審査に不要なファイル（`docs/`、`README.md` など）も入っています。提出には、拡張機能の本体だけを入れた zip を使います。

```sh
./scripts/build-store-zip.sh
```

`dist/on-air-mask-<version>-store.zip` ができます。このスクリプトは、次の処理をまとめて行います。
- 本体のファイルだけを集める（SVG と `.DS_Store` は除く）
- manifest の `key` 行を除く（ストアは「マニフェストでは key フィールドを使用できません」として受け付けないため）

公開後は、ストアのダッシュボードに表示される公開鍵を、リポジトリの manifest の `key` に入れ直してください。手元の開発版も、ストア版と同じ拡張機能 ID になります。

## 画像

| 用途 | サイズ | Chrome | Edge | ファイル |
|---|---|---|---|---|
| アイコン | 128×128 | 必須（manifest から） | — | `icons/icon128.png` |
| ストアのロゴ | 300×300 推奨（最小128×128） | — | 必須 | [logo-300.png](logo-300.png) |
| 小さいプロモタイル | 440×280 | 必須 | 任意 | [promo-small-440x280.png](promo-small-440x280.png) |
| 大きいプロモタイル（マーキー） | 1400×560 | 任意 | 任意 | [promo-marquee-1400x560.png](promo-marquee-1400x560.png) |
| スクリーンショット | 1280×800（または 640×400、Edge は 640×480 も可） | 1枚以上、最大5枚 | 任意、最大6枚 | 撮影リストは下記 |

### スクリーンショットの撮影リスト（1280×800、5枚）
**本物の個人情報は絶対に写さないでください。** 架空のデータを入れたデモページを2つ用意してあります。

- [shop.html](../demo/shop.html)：架空の EC サイトのマイページ。ヘッダーのアカウント名、お届け先、注文履歴、アカウント情報があり、縮小されても読めるよう文字を大きめにしてある。サイドパネルを開いた状態（ページ幅 約900px）で撮る想定。
- [index.html](../demo/index.html)：架空のショップ管理画面の注文一覧。行の追加や並べ替えのボタンがあり、マスクが外れないことを見せる撮影に使う。

1. **使用例**（shop.html）：ヘッダーのアカウント名、お届け先、アカウント情報にマスクがかかり、サイドパネルにマスクの一覧が出ている全体像
2. **範囲の選択**（shop.html）：注文履歴の宛名を選んだ直後の、候補一覧（「3件」「安定」などのバッジ）と、ページ上のプレビュー
3. **見た目の設定**（shop.html）：ぼかしと塗りつぶしの比較。塗りつぶしの色の選択肢が見える状態
4. **文字の一部だけを隠す**（shop.html）：宛名の「様」「御中」だけ、住所の都道府県だけを残した注文履歴と、「3件中 3件で一致」の表示
5. **管理**（index.html）：マスクの一覧でホバーしたマスクの場所をハイライトしている状態と、個別のオン／オフ

デモページの開き方:
- **ファイルとして開く**：`docs/demo/index.html` をブラウザで開きます。このとき、拡張機能の詳細画面で「ファイルの URL へのアクセスを許可する」を ON にする必要があります（`file://` のページでは、既定では拡張機能が動かないため）。
- **GitHub Pages で公開する**：リポジトリの設定で GitHub Pages を有効にすると、`https://do-gugan.github.io/on-air-mask/docs/demo/`（EC サイトのデモは `shop.html`） で開けます。審査担当者に試してもらう URL としても使えます。

撮影のコツ:
- ブラウザのウィンドウを 1280×800 前後にし、余白を付けずに画面全体を撮ります（ストアの指定は「角丸なし、余白なし」）。
- 解像度の高いディスプレイで撮った場合は、1280×800 に縮小します。

## Chrome ウェブストア

### ストアの掲載情報
| 項目 | 内容 |
|---|---|
| カテゴリ | 「プライバシーとセキュリティ」（Privacy & Security）。なければ「ツール」（Tools） |
| プロモーション動画 | 任意（あれば YouTube の URL） |
| 公式 URL | 任意（Search Console で所有権を確認したサイトが必要） |

### プライバシーへの取り組み（Privacy practices）

**単一用途の説明（Single purpose）**

> Masks (blurs or fills) user-selected parts of web pages so that personal or sensitive information is not exposed while the user streams, records, or shares their browser screen.

日本語での意味: 利用者が選んだ Web ページ上の部分をぼかしや塗りつぶしで隠し、ブラウザ画面を配信・録画・共有するときに個人情報や機密情報が映らないようにする。

**権限が必要な理由（Permission justification）**

| 権限 | 記入する文 |
|---|---|
| `storage` | Stores the user's mask settings (site origin, CSS selector and display options) locally so that masks persist across page reloads and browser sessions. No data is transmitted. |
| `sidePanel` | Provides the extension's user interface in the side panel, so that controls are kept off the web page that is being streamed or recorded. |
| `scripting` | Dynamically registers a small CSS file that runs at document_start only on sites where the user has created masks. It keeps the page hidden until the masks are applied, preventing sensitive content from flashing on screen during a reload. |
| `tabs` | Identifies the active tab and its URL so the side panel can show and edit the masks for the current site, and sends messages to the content script in that tab. |
| ホスト権限 `<all_urls>` | Users need to mask content on any website they choose to show on stream (e.g. online shop admin pages, web apps, social media). The content script must run on those pages at document_start to apply masks before content is painted. Page content is processed locally and never transmitted. |

**リモートコード（Remote code）**
「いいえ、リモートコードを使用していません」（No, I am not using remote code）を選びます。すべてのコードがパッケージに含まれています。

**データの使用（Data usage）**
- 収集するデータの種類: **「ウェブサイトのコンテンツ」だけにチェックを入れる**。
  - 理由: Chrome の[ユーザーデータに関する FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) は、データを端末内で処理・保存するだけの場合でも開示が必要としている。本拡張機能は、マスクの候補と文字範囲を求めるために、ページのテキストや構造を端末内で読み取る。
  - 「ウェブ履歴」は入れない。保存するのは利用者がマスクを作ったサイトのオリジン（と「このページのみ」の場合のパス）だけで、閲覧の記録ではないため。審査で指摘されたら追加する。
- 3つの表明（販売しない、目的外に使わない、信用評価に使わない）: すべてにチェックを入れます。
- プライバシーポリシーの URL: PRIVACY.md の URL を入れます。

### 配布
| 項目 | 内容 |
|---|---|
| 公開範囲 | 公開（Public） |
| 地域 | すべての地域 |
| 価格 | 無料 |

## Edge アドオン（Microsoft Partner Center）

### 公開の範囲（Availability）
| 項目 | 内容 |
|---|---|
| 公開範囲 | 公開（Public） |
| 市場 | すべての市場 |

### プロパティ（Properties）
| 項目 | 内容 |
|---|---|
| カテゴリ | 「生産性」（Productivity）。プライバシー関連のカテゴリがあればそちら |
| 個人情報へのアクセス・収集・送信 | 「はい」（Yes）を選ぶ（下記の理由を参照） |
| プライバシーポリシーの URL | PRIVACY.md の URL |
| Web サイトの URL | GitHub リポジトリの URL |
| サポートの連絡先 | GitHub の Issues の URL |
| 成人向けコンテンツ | チェックしない |

「個人情報へのアクセス」を「はい」にする理由: この設問は「収集・送信」だけでなく「アクセス」も含みます。本拡張機能は、マスクを適用するために、ページ上の個人情報を含みうる文字列をブラウザの中で読み取ります。そのため、保守的に「はい」と答えて、プライバシーポリシーで「端末内でのみ処理し、送信しない」と説明するのが安全です。

### 掲載情報（Store listings、日本語と英語それぞれ）
| 項目 | 内容 |
|---|---|
| 説明 | description.ja.txt ／ description.en.txt（250〜10,000文字の範囲内） |
| ロゴ | logo-300.png |
| 小さいプロモタイル | promo-small-440x280.png |
| 大きいプロモタイル | promo-marquee-1400x560.png |
| スクリーンショット | Chrome と同じもの |
| 検索語（Search terms） | 下記 |

**検索語（最大7個、各30文字以内、合計21語以内）**

日本語の掲載情報:
1. 配信
2. 画面共有
3. 個人情報 保護
4. ぼかし
5. モザイク
6. 映り込み防止
7. 録画

英語の掲載情報:
1. streaming privacy
2. screen share
3. blur sensitive info
4. hide personal data
5. redact
6. screen recording
7. streamer mode

### 審査担当者へのメモ（Notes for certification）

> This extension masks (blurs or fills) parts of web pages selected by the user. It has no login and no remote server.
>
> How to test:
> 1. Open the demo page with fictional data (https://do-gugan.github.io/on-air-mask/docs/demo/, available once GitHub Pages is enabled), or any website, and click the toolbar icon to open the side panel.
> 2. Click "要素を選択" (Select element) and click a heading on the page. A list of candidate selectors appears and the page shows a live preview of the mask.
> 3. Click "適用" (Apply). The element stays masked after scrolling and reloading.
> 4. In "このサイトのマスク" (masks for this site), hover over an item to highlight it on the page, toggle the switch to turn it off and on, and click × to delete it.
>
> The UI is in Japanese. The `scripting` permission is used only to register a CSS file at document_start on sites where masks exist, to keep the page hidden until masks are applied. No data is collected or transmitted.

更新して再申請するときは、このメモの先頭に変更点の要約を足します。
