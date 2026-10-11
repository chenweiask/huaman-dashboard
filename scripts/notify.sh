#!/bin/bash
# 推送一条消息给用户：飞书 > 微信 > Telegram（飞书是唯一能无会话主动推送的通道）
# 用法: notify.sh "标题" "正文"
TITLE="${1:-通知}"; BODY="${2:-}"
HERMES="$HOME/.local/bin/hermes"
for T in feishu weixin telegram; do
  if "$HERMES" send -t "$T" -s "$TITLE" "$BODY" >/dev/null 2>&1; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') notify -> $T"
    exit 0
  fi
done
echo "$(date '+%Y-%m-%d %H:%M:%S') notify: 所有通道均失败"
exit 1
