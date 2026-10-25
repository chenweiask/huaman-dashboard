#!/bin/bash
# 花满天下仪表盘：拉飞书数据 → 重建 → push GitHub（Pages 自动部署）
# 跨机可用：J4125（cron，每小时 :25）与 Mac（launchd）都能跑。
# 数据无变化时不提交（fetch_and_build 返回 2）。日志: scripts/update.log
set -u
if [ -d /opt/homebrew/bin ]; then export PATH="/opt/homebrew/bin:$PATH"; fi
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

notify() {   # 机器无关的告警：Mac 弹系统通知，Linux 走 hermes send（飞书>微信>TG）
  if [ "$(uname)" = "Darwin" ]; then
    osascript -e "display notification \"$2\" with title \"$1\" sound name \"Basso\"" 2>/dev/null
  else
    scripts/notify.sh "$1" "$2" >>"$DIR/scripts/notify.log" 2>&1
  fi
}

log "===== 开始更新 ====="

# GitHub 是唯一真源：先同步远端（本地临时改动自动 stash，防止定时任务卡死）
if ! timeout 45 git pull --rebase --autostash -q origin main; then
  log "pull 失败（网络/凭据），改用本地版本继续"
  git rebase --abort 2>/dev/null
fi

OUT="$(python3 scripts/fetch_and_build.py 2>&1)"; rc=$?
echo "$OUT"
# 数据自检告警（人数突降等）：同一条告警只推一次，避免每小时刷屏
WARN="$(echo "$OUT" | grep '^WARN' | head -1)"
if [ -n "$WARN" ]; then
  STAMP="$DIR/scripts/.warn-notified"
  if [ "$(cat "$STAMP" 2>/dev/null)" != "$WARN" ]; then
    printf '%s' "$WARN" > "$STAMP"
    log "⚠️ $WARN"
    notify "仪表盘数据异常" "$WARN"
  fi
else
  rm -f "$DIR/scripts/.warn-notified"
fi
if [ $rc -eq 1 ]; then
  log "拉取/构建失败，终止"
  notify "仪表盘更新失败" "$(echo "$OUT" | tail -3 | tr '\n' ' ')"
  exit 1
fi
if [ $rc -eq 2 ]; then
  log "数据无变化，跳过提交"
  exit 0
fi

DATA_DATE="$(echo "$OUT" | sed -n 's/^UPDATED 截至 \([0-9/]*\).*/\1/p' | tail -1)"
[ -n "$DATA_DATE" ] || DATA_DATE="$(date '+%Y/%m/%d')"

cp -f huaman-dashboard.html index.html      # Pages 入口与主页面保持一致
git add -A
if git diff --cached --quiet; then
  log "无文件变化，跳过提交"
  exit 0
fi
if ! git commit -q -m "data: 更新至 ${DATA_DATE}"; then
  log "提交失败（多半是 git user.name/user.email 没配）"
  notify "仪表盘提交失败" "git commit 失败，检查仓库的 git 身份配置"
  exit 1
fi
PUSH_OK=0
for i in 1 2 3; do
  if timeout 45 git push -q origin main; then PUSH_OK=1; break; fi
  log "推送失败（第 ${i} 次）"
  [ $i -lt 3 ] && sleep $((i * 20))
done
if [ $PUSH_OK -eq 1 ]; then
  log "推送成功（数据截至 ${DATA_DATE}），GitHub Pages 约 1 分钟后生效"
  rm -f "$DIR/scripts/.pushfail-notified"
else
  log "推送失败（已重试 3 次）"
  # 同一个故障每天只提醒一次，避免每小时刷屏
  STAMP="$DIR/scripts/.pushfail-notified"
  TODAY="$(date '+%F')"
  if [ "$(cat "$STAMP" 2>/dev/null)" != "$TODAY" ]; then
    printf '%s' "$TODAY" > "$STAMP"
    notify "仪表盘推送失败" "已提交但推送失败（github.com:443 连不上），本地已累积待推送提交"
  else
    log "今日已提醒过，不再重复推送告警"
  fi
  exit 1
fi
