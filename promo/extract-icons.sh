#!/bin/sh
# 从本机安装的桌面端 app 里取图标给宣传片用。
# 图标是各家的商标，不进仓库（promo/assets/ 在 .gitignore 里），每台机器自己提取。
set -e
cd "$(dirname "$0")"
mkdir -p assets

take() { # take <icns 路径> <输出名>
  if [ -f "$1" ]; then
    sips -s format png "$1" --resampleWidth 256 --out "assets/$2" >/dev/null
    echo "✓ $2"
  else
    echo "✕ 找不到 $1" >&2
    missing=1
  fi
}

take "/Applications/Claude.app/Contents/Resources/electron.icns" claude.png
take "/Applications/ChatGPT.app/Contents/Resources/app.icns"     codex.png
take "/Applications/WorkBuddy.app/Contents/Resources/icon.icns"  workbuddy.png

[ -z "$missing" ] || exit 1
