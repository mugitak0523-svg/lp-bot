# LP+PERPフロー仕様

## スコープ
- LPポジションの作成/クローズと連動したPERPヘッジの一連の流れを定義する。
- 実行順序、データ保存、エラーハンドリングを含む。
- LP側の既存仕様は変更せず、PERPを後付けで組み込む。

## コンポーネント
- Nodeアプリ（lp-bot）: `src/index.ts`, `src/bot/*`, `src/db/*`, `src/api/server.ts`
- PERP CLIブリッジ: `src/extended/cli.py`（Extended SDK呼び出し）
- Extended SDKアプリ: `extended_example/app/main.py`
- SQLite: `data/lpbot.db`

## データモデル（DB）
- `positions`: LPポジション
- `perp_trades`: LP `token_id` に紐付くPERP約定

## 前提条件
- LP設定はDB優先で読み込み、なければ `.env` を使用（チェーン、プール、ウォレットなど）
- PERP設定は `.env` から読み込む（X10_*キー）
- Node APIサーバーが起動している（`npm start`）
- Python依存がインストール済み（`extended_example/requirements.txt`）

## フロー: LP作成 + PERPヘッジ
1) リバランス開始
- トリガー: 定期監視または `/action/rebalance`
- レンジ外またはアクティブLP無しなら新規サイクル開始

2) LPミント
- プール状態と設定からミントパラメータを生成
- オンチェーンでミント実行
- `tokenId`, `amount0/1`, `price`, `net_value` などを取得

3) LPポジション保存
- `positions` に `token_id` と `status=active` で保存

4) PERPヘッジ注文（SELL）
- 厳密にLPミントがエラーなく完了してから実行する。
- LPエクスポージャーからヘッジサイズを決定
- Node APIの `POST /orders/market` を呼ぶ
- Node APIが `src/extended/cli.py` → `extended_example/app/main.py` を実行
- Extended SDKが成行注文（IOC）を送信
- `get_order_by_id` を最大5回・2秒間隔でリトライ
- 取得できなければ直近10件の約定から `order_id` を検索
- 返却内容:
  - `order_id`, `external_id`, `retry_attempts`
  - `order`（詳細）または `order.trade`（フォールバック）

5) PERP約定の保存
- `order` / `trade` の約定ごとに保存
  - `perp_trades` に `token_id`, `order_id`, `trade_id`, `side`, `qty`, `price`, `fee`, `created_time`, `raw_json`

## フロー: LPクローズ + PERPクローズ
1) LPクローズ開始
- トリガー: リバランス判断または `/action/close`
- LPをオンチェーンでクローズ（burn）
- `close_tx_hash`, `closed_net_value`, `realized_pnl` などを取得

2) LPクローズ保存
- `positions` を更新し `status=closed`

3) PERPクローズ注文（BUY）
- 厳密にLPクローズがエラーなく完了してから実行する。
- 現在のPERPポジションと同じ量を反対売買でクローズ
- 注文送信後は作成時と同じリトライ/フォールバック

4) PERP約定の保存
- `perp_trades` に同じ `token_id` で保存

## エラーハンドリング
- PERP失敗でLPオンチェーン操作をロールバックしない
- PERP注文失敗時:
  - API呼び出し元へエラー返却
  - ログに残し手動対応
- PERP注文成功/詳細取得失敗時:
  - `order_id` を保存し後で `/orders/:id` や `/trades` で再取得

## IDと精度
- `order_id` はJSの安全整数上限を超える
- Node <-> Python 間は `order_id` を文字列で扱う
- `src/extended/cli.py` は巨大整数を文字列化して返す

## API利用例
- ヘッジ注文:
  - `POST /orders/market`
- 注文詳細取得:
  - `GET /orders/:id`
- 直近約定取得:
  - `GET /trades?market=ETH-USD&limit=10`

## 次の実装ステップ
- リバランスフローにPERPサイズ計算を追加
- `perp_trades` のDB書き込みヘルパーを追加
- `runRebalance` とクローズフローに組み込み
