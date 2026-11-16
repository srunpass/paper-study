#!/bin/bash
# 只停止由本项目启动且命令路径匹配的服务，保留全部学习资料。
set -e
cd "$(dirname "$0")"
if [ ! -f .runtime/server.pid ]; then
  echo '没有找到启动记录。如果通过 npm start 启动，请在对应终端按 Ctrl+C。'
  exit 0
fi
paper_pid="$(cat .runtime/server.pid)"
case "$paper_pid" in ''|*[!0-9]*) echo '启动记录无效，未停止任何进程。'; exit 1 ;; esac
paper_command="$(ps -p "$paper_pid" -o command= || true)"
case "$paper_command" in
  *"$PWD/server/index.ts"*) kill "$paper_pid"; echo '知页服务已停止，学习资料仍保存在浏览器中。' ;;
  *) echo '该服务已停止，未操作其他进程。' ;;
esac
