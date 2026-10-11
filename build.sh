#!/bin/bash
# 打包静态产物（Cloudflare Pages 构建用；本地也能跑，产物在 dist/）
# 只挑站点真正需要的文件：三个 HTML + assets/ + _shared/（echarts、字体）
set -eu
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist
cp -r *.html _shared assets dist/
echo "dist 内容:"; ls -1 dist
