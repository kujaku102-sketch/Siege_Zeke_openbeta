# 対戦ログの受け口

ゲームの「対戦後に対戦ログを送信」がオンの時、決着した対戦のログがここに届く。
1件ずつ KV の `log/<終了日>/<matchId>` に入る。送り主の情報(IP など)は保存しない。

## 初回の準備(PC のこのフォルダで)

1. `npx wrangler@4 login`(ブラウザで承認)
2. `npx wrangler@4 kv namespace create MATCH_LOGS` で出た id を wrangler.toml の `REPLACE_WITH_KV_NAMESPACE_ID` に入れる
3. `npx wrangler@4 deploy`

## 見る

- 一覧: `npx wrangler@4 kv key list --binding MATCH_LOGS --remote`
- 1件: `npx wrangler@4 kv key get --binding MATCH_LOGS --remote "log/2026-10-23/<matchId>"`

## テスト

`node --test cloudflare/match-log/worker.test.js`
