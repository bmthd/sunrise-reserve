#!/bin/bash

# Sunrise Reserve デプロイスクリプト
# 使用方法: ./deploy.sh

set -e

echo "==================================="
echo "Sunrise Reserve デプロイ開始"
echo "==================================="

# 色付きログ用の関数
log_info() {
    echo -e "\033[32m[INFO]\033[0m $1"
}

log_warn() {
    echo -e "\033[33m[WARN]\033[0m $1"
}

log_error() {
    echo -e "\033[31m[ERROR]\033[0m $1"
}

# 現在のディレクトリを確認
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="sunrise-reserve"
INSTALL_DIR="/opt/${PROJECT_NAME}"
SERVICE_NAME="${PROJECT_NAME}.service"

log_info "現在のディレクトリ: $SCRIPT_DIR"
log_info "インストール先: $INSTALL_DIR"

# rootユーザーで実行されているかチェック
if [[ $EUID -ne 0 ]]; then
   log_error "このスクリプトはrootユーザーで実行してください"
   log_info "使用方法: sudo ./deploy.sh"
   exit 1
fi

# 1. 型チェック
log_info "型チェックを実行中..."
if ! sudo -u ubuntu bun run typecheck; then
    log_error "型チェックに失敗しました"
    exit 1
fi

# 2. ビルド
log_info "プロジェクトをビルド中..."
if ! sudo -u ubuntu bun run build; then
    log_error "ビルドに失敗しました"
    exit 1
fi

# 3. サービス停止
if systemctl is-active --quiet $SERVICE_NAME; then
    log_warn "既存のサービスを停止中..."
    systemctl stop $SERVICE_NAME
fi

# 4. インストールディレクトリの準備
log_info "インストールディレクトリを準備中..."
if [ -d "$INSTALL_DIR" ]; then
    log_warn "既存のインストールをバックアップ中..."
    mv "$INSTALL_DIR" "${INSTALL_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
fi

mkdir -p "$INSTALL_DIR"

# 5. ファイルのコピー
log_info "アプリケーションファイルをコピー中..."
cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/"

# 6. 権限設定
log_info "権限を設定中..."
chown -R ubuntu:ubuntu "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/deploy.sh"

# 7. 依存関係のインストール
log_info "依存関係をインストール中..."
cd "$INSTALL_DIR"
sudo -u ubuntu bun install --production

# 8. Playwrightブラウザのインストール
log_info "Playwrightブラウザをインストール中..."
sudo -u ubuntu npx playwright install chromium

# 9. systemdサービスファイルのインストール
log_info "systemdサービスを登録中..."
cp "$INSTALL_DIR/$SERVICE_NAME" "/etc/systemd/system/$SERVICE_NAME"

# 10. systemd設定をリロード
log_info "systemd設定をリロード中..."
systemctl daemon-reload

# 11. サービスを有効化
log_info "サービスを有効化中..."
systemctl enable $SERVICE_NAME

# 12. サービス開始
log_info "サービスを開始中..."
if systemctl start $SERVICE_NAME; then
    log_info "サービスが正常に開始されました"
else
    log_error "サービスの開始に失敗しました"
    log_info "ログを確認してください: journalctl -u $SERVICE_NAME"
    exit 1
fi

# 13. サービス状態確認
sleep 3
if systemctl is-active --quiet $SERVICE_NAME; then
    log_info "✅ デプロイが正常に完了しました"
    echo ""
    echo "==================================="
    echo "サービス管理コマンド:"
    echo "  状態確認: sudo systemctl status $SERVICE_NAME"
    echo "  ログ確認: sudo journalctl -u $SERVICE_NAME -f"
    echo "  停止:     sudo systemctl stop $SERVICE_NAME"
    echo "  開始:     sudo systemctl start $SERVICE_NAME"
    echo "  再起動:   sudo systemctl restart $SERVICE_NAME"
    echo "==================================="
else
    log_error "サービスが正常に動作していません"
    log_info "ログを確認してください: journalctl -u $SERVICE_NAME"
    exit 1
fi