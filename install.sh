#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.local/share/bili-clipper"
PLIST_LABEL="com.bili-clipper.server"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Bili Clipper — 安装本地服务 ==="

if [[ "$(uname)" != "Darwin" ]]; then
  echo "❌ 仅支持 macOS" && exit 1
fi

PYTHON=$(command -v python3.11 2>/dev/null || command -v python3 2>/dev/null || true)
if [[ -z "$PYTHON" ]]; then
  echo "❌ 未找到 Python 3.11+，请先安装: brew install python@3.11"
  exit 1
fi
PYVER=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
REQ="3.11"
if [[ "$(printf '%s\n' "$REQ" "$PYVER" | sort -V | head -1)" != "$REQ" ]]; then
  echo "❌ Python ${PYVER} < 3.11" && exit 1
fi
echo "✓ Python ${PYVER}"

if ! command -v uv &>/dev/null; then
  echo "→ 安装 uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
fi
echo "✓ uv $(uv --version)"

mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/server/"*.py "$INSTALL_DIR/"
cp "$SCRIPT_DIR/server/requirements.txt" "$INSTALL_DIR/"
echo "✓ 服务文件已复制到 $INSTALL_DIR"

echo "→ 安装 Python 依赖（首次约 2 分钟）..."
uv venv --python "$PYTHON" "$INSTALL_DIR/.venv" 2>/dev/null || true
uv pip install -r "$INSTALL_DIR/requirements.txt" \
   --python "$INSTALL_DIR/.venv/bin/python" -q
echo "✓ 依赖安装完成"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key>           <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_DIR}/.venv/bin/python</string>
    <string>${INSTALL_DIR}/server.py</string>
  </array>
  <key>WorkingDirectory</key> <string>${INSTALL_DIR}</string>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <true/>
  <key>StandardOutPath</key>  <string>${INSTALL_DIR}/server.log</string>
  <key>StandardErrorPath</key><string>${INSTALL_DIR}/server.log</string>
</dict></plist>
PLIST

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
echo "✓ 服务已注册为开机自启"

echo "→ 等待服务启动..."
sleep 3
if curl -sf http://localhost:27182/health > /dev/null 2>&1; then
  echo "✓ 服务运行中 → http://localhost:27182"
else
  echo "⚠ 服务可能还在下载 Whisper 模型，请稍候片刻再试"
  echo "  查看日志: tail -f ${INSTALL_DIR}/server.log"
fi

echo ""
echo "=== 安装完成 ✓ ==="
echo ""
echo "下一步: 在 Chrome 加载扩展"
echo "  chrome://extensions → 开发者模式 → 加载已解压 → 选择 extension/ 文件夹"
