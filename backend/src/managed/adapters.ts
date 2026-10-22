/**
 * Model-to-port adapters: the concrete N2 implementations of every interface
 * in chain/ports.ts. The chain layer never imports models; this file is the
 * only place that joins the two (ARCHITECTURE.md §1).
 */
import { recordManagedAudit } from "./audit";
import type {
  AuditPort,
  BalancesPort,
  DepositsPort,
  IndexerStatePort,
  LoggerPort,
  PickedJob,
  PoolsPort,
  TokensPort,
  TransfersPort,
  VaultPort,
  WalletsPort,
} from "./chain/ports";
import { decryptSecret } from "./keyVault";
import { balances } from "./models/balances";
import { deposits } from "./models/deposits";
import { indexerState } from "./models/indexerState";
import { pools } from "./models/pools";
import { tokens } from "./models/tokens";
import { transfers } from "./models/transfers";
import type { TransferPatch } from "./models/transfers";
import { importedKeyAad, wallets } from "./models/wallets";
import { managedLog } from "./redact";
import { encodeError } from "./service/transferService";

export const poolsPort: PoolsPort = {
  findById: (id) => pools.findById(id),
  listActive: () => pools.listAll({ status: "ACTIVE" }),
};

export const walletsPort: WalletsPort = {
  findById: (id) => wallets.findById(id),
  async listActiveAddressesByNetwork(network) {
    const rows = await wallets.listActiveAddressesByNetwork(network);
    return rows.map((r) => ({ walletId: r.id, poolId: r.poolId, address: r.address }));
  },
};

export const tokensPort: TokensPort = {
  async upsertDiscovered(input) {
    await tokens.upsertDiscovered(input);
  },
  listByNetwork: (network, includeHidden) => tokens.listByNetwork(network, includeHidden),
};

export const balancesPort: BalancesPort = {
  upsertMany: (rows) => balances.upsertMany(rows),
  upsertMaster: (rows) => balances.upsertMaster(rows),
};

export const depositsPort: DepositsPort = {
  insertManyIgnoreDuplicates: (rows) => deposits.insertManyIgnoreDuplicates(rows),
};

export const transfersPort: TransfersPort = {
  async pickNextPending(): Promise<PickedJob | null> {
    const picked = await transfers.pickNextPending();
    if (!picked) return null;
    return {
      job: picked.job,
      commit: () => transfers.release(picked.client, true),
      rollback: () => transfers.release(picked.client, false),
    };
  },

  /**
   * The table has one `error TEXT` column; the typed code is persisted as a
   * prefix (`"<CODE>: <message>"`) and parsed back by the service layer.
   */
  async update(id, patch) {
    const { errorCode, error, ...rest } = patch;
    const modelPatch: TransferPatch = { ...rest };
    if (errorCode !== undefined || error !== undefined) {
      modelPatch.error = errorCode === null && error === undefined ? null : encodeError(errorCode, error);
    }
    await transfers.update(id, modelPatch);
  },

  findById: (id) => transfers.findById(id),
  listInterrupted: () => transfers.listInterrupted(),
};

export const indexerStatePort: IndexerStatePort = {
  async get(network) {
    const row = await indexerState.get(network);
    if (!row) return null;
    return {
      network: row.network,
      lastScannedBlock: row.lastScannedBlock,
      lastRunAt: row.lastRunAt ? new Date(row.lastRunAt) : null,
      lastError: row.lastError,
    };
  },
  async upsert({ network, ...patch }) {
    await indexerState.upsert(network, patch);
  },
};

export const vaultPort: VaultPort = {
  async decryptMnemonic(poolId) {
    const secret = await pools.getSecret(poolId);
    if (!secret) throw new Error("Pool not found");
    return decryptSecret(secret, poolId);
  },
  async decryptWalletKey(walletId) {
    const key = await wallets.getImportedKey(walletId);
    if (!key) throw new Error("Wallet has no imported key");
    return decryptSecret(key, importedKeyAad(walletId));
  },
};

export const auditPort: AuditPort = {
  create: (input) => recordManagedAudit(input),
};

/** LoggerPort over managedLog: every argument is redacted before printing. */
export const loggerPort: LoggerPort = {
  info: (message, meta) => managedLog("info", message, meta),
  warn: (message, meta) => managedLog("warn", message, meta),
  error: (message, meta) => managedLog("error", message, meta),
};
