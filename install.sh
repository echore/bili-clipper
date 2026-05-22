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

FFMPEG_BIN=$(command -v ffmpeg 2>/dev/null || true)
if [[ -z "$FFMPEG_BIN" ]]; then
  if command -v brew &>/dev/null; then
    echo "→ 安装 ffmpeg（yt-dlp 音频转码依赖）..."
    brew install ffmpeg -q
    FFMPEG_BIN=$(command -v ffmpeg)
  else
    echo "❌ 未找到 ffmpeg，请手动安装: brew install ffmpeg" && exit 1
  fi
fi
FFMPEG_DIR="$(dirname "$FFMPEG_BIN")"
echo "✓ ffmpeg ${FFMPEG_BIN}"

mkdir -p "$INSTALL_DIR"
echo "✓ 依赖目录: $INSTALL_DIR"

echo "→ 安装 Python 依赖（首次约 2 分钟）..."
uv venv --python "$PYTHON" "$INSTALL_DIR/.venv" 2>/dev/null || true
uv pip install -r "$SCRIPT_DIR/server/requirements.txt" \
   --python "$INSTALL_DIR/.venv/bin/python" -q
echo "✓ 依赖安装完成"

# Deploy server files to non-TCC path (launchd cannot read ~/Documents)
echo "→ 部署服务文件..."
cp "$SCRIPT_DIR/server/server.py" "$INSTALL_DIR/server.py"
cp "$SCRIPT_DIR/server/writer.py" "$INSTALL_DIR/writer.py"
cp "$SCRIPT_DIR/server/transcriber.py" "$INSTALL_DIR/transcriber.py"
echo "✓ 服务文件已部署到 $INSTALL_DIR"
echo "  （更新代码后重新运行 install.sh 以部署最新版本）"

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
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${FFMPEG_DIR}:${INSTALL_DIR}/.venv/bin:/usr/bin:/bin</string>
  </dict>
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
echo "【必须】配置 Obsidian Local REST API 插件："
echo "  1. 打开 Obsidian → 设置 → 社区插件 → 浏览"
echo "  2. 搜索 'Local REST API'，安装并启用"
echo "  3. 在插件设置中复制 API Key"
echo "  4. 打开 Bili Clipper 扩展弹窗，粘贴 API Key"
echo ""
echo "加载 Chrome 扩展："
echo "  chrome://extensions → 开发者模式 → 加载已解压 → 选择 extension/ 文件夹"
