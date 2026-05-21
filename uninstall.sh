#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.local/share/bili-clipper"
PLIST_LABEL="com.bili-clipper.server"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

echo "=== Bili Clipper — 卸载 ==="

launchctl unload "$PLIST_PATH" 2>/dev/null && echo "✓ 服务已停止" || true
rm -f "$PLIST_PATH" && echo "✓ launchd plist 已删除"
rm -rf "$INSTALL_DIR" && echo "✓ 安装目录已删除"

echo "卸载完成。Chrome 扩展请在 chrome://extensions 手动移除。"
