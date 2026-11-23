/**
 * Monitored addresses service (internal tool).
 * Admin manually enters a name label, wallet address, and private key for
 * balance/monitoring. Stored plaintext per owner choice.
 */
import { monitoredAddresses } from "../models/monitoredAddresses";
import { requireString, requireAddress } from "./common";
import { badRequest, conflict, notFound } from "./errors";
import { recordManagedAudit } from "../audit";
import { ManagedAuditAction } from "../types";

export interface MonitoredAddressDto {
  id: string;
  ownerUserId: string;
  name: string;
  address: string;
  /** Never included in list responses — only in the create/update response. */
  privateKey?: string;
  createdAt: string;
  updatedAt: string;
}

function toDto(record: any, includePrivateKey = false): MonitoredAddressDto {
  return {
    id: record.id,
    ownerUserId: record.ownerUserId,
    name: record.name,
    address: record.address,
    ...(includePrivateKey ? { privateKey: record.privateKey } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function listMonitoredAddresses(ownerUserId: string): Promise<MonitoredAddressDto[]> {
  const rows = await monitoredAddresses.listByOwner(ownerUserId);
  return rows.map((r) => toDto(r));
}

export async function getMonitoredAddress(
  id: string,
  ownerUserId: string
): Promise<MonitoredAddressDto> {
  const row = await monitoredAddresses.findById(id);
  if (!row) throw notFound("MONITORED_ADDRESS_NOT_FOUND", "Monitored address not found");
  if (row.ownerUserId !== ownerUserId) throw notFound("MONITORED_ADDRESS_NOT_FOUND", "Monitored address not found");
  return toDto(row, true);
}

export async function createMonitoredAddress(
  ownerUserId: string,
  body: { name?: unknown; address?: unknown; privateKey?: unknown }
): Promise<MonitoredAddressDto> {
  const name = requireString(body?.name, "name", 200);
  const address = requireAddress(body?.address, "address");
  const privateKey = requireString(body?.privateKey, "privateKey", 66);

  // Normalize to 0x-prefixed 64-hex.
  const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedKey)) {
    throw badRequest("INVALID_PRIVATE_KEY", "Private key must be 64 hex characters (with or without 0x)");
  }

  const existing = await monitoredAddresses.findByAddress(address);
  if (existing) {
    throw conflict("ADDRESS_ALREADY_MONITORED", "This address is already monitored", { id: existing.id });
  }

  const created = await monitoredAddresses.create({
    ownerUserId,
    name,
    address,
    privateKey: normalizedKey,
  });

  await recordManagedAudit({
    userId: ownerUserId,
    action: "MONITORED_ADDRESS_CREATED",
    details: { name, address },
  });

  return toDto(created, true);
}

export async function updateMonitoredAddress(
  id: string,
  ownerUserId: string,
  body: { name?: unknown; address?: unknown; privateKey?: unknown }
): Promise<MonitoredAddressDto> {
  const existing = await monitoredAddresses.findById(id);
  if (!existing) throw notFound("MONITORED_ADDRESS_NOT_FOUND", "Monitored address not found");
  if (existing.ownerUserId !== ownerUserId) throw notFound("MONITORED_ADDRESS_NOT_FOUND", "Monitored address not found");

  const patch: { name?: string; address?: string; privateKey?: string } = {};
  if (body?.name !== undefined) patch.name = requireString(body.name, "name", 200);
  if (body?.address !== undefined) patch.address = requireAddress(body.address, "address");
  if (body?.privateKey !== undefined) {
    const pk = requireString(body.privateKey, "privateKey", 66);
    patch.privateKey = pk.startsWith("0x") ? pk : `0x${pk}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(patch.privateKey)) {
      throw badRequest("INVALID_PRIVATE_KEY", "Private key must be 64 hex characters (with or without 0x)");
    }
  }

  // If the address changed, ensure no conflict.
  if (patch.address && patch.address.toLowerCase() !== existing.address.toLowerCase()) {
    const taken = await monitoredAddresses.findByAddress(patch.address);
    if (taken && taken.id !== id) {
      throw conflict("ADDRESS_ALREADY_MONITORED", "This address is already monitored", { id: taken.id });
    }
  }

  const updated = await monitoredAddresses.update(id, patch);
  if (!updated) throw notFound("MONITORED_ADDRESS_NOT_FOUND", "Monitored address not found");

  await recordManagedAudit({
    userId: ownerUserId,
    action: "MONITORED_ADDRESS_UPDATED",
    details: { id, name: patch.name, address: patch.address },
  });

  return toDto(updated, true);
}

export async function deleteMonitoredAddress(id: string, ownerUserId: string): Promise<void> {
  const existing = await monitoredAddresses.findById(id);
  if (!existing) throw notFound("MONITORED_ADDRESS_NOT_FOUND", "Monitored address not found");
  if (existing.ownerUserId !== ownerUserId) throw notFound("MONITORED_ADDRESS_NOT_FOUND", "Monitored address not found");

  const deleted = await monitoredAddresses.delete(id);
  if (!deleted) throw notFound("MONITORED_ADDRESS_NOT_FOUND", "Monitored address not found");

  await recordManagedAudit({
    userId: ownerUserId,
    action: "MONITORED_ADDRESS_DELETED",
    details: { id, name: existing.name, address: existing.address },
  });
}
