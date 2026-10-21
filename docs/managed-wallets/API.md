# Managed Wallets — API contract

Types referenced here are defined in `backend/src/managed/types.ts` (copy: `frontend/src/lib/managedTypes.ts`). All wei values are decimal strings. All errors use `{ "error": string, "code"?: string }`.

Guard chain for admin routes, in order:

1. `requireAdmin` (existing middleware) → 403 `{ error: "Forbidden" }`
2. `featureFlag` → routes are not mounted at all when `MANAGED_WALLETS_ENABLED !== "true"` (plain 404)
3. `keyVaultGuard` → 503 `{ error, code: "KEY_VAULT_UNAVAILABLE" }`; also 503 `NOT_MIGRATED` when tables are missing
4. `requireRecentReauth` on routes marked **reauth** → 401 `{ error, code: "REAUTH_REQUIRED" }`

Base path: `/api/admin/managed`.

---

## Health and re-auth

### GET /health
Response `HealthResponse`
```json
{ "enabled": true, "keyVault": "ok", "migrated": true,
  "indexer": { "enabled": true, "lastBlockByNetwork": { "bscTestnet": 45123456 } } }
```

### POST /reauth
Request `ReauthRequest` `{ "password": "…" }`
Response `ReauthResponse` `{ "ok": true, "validUntil": "2026-10-21T10:20:00.000Z" }`
Errors: 401 `INVALID_PASSWORD`. Stamps `req.session.managedReauthAt`. Validity window: 10 minutes.

---

## Pools

### GET /pools
Response `ListPoolsResponse`
```json
{ "pools": [ { "id": "6d1…", "name": "Community A", "network": "bscTestnet",
  "masterAddress": "0xAbC…", "walletCount": 120, "status": "ACTIVE", "createdAt": "…" } ] }
```

### POST /pools  **reauth**
Request `CreatePoolRequest`
```json
{ "name": "Community A", "network": "bscTestnet", "mnemonic": "optional twelve words …" }
```
Response 201 `CreatePoolResponse` `{ "pool": Pool, "masterAddress": "0x…" }`
Errors: 400 `INVALID_MNEMONIC`, 400 `VALIDATION`.

### GET /pools/:id
Response `GetPoolResponse` `{ "pool": Pool, "stats": { "wallets": 120, "assetsTracked": 3, "lastDepositAt": "…"|null } }`
Errors: 404 `POOL_NOT_FOUND`.

### PATCH /pools/:id
Request `UpdatePoolRequest` `{ "name"?: string, "status"?: "ACTIVE"|"ARCHIVED" }`
Response `UpdatePoolResponse`. Audit `POOL_UPDATED` / `POOL_ARCHIVED`.

### POST /pools/:id/reveal-mnemonic  **reauth**
Response `RevealMnemonicResponse` `{ "mnemonic": "…", "masterAddress": "0x…", "accountPath": "m/44'/60'/0'/0" }`
Side effects: `mnemonic_revealed_at` set, audit `MNEMONIC_REVEALED`. Never cached, `Cache-Control: no-store`.

### GET /export/pools/:id.csv
`text/csv` attachment `pool-<id>.csv` with columns `index,address,label,holder_name,holder_email,status,<one column per visible asset symbol>`. No keys, no view tokens. Audit `EXPORT_DOWNLOADED`.

---

## Wallets

### POST /pools/:id/wallets/generate
Request `GenerateWalletsRequest` `{ "count": 100, "labelPrefix": "member-" }` (1 ≤ count ≤ remaining limit)
Response 201 `GenerateWalletsResponse`
```json
{ "created": [ { "id": "…", "derivationIndex": 1, "address": "0x…" } ], "nextIndex": 101 }
```
Errors: 400 `POOL_LIMIT_REACHED`, 409 `POOL_ARCHIVED`.

### GET /pools/:id/wallets?skip=0&limit=50&search=
Response `ListWalletsResponse`
```json
{ "wallets": [ { "id": "…", "poolId": "…", "derivationIndex": 1, "address": "0x…", "label": "member-1",
  "holderName": null, "holderEmail": null, "holderUserId": null, "status": "ACTIVE",
  "createdAt": "…", "updatedAt": "…",
  "balances": [ { "asset": "native", "symbol": "tBNB", "name": "BNB", "decimals": 18,
                  "balanceWei": "0", "balance": "0", "blockNumber": 45123000, "updatedAt": "…", "hidden": false } ],
  "lastDepositAt": null } ], "total": 120 }
```
`search` matches address prefix, label, holder name, holder email (case-insensitive). Hidden tokens are omitted from `balances`.

### GET /wallets/:id
Response `GetWalletResponse` with `viewToken`, `viewUrl` (`${CLIENT_URL}/w/${viewToken}`), last 50 `deposits`, last 50 `transfers`.

### PATCH /wallets/:id
Request `UpdateWalletRequest` `{ "label"?, "holderName"?, "holderEmail"?, "holderUserEmail"?, "status"? }`
`holderUserEmail` resolves to `users.id` via the existing `User.findOne({ email })`; unknown email → 400 `USER_NOT_FOUND`; `null` unlinks.
Response `UpdateWalletResponse`. Audit `WALLET_ASSIGNED` / `WALLET_STATUS_CHANGED`.

### POST /wallets/:id/rotate-view-token  **reauth**
Response `RotateViewTokenResponse` `{ "viewToken": "…64 hex…", "viewUrl": "…" }`. Audit `VIEW_TOKEN_ROTATED`.

---

## Deposits and treasury

### GET /pools/:id/deposits?skip=0&limit=50&asset=
Response `ListDepositsResponse`
```json
{ "deposits": [ { "id": "…", "walletId": "…", "walletAddress": "0x…", "asset": "0xtoken…", "symbol": "ABC",
  "decimals": 18, "fromAddress": "0x…", "amountWei": "5000000000000000000", "amount": "5",
  "txHash": "0x…", "logIndex": 12, "blockNumber": 45123456, "blockTime": "…", "createdAt": "…" } ], "total": 7 }
```

### GET /pools/:id/treasury
Response `PoolTreasuryResponse`
```json
{ "poolId": "…", "network": "bscTestnet", "masterAddress": "0x…",
  "totals": [ { "asset": "0xtoken…", "symbol": "ABC", "name": "ABC", "decimals": 18,
                "totalWei": "123000000000000000000", "total": "123", "walletsWithBalance": 9 } ],
  "master": [ { "asset": "native", "symbol": "tBNB", "decimals": 18, "balanceWei": "…", "balance": "0.42" } ],
  "walletCount": 120, "lowGas": false, "updatedAt": "…" }
```
`lowGas` is true when master native balance < `MANAGED_TOPUP_BUFFER_WEI × 50` (enough for roughly 50 top-ups).

### GET /treasury
Response `GlobalTreasuryResponse` `{ totalsByNetwork: [...], byPool: PoolTreasuryResponse[], poolCount, walletCount }`.

---

## Transfers

### POST /transfers/plan
Request `PlanTransferRequest`
```json
{ "walletId": "…", "toAddress": "0x…", "asset": "0xtoken…", "amount": "12.5" }
```
or `{ …, "sweepAll": true }`. Dry run, no job created.
Response `PlanTransferResponse`
```json
{ "plan": { "ok": true, "gasLimit": "65000", "gasPriceWei": "100000000", "gasCostWei": "6500000000000",
  "topUpWei": "106500000000000", "amountWei": "12500000000000000000",
  "childNativeWei": "0", "masterNativeWei": "420000000000000000",
  "txs": [ { "kind": "topup", "from": "0xMaster", "to": "0xChild", "valueWei": "106500000000000" },
           { "kind": "transfer", "from": "0xChild", "to": "0xtoken…", "valueWei": "0", "data": "0xa9059cbb…" } ] } }
```
or `{ "plan": { "ok": false, "code": "MASTER_INSUFFICIENT_BNB", "message": "…" } }` (HTTP 200 either way).

### POST /transfers  **reauth**
Request `CreateTransferRequest` = plan request + `"idempotencyKey": "<client uuid>"`.
Response 201 `CreateTransferResponse` `{ "job": TransferJob }`; a repeated idempotency key returns 200 with the existing job.
Errors: 400 plan rejection (same codes as planner, returned as `code`), 409 `WALLET_DISABLED`, 409 `POOL_ARCHIVED`.

### POST /transfers/sweep  **reauth**
Request `SweepRequest`
```json
{ "poolId": "…", "walletIds": "ALL", "assets": "ALL", "toAddress": "0x… optional", "idempotencyKey": "<uuid>" }
```
Response 201 `SweepResponse` `{ "batchId": "…", "jobs": 37, "skipped": 83 }` (skipped = pairs with zero balance or hidden tokens).

### GET /transfers?poolId=&batchId=&status=&skip=0&limit=50
Response `ListTransfersResponse` `{ "jobs": TransferJob[], "total": 37, "byStatus": { "CONFIRMED": 30, "PENDING": 5, "FAILED": 2 } }`

### GET /transfers/:id
Response `GetTransferResponse` `{ "job": TransferJob }`

### POST /transfers/:id/retry  **reauth**
Only for `FAILED` jobs with `attempts < MANAGED_MAX_ATTEMPTS`; resets to `PENDING`. Response `{ "job": TransferJob }`. Errors: 409 `NOT_RETRYABLE`, 409 `MAX_ATTEMPTS`. Audit `TRANSFER_RETRIED`.

---

## Tokens and indexer

### GET /tokens?network=&includeHidden=false
Response `ListTokensResponse` `{ "tokens": ManagedToken[] }`

### POST /tokens
Request `TrackTokenRequest` `{ "network": "bscTestnet", "tokenAddress": "0x…" }` → metadata fetched on-chain.
Response 201 `TrackTokenResponse`. Errors: 400 `NOT_A_CONTRACT`, 409 `ALREADY_TRACKED` (returns the existing token with 200 if it was DISCOVERED and is now promoted to TRACKED). Audit `TOKEN_TRACKED`.

### PATCH /tokens/:id
Request `UpdateTokenRequest` `{ "hidden": true }` → Response `UpdateTokenResponse`. Audit `TOKEN_HIDDEN` / `TOKEN_UNHIDDEN`.

### GET /indexer/status
Response `IndexerStatusResponse`
```json
{ "byNetwork": [ { "network": "bscTestnet", "enabled": true, "lastScannedBlock": 45123400, "head": 45123456,
                   "lag": 56, "lastRunAt": "…", "lastError": null } ] }
```

### POST /indexer/run
Response 202 `IndexerRunResponse` `{ "started": true }`; no-op with 202 if a run is already in progress. Audit `INDEXER_RUN_REQUESTED`.

---

## Public holder view

### GET /api/view/:viewToken
No auth. Rate limited by `express-rate-limit`: `MANAGED_VIEW_RATE_LIMIT_PER_MIN` per IP per minute (429 on excess). Mounted only when the feature flag is on.
Response `WalletViewResponse`
```json
{ "label": "member-1", "address": "0x…", "network": "bscTestnet",
  "native": { "symbol": "tBNB", "balanceWei": "0", "balance": "0" },
  "tokens": [ { "tokenAddress": "0x…", "symbol": "ABC", "name": "ABC", "decimals": 18,
                "balanceWei": "5000000000000000000", "balance": "5" } ],
  "deposits": [ { "txHash": "0x…", "asset": "0x…", "symbol": "ABC", "decimals": 18,
                  "amountWei": "5000000000000000000", "amount": "5", "from": "0x…",
                  "blockNumber": 45123456, "blockTime": "…" } ],
  "updatedAt": "…" }
```
404 for unknown token, `DISABLED` wallet, or `ARCHIVED` pool. Never includes pool id, pool name, derivation index, other wallets, or any admin field. Hidden tokens are excluded. `Cache-Control: no-store`.
