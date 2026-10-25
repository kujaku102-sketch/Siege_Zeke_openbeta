# 対戦ログの受け口

ゲームの「対戦後に対戦ログを送信」がオンの時、決着した対戦のログがここに届く。
1件ずつ KV の `log/<終了日>/<matchId>` に入る。送り主の情報(IP など)は保存しない。

- 同じ対局(同じ終了日・matchId)で先に保存されたログは残る。まったく同じ本文の再送は 204(成功)、本文が違う再送は 409 で、保存済みのログは書き換わらない。ゲームは応答が届かなかった時などに 1 回だけ再送するので、この「同じ本文は成功」が要る。
- KV は結果整合で、読んでから書くのは一括(原子的)ではない。同時に届いた 2 通や、別の終了日で送られた同じ matchId までは防げない。「上書きを減らす」ためのもので、排他制御ではない。
- ゲームの再送: 小さいログは keepalive 付き fetch(ページを閉じても送られる)で送り、応答なし・408・5xx なら 3 秒後に 1 回だけ再送する。200 番台・409・その他の 4xx(429 含む)は再送しない。ブラウザが閉じられた後の再送はしない。

## 初回の準備(PC のこのフォルダで)

1. `npx wrangler@4 login`(ブラウザで承認)
2. `npx wrangler@4 kv namespace create MATCH_LOGS` で出た id を wrangler.toml の `[[kv_namespaces]]` の `id` に入れる(今は作成済みの id が入っている。作り直す時だけ)
3. `npx wrangler@4 deploy`

受け付ける送り元は `*.siegezeke.online`、`siege-zeke-simple-public.pages.dev` とそのプレビュー、localhost。

`workers_dev = false` にしてあるので、`*.workers.dev` 経由の入口は無く、受け口は `log.siegezeke.online` だけ(次回の `wrangler deploy` で反映される。ゲーム側のコードに workers.dev の宛先は無い)。

## 濫用対策: レート制限(ダッシュボードで設定。コードの外)

Origin ヘッダは curl などから偽装できるので、Worker の許可リストだけでは書き込みを防げない。Cloudflare 側で IP ごとの回数を絞る。

1. Cloudflare ダッシュボードで `siegezeke.online` のゾーンを開く
2. **Security** → **Security rules**(旧 WAF)→ **Create rule** → **Rate limiting rule**(画面名は版で違うことがある)
3. 設定の推奨値:
   - Rule name: `match-log post limit`
   - If incoming requests match: Hostname `equals` `log.siegezeke.online` **and** URI Path `equals` `/match-logs`
   - Characteristics: IP
   - Requests: **10** / Period: **1 minute**(無料プランで選べる期間が 10 秒などに限られる場合は、その範囲で 1 分あたり 10 件前後になる値)
   - Action: Block / Duration: 同じ期間(選べる最短)
4. Deploy

目安: 1 対局 = 1 件の送信なので、10 件/分は通常の遊び方では当たらない(再戦の連打でも足りる)。厳しすぎたら 20〜30 に上げる。

## 見る

- まとめて手元に: リポジトリのルートで `pnpm logs:pull`(`logs/match-logs/<終了日>/<matchId>.json` に落ちる。取り込み済みは飛ばす)
- 一覧: `npx wrangler@4 kv key list --binding MATCH_LOGS --remote`
- 1件: `npx wrangler@4 kv key get --binding MATCH_LOGS --remote "log/2026-10-23/<matchId>"`

## テスト

`node --test cloudflare/match-log/worker.test.js`
