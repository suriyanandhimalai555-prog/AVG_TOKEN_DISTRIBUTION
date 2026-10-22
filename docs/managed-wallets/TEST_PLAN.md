# Managed Wallets — Test plan (N8 QA)

Maps every acceptance criterion of `docs/MANAGED_WALLETS_SPEC.md` §9 to the automated test that proves it or to a numbered manual step with exact commands, lists the flag-off regression checklist for the existing wizard, the curl checks proving the HTTP surface is unchanged with the flag off, and the results of everything that was executable on 2026-10-21.

Conventions: `backend/test/managed/<file>.test.ts › <describe> › <case>`. Commands run from the repo root unless stated. Nothing below touches the `DATABASE_URL` in `backend/.env`; DB-backed tests use the throwaway Postgres `postgres://postgres:test@localhost:55432/managed_test?sslmode=disable` (container `managed-pg-test`).

---

## 0. Gate commands

```bash
cd backend  && npx tsc --noEmit -p tsconfig.json
cd backend  && npm test                         # vitest run, whole suite
cd backend  && npm run build                    # tsc -p tsconfig.build.json → dist/
cd frontend && npx tsc --noEmit
cd frontend && npm run build                    # tsc + vite build + scripts/verify-build.mjs
```

Test files (owner in brackets):

| File | Owner | What it proves |
|---|---|---|
| `keyVault.test.ts`, `derive.test.ts`, `redact.test.ts` | N2 | AES-256-GCM vault, BIP-44 derivation against Hardhat vectors, redaction primitives |
| `transferPlanner.test.ts`, `indexer.test.ts`, `transferWorker.test.ts` | N3 | planner rules, log scanning / balance refresh, worker state machine incl. restart recovery |
| `api.test.ts` | N5 | guard chain, flag, key vault, re-auth, pool/wallet creation, view route, rate limit |
| `services.test.ts` | N8 | treasury math, CSV export, view shape, wallet list shape (SR-04), sweep enumeration, audits |
| `transfers.test.ts` | N8 | retry rules, idempotent `POST /transfers`, retry route, re-auth guard, 409s |
| `logging.test.ts` | N8 | redaction at every managed log call site (dynamic + static scan) |
| `flagOff.test.ts` | N8 | R3: nothing mounted / started / logged unless `MANAGED_WALLETS_ENABLED === "true"` |
| `migrate.test.ts` | N8 | `migrate.ts` re-run is a no-op |
| `helpers/fixtures.ts` | N8 | shared fixtures (random addresses, never Hardhat accounts) |

---

## 1. Acceptance criteria → proof

| # | Criterion (SPEC §9) | Automated proof | Manual proof |
|---|---|---|---|
| 1 | Pool created on bscTestnet; master = account 1 of the revealed phrase in MetaMask | `derive.test.ts` (master/children match Hardhat vectors for `test … junk`); `api.test.ts › against the throwaway database › POST /pools imports the Hardhat mnemonic and derives account 0 as master` | M1 |
| 2 | 100 wallets = `deriveChild(i)` for i = 1…100; no key or plaintext mnemonic in DB, disk, logs or any response except reveal | `derive.test.ts` (child i addresses); `api.test.ts › POST /pools/:id/wallets/generate derives indexes 1..3`; `keyVault.test.ts` (ciphertext only, AAD = pool id); `services.test.ts › pool records never carry the ciphertext columns`; `services.test.ts › CSV export › … no secret in any cell`; `logging.test.ts` (both describes) | M2 (100 wallets, DB grep, log grep) |
| 3 | tBNB + BEP-20 deposit appears in Deposits, wallet row, Treasury and holder view within two indexer cycles; BNB as balance change | `indexer.test.ts` (log → deposit rows, balance refresh); `services.test.ts › treasury aggregation › *`; `services.test.ts › public view shape › returns only the documented keys…` (deposit + balances surface from stored rows) | M3 (`testnet-e2e.ts` steps 5–6) |
| 4 | Wallet View works logged out, no send control, no pool name / index / other addresses; 256-bit token; rate limited | `api.test.ts › GET /api/view/:token returns the public shape only`, `… rate limits the public view per MANAGED_VIEW_RATE_LIMIT_PER_MIN`, `… 404 for unknown and malformed tokens`; `services.test.ts › public view shape › *` (exact key set, hidden token and other wallets excluded, 404 for DISABLED wallet and ARCHIVED pool); token = 32 random bytes (`models/wallets.ts › newViewToken`), `services.test.ts › wallet list and detail shape › *` (token only on the detail route, SR-04) | M4 (visual: no send control) |
| 5 | Transfer from a 0-BNB wallet: review shows top-up; `FUNDING_GAS → SENDING → CONFIRMED`; both hashes stored and linked; balances refresh | `transferPlanner.test.ts` (top-up amount, master reserve); `transferWorker.test.ts` (state machine, hashes persisted); `transfers.test.ts › retry rules › TIMEOUT …` / `REVERTED …` (hash retention rules) | M5 (`testnet-e2e.ts` step 7 prints both hashes and the status chain) |
| 6 | Sweeping 10 wallets = 10 jobs in one batch; one failing job does not block the others | `services.test.ts › sweep enumeration › *` (one batch id, one job per non-zero ACTIVE/visible pair, idempotent); `transferWorker.test.ts` (per-job failure isolation, one job at a time) | M6 |
| 7 | Non-admin → 403 on every `/api/admin/managed/*`; flag off → 404 and no nav | `api.test.ts › feature flag and guards › *`; `flagOff.test.ts › *` (10 off-values, zero logs, workers inert); flag-off boot §3 below | M7 (nav) |
| 8 | Flag off: existing wizard behaves exactly as before; typechecks and builds green | §0 gate results (§4) and §3 curl checks | M8 (wizard checklist §2) |
| 9 | Kill backend while `SENDING`, restart: worker finds the receipt, marks `CONFIRMED`, no re-broadcast | `transferWorker.test.ts` (interrupted-job recovery via `listInterrupted` + receipt check); `transfers.test.ts › retry rules › TIMEOUT …` (hash kept so the receipt is checked before any broadcast) | M9 |
| 10 | Every admin action appears in `managed_audits` with the acting user id | `services.test.ts › CSV export › writes an EXPORT_DOWNLOADED audit with the acting user id`, `… sweep enumeration › records SWEEP_REQUESTED audits …`; `transfers.test.ts › retry rules › records TRANSFER_RETRIED audits …`; `api.test.ts` cleanup relies on `POOL_CREATED`/`WALLETS_GENERATED` rows per user | M10 (SQL after the e2e run) |

### Manual steps

Prerequisites for all manual steps: a backend running with `MANAGED_WALLETS_ENABLED=true`, a valid `WALLET_ENCRYPTION_KEY` (`cd backend && npm run -s managed:gen-key`), migrations applied (see §5), `MANAGED_INDEXER_ENABLED` unset, `BSC_TESTNET_RPC_URL` set, and an ADMIN user with a password. A throwaway funded testnet key (`E2E_FUNDER_PRIVATE_KEY`) and a test token (`E2E_TOKEN_ADDRESS`) are needed for M3/M5.

- **M1** — In the admin UI (Managed → New pool, bscTestnet) create a pool, note the master address, click *Reveal phrase* (re-auth). In MetaMask: *Import wallet* with the phrase; the first account shown must equal the master address. Observe: `managed_audits` has `POOL_CREATED` and `MNEMONIC_REVEALED` for your user id.
- **M2** — Generate 100 wallets with prefix `m-`. Export the CSV; the `index` column is 1…100. Spot-check three addresses with `scripts/recover-hd-wallets.ts`-style derivation or MetaMask *Add account* (accounts 2, 3, … of the imported phrase equal indexes 1, 2, …). Then:
  ```bash
  # no plaintext mnemonic / key anywhere in the DB (adjust the connection string; read-only)
  psql "$THROWAWAY_URL" -c "SELECT count(*) FROM managed_pools WHERE mnemonic_ciphertext ~ '^[a-z]+( [a-z]+){11}$'"   # 0
  grep -rEn "([a-z]+ ){11}[a-z]+|0x[0-9a-fA-F]{64}" <backend log file> | grep -v "tx/" ; echo "exit $?"            # exit 1 (no match)
  ```
- **M3 / M5** — run the e2e script (it refuses mainnet and never prints secrets):
  ```bash
  cd backend
  # once, to get a test BEP-20 (existing script; mints to the deployer = funder key):
  PRIVATE_KEY=<funder key> npm run deploy:token            # prints "ABCToken deployed to: 0x…"
  E2E_NETWORK=bscTestnet E2E_FUNDER_PRIVATE_KEY=0x… E2E_TOKEN_ADDRESS=0x… \
  E2E_API_URL=http://localhost:4000 E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… \
  E2E_AUTO_FUND_MASTER=0.01 \
  npx ts-node scripts/managed/testnet-e2e.ts
  ```
  Observe: pool + 3 wallets created; both funding tx links; `indexer lag` lines shrinking; `deposit indexed: 5 ABC …`; `public view HTTP 200: 1 token(s) visible`; `plan ok: … topUpWei=<non-zero>`; status chain `PENDING → FUNDING_GAS → SENDING → CONFIRMED`; two explorer links; final `wallet 1 after: 0 ABC …`; exit 0. Criterion 3 (BNB as a balance change): the wallet row shows the tBNB balance but no native deposit row (stated in the UI).
- **M4** — Open the printed holder view URL in a private window. Observe: balances and deposits, no send button, no pool name, no index, no other address; page title is the label only. `curl -s -o /dev/null -w "%{http_code}\n" <API>/api/view/<token>` ×(limit+1) within a minute → last answer 429.
- **M6** — With ≥ 10 funded wallets: Pool → *Sweep* (walletIds ALL, assets ALL). Observe `SweepResponse.jobs` = number of non-zero pairs under one `batchId`; set one job's `to_address` to a reverting contract **before** the worker picks it (or hide the token so the planner rejects it); the other jobs still reach `CONFIRMED`, the one job is `FAILED` with `errorCode REVERTED`, and *Retry* is offered.
- **M7** — Log in as a non-admin: every `/api/admin/managed/*` request → `403 {"error":"Forbidden"}`; the sidebar shows no MANAGED / TREASURY entries. Restart with the flag off: an ADMIN gets `404 {"error":"Route not found"}` and the sidebar shows no entries.
- **M8** — wizard checklist, §2.
- **M9** — Start a transfer whose confirmation takes a few blocks; when the job row shows `SENDING` with `transfer_tx_hash` set, `kill -TERM <backend pid>`; restart. Observe log `[managed] … recovering interrupted job …` (no new broadcast: `eth_sendRawTransaction` absent from RPC logs after restart), job → `CONFIRMED`, `attempts` unchanged, the same `transfer_tx_hash`.
- **M10** — after M3/M5:
  ```sql
  SELECT action, user_id, wallet_id IS NOT NULL AS has_wallet, created_at
  FROM managed_audits WHERE pool_id = '<pool id>' ORDER BY created_at;
  ```
  Expect, in order: `POOL_CREATED`, `WALLETS_GENERATED`, `INDEXER_RUN_REQUESTED`, `TRANSFER_REQUESTED`, `TRANSFER_CONFIRMED`, all with your admin `user_id`.

---

## 2. Flag-off regression checklist — existing wizard (manual, bscTestnet)

Run with `MANAGED_WALLETS_ENABLED` unset (or `false`) on both backend and the built frontend. Each step: what to click, what to observe.

1. **Login** (`/login`, email + password) → lands on `/setup`; `GET /api/auth/me` returns `{user, subscription}` as before. Sidebar shows the five wizard entries only (no MANAGED, no TREASURY); Admin layout shows the pre-existing tabs only (no Managed, no Treasury).
2. **Setup** — choose plan, network *bscTestnet*, paste token address + multisender address (or deploy), click *Save*. Observe: `POST /api/sessions` 201, the session id in the URL, no console error, and `[runner]`/`[server]` log lines identical in shape to before (no `[managed]` line anywhere in stdout/stderr).
3. **Generate** — count N, click *Generate wallets*. Observe: SSE progress completes, `GET /api/sessions/:id/wallets` lists N rows, the download link works and the file has the same columns as before.
4. **Plan** — click *Prepare distribution*. Observe: catalog from `frontend/src/shared/plans.ts` unchanged (same plan names and limits), batch sizes from `distributionBatching.ts` identical for the same N, preview totals unchanged.
5. **Distribute** — click *Start*. Observe: `POST /api/distribute` 202, SSE batch progress, tx hashes link to `testnet.bscscan.com`, the `[runner]` stdout lines parsed by `backend/src/lib/runner.ts` still match (progress bar advances).
6. **Results** — Observe: success/failed counts, CSV export from `/api/export/:id` downloads, History page lists the session.
7. **Logs** — `grep -c "\[managed\]" <backend log>` → `0`.
8. **Build artefacts** — `frontend/dist/index.html` references production assets (`verify-build: OK`), `backend/dist/index.js` exists; `git diff --stat main -- backend/src/lib/runner.ts backend/src/lib/plans.ts backend/scripts frontend/src/pages/{Setup,Generate,Plan,Distribute,Results,History}Page.tsx` is empty.

---

## 3. Flag-off HTTP surface — exact curl checks

Boot (never the `.env` database; the flag is forced off in the environment so a value in `.env` cannot leak in — dotenv never overrides variables that are already set):

```bash
cd backend
PORT=4998 DATABASE_URL='postgres://postgres:test@localhost:55432/managed_test?sslmode=disable' PGSSL=false \
NODE_ENV=development SESSION_SECRET=qa FRONTEND_URL=http://localhost:5173 CLIENT_URL=http://localhost:5173 \
MANAGED_WALLETS_ENABLED=false WALLET_ENCRYPTION_KEY= \
npx ts-node --transpile-only src/index.ts > /tmp/boot-off.log 2>&1 &
B=http://localhost:4998
```

An admin cookie jar: register a throwaway user, promote it in the **throwaway** DB, log in again (the role is read into the session at login):

```bash
EMAIL="qa-$(date +%s)@example.test"; PW="qa-$RANDOM$RANDOM"
curl -s -H 'content-type: application/json' -d "{\"name\":\"QA\",\"email\":\"$EMAIL\",\"password\":\"$PW\"}" $B/api/auth/register   # 201
psql 'postgres://postgres:test@localhost:55432/managed_test' -c "UPDATE users SET role='ADMIN' WHERE email='$EMAIL'"
curl -s -c jar.txt -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" $B/api/auth/login   # 200, role ADMIN
```

Checks and the exact expected answers (all observed on 2026-10-21, see §4):

| # | Command | Expected |
|---|---|---|
| C1 | `curl -s -w " [%{http_code}]\n" $B/health` | `{"status":"ok","timestamp":"…"} [200]` |
| C2 | `curl -s -w " [%{http_code}]\n" $B/api/auth/me` | `{"user":null,"subscription":null} [200]` |
| C3 | `curl -s -b jar.txt -w " [%{http_code}]\n" $B/api/auth/me` | `{"user":{"_id":"…","email":"…","name":"QA","role":"ADMIN"},"subscription":null} [200]` |
| C4 | `curl -s -w " [%{http_code}]\n" $B/api/admin/managed/health` (anonymous) | `{"error":"Forbidden"} [403]` — from the existing `/api/admin` router's guard, not from managed code |
| C5 | `curl -s -b jar.txt -w " [%{http_code}]\n" $B/api/admin/managed/health` (admin) | `{"error":"Route not found"} [404]` — the app's generic handler; nothing is mounted |
| C6 | `curl -s -b jar.txt -w " [%{http_code}]\n" $B/api/admin/managed/pools` | `{"error":"Route not found"} [404]` |
| C7 | `curl -s -w " [%{http_code}]\n" $B/api/view/$(printf 'a%.0s' {1..64})` | `{"error":"Route not found"} [404]` |
| C8 | `curl -s -o /dev/null -w "%{http_code}\n" -b jar.txt $B/api/admin/users` / same without jar | `200` / `403` (existing admin route unchanged) |
| C9 | `grep -c "\[managed\]" /tmp/boot-off.log` | `0` |

Cleanup: `psql … -c "DELETE FROM users WHERE email='$EMAIL'"`, `kill %1`, `lsof -nP -iTCP:4998 -sTCP:LISTEN` prints nothing.

Flag-on counterpart (proves the mount, same boot with `MANAGED_WALLETS_ENABLED=true WALLET_ENCRYPTION_KEY=$(npm run -s managed:gen-key) MANAGED_INDEXER_ENABLED=false`): C4 → `403 Forbidden`; C5 → `{"enabled":true,"keyVault":"ok","migrated":true,"indexer":{…},"maxWalletsPerPool":10000} [200]`; `POST /api/admin/managed/pools` without re-auth → `401 REAUTH_REQUIRED`; `POST /api/admin/managed/reauth` → `{"ok":true,"validUntil":"…"} [200]`; C7 → `{"error":"Not found"} [404]` (managed handler, different body); log has exactly `[managed] routes mounted …`, `[managed] indexer disabled by MANAGED_INDEXER_ENABLED=false`, `[managed] transfer worker started …`.

---

## 4. Results — 2026-10-21 (branch `feat/managed-wallets`, N8 run)

| Command | Result |
|---|---|
| `cd backend && npx tsc --noEmit -p tsconfig.json` | PASS (exit 0; includes `scripts/managed/testnet-e2e.ts`) |
| `cd frontend && npx tsc --noEmit` | PASS (exit 0) |
| `cd frontend && npm run build` | PASS (`✓ built in 3.89s`, `verify-build: OK`; pre-existing 995 kB chunk warning) |
| `cd backend && npm run build` | PASS at the gate (exit 0, `dist/index.js` + `dist/migrate.js`); one transient failure mid-session, see §4.1 |
| `cd backend && npm test` | PASS at the gate: **12 files, 194 tests, 0 failed** (N8 files: `services` 21, `transfers` 16, `logging` 8 incl. one `it.fails`, `flagOff` 23, `migrate` 2 = 70) |
| flag-off boot on 4998 + C1…C9 | PASS exactly as tabled in §3 (`[managed]` lines: 0); user deleted; 4998 free afterwards |
| flag-on boot on 4998 | PASS as tabled in §3 (health 200 `migrated:true keyVault:ok`, 401 `REAUTH_REQUIRED`, reauth 200, `/api/view/<unknown>` 404 `Not found`, 3 `[managed]` lines); user deleted; SIGTERM shutdown clean; 4998 free |
| `testnet-e2e.ts` refusals | PASS: `E2E_NETWORK=bscMainnet` → exit 2; missing key → exit 2; missing `E2E_TOKEN_ADDRESS` → prints the `npm run deploy:token` instructions, exit 2; `E2E_RPC_URL=https://bsc-dataseed1.binance.org` → `chain id 56, not BSC testnet (97)`, exit 2 |
| `testnet-e2e.ts` full run (M3/M5) | NOT RUN — needs a funded testnet key and a deployed token; manual |
| M1, M2, M4, M6, M7, M9, M10, §2 wizard | NOT RUN — manual |

### 4.1 `npm test` and backend build

Final gate (after N3/N5/N7 landed their security-review changes): `npm test` → 12 files, 194 tests, all green; backend build exit 0. Conditions observed during the session, kept here because they explain the test design:

- Earlier in the session `api.test.ts` (N5) failed 7 cases **because of leftover rows in the throwaway DB, not because of the feature**: the "N6 smoke pool" (`4339b6cf-…`) holds Hardhat accounts 1–3 (`0x7099…`, `0x3C44…`, `0x90F7…`), which the test re-derived from the `test … junk` phrase; `managed_wallets.address` is globally `UNIQUE`, so generation answered 500 and six later cases cascaded. N5 resolved it by deriving a per-run random mnemonic (`Mnemonic.entropyToPhrase(randomBytes(16))`). N8 tests never use the Hardhat phrase: they insert pools through the model with random addresses (`helpers/fixtures.ts`). The leftover rows are still present and tolerated.
- `services.test.ts › wallet list and detail shape › …(SR-04)` assert the SECURITY_REVIEW SR-04 contract (list without `viewUrl`/`viewToken`, detail with both); green since N5's `walletService.listWallets` change.
- `transfers.test.ts` and `services.test.ts › sweep enumeration` use the SR-08 user-scoped keys (`transferIdempotencyKey`, `sweepIdempotencyKey`) and cover `409 IDEMPOTENCY_MISMATCH`; every state-changing request sends a JSON body (SR-01), and one case proves a form-encoded / bodiless POST is refused with 415 before any row is written.
- `logging.test.ts › KNOWN GAP: a mnemonic embedded inside a longer log message is masked` is declared with `it.fails` (documents a gap in `redact.ts`: anchored `PHRASE_RE`, inline phrases pass through; inline 64-hex is masked). It passes as "expected failure" and must lose `.fails` once N2 masks inline phrases.
- `npm run build` failed once mid-session with `chain/indexer.ts` / `chain/transferWorker.ts` importing `consoleLogger` after N3 removed it from `chain/ports.ts` (N3 editing concurrently); green at the gate.

---

## 5. Database prerequisites (read before any boot)

- A **fresh** database needs `backend/migrations/0000_baseline.sql` applied first (it is documentation of the pre-existing schema and `migrate.ts` deliberately skips it), then `0001_managed_wallets.sql` via `npm run migrate` (dist) or `npm run migrate:dev` (ts-node, `PGSSL=false` for a local Postgres). `migrate.test.ts` proves a re-run applies nothing.
- `POST /api/auth/login` (and `/api/auth/me` for a logged-in user) query the `subscriptions` table; on a database without it the request **crashes the process** (unhandled rejection). Pre-existing behaviour, out of scope for this feature; the throwaway DB has the table because the baseline was applied.
- The throwaway DB keeps leftover rows from earlier nodes (user `n6-smoke@example.test`, pool "N6 smoke pool" with 3 wallets, one `managed_indexer_state` row for bscTestnet at block 100). N8 tests create and delete their own rows and tolerate those leftovers; see §4.1 for the one N5 test they break.
- Never point tests or boots at the `DATABASE_URL` in `backend/.env` (R11). Set `DATABASE_URL` in the environment before `dotenv` runs; it is then not overridden.
