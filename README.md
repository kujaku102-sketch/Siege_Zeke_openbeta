# Siege÷Zeke Simple Public

ブラウザ用の公開開発リポジトリ。正本は [kujaku102-sketch/Siege_Zeke_openbeta](https://github.com/kujaku102-sketch/Siege_Zeke_openbeta) の `main`。現行の基準は β0.9.1（公開 revision `76bbe3f892a41264`）で、β0.9.2 は今後の開発予定。β0.9.2 の実装・公開が完了したという意味ではない。

214種のSTDカードを含む公開 staging データ、簡易プレイ、チュートリアル、デッキ構築を収録する。オンライン対戦、認証、外部API、production公開は含まない。ルールは[現行ルールブック](docs/rules/siege-zeke-rulebook-current.md)、データの範囲は[公開データ境界](docs/PUBLIC-DATA-BOUNDARY.md)を参照。

## ローカル開発

Node.js `24.19.0` と pnpm `11.19.0` を使用する。最初にリポジトリを取得し、依存をインストールする。

```powershell
git clone https://github.com/kujaku102-sketch/Siege_Zeke_openbeta.git
cd Siege_Zeke_openbeta
pnpm install --frozen-lockfile
```

開発画面を見るときは、別ターミナルで次を起動する。テストやビルドに進む前に、このサーバーを停止する。

```powershell
pnpm dev
```

テストと staging ビルドの確認は次の順で実行する。

```powershell
pnpm test
pnpm build:staging
pnpm verify:public
```

`pnpm dev` はローカルの開発サーバーを起動する。PC入口は `/pc/`、モバイル入口は `/mobile/`。ビルド出力は `dist/`。Cloudflare Pages への自動デプロイ設定はなく、公開は別工程で手動確認する。

ブラウザ E2E は任意。`pnpm build:staging` 後、ビルド済みの画面を別ターミナルで起動する。

```powershell
pnpm exec vite preview --host 127.0.0.1 --port 4173
```

さらに別ターミナルで、外部に用意した Playwright のモジュールパスを渡して実行する。

```powershell
node scripts/e2e-public-build.mjs --playwright-module <module-path> http://127.0.0.1:4173/
```

モジュールパスは `SIMPLE_ZEKE_PLAYWRIGHT_MODULE` 環境変数でも指定できる。スクリプトは Edge の `msedge` チャネルを使う。Playwright はこのリポジトリの依存に含めない。

## 素材と権利

任意の「マキナス4」と「廻想体」は配布しない。使用したい場合は公式の[マキナス4](https://moji-waku.com/makinas/index.html)、[廻想体](https://moji-waku.com/kaiso/)、[使用許諾範囲](https://moji-waku.com/mj_work_license/)を読み、推奨表示環境のため利用規約を確認し自己判断でダウンロードすること。配置先は `src/assets/fonts-local/Makinas-4-Flat.otf` と `src/assets/fonts-local/Kaisotai-Next-UP-B.woff2`。無くても CSS の `sans-serif` fallback で表示できる。DotGothic16 と OFL 表記は同梱する。

この公開リポジトリ自体は OSS ライセンスを付与しない。コード・カードデータ・第三者素材の権利は [NOTICE.md](NOTICE.md) と [第三者通知](public/THIRD_PARTY_NOTICES.txt)を参照。内部資料と検証 evidence は外部の Drive に保管し、このリポジトリには含めない。
