# Project Notes for Claude

## Dev servers (frontend :5173, backend :4002)

- **Never try to "start the dev server" and keep it running from your own shell as the deliverable.** Any long-running process you spawn dies when your tool call / session ends, and `localhost` inside your sandbox is not the user's `localhost` — so a "running" server you verify with curl will still be gone (or unreachable) by the time the user opens the app. This is the root cause of the dev server "failing every time" in previous sessions.
- To run the dev environment, tell the user to run `./dev.sh` (repo root) in **their own Mac terminal**. That script starts both servers and Ctrl+C stops both. Do not run `./dev.sh` yourself as a background process expecting it to persist.
- If you must run a server inside your own shell for a quick check (e.g., verifying a route or a compile):
  - Start it, verify, and explicitly say it is only alive for the duration of that shell and will not persist.
  - Frontend note: `frontend/node_modules` was installed on macOS (contains `@rollup/rollup-darwin-arm64`). Inside a Linux sandbox this fails with `Cannot find module '@rollup/rollup-linux-arm64-gnu'`. Fix in-sandbox only: `cd frontend && rm -rf node_modules && npm install` so the correct native Rollup binaries are fetched for the sandbox platform. Do not delete the user's Mac `node_modules` while working on their Mac.
- Backend notes: `npm run dev` = `ts-node-dev` watching `src/index.ts` on port 4002; it connects to Postgres via `backend/.env` (`DATABASE_URL`). A warning `[managed] WALLET_ENCRYPTION_KEY missing` at startup is expected — managed routes return 503 in that state, it is not a crash.
