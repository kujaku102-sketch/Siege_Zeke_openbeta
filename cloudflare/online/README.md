# オンライン対戦の部屋

部屋コードで友だちと対戦するための Worker と Durable Object(`siege-zeke-online`、入口は `play.siegezeke.online`)。**本物の Cloudflare への反映はまだ。** いまは手元の `wrangler dev` と偽の Discord でだけ確かめてある。反映の手順は下の「本物の Cloudflare に反映する」(文豪がやる)。ページ側の接続先は `src/network/endpoint.js` の `ONLINE_ENDPOINT`(`https://play.siegezeke.online`)。

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
  - 変数(公開してよい。`wrangler.toml` の `[vars]`): `DISCORD_CLIENT_ID`(入れてある。19桁なので必ず引用符つきの文字列にする)、`DISCORD_REDIRECT_URI`(Discord に登録したものと完全一致。いまは staging のページ)
  - **secret**: `DISCORD_CLIENT_SECRET`、`AUTH_KEY`(16文字以上の乱数。`ROOM_CODE_KEY` とは別の値)
  - `DISCORD_BASE` は手元の試験専用(本物の Discord 以外は、localhost の http だけ受け付ける)。本番では設定しない。
  - secret の値はこのリポジトリにも文書にも書かない。登録は文豪が行う。
- 設計: `サーバー設計-Discordログイン.md`。

## ファイル

- `src/index.js` … 入口。`router.js` と `room.js` を出す。
- `src/router.js` … 部屋コードの発行、Origin の確認、コードの検査、部屋への中継、Discord ログインの2つの経路。
- `src/auth.js` … Discord ログイン(`authStart` / `authExchange` / `authConfig`)。
- `src/room.js` … Durable Object。休止しても、ソケットが持つ印(`serializeAttachment`)から席を思い出す。`"ping"` は休止中の部屋を起こさず `"pong"` で返す。
- `src/sql-store.js` … `room-core` が使う保存先(1テーブル、索引なし)。
- `put-random-secret.mjs` … 乱数の secret(`ROOM_CODE_KEY` / `AUTH_KEY`)を、値を見せず・残さず `wrangler secret put` に渡す。
- `worker.test.js` / `sql-store.test.js` / `auth.test.js` … `node --test cloudflare/online/worker.test.js cloudflare/online/sql-store.test.js cloudflare/online/auth.test.js`(Node の `node:sqlite` で同じ SQL を流す。`auth.test.js` は手元の小さな HTTP サーバーを偽の Discord にする。本物の Discord は呼ばない)。

## この PC で動かす

1. `cloudflare/online/.dev.vars` を作り、`ROOM_CODE_KEY=` に16文字以上の**試験用の文字列**を書く(`.dev.vars` はコミットされない)。本物の値は書かない・持ち込まない。Discord ログインを手元で試すときは、同じ形で `AUTH_KEY`、`DISCORD_CLIENT_ID`(数字)、`DISCORD_CLIENT_SECRET`、`DISCORD_REDIRECT_URI`、`DISCORD_BASE=http://127.0.0.1:<偽の Discord のポート>` にも試験用の値を書く。
2. このフォルダで `npx wrangler@4 dev`(ログインもデプロイも要らない。KV も DO もこの PC の中の模擬)。

## 本物の Cloudflare に反映する(文豪がやる)

前提: Cloudflare のアカウントに `siegezeke.online` があること(`play.siegezeke.online` の割り当ては deploy が行う)。コマンドはすべて **このフォルダ(`cloudflare/online`)** で。wrangler は `npx wrangler@4`(この PC なら `node D:/work/tmp/sz-net-worker/node_modules/wrangler/bin/wrangler.js` でも同じ。その場合は `npx wrangler@4` の所をそれに替え、`put-random-secret.mjs` には環境変数 `WRANGLER` で同じものを渡す)。

### 1. Discord のアプリ(Discord 側の作業)

1. https://discord.com/developers/applications → New Application(名前は「Siege÷Zeke」など。ログインの許可画面に出る)。
2. OAuth2 の **Redirects** に `https://staging.siege-zeke-simple-public.pages.dev/discord-callback.html` を追加(`wrangler.toml` の `DISCORD_REDIRECT_URI` と1文字も違わないこと)。本番(`siegezeke.online`)へ移すときは、そのアドレスの Redirect も足す。
3. **Client ID**(公開してよい)は `wrangler.toml` の `[vars]` の `DISCORD_CLIENT_ID` に入れてある(アプリを作り直したら替える。19桁なので引用符つきの文字列のまま)。**Client Secret** は手順 4 で貼るまで、どこにも書かない(チャットにも貼らない)。画面で一度しか出ないので、出たまま 4 に進む。

### 2. ログインと反映

```bash
npx wrangler@4 login
npx wrangler@4 deploy
```

- `login` はブラウザで承認する。
- 初回の `deploy` が、Worker・Durable Object(SQLite)・`play.siegezeke.online` の割り当て(DNS と証明書)を作る。secret が無い間は、部屋の作成が `500 SERVER_MISCONFIGURED` を返すだけで、安全側に倒れる。

### 3. secret を入れる(値は画面にも履歴にも出ない)

```bash
node put-random-secret.mjs ROOM_CODE_KEY
node put-random-secret.mjs AUTH_KEY
npx wrangler@4 secret put DISCORD_CLIENT_SECRET
```

- 上の2つは乱数(64文字)を作って `wrangler secret put` の入力に直接渡す。値は表示も保存もされない。**2つは別の値**になる。
- `DISCORD_CLIENT_SECRET` は Discord の画面の値を、`Enter a secret value:` と聞かれたときに貼って Enter(入力は表示されない)。
- どれも、一度入れれば次の `deploy` でも残る。入れ直すと古い値は無効になる(`AUTH_KEY` を替えると、発行済みの Discord の ticket がすべて無効になり、みんな再ログインになる。`ROOM_CODE_KEY` を替えると、いまある部屋コードが全部無効になる)。

### 4. 確かめる

```bash
curl.exe -i -X POST https://play.siegezeke.online/rooms -H "Origin: https://staging.siege-zeke-simple-public.pages.dev"
```

`201` と、`code` / `display` の入った JSON が返ればよい(`500` なら secret が足りない。`403` なら Origin が許可外)。Discord は、ステージングのページの「Discordでログイン」で確かめる。

### 5. 順序と、止めたいとき

- **Worker を先に deploy し、そのあとでページ**(`ONLINE_ENDPOINT` が入った版)を出す。逆だと、ページのオンライン対戦が接続できない。
- ページ側の CSP(`public/_headers`)には `connect-src` に `https://play.siegezeke.online wss://play.siegezeke.online`、`img-src` に `https://cdn.discordapp.com` が要る(ページ側の担当。いまは未反映)。
- ログ: `npx wrangler@4 tail`(このコードは console に何も出さない)。
- 戻す: `npx wrangler@4 rollback`。Discord だけ止める: `npx wrangler@4 secret delete DISCORD_CLIENT_SECRET`(`/auth/discord/*` が `SERVER_MISCONFIGURED` になり、ゲストの対戦はそのまま動く)。
- 無料プランの上限と使う量の見積りは `サーバー設計-詳細.md` §12。反映後は Cloudflare の画面(Workers & Pages → siege-zeke-online → Metrics)で、リクエスト数と Durable Object の使用量を見る。
