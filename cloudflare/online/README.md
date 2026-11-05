# オンライン対戦の部屋

部屋コードで友だちと対戦するための Worker と Durable Object。**まだデプロイしていない。** この PC の中(`wrangler dev`)でだけ動かして確かめている。

- `POST /rooms` … 部屋を作り、部屋コード(8文字)を返す。受け付けるのは `*.siegezeke.online`、`siege-zeke-simple-public.pages.dev` とそのプレビュー、localhost の画面だけ。
- `GET /rooms/{コード}/ws` … WebSocket で部屋に入る。コードの検査文字が違えば、部屋を起こす前に 404 で断る。
- 1部屋 = Durable Object 1つ(`Room`)。対戦の状態は DO の SQLite に、1コマンドごとに保存する。
- 決着した対戦は、対戦ログの Worker と同じ KV(`MATCH_LOGS`)に1件のログとして書く(`mode: "online"`)。

部屋のルール(席、準備、切断の60秒、期限、投了)は `src/network/room-core.js` にあり、この Worker は WebSocket・SQLite・アラームをつなぐだけ。

## ファイル

- `src/index.js` … 入口。`router.js` と `room.js` を出す。
- `src/router.js` … 部屋コードの発行、Origin の確認、コードの検査、部屋への中継。
- `src/room.js` … Durable Object。休止しても、ソケットが持つ印(`serializeAttachment`)から席を思い出す。`"ping"` は休止中の部屋を起こさず `"pong"` で返す。
- `src/sql-store.js` … `room-core` が使う保存先(1テーブル、索引なし)。
- `worker.test.js` / `sql-store.test.js` … `node --test cloudflare/online/worker.test.js cloudflare/online/sql-store.test.js`(Node の `node:sqlite` で同じ SQL を流す)。

## この PC で動かす

1. `cloudflare/online/.dev.vars` を作り、`ROOM_CODE_KEY=` に16文字以上の**試験用の文字列**を書く(`.dev.vars` はコミットされない)。本物の値は書かない・持ち込まない。
2. このフォルダで `npx wrangler@4 dev`(ログインもデプロイも要らない。KV も DO もこの PC の中の模擬)。

本物の Cloudflare への反映(`wrangler deploy`、シークレットの設定、`play.siegezeke.online` の割り当て)は、文豪の承認のあとに行う。
