# Sunrise Reserve Monitor

サンライズ瀬戸・出雲の空席状況を監視するCLIツールです。

## 機能

- リアルタイムでの空席状況監視
- Discord Webhook通知対応
- 音声通知対応
- systemdサービスとしてのバックグラウンド実行

## デプロイ

### 1. 手動デプロイ

```bash
# リポジトリをクローン
git clone <repository-url>
cd sunrise-reserve

# 依存関係のインストール
bun install

# Playwrightブラウザのインストール
npx playwright install chromium

# アプリケーションの実行
bun start
```

### 2. サービスとしてデプロイ

```bash
# デプロイスクリプトを実行（要root権限）
bun run deploy
```

デプロイスクリプトは以下の処理を自動実行します：

1. 型チェックとビルド
2. 既存サービスの停止
3. `/opt/sunrise-reserve`へのファイルコピー
4. 依存関係のインストール
5. systemdサービスの登録・開始

## サービス管理

```bash
# サービス状態確認
bun run service:status

# ログ確認
bun run service:logs

# サービス停止
bun run service:stop

# サービス開始
bun run service:start

# サービス再起動
bun run service:restart
```

## 開発

```bash
# 型チェック
bun run typecheck

# テスト実行
bun test

# ビルド
bun run build
```

## 設定

初回実行時に対話形式で設定を行います：

- 出発駅・到着駅
- 監視対象の部屋タイプ
- 通知方法（音声/Discord）
- Discord Webhook URL（Discord通知の場合）

設定は`settings.json`に保存されます。
