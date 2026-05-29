import { hostname } from "node:os";

import { applyManifest } from "./apply";
import { CcSyncClient, type CcSyncRemoteClient } from "./client";
import { getDeviceInfo, loadConfig, saveConfig } from "./config";
import { scanManifest } from "./manifest";
import type { AgentAdapter } from "./adapters";
import type { ApplyResult, CcSyncConfig, CcSyncManifest, SyncResult } from "./types";

export interface SyncOptions {
  adapters?: AgentAdapter[];
  client?: CcSyncRemoteClient;
  saveConfig?: (config: CcSyncConfig) => Promise<void>;
}

export async function scanLocalManifest(
  config?: CcSyncConfig,
  options?: Pick<SyncOptions, "adapters">,
): Promise<CcSyncManifest> {
  const loaded = config ?? (await loadConfig());
  return await scanManifest({
    deviceId: loaded.deviceId,
    machineName: hostname(),
    adapters: options?.adapters,
  });
}

export async function pushLocalManifest(
  config: CcSyncConfig,
  options?: SyncOptions,
): Promise<SyncResult> {
  const manifest = await scanLocalManifest(config, options);
  const client = options?.client ?? new CcSyncClient(config);
  const persistConfig = options?.saveConfig ?? saveConfig;
  const device = getDeviceInfo(config, manifest.agents.filter((agent) => agent.detected).length);
  await client.registerDevice(device);
  const result = await client.pushManifest(manifest);
  await persistConfig({
    ...config,
    lastSyncAt: Date.now(),
    lastPushedHash: manifest.hash,
    lastPulledRevision: result.revision,
  });
  return {
    ok: true,
    changed: result.changed,
    revision: result.revision,
    message: result.changed
      ? `Pushed manifest revision ${result.revision}`
      : "Remote manifest already matches local state",
  };
}

export async function pullRemoteManifest(
  config: CcSyncConfig,
  options?: SyncOptions,
): Promise<SyncResult & { applyResult?: ApplyResult }> {
  const client = options?.client ?? new CcSyncClient(config);
  const persistConfig = options?.saveConfig ?? saveConfig;
  const pulled = await client.pullManifest();
  if (!pulled) {
    return { ok: true, changed: false, message: "No remote manifest exists yet" };
  }
  if (pulled.manifest.deviceId === config.deviceId && pulled.hash === config.lastPushedHash) {
    await persistConfig({
      ...config,
      lastSyncAt: Date.now(),
      lastPulledRevision: pulled.revision,
    });
    return {
      ok: true,
      changed: false,
      revision: pulled.revision,
      message: "Remote manifest is this device's latest push",
    };
  }
  if (config.lastPulledRevision && pulled.revision <= config.lastPulledRevision) {
    return { ok: true, changed: false, revision: pulled.revision, message: "Already up to date" };
  }
  const applyResult = await applyManifest(pulled.manifest, { adapters: options?.adapters });
  await persistConfig({
    ...config,
    lastSyncAt: Date.now(),
    lastPulledRevision: pulled.revision,
  });
  const changedCount = applyResult.changes.filter(
    (change) => change.action === "created" || change.action === "updated",
  ).length;
  return {
    ok: true,
    changed: changedCount > 0,
    revision: pulled.revision,
    message: `Pulled revision ${pulled.revision}; ${changedCount} local updates applied`,
    applyResult,
  };
}
