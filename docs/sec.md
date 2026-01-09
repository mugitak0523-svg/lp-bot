ご提示いただいた回答内容およびこれまでの議論に基づき、**Arbitrum Uniswap V3 自動リバランスBot システム仕様書**を作成しました。

この仕様書は、バックエンド（Bot本体/API）とフロントエンドを分離し、本番環境（Railway + Vercel）での運用を前提とした構成になっています。

---

# Arbitrum Uniswap V3 LP Bot 実装仕様書

## 1. プロジェクト概要

Arbitrum One上のUniswap V3における流動性提供（LP）を自動化するシステム。
指定した価格帯（Tick Range）から外れた際に自動でリバランス（ポジションの組み直し）を行い、手数料収益の最大化を目指す。
コア機能はAPIとして実装し、外部（フロントエンド等）から状態確認や操作を可能にする。
**複数ポジション（複数NFT）を同時に管理する前提**とする。

## 2. システムアーキテクチャ

### 2.1. 構成図

* **Frontend (Vercel):** ユーザーインターフェース。Botの状態監視、設定変更、損益表示を行う。
* **Backend / Bot Core (Railway):** Node.jsで稼働。常駐プロセスによる監視、APIサーバー機能、Discord通知を担当。
* **Blockchain (Arbitrum One):** ハイブリッド接続（HTTP/WSS）により安定した通信を行う。

### 2.2. 技術スタック

| カテゴリ | 技術・ツール | 備考 |
| --- | --- | --- |
| **言語** | TypeScript | 型安全性確保のため必須 |
| **Runtime** | Node.js | v18以上推奨 |
| **Library** | ethers.js v5 | ブロックチェーン対話（v6ではなくv5指定） |
| **SDK** | @uniswap/v3-sdk | 金額計算、ルート計算等 |
| **API Framework** | Express or Fastify | 軽量なREST API構築のため |
| **Notification** | Discord.js / Webhooks | リバランス実行時の通知 |
| **Infra (Dev)** | Local (Mac) | `.env` による環境変数管理 |
| **Infra (Prod)** | Railway (Backend) | 常時稼働プロセス + API |
| **Infra (Prod)** | Vercel (Frontend) | Next.js 等のホスティング |

---

## 3. 機能要件

### 3.1. 監視機能 (Monitor)

* **接続方式:**
* データ取得（RPC Call）: **HTTP Provider**
* イベント監視（Logs/Events）: **WebSocket Provider**


* **監視項目:**
* 現在価格（Pool Slot0）
* 現在のTick
* Gas価格（急騰時の監視用）
* ポジションの状態（In Range / Out of Range）
* 含み益・未回収手数料
* **複数ポジション対応:** 監視はポジション単位で行い、各ポジションの状態を独立に保持する。



### 3.2. 自動リバランス機能 (Auto-Rebalance)

* **発動条件:**
* 現在価格が設定したレンジ（Tick Range）を外れた場合。
* **待機時間（Delay）:** 設定された時間（例: 5分）継続して範囲外に留まった場合に実行（騙し・ノイズ対策）。


* **実行フロー:**
1. 現在のポジションを解除（Remove Liquidity）。
2. 未回収手数料を回収（Collect Fees）。
3. **資産配分:** 現在価格を中心としたレンジに対して、価値ベースで **50:50** になるように、不足しているトークンをスワップする（Swap）。
* スリッページ許容値: 設定値（例: 0.5%）を使用。


4. 新しいレンジ（Tick Lower/Upper）を計算し、新規ポジションを作成（Mint）。


* **レンジ幅:**
* 現在価格を中心として、設定されたTick幅（例: ±50 ticks）で再設定。



### 3.3. 資金管理・損益計算

* **利益計算基準 (Metrics):**
* **時価総額 (Net Value) [採用]:** 保有トークン（ETH+USDC）のドル換算総額を表示。
* 開始時からの増減額・増減率を算出。


* **手数料の扱い:**
* 回収した手数料は再投資（複利）せず、ウォレット内の残高として保持（単利運用）。


* **緊急停止 (Stop Loss):**
* 総資産（Net Value）が運用開始時から **指定％（例: -10%）** 減少した場合、ポジションを全解除してBotを停止する。



### 3.4. 通知・API機能

* **APIエンドポイント:** フロントエンド向けに以下の情報を提供。
* Botステータス（稼働中/停止中/待機中）
* **ポジション一覧（複数）**の資産状況、PnL（損益）
* 現在の設定値


* **Discord通知:**
* リバランス実行時（旧ポジション解除、スワップ結果、新ポジション作成、確定損益）。
* 緊急停止発動時。
* エラー発生時。



---

## 4. 設定パラメータ (Config)

以下の項目はハードコードせず、API経由または環境変数/設定ファイルで変更可能にする。

| パラメータ名 | 説明 | 例 |
| --- | --- | --- |
| `TARGET_POOL` | 監視対象のプールアドレス | USDC/ETH 0.05% |
| `TICK_RANGE` | リバランス時のレンジ幅 (±Ticks) | 50 (=0.5%) |
| `REBALANCE_DELAY_SEC` | 範囲外判定後の待機時間 (秒) | 300 (5分) |
| `SLIPPAGE_TOLERANCE` | スワップ・Mint時の許容スリッページ (%) | 0.5 |
| `STOP_LOSS_PERCENT` | 緊急停止ライン (開始比 %) | 10 |
| `MAX_GAS_PRICE` | ガス代監視用アラートライン (Gwei) | 50 (あくまで監視用) |

---

## 5. フォルダ構成案 (Backend)

APIサーバーとBotロジックを同居させる構成です。

```text
root/
├── src/
│   ├── api/                # API関連
│   │   ├── routes.ts       # ルーティング定義 (GET /status, POST /config 等)
│   │   └── controllers.ts  # APIのリクエスト処理
│   ├── bot/                # Botコアロジック
│   │   ├── monitor.ts      # 価格・イベント監視 (Hybrid Provider)
│   │   ├── rebalance.ts    # リバランス実行フロー (Remove -> Swap -> Mint)
│   │   ├── logic.ts        # Tick計算、スワップ量計算などの純粋関数
│   │   └── safety.ts       # ストップロス、ガス監視チェック
│   ├── uniswap/            # Uniswap SDK/Contract ラッパー
│   │   ├── positions.ts    # NFPMコントラクト操作
│   │   ├── pool.ts         # Poolコントラクト操作
│   │   └── swap.ts         # SwapRouter操作
│   ├── utils/              # ユーティリティ
│   │   ├── provider.ts     # Ethers provider設定 (HTTP/WSS)
│   │   ├── discord.ts      # Discord通知機能
│   │   └── logger.ts       # ログ出力設定
│   ├── config/
│   │   └── settings.ts     # 設定値管理 (環境変数 + 動的設定)
│   ├── index.ts            # エントリーポイント (Server & Bot起動)
│   └── types.ts            # 型定義
├── .env                    # 環境変数 (秘密鍵、RPC URL等)
├── package.json
└── tsconfig.json

```

## 6. API設計 (簡易定義)

フロントエンドから叩くための主要エンドポイント定義です。

* **`GET /api/status`**
* **Response:** 複数ポジションの配列で、現在価格, Tick, Range状態(In/Out), ポジション内訳(ETH/USDC), 累積手数料, Net Value, 含み損益率。


* **`GET /api/config`**
* **Response:** 現在の設定値（Range幅, Delay秒数, スリッページ等）。


* **`POST /api/config`**
* **Request:** 変更したい設定値。リバランス条件等を動的に変更する。


* **`POST /api/action/start`**
* Botの自動監視を開始（全ポジション or 指定ポジション）。


* **`POST /api/action/stop`**
* Botの自動監視を停止（ポジションは維持、全ポジション or 指定ポジション）。


* **`POST /api/action/panic`**
* 緊急停止（ポジションを即時解除し、USDC/ETHに戻して終了）。



---

## 7. 開発・運用フロー

1. **Local Dev:**
* `.env` にArbitrumのRPC、秘密鍵を設定。
* `npm run dev` でローカルサーバー起動。
* コンソールでログを確認しながらロジック検証（テストネット推奨だが、Arbitrum OneのFork環境がベスト）。


2. **Deployment (Backend):**
* GitHub経由で **Railway** にデプロイ。
* 環境変数はRailwayのダッシュボードで設定。
* 永続化が必要なデータ（開始時の元本データなど）は、RailwayのVolumeか、**SQLite**（推奨）/簡易なJSON DB（lowdb等）/Redisを使用する（再起動で消えないようにするため）。ポジション情報はSQLiteに保存して管理し、**リバランスのたびに新しいレコードとして保存**する（履歴を残す）。

**SQLite 仕様（ポジション履歴）**
* テーブル: `positions`
* 保存項目（必須）: token_id, pool_address, token0/1(アドレス・symbol・decimals), fee, tick_lower/upper, liquidity, amount0/1, price0_in_1, net_value_in_1, mint_tx_hash, status, created_at, updated_at
* 保存項目（任意）: fees0/fees1, gas_cost_native/gas_cost_in_1, rebalance_reason, close_tx_hash


3. **Deployment (Frontend):**
* Next.js等で作成し **Vercel** にデプロイ。
* BackendのAPI URLを環境変数に設定。



この仕様書をベースに開発を進めていけば、要件を満たすBotが構築可能です。
