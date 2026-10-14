# プライバシーポリシー / Privacy Policy

最終更新日: 2026年10月14日 / Last updated: October 14, 2026

## 日本語

配信マスク（以下「本拡張機能」）は、利用者のプライバシーを守るための拡張機能です。本拡張機能は、利用者のデータを外部へ送信しません。

### 本拡張機能が扱う情報
本拡張機能は、マスクを表示するために、閲覧中のページの内容（要素の構造や文字列）を**利用者のブラウザの中だけで**読み取ります。たとえば、マスクする範囲の候補を作ったり、文字の一部を残すマスクの範囲を計算したりする処理です。読み取った内容を保存したり、外部へ送信したりすることはありません。

### 保存する情報
利用者が作成したマスクの設定は、利用者のブラウザの中（`chrome.storage.session` と `chrome.storage.local`）に保存されます。

- 設定したサイトのオリジン（例: `https://example.com`）
- 「このページのみ」を選んだ場合は、そのページのパス
- マスクの対象を指定する CSS セレクタ（ページ上の属性値を含む場合があります）
- マスクの名前、方式、色などの表示設定

これらの情報は、作者を含む第三者に送信されません。拡張機能を削除すると、保存されたデータもブラウザから削除されます。

### 収集・送信しない情報
本拡張機能は、次のことを一切行いません。

- 個人情報、閲覧履歴、ページの内容を収集すること
- 外部のサーバーと通信すること（解析ツールや広告も含みません）
- 第三者にデータを販売・共有すること

### 外部リンク
サイドパネルにある「GitHub」や「投げ銭で応援する」のリンクは、利用者がクリックした場合にだけ、ブラウザの新しいタブで外部のサイトを開きます。リンク先のサイトでの情報の扱いは、そのサイトのポリシーに従います。

### お問い合わせ
本ポリシーについてのお問い合わせは、GitHub リポジトリの Issues で受け付けています。

<!-- TODO: 連絡先（Issues の URL かメールアドレス）を入れる -->

### 改定
本ポリシーを改定する場合は、このページを更新し、最終更新日を変更します。

---

## English

On-Air Mask ("the extension") is designed to protect your privacy. It does not send your data anywhere.

### Information the extension handles
To display masks, the extension reads the content of the page you are viewing (element structure and text) **locally in your browser only**. For example, it does so to suggest which parts of the page to mask, or to calculate which characters to hide when you keep part of the text visible. This content is never stored or transmitted.

### Information stored
Masks you create are stored locally in your browser (`chrome.storage.session` and `chrome.storage.local`):

- The origin of the site (e.g. `https://example.com`)
- The page path, if you chose "this page only"
- The CSS selector identifying what to mask (this may include attribute values from the page)
- Display settings such as the mask's name, style and color

This information is never sent to the author or any third party. It is deleted from your browser when you remove the extension.

### What the extension does not do
- It does not collect personal information, browsing history or page content.
- It does not communicate with any external server. It contains no analytics and no advertising.
- It does not sell or share any data with third parties.

### External links
The "GitHub" and "tip" links in the side panel open external websites in a new tab only when you click them. Those websites are governed by their own privacy policies.

### Contact
For questions about this policy, please open an issue in the GitHub repository.

### Changes
If this policy changes, this page and its "Last updated" date will be updated.
