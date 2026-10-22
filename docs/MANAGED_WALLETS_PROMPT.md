# Claude Code orchestrator prompt — Managed Wallets

This file holds the prompt that builds `docs/MANAGED_WALLETS_SPEC.md` as a multi-agent job inside a Claude Code terminal.

## How to use

1. From the repo root, make sure `main` is current: `git checkout main && git pull`.
2. Start Claude Code in the repo root.
3. Paste the whole block in the next section as your first message.

Short launcher (same effect, if you prefer not to paste the long block):

```
Read docs/MANAGED_WALLETS_PROMPT.md and execute the prompt in its "Prompt" section exactly, as the orchestrator of a multi-agent build on branch feat/managed-wallets. Do not summarize it back to me; start with N1.
```

If your Claude Code has the multi-agent workflow runner enabled, prefix the launcher with the word `ultracode` to let the orchestrator use it; otherwise it will use parallel subagents, which is what the prompt expects.

---

## Prompt

````text
You are the ORCHESTRATOR of a multi-agent build in this repository (HolderForge / AVG Token Distribution).
Feature: "Managed Wallets", an admin-only custodial wallet pool: one encrypted master seed per pool, derived
deposit addresses handed to holders, any-token deposit detection, read-only holder view links, admin-only
outbound transfers with automatic gas top-up from the master wallet, and an aggregated Treasury dashboard.

# 0. Read before doing anything
1. HANDOFF.md (whole file). It is the map of the existing system, its conventions, and its known risks.
2. docs/MANAGED_WALLETS_SPEC.md (whole file). It is the source of truth for scope, data model, API,
   custody, indexer, transfer engine, UI, file ownership, build graph, and acceptance criteria.
   Where this prompt and the spec disagree, the spec wins.
3. Skim for conventions only: backend/src/index.ts, backend/src/routes/admin.ts,
   backend/src/models/Session.ts, backend/src/lib/postgres.ts, backend/scripts/generate-wallets.ts
   (the fixed HD derivation), frontend/src/App.tsx, frontend/src/pages/admin/AdminLayout.tsx,
   frontend/src/components/layout/Sidebar.tsx, frontend/src/lib/api.ts, frontend/src/pages/PaymentResult.tsx
   (standalone page layout), frontend/src/index.css (theme tokens and dash-card classes).

# 1. Ground rules (binding for you and every subagent)
R1  Branch: `git checkout -b feat/managed-wallets` from current main. NEVER push. NEVER merge to main.
    Every push to main auto-deploys to production.
R2  Do not break the existing product. SPEC §7 lists frozen files and the exact allowed edits to existing
    files. Nothing else existing changes. Existing routes, stdout log lines parsed by backend/src/lib/runner.ts,
    plan catalogs, scripts, contracts, and wizard pages keep identical behavior.
R3  Everything new is behind MANAGED_WALLETS_ENABLED (default false). With the flag off, no new route is
    mounted, no worker starts, no nav item renders, and logs are unchanged.
R4  Secrets: pool mnemonics are encrypted at rest with AES-256-GCM under WALLET_ENCRYPTION_KEY, never written
    to disk, never logged, never returned except by the reveal endpoint behind password re-auth. Child private
    keys are derived in memory only when signing and never persisted. Add a redaction helper and test it.
R5  Conventions: hand-written SQL models with mapX functions (copy the style of backend/src/models/Session.ts),
    one Express router file per concern, React Query + the existing axios instance, Tailwind theme tokens and
    dash-card classes, lucide-react icons, TypeScript strict. No `any` outside the mapX row parameter.
R6  Exclusive ownership: every subagent gets an exclusive file list. Two agents never edit the same file.
    If an agent needs a change outside its files, it writes the request in its report; you route it to the owner.
R7  Gates: after every group, run from the repo root
      (cd backend && npx tsc --noEmit -p tsconfig.json) && (cd frontend && npx tsc --noEmit)
    and, once tests exist, (cd backend && npm test). A group is not done until the gate is green.
    Commit at the end of each group: "feat(managed-wallets): <group> — <one-line summary>".
R8  Parallelism: nodes in the same group are launched as separate subagents in ONE message. A node starts only
    when all its dependencies are complete and the previous gate passed.
R9  Each subagent brief must contain: role, goal, exclusive files, forbidden files, inputs to read, outputs with
    exact paths, definition of done, and the report format below. Paste the relevant SPEC sections into the
    brief verbatim; do not paraphrase the data model, API table, or transfer planner rules.
R10 Dependencies: allowed additions are vitest, supertest, @types/supertest, express-rate-limit (backend) and
    qrcode, @types/qrcode (frontend). Anything else: stop and report instead of installing.
R11 Never run anything that writes to the configured DATABASE_URL in backend/.env; treat it as production.
    For migrations and API tests use a throwaway Postgres (Docker `postgres:16` if available, else skip the
    DB-backed tests and say so). Never print values from backend/.env.
R12 Subagent report format (mandatory, at the end of every report):
      FILES CHANGED: <list>
      DECISIONS: <bullets>
      REQUESTS FOR OTHER OWNERS: <file: change needed> or "none"
      COMMANDS RUN + RESULTS: <exact commands and pass/fail>
      OPEN QUESTIONS: <bullets> or "none"

# 2. Build graph (execute exactly in this order)
G0  N1 Architect
G1  N2 Backend-Data   |  N3 Blockchain-Core   |  N4 Frontend-Admin      (parallel, one message)
G2  N5 API-Wiring
G3  N6 Frontend-Integration
G4  N7 Security-Review  |  N8 QA                                         (parallel, one message)
G5  N9 DevOps-Docs
G6  N10 Final gate (you, no subagent)
Dependencies: N2, N3, N4 depend on N1. N5 depends on N2 and N3. N6 depends on N4 and N5.
N7 and N8 depend on N6. N9 depends on N7 and N8. N10 depends on N9.

# 3. Node briefs

## N1 Architect (role R2)
Inputs: HANDOFF.md, SPEC §3, §4, §6, §7, §8.
Exclusive files: docs/managed-wallets/**, backend/migrations/**, backend/src/managed/types.ts,
  frontend/src/lib/managedTypes.ts.
Tasks:
 a. Introspect the live schema READ-ONLY to learn the exact type of users.id and the existing tables:
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' ORDER BY table_name, ordinal_position;
    Use DATABASE_URL from backend/.env via a tiny throwaway Node script with the pg Pool and
    ssl { rejectUnauthorized: false }. Do not run any other statement. Write the result as
    backend/migrations/0000_baseline.sql (CREATE TABLE IF NOT EXISTS reconstructions, documentation only,
    header comment "documentation of the live schema on <date>; not applied by the runner").
 b. Write backend/migrations/0001_managed_wallets.sql exactly as SPEC §6.2, adjusting only the id column
    types that must match users.id. Idempotent. Include every index and constraint.
 c. Write backend/src/managed/types.ts: TS interfaces for every API request and response in SPEC §6.6,
    the job status union, the asset string convention ('native' | lowercase token address), and the
    TransferPlan shape. Write frontend/src/lib/managedTypes.ts with identical content (no imports from backend).
 d. Write docs/managed-wallets/ARCHITECTURE.md: module map under backend/src/managed/, sequence diagrams
    (mermaid) for create pool, generate wallets, deposit indexing cycle, transfer with top-up, sweep batch,
    restart recovery; failure modes and their typed error codes.
 e. Write docs/managed-wallets/API.md: every endpoint with method, path, guards, request and response JSON
    examples, error codes. This is the contract N4 codes against before N5 exists.
 f. Write docs/managed-wallets/FILE_OWNERSHIP.md: the final exclusive file list per node N2..N9, derived
    from SPEC §4 and §7. This document is binding for all later briefs.
Done when: both tsc are green, the migration applies cleanly to a throwaway Postgres (or you explain why it
  could not be tried), and the three docs exist. Report per R12.

## N2 Backend-Data (role R3)  [parallel with N3, N4]
Inputs: SPEC §6.2, §6.3, N1 outputs (types.ts, migrations, FILE_OWNERSHIP.md, API.md).
Exclusive files: backend/src/migrate.ts, backend/src/managed/models/** (pools.ts, wallets.ts, tokens.ts,
  balances.ts, deposits.ts, transfers.ts, indexerState.ts, audits.ts), backend/src/managed/keyVault.ts,
  backend/src/managed/derive.ts, backend/src/managed/audit.ts, backend/src/managed/redact.ts,
  backend/scripts/managed/gen-key.ts, backend/test/managed/keyVault.test.ts,
  backend/test/managed/derive.test.ts, backend/test/managed/redact.test.ts, backend/vitest.config.ts,
  and the package.json script/devDependency lines for migrate, managed:gen-key, test, vitest.
Tasks:
 a. migrate.ts: reads backend/migrations/*.sql in name order (skipping 0000_baseline.sql), applies each in a
    transaction, records in schema_migrations, is safe to re-run. Compiled into dist by the existing build
    (it lives under src). npm script "migrate": "node dist/migrate.js", plus "migrate:dev": "ts-node src/migrate.ts".
 b. Models: one file per table, same shape as backend/src/models/Session.ts (requirePool, mapX, explicit
    column lists, parameterized SQL, chunked multi-row inserts of 500 like models/Wallet.ts). Required methods:
      pools: create, findById, listByOwner, update, archive, reserveIndexes(poolId, count) which atomically
             returns [from, to] and advances next_index in one UPDATE ... RETURNING.
      wallets: insertMany, findById, findByViewToken, listByPool(skip, limit, search), update, rotateViewToken,
               listActiveAddressesByNetwork(network) for the indexer.
      tokens: upsertDiscovered, insertTracked, listByNetwork(includeHidden), setHidden.
      balances: upsertMany, listByWallet, aggregateByPool(poolId), aggregateAll, upsertMaster, listMaster.
      deposits: insertManyIgnoreDuplicates, listByPool, listByWallet(limit).
      transfers: create, createBatch, pickNextPending (FOR UPDATE SKIP LOCKED inside a client transaction,
                 returns job and the client or null), update, findById, list(filters), countByStatus(batchId).
      indexerState: get, upsert.
      audits: create, listByPool.
 c. keyVault.ts: encryptSecret(plaintext, aad) / decryptSecret(record, aad) with AES-256-GCM, 12-byte random
    IV, 16-byte tag, key from WALLET_ENCRYPTION_KEY (base64, must decode to 32 bytes), keyVersion 1,
    isKeyVaultAvailable(). Throws typed errors; never logs inputs.
 d. derive.ts: accountNode(mnemonic), masterSigner(mnemonic), childSigner(mnemonic, index), addressesFor
    (mnemonic, from, to) using HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0") then deriveChild.
    Validate mnemonics with ethers.Mnemonic.isValidMnemonic. Generate with ethers.Wallet.createRandom().
 e. redact.ts: redact(obj) that masks any 12 or 24 word BIP-39 looking string, 0x-prefixed 64-hex strings, and
    the ciphertext fields; used by every log line in the feature.
 f. audit.ts: recordManagedAudit({userId, poolId?, walletId?, action, details}) that never throws (same pattern
    as backend/src/lib/sessionAudit.ts).
 g. gen-key.ts: prints a fresh base64 32-byte key and nothing else.
 h. Tests (vitest): vault round trip and tamper detection; derive against the Hardhat test mnemonic
    "test test test test test test test test test test test junk" where index 0 must equal
    0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 and index 1 must equal 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    redact masks all secret shapes.
Done when: backend tsc green, `npm test` green for your files. Report per R12.

## N3 Blockchain-Core (role R4)  [parallel with N2, N4]
Inputs: SPEC §6.4, §6.5, §6.8, N1 outputs. You may import the model interfaces from N1's types.ts; integration
  with N2's concrete models happens through small dependency-injected ports so you can unit test with fakes.
Exclusive files: backend/src/managed/chain/** (rpc.ts, multicall.ts, fees.ts, indexer.ts, balances.ts,
  transferPlanner.ts, transferWorker.ts, ports.ts), backend/test/managed/transferPlanner.test.ts,
  backend/test/managed/indexer.test.ts, backend/test/managed/fixtures/**.
Tasks:
 a. rpc.ts: providerFor(network) using the same env resolution as backend/src/routes/estimate.ts
    (BSC_TESTNET_RPC_URL for testnet; ALCHEMY_RPC_URL then FALLBACK_RPC_1/2 for mainnet), plus a withFallback
    (fn) helper that retries reads across the fallbacks on 429/timeout/SERVER_ERROR.
 b. multicall.ts: Multicall3 at MULTICALL3_ADDRESS (default 0xcA11bde05977b3631167028862bE2a173976CA11):
    getEthBalances(addresses[]) and getTokenBalances(token, addresses[]) via aggregate3 in chunks of 500,
    per-call fallback when multicall reverts. Return bigint.
 c. fees.ts: resolveGasPrice(provider) = clamp(getFeeData().gasPrice, MANAGED_MIN_GAS_PRICE_GWEI,
    MANAGED_MAX_GAS_PRICE_GWEI). Do not touch the 0.05 gwei constant in scripts/distribute.ts.
 d. indexer.ts: runOnce(network) and start()/stop() timer. Exactly SPEC §6.4: head = latest minus
    confirmations; chunked block ranges; eth_getLogs with topics [TRANSFER_SIG, null, paddedAddresses[]] in
    address chunks; decode (token = log.address, from = topic1, to = topic2, amount = data); upsert token
    metadata on first sight with try/catch per call (symbol/name/decimals, fallback UNKNOWN/18); insert deposits;
    mark dirty pairs; update indexer state; backoff on errors and record last_error. TRANSFER_SIG =
    0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef.
 e. balances.ts: refreshPairs(pairs), refreshAll(network) every MANAGED_FULL_REFRESH_MS, refreshMaster(pool).
    Native asset key is 'native'.
 f. transferPlanner.ts (pure, no I/O): plan(input) implementing SPEC §6.5 steps 1 to 4 exactly, returning
    { ok: true, gasLimit, gasPriceWei, gasCostWei, topUpWei, amountWei, txs: [...] } or { ok: false, code }.
    Codes: NOTHING_TO_SWEEP, INSUFFICIENT_TOKEN_BALANCE, INSUFFICIENT_NATIVE_FOR_AMOUNT, MASTER_INSUFFICIENT_BNB,
    GAS_LIMIT_EXCEEDED, INVALID_DESTINATION.
 g. transferWorker.ts: single loop, concurrency 1, start()/stop() with a clean stop that finishes the current
    job. Per job: decrypt seed via the vault port, derive signers, execute plan (FUNDING_GAS → wait 1 → SENDING
    → wait 1 → CONFIRMED), receipt check on any stored hash before broadcasting, typed FAILED reasons,
    MANAGED_TX_TIMEOUT_MS handling, MANAGED_MAX_ATTEMPTS, balance refresh on completion, audit on terminal
    states. Nonces via getTransactionCount(address, "pending").
 h. ports.ts: the small interfaces the worker and indexer need (vault, models subset, clock, logger) so N5 can
    wire the real implementations and tests can pass fakes.
 i. Tests: planner tables (token with zero BNB → top-up; native sweep-all math; master short → rejection);
    indexer decoding against fixture logs; worker restart path with a fake provider returning a receipt.
Done when: backend tsc green, your tests green. Report per R12.

## N4 Frontend-Admin (role R5)  [parallel with N2, N3]
Inputs: SPEC §5, §6.6, §6.7, N1 API.md and managedTypes.ts. No backend exists yet; code against a thin
  mock in frontend/src/lib/managedApi.mock.ts (yours) that returns typed fixtures, and read the client through
  a single `managedApi` import so N6 can swap in the real client without touching your pages.
Exclusive files: frontend/src/pages/admin/managed/** (PoolsPage.tsx, PoolDetailPage.tsx, TreasuryPage.tsx,
  TransferJobsPage.tsx, ManagedSettingsPage.tsx), frontend/src/components/managed/** EXCEPT QrCode.tsx,
  frontend/src/lib/managedApi.mock.ts.
Tasks: implement features F1 to F10 and flows 1, 2, 3, 5, 6, 8 from SPEC §5 with the exact page and
  component names in §6.7. Transfer dialog is three steps plus re-auth and calls the plan endpoint for the
  review step, showing the "Gas top-up from master" line when topUpWei > 0. Sweep dialog builds one batch.
  Live status via React Query refetchInterval (5 s while any job is active, 30 s otherwise). Reuse StatCard,
  AddressCell, TxHashLink, StatusBadge, dash-card classes, theme tokens; dark and light both correct.
  Treasury shows totals per token with formatUnits by decimals, master balances, and a low-gas warning.
  Do not edit App.tsx, Sidebar.tsx, AdminLayout.tsx; export a `managedAdminRoutes` array from
  frontend/src/pages/admin/managed/routes.tsx for N6 to mount.
Done when: frontend tsc green with the mock client. Report per R12.

## N5 API-Wiring (role R7)  [after N2 and N3]
Inputs: SPEC §6.3, §6.6, §6.8, §7, N1 API.md, N2 models, N3 chain modules.
Exclusive files: backend/src/managed/routes/** (admin.ts, view.ts), backend/src/managed/middleware/**
  (featureFlag.ts, keyVaultGuard.ts, requireRecentReauth.ts, viewRateLimit.ts), backend/src/managed/index.ts,
  backend/src/managed/service/** (poolService.ts, walletService.ts, transferService.ts, treasuryService.ts,
  tokenService.ts), backend/src/lib/password.ts, backend/test/managed/api.test.ts, and the allowed edits to
  backend/src/index.ts, backend/src/routes/auth.ts, backend/src/types/express.d.ts, backend/package.json
  (express-rate-limit, supertest lines).
Tasks:
 a. lib/password.ts: move hashPassword from routes/auth.ts unchanged (PBKDF2-SHA512, 100000 iterations,
    64 bytes, hex) and import it back in auth.ts. Add verifyPassword(user, password) with timingSafeEqual.
 b. Services: thin orchestration over N2 models and N3 chain modules. Create pool = validate or generate
    mnemonic → derive master address → encrypt with pool id as AAD → insert → audit. Generate = reserveIndexes
    → addressesFor → insertMany with fresh view tokens (crypto.randomBytes(32).toString('hex')) → audit.
    Transfer = plan via N3 planner (dry run endpoint) → create job with idempotency key → worker picks it up.
    Sweep = enumerate (wallet, asset) pairs with non-zero balance → createBatch. Treasury = aggregates.
 c. Routers exactly per SPEC §6.6 including guards order requireAdmin → featureFlag → keyVaultGuard
    (→ requireRecentReauth on sensitive routes). Public /api/view/:viewToken with express-rate-limit
    (MANAGED_VIEW_RATE_LIMIT_PER_MIN) and the exact response shape (no pool, no index, no other wallets).
    CSV export with no key material.
 d. managed/index.ts: mountManagedWallets(app) that mounts /api/admin/managed and /api/view only when
    MANAGED_WALLETS_ENABLED === "true"; startManagedWorkers() starting the indexer (if MANAGED_INDEXER_ENABLED)
    and the transfer worker; stopManagedWorkers() awaited in shutdown. Apply the allowed edits to
    backend/src/index.ts exactly as SPEC §7 describes (mount after existing routers and before the 404
    handler; start after listen; stop inside shutdown). Keep the webhook route before express.json().
 e. express.d.ts: additive SessionData augmentation for managedReauthAt.
 f. api.test.ts (supertest): flag off → 404 on /api/admin/managed/health; flag on, non-admin → 403;
    admin without reauth → 401 on POST /pools; view route rate limited. Use fakes for the pool if no
    throwaway DB is available and say so.
Done when: backend tsc green, app boots with the flag off and on (`npm run dev` smoke with curl), tests
  green. Report per R12 including the exact diff applied to index.ts and auth.ts.

## N6 Frontend-Integration (role R6)  [after N4 and N5]
Inputs: SPEC §5 (F11, F12, flow 7), §6.7, N1 API.md, N4 routes.tsx, N5 routers.
Exclusive files: frontend/src/lib/managedApi.ts, frontend/src/pages/WalletViewPage.tsx,
  frontend/src/components/managed/QrCode.tsx, and the allowed edits to frontend/src/App.tsx,
  frontend/src/components/layout/Sidebar.tsx, frontend/src/pages/admin/AdminLayout.tsx, frontend/package.json
  (qrcode, @types/qrcode).
Tasks:
 a. managedApi.ts: typed client over the existing axios instance in frontend/src/lib/api.ts for every endpoint
    in API.md; replace the N4 mock import in exactly one place (the `managedApi` entry module) without editing
    N4 pages.
 b. WalletViewPage.tsx: standalone layout like PaymentResult.tsx (no Shell), theme toggle, address with copy
    and QR, network badge, BNB and token balances, last 50 deposits with BscScan links, "Updated X ago",
    refresh, "Powered by HolderForge". No action controls. 404 state for an unknown token.
 c. App.tsx: mount `managedAdminRoutes` under the existing /admin ProtectedRoute requireAdmin, and add the
    public /w/:viewToken route outside ProtectedRoute. Sidebar.tsx and AdminLayout.tsx: add MANAGED and
    TREASURY entries, rendered only when the user is ADMIN and GET /api/admin/managed/health returns
    enabled true (a 404 hides them). Use one small hook useManagedEnabled() in managedApi.ts.
 d. Smoke the whole admin flow against a local backend with the flag on and a throwaway DB if available:
    create pool → generate → view link opens → settings page shows indexer status.
Done when: frontend tsc green and `npm run build` green. Report per R12.

## N7 Security-Review (role R8)  [parallel with N8]
Inputs: all code under backend/src/managed, frontend managed files, the allowed edits, SPEC §6.3, §6.9.
Exclusive files: docs/managed-wallets/SECURITY_REVIEW.md. Read-only on code.
Tasks: threat model (key at rest, key in memory, logs, API responses, CSV export, view tokens, re-auth window,
  rate limits, IDOR on wallet and job ids across pools and owners, SQL injection in dynamic filters, CSRF posture
  of the cookie session, sweep destination validation, replay via idempotency keys, restart double-send).
  Grep for any path by which a mnemonic, private key, or ciphertext could reach a log, response, or file.
  Produce findings with severity (High/Medium/Low), file and line, and the exact fix. The orchestrator routes
  each finding to the owning node for a fix, then you re-verify and close it.
Done when: zero open High findings, all Medium findings either fixed or accepted with a written reason.

## N8 QA (role R9)  [parallel with N7]
Inputs: SPEC §9, all code, N1 docs.
Exclusive files: backend/test/managed/** except files owned by N2, N3, N5; backend/scripts/managed/testnet-e2e.ts;
  docs/managed-wallets/TEST_PLAN.md.
Tasks:
 a. Extend unit tests where coverage is thin (treasury aggregation math, CSV export has no key columns,
    view response shape excludes pool and index, redaction in every logger call path).
 b. testnet-e2e.ts: a manual script (requires a funded testnet key in env, never committed) that creates a
    pool, generates 3 wallets, deploys ABCToken with the existing deploy:token script instructions, sends
    tBNB and ABC to wallet 1, waits for the indexer, then runs a transfer with top-up and prints both hashes.
    It must refuse to run against bscMainnet.
 c. TEST_PLAN.md: map every acceptance criterion in SPEC §9 to a test or a manual step; include the flag-off
    regression checklist for the existing wizard (Setup → Generate → Plan → Distribute → Results on testnet)
    and the exact curl checks proving the HTTP surface is unchanged with the flag off.
 d. Execute everything executable now: `npm test`, both tsc, both builds, flag-off boot plus curl checks.
Done when: all executable checks are green and TEST_PLAN.md marks what remains manual.

## N9 DevOps-Docs (role R10)  [after N7 and N8]
Inputs: SPEC §6.8, §7, HANDOFF §5 and §6, N7 and N8 outputs.
Exclusive files: backend/.env.example, docs/managed-wallets/RUNBOOK.md, docs/managed-wallets/PR_DESCRIPTION.md,
  README.md (a short "Managed Wallets" section only).
Tasks: .env.example gets the SPEC §6.8 block plus the already-missing vars listed in HANDOFF §5.
  RUNBOOK.md: generate key, store key and phrases offline, add vars to the k8s secret holderforge-backend-env,
  deploy with the flag off, run `node dist/migrate.js` inside the backend pod, flip the flag, restart, verify
  /api/admin/managed/health, rollback steps, what to do if the key is lost. PR_DESCRIPTION.md: summary, scope,
  screenshots placeholders, test evidence from N8, security sign-off from N7, deploy order. No changes to k8s
  manifests or the CI workflow are needed; say so explicitly.
Done when: docs complete and consistent with the final code.

## N10 Final gate (you)
1. (cd backend && npx tsc --noEmit -p tsconfig.json && npm test && npm run build)
2. (cd frontend && npx tsc --noEmit && npm run build)
3. Flag-off regression: start the backend with MANAGED_WALLETS_ENABLED unset, curl /health, /api/auth/me,
   and confirm /api/admin/managed/health returns 404 and the frontend nav has no new entries.
4. `git status` shows only files allowed by SPEC §4 and §7; `git diff main --stat` is reviewed by you.
5. Commit, then print the final report:
      BRANCH, COMMITS, FILES BY NODE, GATES (each command and result), ACCEPTANCE CRITERIA STATUS (1..10 with
      evidence or "manual: see TEST_PLAN.md"), OPEN SECURITY FINDINGS, OPEN QUESTIONS, NEXT STEPS FOR THE HUMAN
      (open the PR, run the testnet e2e with a funded key, production runbook order).
Do not push. Stop after the report.

# 4. If anything blocks you
Stop the affected node, report the blocker with the exact error, propose the smallest change, and continue
with any node whose dependencies are satisfied. Never work around a blocker by editing a frozen file.
````
