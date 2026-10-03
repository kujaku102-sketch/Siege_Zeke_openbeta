# Public data boundary

この公開フォルダのカードデータはstaging用の214 unique STD ID、27枚の補助カード、公開ユーザーカードを含む。`src/data/cards.js`は公開専用の自己完結ライブラリであり、スプレッドシートID、原本行、原本シート、原本名、原本テキストなどの追跡メタデータを含めない。`release-manifest.json`が扱うのは214 unique STD IDのpoolだけであり、補助カードやユーザーカードは含めない。

含めないものは、canonical/private generated data、入力・出力データ、監査、同期、資格情報、トークン、端末固有パス、未公開アセット、production承認情報である。

`scripts/verify-public-build.mjs`は214 ID、公開ファイル構造、private metadata、資格情報らしい値、端末固有パスを検査する。公開先への書込みはこのプロジェクトの外で明示承認して行う。
