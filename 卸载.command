#!/bin/bash
# ============================================================
# Job Copilot 卸载(双击运行)
# 停止并移除开机自启的后台服务、删除全局 job 命令。
# 不会动你的任何数据(data/ 目录原样保留)。
# ============================================================
set -u

LABEL="com.superjob.serve"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "🟢 后台服务已停止" || echo "ℹ️  后台服务本来就没在运行"
if [ -f "$PLIST" ]; then
  rm -f "$PLIST"
  echo "🟢 已移除开机自启项"
fi

# 只删除本安装器写入的、且指向本项目 cli.js 的 job 包装命令,不误删同名工具
for d in /opt/homebrew/bin /usr/local/bin "$HOME/bin"; do
  if [ -f "$d/job" ] && grep -qs "managed-by: superjob" "$d/job" && grep -qs "superjob/src/cli.js" "$d/job"; then
    rm -f "$d/job"
    echo "🟢 已移除全局命令: $d/job"
  fi
done

echo ""
echo "✅ 卸载完成。数据都还在 data/ 目录里;想再用时双击「安装.command」即可。"
read -r -p "按回车关闭窗口..." _
