#!/bin/bash
# 双击后构建并启动本机阅读器，已经启动时直接打开页面。
set -e
export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo '请先安装 Node.js 22.13 或更高版本。'
  read -r -p '按回车关闭…'
  exit 1
fi
if node --input-type=module -e 'const r=await fetch("http://127.0.0.1:4317/api/status").catch(()=>null);process.exit(r && (await r.json()).app === "paper-study" ? 0 : 1)' 2>/dev/null; then
  open 'http://127.0.0.1:4317'
  exit 0
fi
if [ ! -d node_modules ]; then npm ci --no-fund --no-audit; fi
npm run build
mkdir -p .runtime
node scripts/start-server.mjs
for attempt in $(seq 1 30); do
  if node --input-type=module -e 'const r=await fetch("http://127.0.0.1:4317/api/status").catch(()=>null);process.exit(r && (await r.json()).app === "paper-study" ? 0 : 1)' 2>/dev/null; then
    open 'http://127.0.0.1:4317'
    echo '知页已启动。可以关闭此终端窗口。'
    exit 0
  fi
  sleep 1
done
echo '启动失败，请查看 .runtime/server.log，确认 4317 端口是否被占用。'
read -r -p '按回车关闭…'
exit 1
