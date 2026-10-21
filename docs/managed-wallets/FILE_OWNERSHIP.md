# Managed Wallets — File ownership (binding)

One owner per path. An agent that needs a change outside its list writes the request in its report; the orchestrator routes it to the owner. Paths are repo-relative. `**` means every file below that folder.

## N1 Architect (done)
- `docs/managed-wallets/ARCHITECTURE.md`, `docs/managed-wallets/API.md`, `docs/managed-wallets/FILE_OWNERSHIP.md`
- `backend/migrations/0000_baseline.sql`, `backend/migrations/0001_managed_wallets.sql`
- `backend/src/managed/types.ts`, `frontend/src/lib/managedTypes.ts`

## N2 Backend-Data
- `backend/src/migrate.ts`
- `backend/src/managed/models/**` (`pools.ts`, `wallets.ts`, `tokens.ts`, `balances.ts`, `deposits.ts`, `transfers.ts`, `indexerState.ts`, `audits.ts`)
- `backend/src/managed/keyVault.ts`, `backend/src/managed/derive.ts`, `backend/src/managed/audit.ts`, `backend/src/managed/redact.ts`
- `backend/scripts/managed/gen-key.ts`
- `backend/test/managed/keyVault.test.ts`, `backend/test/managed/derive.test.ts`, `backend/test/managed/redact.test.ts`
- `backend/vitest.config.ts`
- `backend/package.json`: ONLY the lines for scripts `migrate`, `migrate:dev`, `managed:gen-key`, `test` and devDependency `vitest`

## N3 Blockchain-Core
- `backend/src/managed/chain/**` (`ports.ts`, `rpc.ts`, `multicall.ts`, `fees.ts`, `indexer.ts`, `balances.ts`, `transferPlanner.ts`, `transferWorker.ts`)
- `backend/test/managed/transferPlanner.test.ts`, `backend/test/managed/indexer.test.ts`, `backend/test/managed/fixtures/**`

## N4 Frontend-Admin
- `frontend/src/pages/admin/managed/**` (`routes.tsx`, `PoolsPage.tsx`, `PoolDetailPage.tsx`, `TreasuryPage.tsx`, `TransferJobsPage.tsx`, `ManagedSettingsPage.tsx`)
- `frontend/src/components/managed/**` EXCEPT `QrCode.tsx`
- `frontend/src/lib/managedApi.mock.ts`

## N5 API-Wiring
- `backend/src/managed/routes/**` (`admin.ts`, `view.ts`)
- `backend/src/managed/middleware/**` (`featureFlag.ts`, `keyVaultGuard.ts`, `requireRecentReauth.ts`, `viewRateLimit.ts`)
- `backend/src/managed/service/**` (`poolService.ts`, `walletService.ts`, `transferService.ts`, `treasuryService.ts`, `tokenService.ts`)
- `backend/src/managed/index.ts`
- `backend/src/lib/password.ts`
- `backend/test/managed/api.test.ts`
- Allowed edits: `backend/src/index.ts`, `backend/src/routes/auth.ts`, `backend/src/types/express.d.ts`, `backend/package.json` (ONLY `express-rate-limit`, `supertest`, `@types/supertest` lines)

## N6 Frontend-Integration
- `frontend/src/lib/managedApi.ts`
- `frontend/src/pages/WalletViewPage.tsx`
- `frontend/src/components/managed/QrCode.tsx`
- Allowed edits: `frontend/src/App.tsx`, `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/pages/admin/AdminLayout.tsx`, `frontend/package.json` (ONLY `qrcode`, `@types/qrcode` lines)

## N7 Security-Review
- `docs/managed-wallets/SECURITY_REVIEW.md` (read-only on all code)

## N8 QA
- `backend/test/managed/**` EXCEPT files owned by N2, N3, N5
- `backend/scripts/managed/testnet-e2e.ts`
- `docs/managed-wallets/TEST_PLAN.md`

## N9 DevOps-Docs
- `backend/.env.example`
- `docs/managed-wallets/RUNBOOK.md`, `docs/managed-wallets/PR_DESCRIPTION.md`
- `README.md` (a short "Managed Wallets" section only)

## Allowed edits to existing files (from SPEC §7, exact scope)

| File | Owner | Allowed change |
|---|---|---|
| `backend/src/index.ts` | N5 | Import `mountManagedWallets`, `startManagedWorkers`, `stopManagedWorkers` from `./managed`; call mount after the existing routers and before the 404 handler (guarded by the flag inside `mountManagedWallets`); start workers in `start()` after `listen`; `await stopManagedWorkers()` at the top of `shutdown()`. The webhook route stays before `express.json()`. Nothing else moves. |
| `backend/src/routes/auth.ts` | N5 | Replace the local `hashPassword` body with an import from `../lib/password` (identical algorithm: PBKDF2-SHA512, 100000 iterations, 64 bytes, hex). |
| `backend/src/types/express.d.ts` | N5 | Additive `declare module "express-session" { interface SessionData { managedReauthAt?: number } }`. |
| `backend/package.json` | N2 / N5 | Scripts `migrate`, `migrate:dev`, `managed:gen-key`, `test`; devDeps `vitest`, `supertest`, `@types/supertest`; dep `express-rate-limit`. (The uncommitted `recover:hd` script line already present on this branch is pre-existing work and stays.) |
| `backend/tsconfig.json` | N2 | Only if needed to exclude `test/**` from `include`; `tsconfig.build.json` keeps `rootDir: src`. |
| `backend/.env.example` | N9 | Append the SPEC §6.8 block plus the already-missing vars from HANDOFF §5. |
| `frontend/src/App.tsx` | N6 | Add the routes listed in SPEC §6.7. |
| `frontend/src/components/layout/Sidebar.tsx` | N6 | Add "MANAGED" and "TREASURY" nav entries for ADMIN when enabled. |
| `frontend/src/pages/admin/AdminLayout.tsx` | N6 | Add tabs "Managed", "Treasury". |
| `frontend/package.json` | N6 | Add dep `qrcode` and devDep `@types/qrcode`. |

## Frozen (no edits by anyone)
`backend/scripts/*.ts` (existing files), `backend/contracts/*`, `backend/src/lib/runner.ts`, `backend/src/lib/plans.ts`, `backend/src/lib/distributionBatching.ts`, `backend/src/lib/postgres.ts`, `backend/src/lib/sessionAccess.ts`, `backend/src/lib/sessionAudit.ts`, `backend/src/models/*`, `backend/src/routes/*` except `auth.ts` as above, `backend/src/middleware/*`, `backend/src/config/*`, `backend/hardhat.config.ts`, `backend/Dockerfile`, `frontend/src/shared/plans.ts`, `frontend/src/lib/distributionBatching.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/store.ts`, `frontend/src/pages/{Setup,Generate,Plan,Distribute,Results,History}Page.tsx`, `frontend/src/pages/{Landing,Pricing,Login,Onboarding,PaymentResult,Account}.tsx`, `frontend/src/pages/admin/{AdminOverview,AdminUsers,AdminPayments}.tsx`, `frontend/src/components/ui/*`, `frontend/src/components/layout/{Shell,TopBar}.tsx`, `frontend/src/components/marketing/*`, `frontend/Dockerfile`, `frontend/nginx.conf`, `k8s/*`, `.github/workflows/*`, `docker-compose.yml`.

## Throwaway test database
Container `managed-pg-test` (postgres:16) is running with `postgres://postgres:test@localhost:55432/managed_test`; migration `0001` is already applied there. Never use the `DATABASE_URL` from `backend/.env` in tests.
