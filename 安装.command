#!/bin/bash
# ============================================================
# Job Copilot 一键安装(双击运行,重复运行安全)
#
# 做三件事:
#   1. 注册 macOS 开机自启后台服务(launchd),以后不用再跑 node src/cli.js serve
#   2. 安装全局 job 命令,终端里 `job list` 即可(替代 node src/cli.js list)
#   3. 启动服务并打开浏览器面板
#
# 换了 Node 版本、挪了项目目录、或服务出问题时,重新双击本脚本即可修复。
# ============================================================
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.superjob.serve"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${SUPERJOB_PORT:-8787}"

finish() { echo ""; read -r -p "按回车关闭窗口..." _; exit "${1:-0}"; }

echo "📁 项目目录: $DIR"

# ---------- 1) 定位 node(走登录 shell,兼容 nvm / homebrew) ----------
NODE="$(/bin/zsh -l -c 'command -v node' 2>/dev/null | tail -1 || true)"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$c" ] && NODE="$c" && break
  done
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "❌ 找不到 node。请先安装 Node.js(brew install node 或 https://nodejs.org),再重新双击本脚本"
  finish 1
fi
echo "🟢 使用 node: $NODE ($("$NODE" -v))"

# ---------- 2) 依赖与 .env 检查 ----------
if [ ! -d "$DIR/node_modules" ]; then
  echo "📦 首次安装依赖中..."
  NPM="$(dirname "$NODE")/npm"
  [ -x "$NPM" ] || NPM="npm"
  ( cd "$DIR" && "$NPM" install ) || { echo "❌ npm install 失败"; finish 1; }
fi
if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  echo "⚠️  还没有 .env。已为你创建,请在打开的文件里填 LLM_PROVIDER、LLM_MODEL 和对应 API key,保存后重新双击本脚本"
  open -t "$DIR/.env" 2>/dev/null || true
  finish 1
fi

# ---------- 3) 写 LaunchAgent(开机自启 + 崩溃自动拉起) ----------
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/data"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/src/cli.js</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$DIR/data/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/server.log</string>
</dict>
</plist>
EOF

# 先卸旧再装新(改过 node 路径/端口也能生效)
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 1
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
  launchctl load "$PLIST" 2>/dev/null || true
fi

# ---------- 4) 安装全局 job 命令 ----------
BIN=""
for d in /opt/homebrew/bin /usr/local/bin "$HOME/bin"; do
  [ -d "$d" ] && [ -w "$d" ] && BIN="$d" && break
done
if [ -z "$BIN" ]; then mkdir -p "$HOME/bin"; BIN="$HOME/bin"; fi
cat > "$BIN/job" <<EOF
#!/bin/sh
# Job Copilot CLI 包装(由 安装.command 生成)
exec "$NODE" "$DIR/src/cli.js" "\$@"
EOF
chmod +x "$BIN/job"
echo "🟢 全局命令已装好: $BIN/job(终端里直接 job list / job gen <id> / job show <id>)"
if [ "$BIN" = "$HOME/bin" ]; then
  if ! grep -qs 'export PATH="$HOME/bin:$PATH"' "$HOME/.zshrc"; then
    echo 'export PATH="$HOME/bin:$PATH"' >> "$HOME/.zshrc"
    echo "   (已把 ~/bin 加入 PATH,新开的终端窗口生效)"
  fi
fi

# ---------- 5) 等服务起来,打开面板 ----------
printf "⏳ 等待服务启动"
OK=""
for _ in $(seq 1 20); do
  if curl -s --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then OK=1; break; fi
  printf "."; sleep 0.5
done
echo ""
if [ -n "$OK" ]; then
  echo "✅ 全部完成!服务已在后台运行:开机自动启动,崩溃自动拉起,以后不用再碰终端。"
  echo "   📊 面板:  http://127.0.0.1:$PORT/"
  echo "   🧩 抓取:  招聘页上点 Chrome 扩展图标即可"
  echo "   📜 日志:  $DIR/data/server.log"
  open "http://127.0.0.1:$PORT/" 2>/dev/null || true
else
  echo "⚠️  服务没有响应,最近的日志如下(常见原因:.env 里 API key 没填、端口被占):"
  tail -20 "$DIR/data/server.log" 2>/dev/null || echo "   (暂无日志)"
fi
finish 0
