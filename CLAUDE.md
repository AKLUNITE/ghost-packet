# GHOST//PACKET — 作業メモ（Claude用）

3〜5人のブラウザ対戦ブラフゲーム（チャオチャオ系・ハッカーテーマ）。公開先は GitHub Pages：https://aklunite.github.io/ghost-packet/ 。`main` に push すると数分で反映される。

## 絶対ルール
- **世界観・ゲームルール・勝利条件・ダウト審議の仕組みは、ユーザーの事前承認なしに変えない**（設計書 v1.5 準拠）。UI・演出・音・実装はおまかせ。
- 設計書からのユーザー決定の変更：人数 3〜5人（2026-10）／**先に3個ゴールさせた人が優勝**（2026-11-10。到着順位の点数とゴール台の上限＝人数×2で終了、は廃止。全員のパケットが尽きて誰も送れなくなったときだけゴール数で決着、同数は同時優勝。`engine.js` の `advance / score / endByScore`）
- 出目は手番の本人にしか送らない（`GP.view(G, seat)` で手番以外から `myRoll` を消している）。テストで毎回検査している。
- 「無敵の人」状態（手持ちが少ない人が強気にブラフできる非対称）は意図した仕様なので直さない。
- 煽り文言（「通話で揺さぶれ」など）は入れない。説明は短く、事実だけ書く。

## ファイル構成（このリポジトリが唯一の正本。サイトはリポジトリ直下）
| ファイル | 役割 | 大きさ |
|---|---|---|
| `engine.js` | ルールエンジン（純粋JS、UMD）。`GP.createGame / beginTurn / declare / pass / doubt / tick / view` | 10KB |
| `room.js` | ルーム進行（ロビー、CPU、タイマー、公開履歴、ホスト引き継ぎ）。P2Pホスト・練習モード・開発サーバーで共通 | 15KB |
| `bots.js` | CPUの申告・ダウト判断とセリフ | 2KB |
| `p2p.js` | PeerJS（WebRTC）通信。`P2PHost`＝ホストのブラウザで room.js を動かす／`P2PClient`。ピアIDは `ghostpacket-<CODE>` | 9KB |
| `app.js` | 画面制御のすべて（下に目次） | 87KB |
| `scene.js` | 3D卓（席・アバター8種・パケット・ダイスカップ・演出 fx*） | 55KB |
| `gl.js` | 自作 WebGL2 描画（Geo, M4, Renderer, Particles） | 27KB |
| `audio.js` | BGM・効果音をその場で生成。`A.sfx(name, opts)` | 16KB |
| `style.css` | 全スタイル（下に注意） | 61KB |
| `index.html` | 骨組みだけ（HUD要素、スクリプト読み込み） | 3KB |
| `dev/server.js` | テスト用 Node サーバー（WebSocket・依存なし）。リポジトリ直下を配信、`/dev` と `/.git` は 403 | |
| `dev/test/*` | テスト一式 | |
| `dev/tools/*` | ブラウザ確認用スクリプト（Playwright） | |

大きいファイルは全部読まずに、`grep -n` で場所を探して Read の offset/limit で必要な範囲だけ読むこと。

### app.js の目次（`grep -n "^function 名前"` で探す）
- 状態：`const ST = {` … 全体の状態。`ST.view`（自分用の見え方）、`ST.room`（ルーム情報）、`ST.roll`（カップ操作）
- 通信：`class Online`（WS・開発サーバー用）、`class Local`（練習モード）、`hostP2P / joinP2P / connectOnline`（末尾の boot 付近）、`send`
- 受信：`onMsg` → `hardSync` → 演出キュー `queue / runQ` → `fx(e)`（イベントごとの演出 switch）
- 表示の保留：`DV() / RV()`。ダウト結果のネタバレ防止のため、演出中は前の見え方を見せている
- ダウト演出：`duelHtml / showDuel / endSuspense`。PCは盤面上の大きいカード（`#duelBox`）だけ、スマホは操作パネル内の細いカード（`duelMini`）だけを出す（二重表示しない）
- カップ：`syncRoll / myRollPending / shakeStart / shakeEnd / land`（演出だけ。出目は手番開始時にホストが決めている）。`cupHtml / dieHtml`
- HUD：`render` → `renderStatus`（3Dの状態とカップ）`renderBanner` `renderRail` `renderRack` `renderDock`（下の操作パネル）`declTiles`
- 画面：`renderTitle / renderLobby / renderOver / lookPicker / avatarSvg / guide / openSheet / modal / RULES`
- 入力：`// ───────── input` 以下（クリックは `data-*` 属性で振り分け、キー操作、長押しで出目を見る `peek`）
- 毎フレーム：`frame`（タイマー・BGMの緊張度）
- 盤面の操作：PCはドラッグで回転・ホイールで拡大。スマホはピンチで拡大、拡大中は1本指で移動、ダブルタップか「表示を戻す」で元に戻す（`S3.zoomBy / panBy / resetView`、`syncZoomChip`）
- パケット一覧 `trayHtml(p, big)`：★ゴール／塗り＝転送中／枠＝手元／猫＝猫動画・没収。プレイヤー欄・詳細シートに表示
- 猫動画の画面ジャック `catJack(seat)`：嘘がバレたとき（`destroy` イベントの cause が cat）に画面全体が約2.3秒「cat.mp4」の再生画面になる。タップで飛ばせる。閉じたあとプレイヤー欄の猫印が弾む
- 演出文字 `splash`：文字数から幅を見積もって `--n` に入れ、盤面の幅（`cqw`）に収まる大きさにしている
- デバッグ用：`window.__GP = { ST, S3, A, splash, catJack }`

### 通信メッセージ（クライアント → room.handle）
`create/join`（WSのみ）、`look`、`addBot`、`kick`、`setSec`、`start`、`roll {s:'shake'|'done'}`（演出だけ）、`declare {v}`、`pass`、`unpass`、`doubt {rank?}`、`react {k}`、`skipTurn`、`lobby`、`leave`。
サーバー → 各自に `sync`（`you, room, view, events[]`）。`events` が演出の元：`start turn rollfx declare pass doubtIn reveal passed goal cat confiscate over react say streak disc` など。

### style.css の注意
上から「基本 → 端末別レイアウト → アナログ風の見た目 → 磨き込み → v3（読みやすさ・カップ） → v4（スマホの小さい操作パネル・ダウトカード・閉じられるシート） → v5（はみ出し対策・ピンチ拡大） → v6（パケット7個の一覧 `.tray`・猫動画の画面ジャック `.catjack`）」の順に重ねている。**後に書いたブロックが前を上書きする**。直すときは既存ブロックを探して直すか、末尾の v3 ブロックに足す。`!important` は v3 の演出文字（`.sp`）など一部だけ。
レイアウトは `body[data-layout]` = `pc` / `port`（スマホ縦）/ `land`（スマホ横）。

## テスト（Node 22）
```
npm test            # 全部（約6分。soak が長い）
npm run test:quick  # ルールとルームだけ（数秒）
N=1 node dev/test/soak.test.js   # soak を1局だけ
```
- `engine.tests.js` 設計書§14 T01〜T17 ＋人数チェック／`room.extra.test.js`／`net.test.js` 実サーバー経由で T01〜T17 と出目漏れ検査／`soak.test.js` CPU入りの完全な対戦
- 画面の確認：リポジトリ直下を配信して（`python3 -m http.server 8099` か `PORT=8099 npm run dev`）
  - `node dev/tools/shots-roll.js <出力先>` …練習モードで手番の流れを PC・スマホ縦・スマホ横で撮影
  - `node dev/tools/shots-all.js <出力先>` …タイトル〜結果まで一通り撮影
  - `node dev/tools/shots-phone.js <出力先> [url] [390x620]` …iPhone Safari 相当の画面で、審議・自分のダウト（照合〜結果）・手番・メニューを撮影
  - `node dev/tools/fit-audit.js <出力先> [url]` …7種類の画面サイズで練習を1局ずつ進め、画面外へのはみ出し・切れた文字・1文字ずつ折り返す文字を全部列挙（`SIZES=se,pc` で絞れる。全サイズだと10分超なので分けて実行）。**UIを直したら最後にこれで0件を確認**
  - `node dev/tools/e2e-p2p.js <出力先> http://localhost:8097/` …PeerJS を BroadcastChannel の偽物（`mockpeer.js`）に差し替え、ホスト＋参加者3人のタブで通しテスト（出目漏れ・再接続・ホスト退出）

## 作業環境のクセ（クラウド作業環境）
- jsdelivr・Google Fonts・PeerJS のサーバーに届かない。テストではこれらをブロックし、P2P は `mockpeer.js` で代用する
- WebGL は `--use-angle=swiftshader` で動く（遅い）。同じブラウザのタブを何枚も開くときは `waitUntil: 'domcontentloaded'` にしないとタイムアウトする
- `pkill -f "http.server ..."` は実行中の自分のシェルまで止めてしまうので使わない。ポートを変えて起動し直す
- commit は `user.email=350529989+AKLUNITE@users.noreply.github.com`（ユーザーのメールアドレスを使うと push が拒否される）。メッセージ末尾に Claude の帰属行を付ける
- GitHub Pages の設定変更は API では不可。ユーザーに Settings → Pages で操作してもらう
