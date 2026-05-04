# tategaki

[![CI](https://github.com/miruky/tategaki/actions/workflows/ci.yml/badge.svg)](https://github.com/miruky/tategaki/actions/workflows/ci.yml)
[![Deploy](https://github.com/miruky/tategaki/actions/workflows/deploy.yml/badge.svg)](https://github.com/miruky/tategaki/actions/workflows/deploy.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Test](https://img.shields.io/badge/Test-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**青空文庫のテキストを、ルビ・傍点・縦中横まで組んだ縦書きで読むブラウザリーダーです。**

## 概要

青空文庫が配布する注記つきテキスト(.txt)を開くと、注記記法を解釈して縦書きで組み直します。漢字《かんじ》形式と|指定《してい》形式のルビ、傍点、大中小の見出し、字下げ、改ページに対応し、半角数字の「12月」のような並びは縦中横として一文字幅に収めます。ページは紙の本と同じく右から左へめくり、読みさしの位置は作品ごとに自動で保存されます。

読みながら本文を検索して一致箇所へ飛べるほか、気になった場所には抜き出し文つきのしおりを何枚でも挟めます。書架は丸ごとJSONに書き出して別の端末へ持ち運べます。文字コードはShift_JISとUTF-8を自動判別し、データはすべてlocalStorageに保存して、サーバーには何も送りません。

試す: https://miruky.github.io/tategaki/

### なぜ作ったのか

青空文庫の作品をブラウザで読むと、注記が生のまま見えるか、横書きに均されるかのどちらかになりがちです。かといって専用アプリを入れるほどでもない。タブをひとつ開いてファイルを放り込めば、ルビも傍点もきちんと組まれた縦書きで読める、という体験が欲しくて作りました。ページ送りで行が裂けないよう、1ページの幅を行送りの整数倍に揃えるところにこだわっています。

## 使い方

- 「ファイルを開く」で青空文庫のテキストファイル(.txt)を選ぶか、書架へファイルをドラッグして放り込みます。「貼り付け」に本文を貼っても追加できます。1行目が題名、2行目が著者として書架に並びます
- 書架が空のときは収録サンプル「縦書きのすすめ」で組み上がりを確かめられます
- ページ送りは左矢印キー・スペース(次へ)、右矢印キー(前へ)、または画面の左右端のクリック。下部のスライダーでも移動できます
- 「表示」から書体(明朝・ゴシック)、文字サイズ、行間、配色(自動・ライト・ダーク・セピア)を変えられます。設定は次回も引き継がれます
- 「検索」で本文中の語を探し、一致箇所をハイライトして前後へ移動できます
- 「しおり」で今読んでいる位置を、その場の一節を添えて何枚でも記録できます。書架には作品ごとのしおり数が表示されます
- 読書位置は自動保存され、書架上部の「続きから」で最後に開いた作品の続きへ戻れます
- 書架メニュー(…)から書架を丸ごとJSONに書き出し、別の端末で読み込めます。同じ本文の作品は重複して取り込まれません

主なキーボード操作は次のとおりです。`←`/Space で次へ、`→` で前へ、`Home`/`End` で先頭・末尾、`+`/`-` で文字の拡大縮小、`t` で配色切り替え、`b` でしおり、`/` で検索、`?` で操作一覧、`Esc` でパネルを閉じます。

対応する注記はルビ・傍点・見出し・字下げ・改ページです。それ以外の注記(外字の説明など)は本文から取り除いて表示します。

## アーキテクチャ

![tategakiのアーキテクチャ](docs/architecture.svg)

`aozora.ts` が注記記法を構造(段落・見出し・ルビ・傍点)へパースし、`render.ts` がそれを縦書き用HTMLへ変換します。字数の集計やしおりの抜き出し、本文検索の素材づくりは `reading.ts` にまとめ、いずれもDOMに触れない純粋な文字列処理として、ルビの境界判定や縦中横の桁数といった細かい規則とともに単体テストで固めています。ページ送りは `app.ts` がCSSの `writing-mode: vertical-rl` で組んだ本文を、行送り幅の整数倍だけ `translateX` でずらす方式です。スクロール座標系のブラウザ差に依存せず、ページ境界で縦の行が裂けません。

## 技術スタック

| カテゴリ | 技術                                    |
| :------- | :-------------------------------------- |
| 言語     | TypeScript 5(strict)                    |
| 組版     | CSS writing-mode / text-combine-upright |
| ビルド   | Vite 8                                  |
| テスト   | Vitest(65テスト)                        |
| リンタ   | ESLint + Prettier                       |
| CI / CD  | GitHub Actions                          |
| 配信     | GitHub Pages                            |

## プロジェクト構成

- `src/lib/aozora.ts` — 注記記法のパーサ(ルビ・傍点・見出し・字下げ・改ページ)
- `src/lib/render.ts` — 縦書き用HTMLの生成。縦中横とエスケープ
- `src/lib/encoding.ts` — Shift_JIS / UTF-8の自動判別
- `src/lib/reading.ts` — 字数・推定読書時間・しおりの抜き出し・検索の素材づくり(純粋関数)
- `src/lib/library.ts` — 書架・しおり・続きから・表示設定の保存と書き出し / 読み込み
- `src/lib/sample.ts` — 注記記法の見本を兼ねた書き下ろしの収録サンプル
- `src/app.ts` — 書架と読書画面。行送り単位のページ計算、検索・しおり・設定のパネル
- `docs/architecture.svg` — アーキテクチャ図

## はじめ方

### 前提条件

- Node.js 20 以上

### セットアップ

```bash
git clone https://github.com/miruky/tategaki.git
cd tategaki
npm ci
npm run dev
```

### テストとlint

```bash
npm test
npm run lint
```

### ビルド

```bash
npm run build
```

GitHub Pagesへは `main` へのpushで自動デプロイされます。サブパス配信のため、ワークフローでは環境変数 `TATEGAKI_BASE=/tategaki/` を渡してViteの `base` を切り替えています。

## 設計方針

- **行が裂けないページ送り**: 1ページの幅を行送り(line-height)の整数倍に丸めてから `translateX` で送るため、ページ境界で縦の行が半分に切れません。文字サイズや行間を変えると、読書位置の割合を保ったまま組み直します。
- **パースとレンダリングの分離**: 注記の解釈(構造化)とHTML生成を分け、それぞれを純粋関数としてテストしています。未知の注記は落とし、傍点のような文脈依存の注記は直前のテキストに安全に適用できる場合だけ反映します。
- **作品の本文はそのまま保存**: 書架にはパース結果ではなく原文を保存します。パーサを改良したら、既存の作品も次に開いたときから新しい組版になります。
- **収録物は書き下ろしのみ**: サンプルは注記記法の見本を兼ねた自作の文章で、青空文庫の作品自体は同梱しません。読みたい作品は各自のファイルで開く設計です。

## ライセンス

[MIT](LICENSE)
