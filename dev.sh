#!/usr/bin/env bash
# Start both dev servers (frontend :5173, backend :4002) in one command.
# Run this in your own terminal on the Mac — Claude's sandbox shell
# can't keep servers alive between calls, and its localhost isn't yours.
set -euo pipefail
cd "$(dirname "$0")"

frontend_pid=""
backend_pid=""

# Kill a process tree (children first) with the given signal.
kill_tree() {
  local signal="$1" pid="$2" children c
  [ -n "$pid" ] || return 0
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for c in $children; do
    kill_tree "$signal" "$c"
  done
  kill -s "$signal" "$pid" 2>/dev/null || true
}

cleanup() {
  echo
  echo "[dev] shutting down both servers..."
  kill_tree TERM "${backend_pid}"
  kill_tree TERM "${frontend_pid}"
  kill 0 2>/dev/null || true
  sleep 1
  # Force-kill anything that survived the TERM pass.
  kill_tree KILL "${backend_pid}"
  kill_tree KILL "${frontend_pid}"
}
trap cleanup EXIT INT TERM

echo "[dev] starting frontend (vite) on http://localhost:5173"
(cd frontend && exec npm run dev) &
frontend_pid=$!

echo "[dev] starting backend on http://localhost:4002"
(cd backend && exec npm run dev) &
backend_pid=$!

wait
