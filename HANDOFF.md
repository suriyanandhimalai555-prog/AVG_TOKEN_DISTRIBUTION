# HANDOFF — HolderForge (AVG Token Distribution)

> Read this first in any new Claude session. Snapshot taken 2026-10-21 at commit `fecc8f3` (branch `main`, clean tree).
> Written after a full read of every tracked source file (backend, frontend, contracts, scripts, k8s, CI).
> Builds were **not** run this session (no `node_modules` installed locally).

---

## 1. What this product is

**HolderForge** (https://holderforge.io) is a paid SaaS that **creates token holders on BNB Chain**:

1. A customer buys a plan (crypto payment via Coinbase Commerce).
2. They enter their **funding wallet private key** + **BEP-20 token address**.
3. The app **deploys a MultiSender contract** (or reuses one), **generates N fresh wallets** (up to 100,000),
   **assigns a random 1–100 token amount** to each, and **airdrops the tokens in batches** of 100 wallets per tx.
4. They watch live progress (SSE), then **download an Excel/CSV report** with addresses, seed phrases, tx hashes.

A second product line, **DEX Automation** (trading bots/market activity), exists **only in the pricing catalog**:
there is no backend feature behind it yet.

Brand names in code: `HolderForge` (deploy/UI), `AVG Token Distribution` (repo/CI), `bnb-distribution-*` (package.json names), `ABC` (test token).

---

## 2. Repo layout

```
AVG_TOKEN_DISTRIBUTION/
├── backend/                  Express API + Hardhat + CLI scripts (Node 22, TypeScript)
│   ├── contracts/            ABCToken.sol (50M test ERC20), MultiSender.sol (batch sender)
│   ├── scripts/              The real blockchain work, run as CHILD PROCESSES by the API
│   │   ├── generate-wallets.ts      → output/wallets.csv (+ MASTER_MNEMONIC.txt in HD mode)
│   │   ├── prepare-distribution.ts  → output/distribution-plan.json (random 1–100 tokens each)
│   │   ├── distribute.ts            → sends multisend txs, checkpoints plan.json, logs to stdout
│   │   ├── deploy-multisender.ts    → output/deployments.json
│   │   ├── deploy-token.ts, export-results.ts (CLI only)
│   ├── src/
│   │   ├── index.ts          App bootstrap: CORS, raw-body webhook, pg sessions, passport, routes, SIGTERM
│   │   ├── routes/           One file per /api/* prefix (see §4)
│   │   ├── models/           Hand-written SQL repos over `pg` (Mongo-style API kept from old MongoDB code)
│   │   ├── lib/runner.ts     spawn() scripts, parse stdout with regex → SSE events + DB callbacks
│   │   ├── lib/plans.ts      Plan catalog (MUST stay in sync with frontend/src/shared/plans.ts)
│   │   ├── lib/distributionBatching.ts  Batch size 100 / 5 parallel (mirrored in frontend)
│   │   ├── middleware/       requireAuth, requirePlan (ACTIVE sub or ADMIN), requireAdmin
│   │   └── config/           passport (serialize only), coinbase
│   ├── typechain-types/      Generated, committed
│   └── Dockerfile            node:22-alpine, runs dist/index.js on :4002
├── frontend/                 React 18 + Vite 5 + Tailwind + React Query + react-router 6
│   ├── src/pages/            Landing, Pricing, Login, Onboarding, PaymentResult, Account,
│   │                         Setup → Generate → Plan → Distribute → Results, History, admin/*
│   ├── src/lib/api.ts        axios client (withCredentials) + typed API helpers
│   ├── src/lib/store.ts      sessionId in localStorage, privateKey in sessionStorage
│   └── Dockerfile, nginx.conf  Static build served by nginx :80
├── k8s/                      namespace, backend (+5Gi PVC on /app/output), frontend, ingress
├── .github/workflows/deploy-holderforge.yml   CI/CD (see §6)
└── docker-compose.yml        Legacy/alt run of the two GHCR images (ports 4002 / 3002)
```

---

## 3. How it works end to end

### User journey (frontend routes)
`/` Landing → `/pricing` → `/login` (email+password) → `/onboarding` (pick product+plan → Coinbase hosted checkout)
→ `/payment-result` (polls `/api/payments/status/:chargeId`) → `/dashboard/*` wizard:

| Step | Page | Backend call | What happens |
|---|---|---|---|
| 1 Setup | `SetupPage.tsx` (1,004 lines) | `GET /api/config`, `POST /api/wallet/preview`, `POST /api/deploy/multisender`, `POST/PATCH /api/sessions` | Enter PK + token, preview balances, deploy/enter MultiSender, create a session |
| 2 Generate | `GeneratePage.tsx` | `POST /api/generate` | Spawns `generate-wallets.ts`, imports `wallets.csv` into `wallets` table, stores mnemonic |
| 3 Plan | `PlanPage.tsx` | `POST /api/prepare` | Spawns `prepare-distribution.ts`, upserts amounts into `wallets` |
| 4 Distribute | `DistributePage.tsx` | `POST /api/estimate/preflight`, `POST/DELETE /api/distribute`, `GET /api/progress` (SSE) | Spawns `distribute.ts`; live log, batches, countdown |
| 5 Results | `ResultsPage.tsx` | `GET /api/export?file=csv|xlsx|wallets|json` | Download reports |
| History | `HistoryPage.tsx` | `GET /api/sessions`, `/api/sessions/history` | Past sessions + audit timeline, delete |

### Distribution engine (scripts/distribute.ts)
- **Batch mode (default):** funds MultiSender with the needed tokens (`token.transfer` from deployer), then calls
  `multisend(token, indices[], packed[])` with 100 wallets/tx, 5 txs in parallel, serial nonces via `SerialTxSubmitter`,
  gas price fixed **0.05 gwei**, gas limit **4,000,000**, 3 retries, up to 5 "drain passes". Plan JSON checkpointed after each group.
- **Delay mode** (`delayMode: true`): one direct `token.transfer` per wallet, random 120–240 s delay between them (looks organic). Emits `SSE:delay:*` lines for the countdown UI.
- RPC: primary `ALCHEMY_RPC_URL` (or testnet URL) + 2 fallbacks for broadcast.
- Packed calldata: `bytes32 = address(20B) | uint96 whole-token amount`; contract multiplies by 1e18 (**assumes 18 decimals**).

### Process ↔ API ↔ UI plumbing
`lib/runner.ts` spawns `npx ts-node scripts/X.ts` with secrets passed via **env vars**, reads stdout line-by-line, matches
regexes (`Batch n/m | ... CONFIRMED`, `Group ... ✓ sent`, `DISTRIBUTION COMPLETE`, `BNB spent:`) and:
- updates Postgres (`batches`, `distribution_sessions`, `wallets`) via callbacks,
- pushes SSE events (`log`, `batch`, `stats`, `done`, `error`, `delay:*`) to browsers subscribed on `/api/progress?sessionId=`.
Active processes + SSE clients live **in memory** → backend must run as **exactly one replica**.

### Payments → access
`POST /api/payments/create-charge` → Coinbase Commerce charge → user pays on hosted page →
**webhook** `POST /api/payments/webhook` (HMAC-SHA256 on raw body, registered before `express.json`) →
on `charge:confirmed` upsert `subscriptions` row `ACTIVE` with plan `walletLimit` (TOKEN_HOLDER = 5 years, DEX = 30 days).
`requirePlan` gates every distribution route; ADMIN bypasses. Make an admin with:
`psql "$DATABASE_URL" -c "UPDATE users SET role='ADMIN' WHERE email='you@x.com';"`

### Data (PostgreSQL)
Tables used: `users`, `subscriptions`, `payments`, `distribution_sessions`, `wallets`, `batches`, `session_audits`, `express_sessions` (connect-pg-simple, `createTableIfMissing: false`).
**There are NO migration/schema files in the repo**: the schema only exists in the live DB. Column names can be inferred from `models/*.ts` (`mapX` functions).
Pool uses `ssl: { rejectUnauthorized: false }`.

---

## 4. API map (backend/src/routes)

| Prefix | Guard | Endpoints |
|---|---|---|
| `/api/auth` | none | `POST /register`, `POST /login` (PBKDF2-SHA512 100k), `GET /me`, `POST /logout` |
| `/api/payments` | auth | `POST /create-charge`, `GET /status/:chargeId`, `GET /by-order/:id`, `GET /history` |
| `/api/payments/webhook` | HMAC | Coinbase events |
| `/api/admin` | ADMIN | `GET /stats`, `GET /users`, `PATCH /users/:id`, `GET /payments` |
| `/api/sessions` | auth (+plan on create/patch) | CRUD + `/history` (audits) |
| `/api/generate`, `/api/prepare`, `/api/distribute` | auth+plan | start (and `DELETE /api/distribute` = stop) |
| `/api/progress` | auth+owner | SSE stream |
| `/api/status` | auth+owner | derived counts |
| `/api/batches`, `/batches/wallets`, `/batches/wallets/summary` | auth+plan+owner | paginated tables |
| `/api/export` | auth+plan+owner | `file=csv|xlsx|wallets|json` |
| `/api/config` | auth+plan | RPC URLs + last deployed MultiSender from `output/deployments.json` |
| `/api/deploy/multisender` | auth+plan | `npx hardhat run ... --network bscMainnet|bscTestnet` |
| `/api/wallet/preview`, `/api/estimate/preflight` | auth+plan | balances, gas/BNB estimate |
| `/`, `/health` | none | liveness |

---

## 5. Environment variables (backend)

From `.env.example`: `DATABASE_URL`, `PORT`, `FRONTEND_URL`, `CLIENT_URL`, `NODE_ENV`, `SESSION_SECRET`,
`GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` (unused, see §7), `ALCHEMY_RPC_URL`, `BSC_TESTNET_RPC_URL`, `FALLBACK_RPC_1/2`, `OPBNB_*` (unused).

**Used in code but missing from `.env.example`:** `COINBASE_COMMERCE_API_KEY`, `COINBASE_COMMERCE_WEBHOOK_SECRET`,
`BSC_TESTNET_FALLBACK_RPC_1/2`, `SCRIPTS_DIR`, `MIN_DELAY_MS`, `MAX_DELAY_MS`, plus script-only `PRIVATE_KEY`, `TOKEN_ADDRESS`,
`MULTISENDER_ADDRESS`, `TOTAL_WALLETS`, `WALLET_MODE`, `DELAY_MODE` (the API injects these per run).

Frontend: `VITE_API_URL` (build-time; CI passes `https://holderforge.io`). Dev: Vite proxies `/api` → `localhost:4000`.

In k8s the backend env comes from secret `holderforge-backend-env` (created manually on the server, not in repo).

---

## 6. Build, run, deploy

```bash
# backend
cd backend && npm ci && cp .env.example .env   # fill values
npx hardhat compile                            # REQUIRED: distribute.ts reads artifacts/contracts/*.json
npm run dev                                    # ts-node-dev on PORT (default 4000)
npm run build && npm start                     # tsc → dist/

# frontend
cd frontend && npm ci && npm run dev           # :5173, proxies /api → :4000
npm run build                                  # tsc + vite build + scripts/verify-build.mjs
```

**CI/CD** (`.github/workflows/deploy-holderforge.yml`, on every push to `main`):
build ARM64 images on `ubuntu-24.04-arm` → push `ghcr.io/suriyanandhimalai555-prog/avg-token-{backend,frontend}:<sha>` →
SSH to the k3s host (`~/otp/apps/AVG_TOKEN_DISTRIBUTION/combined-repo`) → apply `k8s/*` with `__IMAGE_TAG__` substituted →
rollout status (60 s) → in-pod health checks → external HTTPS checks on holderforge.io / www / /health → auto `rollout undo` on failure → email notification.
Ingress: `holderforge.io` + `www.` (`/api` and `/health` → backend, `/` → frontend), `api.holderforge.io` → backend. TLS via cert-manager `letsencrypt-prod`. Proxy timeouts 3600 s (for SSE).
⚠ The server checkout must be `git pull`ed for k8s manifest changes; CI does **not** pull, it `cd`s into the existing checkout.

---

## 7. Known issues and risks (verified by reading code; ranked)

**Critical: multi-tenant data leakage via the shared `output/` folder**
- All scripts read/write fixed paths: `backend/output/wallets.csv`, `distribution-plan.json`, `MASTER_MNEMONIC.txt`, `deployments.json`. These are **global, not per session or user**.
- `GET /api/export?file=wallets` streams the global `wallets.csv`, which contains **private keys** (and mnemonics in INDEPENDENT mode). The ownership check is on the session id only, so any paying user can download the **most recent run's keys from any other user**.
- CSV/XLSX export maps seed phrases from the global `wallets.csv` by wallet index, so it can put another user's seeds into this user's report.
- `/api/batches/wallets`, `/api/distribute` sync, and exports overlay "sent/txHash" from the global `distribution-plan.json`, so two concurrent sessions corrupt each other.
- `/api/config` returns the last deployed MultiSender from global `deployments.json`, so user B's Setup auto-fills user A's contract (B's `multisend` would revert because of `onlyOwner`).
- **Fix direction:** per-session output dir (`output/<sessionId>/`), pass it to scripts via env, read only from it. Better: stop using files and keep the plan in Postgres.

**High: MultiSender bitmap blocks reuse**
- `MultiSender._claimed` is keyed by wallet **index** (0..N-1), and every session starts at index 0. Reusing the same MultiSender for a second session makes the contract **silently skip** already-claimed indices, while the script still marks the batch "sent". The likely result is that the run reports success but no tokens move.
- Fix: use a fresh MultiSender per session, or include a session/nonce salt, or drop the bitmap (the off-chain plan already tracks sent).
- Also: leftover tokens stay in MultiSender (only `withdrawTokens` by owner); the contract assumes 18 decimals; the transfer return value is not checked (non-standard tokens).

**High: secrets handling**
- The user's funding **private key** is sent to the API, passed to child processes as env, kept in `sessionStorage` (`runtimePrivateKey`, and inside the Setup draft JSON).
- `master_mnemonic` is stored **plaintext** in Postgres and returned by `GET /api/sessions/:id`.
- Generated wallet private keys sit in plaintext on the PVC (`wallets.csv`, and `output/mnemonics/` in INDEPENDENT mode).
- Bug: in the **default INDEPENDENT_SEEDS mode**, `wallets.csv` columns are `index,address,privateKey,mnemonic,derivationPath`,
  but `routes/generate.ts` parses `[idx, address, , derivationPath]`, so **each wallet's seed phrase is stored in `wallets.derivation_path`**
  (plaintext, and returned by `/api/batches/wallets`). HD mode is unaffected.

**High: wallet generation bugs (`scripts/generate-wallets.ts`, verified 2026-10-21 by running ethers 6.13.4)**
- **HD mode derives from a non-standard path.** `HDNodeWallet.fromPhrase(m)` already returns the node at `m/44'/60'/0'/0/0` (depth 5).
  The relative `derivePath("44'/60'/0'/0")` then gives the real path `m/44'/60'/0'/0/0/44'/60'/0'/0/i`, but the CSV labels it `m/44'/60'/0'/0/i`.
  With the Hardhat test mnemonic, index 0 comes out as `0xD898…2e8d` instead of the standard `0xf39F…2266`.
  Importing the master mnemonic into MetaMask or Trust Wallet will **not** show these wallets. The XLSX/CSV report gives only the seed (no private key), so customers can't recover HD-mode wallets from the report.
  Fix: `HDNodeWallet.fromPhrase(m, undefined, "m/44'/60'/0'/0")` then `deriveChild(i)`. Existing HD sessions need their keys from `wallets.csv` (if it still exists).
- **INDEPENDENT mode picks up a stale master mnemonic.** It never writes `MASTER_MNEMONIC.txt`, but `runner.runGenerate` reads that file on success.
  It then stores whatever an earlier HD run (possibly **another user's**) left there as this session's `masterMnemonic`, and GeneratePage displays it.
- **INDEPENDENT mode sends no progress events.** Its log lines (`Generated X / Y`, `Total wallets generated:`) don't match runner's regexes (`Total wallets:\s+`, `WALLET GENERATION COMPLETE`).
  The UI therefore only learns about completion by polling `/api/status`.
- INDEPENDENT mode also writes one file per wallet (`output/mnemonics/wallet-<i>.txt`) synchronously, which means 100k files for a 100k run.

**High: operational fragility**
- A deploy (`git push main`) restarts the backend pod, which **kills any running distribution** child process. `distribute.ts` only saves state on SIGINT, not SIGTERM, and the session stays `distributing` forever with no auto-resume. Coordinate deploys and add SIGTERM handling plus a resume path.
- The Docker image never runs `hardhat compile`, and `artifacts/` is gitignored and not on the PVC. `distribute.ts` throws `Artifact not found` unless `hardhat run` (deploy) compiled earlier in the same pod lifetime, which also needs to download solc at runtime. **Verify in prod**; fix by compiling in the Dockerfile build stage.
- In-memory process/SSE maps need `replicas: 1`; the RollingUpdate `maxSurge: 1` briefly runs two pods with an RWO PVC.

**Medium: product and logic gaps**
- Plan limits only cap `totalWallets` per session. There is **no usage quota** (unlimited sessions per plan) and **no expiry check** (`expiresAt` is ignored by `requirePlan`).
- The subscription is activated **only by the webhook**. `/payments/status` polling updates the payment row but never creates the subscription.
- Token amounts are always random 1–100. The plans advertise "fixed amount" (Starter/Growth) and "custom 100–500/1,000" (Scale+), which is **not implemented**.
- **Google OAuth is advertised** (README, deps, env, `googleId` column) **but not wired**: there is no strategy and no `/google` routes. Only email+password works.
- DEX Automation plans can be bought but there is no feature behind them.
- Gas is hard-coded at 0.05 gwei / 4M limit (`distribute.ts` and `estimate.ts`).
- `GET /api/sessions/history` and `admin/users` load all rows, then slice in JS (no SQL LIMIT).
- No DB migrations in the repo (see §3). No tests anywhere. No lint config.

**Low: housekeeping**
- `backend/README.md` has stray "Test deployment" lines; `plans.ts` comment points to the old `AVG_Frontend/...` path; root `package-lock.json` is empty; `frontend/.env.production` is committed despite being gitignored (it contains only the public URL).
- Login lockout and rate limiting are absent; the error handler returns `err.message` to clients.

---

## 7b. Status update (2026-10-21, later the same day)
- ✅ **RESOLVED:** `f3f2189` (pushed by the repo owner) fixed the CI health check: it picks only Running+Ready, non-terminating pods and retries 10×.
  Deploy run 39550800410 succeeded, so **the HD path fix `d58b556` is live in production**. The notes below are kept as history.
- HD path fix committed and pushed (`d58b556`); its first deploy, run 39546817571, rolled back.
  Cause: a race in the CI health check. `kubectl get pods -l app=holderforge-backend -o jsonpath='{.items[0]...}'` picked the **old pod that was still Terminating**.
  `kubectl exec` then hit `NotFound`, so the script triggered a rollback even though the new pod was Running and healthy.
  Fix: pick the newest pod (`--sort-by=.metadata.creationTimestamp` + `{.items[-1:].metadata.name}`) for both the backend and frontend checks, or wait for the old pods to be deleted first.
- **`backend/scripts/recover-hd-wallets.ts`** (+ `npm run recover:hd`) was written and tested against a throwaway Postgres; it is **not committed yet**.
  Modes: `--scan` (classifies sessions, prints no secrets), `--session <id>` (writes `output/recovery/<id>.csv`, mode 0600, never overwrites),
  `--mnemonic-file <f> --count <n>` (offline). It is read-only on the DB and only outputs a key if it reproduces the stored address. Set `PGSSL=false` for a local DB.

## 8. Recent history (newest first)
```
fecc8f3 Add backend root API response
878b3f8 Add HolderForge API domain (api.holderforge.io ingress)
26748a4 Set HolderForge frontend replicas to 1
2ec7d67 Fix backend rollout timeout: shut down quickly on SIGTERM (closeAllSseClients)
7fb42f8 TS config → nodenext
421419a / 0f70a9e  Migrate backend MongoDB → PostgreSQL (models keep Mongo-like method names)
8978d8b … 6273fa2  k3s ARM64 deployment pipeline
d1d0df1 Initial combined frontend and backend
```

---

## 9. Suggested next steps (pick with the user)

1. **Isolate `output/` per session** (critical security fix, §7). Touch: `lib/runner.ts`, all `scripts/*.ts` OUTPUT_DIR, `routes/{generate,prepare,distribute,batches,export,config,deploy}.ts`.
2. **Fix MultiSender reuse**: per-session contract or a salted claim key. Contract change means redeploy plus a typechain regen.
3. **Compile contracts in Docker build**, and add SIGTERM checkpoint plus a "resume distribution" path.
4. **Commit a SQL schema/migration** (dump from prod: `pg_dump --schema-only`).
5. **Enforce plan rules**: expiry, usage quota, fixed vs custom amounts per plan.
6. Wire Google OAuth or remove it from README/env/deps.
7. Encrypt mnemonics at rest and stop returning them from `GET /api/sessions/:id` except on explicit export.
8. Update `.env.example` with the missing vars (§5).

## 10. Working rules for the next session
- Keep `backend/src/lib/plans.ts` ⇄ `frontend/src/shared/plans.ts` and both `distributionBatching.ts` files in sync.
- `runner.ts` parses **exact stdout strings** from `distribute.ts` / `generate-wallets.ts` / `prepare-distribution.ts`. Changing a log line breaks progress tracking.
- Webhook route must stay **before** `express.json()` in `index.ts`.
- Every push to `main` deploys to production: branch first for anything risky.
- Test on **bscTestnet** (chainId 97) before mainnet; deploy-token/multisender npm scripts default to testnet.
