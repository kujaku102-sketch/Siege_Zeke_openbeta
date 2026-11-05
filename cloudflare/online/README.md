# オンライン対戦の部屋

部屋コードで友だちと対戦するための Worker と Durable Object。**まだデプロイしていない。** この PC の中(`wrangler dev`)でだけ動かして確かめている。

- `POST /rooms` … 部屋を作り、部屋コード(8文字)を返す。受け付けるのは `*.siegezeke.online`、`siege-zeke-simple-public.pages.dev` とそのプレビュー、localhost の画面だけ。
- `GET /rooms/{コード}/ws` … WebSocket で部屋に入る。コードの検査文字が違えば、部屋を起こす前に 404 で断る。
- 1部屋 = Durable Object 1つ(`Room`)。対戦の状態は DO の SQLite に、1コマンドごとに保存する。
- 決着した対戦は、対戦ログの Worker と同じ KV(`MATCH_LOGS`)に1件のログとして書く(`mode: "online"`)。

部屋のルール(席、準備、切断の60秒、期限、投了)は `src/network/room-core.js` にあり、この Worker は WebSocket・SQLite・アラームをつなぐだけ。

## Discord ログイン(名前とアイコン)

- `POST /auth/discord/start` … ブラウザのトークンを受け取り、Discord の認可 URL(`identify` だけ、`state` と PKCE の S256 つき)を返す。
- `POST /auth/discord/exchange` … Discord から戻った `code` と `state` を受け取り、Discord でトークン交換 → `users/@me` → トークンの取り消し、を行って、署名つきの ticket と `{ name, avatarUrl, expiresAt }` を返す。**Worker は何も保存しない**(`state` は署名つき、PKCE の verifier は `state` から計算し直す)。
- 部屋は `hello` の `ticket` を `AUTH_KEY` で確かめ、席に `avatar`(Discord の CDN の決まった形のアドレス)を載せる。ticket が無い・壊れている・期限切れ・鍵が無いときも、ゲストとして入れる(`welcome.profile` に `none` / `invalid` / `expired` / `unavailable`)。
- 設定(どれかが無いと `SERVER_MISCONFIGURED` を返し、Discord は呼ばない。対戦はゲストのまま遊べる):
  - 変数(公開してよい): `DISCORD_CLIENT_ID`、`DISCORD_REDIRECT_URI`(Discord に登録したものと完全一致)
  - **secret**: `DISCORD_CLIENT_SECRET`、`AUTH_KEY`(16文字以上の乱数。`ROOM_CODE_KEY` とは別の値)
  - `DISCORD_BASE` は手元の試験専用(本物の Discord 以外は、localhost の http だけ受け付ける)。本番では設定しない。
  - 値はこのリポジトリにも文書にも書かない。本番の登録は文豪が行う。
- 設計: `サーバー設計-Discordログイン.md`。

## ファイル

- `src/index.js` … 入口。`router.js` と `room.js` を出す。
- `src/router.js` … 部屋コードの発行、Origin の確認、コードの検査、部屋への中継、Discord ログインの2つの経路。
- `src/auth.js` … Discord ログイン(`authStart` / `authExchange` / `authConfig`)。
- `src/room.js` … Durable Object。休止しても、ソケットが持つ印(`serializeAttachment`)から席を思い出す。`"ping"` は休止中の部屋を起こさず `"pong"` で返す。
- `src/sql-store.js` … `room-core` が使う保存先(1テーブル、索引なし)。
- `worker.test.js` / `sql-store.test.js` / `auth.test.js` … `node --test cloudflare/online/worker.test.js cloudflare/online/sql-store.test.js cloudflare/online/auth.test.js`(Node の `node:sqlite` で同じ SQL を流す。`auth.test.js` は手元の小さな HTTP サーバーを偽の Discord にする。本物の Discord は呼ばない)。

## この PC で動かす

1. `cloudflare/online/.dev.vars` を作り、`ROOM_CODE_KEY=` に16文字以上の**試験用の文字列**を書く(`.dev.vars` はコミットされない)。本物の値は書かない・持ち込まない。Discord ログインを手元で試すときは、同じ形で `AUTH_KEY`、`DISCORD_CLIENT_ID`(数字)、`DISCORD_CLIENT_SECRET`、`DISCORD_REDIRECT_URI`、`DISCORD_BASE=http://127.0.0.1:<偽の Discord のポート>` にも試験用の値を書く。
2. このフォルダで `npx wrangler@4 dev`(ログインもデプロイも要らない。KV も DO もこの PC の中の模擬)。

本物の Cloudflare への反映(`wrangler deploy`、シークレットの設定、`play.siegezeke.online` の割り当て)は、文豪の承認のあとに行う。
