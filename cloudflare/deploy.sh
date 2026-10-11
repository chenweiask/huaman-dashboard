#!/bin/bash
# 把 cloudflare/worker.js 部署成 Worker 并绑定自定义域（国内可直连的镜像）
# 用法: CLOUDFLARE_API_TOKEN=xxx CF_ACCOUNT_ID=xxx CF_ZONE_ID=xxx bash cloudflare/deploy.sh
#   自定义域由 API 自动建 DNS 记录，不需要手动加 CNAME。
#   token 权限：Account → Workers Scripts:Edit；Zone → Workers Routes:Edit + Zone:Read + DNS:Edit
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
: "${CLOUDFLARE_API_TOKEN:?需要 CLOUDFLARE_API_TOKEN}"
NAME="${WORKER_NAME:-huaman-dashboard}"
HOST="${WORKER_HOST:-huaman.myhub.site}"
API=https://api.cloudflare.com/client/v4

api() { curl -s -m 60 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$@"; }

if [ -z "${CF_ACCOUNT_ID:-}" ]; then
  CF_ACCOUNT_ID="$(api "$API/accounts" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["result"][0]["id"] if d.get("result") else (_ for _ in ()).throw(SystemExit("取不到账号: %s"%d.get("errors"))))')"
fi
echo "account=$CF_ACCOUNT_ID worker=$NAME host=$HOST"

# 1) 上传脚本（module 格式：main_module + export default）
printf '{"main_module":"worker.js","compatibility_date":"2024-10-01"}' > /tmp/cf_meta.json
api -X PUT "$API/accounts/$CF_ACCOUNT_ID/workers/scripts/$NAME" \
  -F "metadata=@/tmp/cf_meta.json;type=application/json" \
  -F "worker.js=@$DIR/worker.js;type=application/javascript+module" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("upload:", "OK" if d.get("success") else d.get("errors"))'

# 2) 绑定自定义域（zone 自动探测；DNS 记录由 CF 自动创建）
if [ -z "${CF_ZONE_ID:-}" ]; then
  ZONE="${HOST#*.}"
  CF_ZONE_ID="$(api "$API/zones?name=$ZONE" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["result"][0]["id"] if d.get("result") else "")')"
fi
[ -n "$CF_ZONE_ID" ] || { echo "找不到 zone，请显式传 CF_ZONE_ID"; exit 1; }
api -X POST "$API/accounts/$CF_ACCOUNT_ID/workers/domains" \
  -H "Content-Type: application/json" \
  -d "{\"zone_id\":\"$CF_ZONE_ID\",\"hostname\":\"$HOST\",\"service\":\"$NAME\",\"environment\":\"production\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d.get("result") or {};print("domain:", r.get("hostname"), "| OK" if d.get("success") else d.get("errors"))'
echo "完成。证书签发后访问 https://$HOST/"
