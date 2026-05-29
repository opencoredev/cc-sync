import { hostname } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { CcSyncConfig, DeviceInfo } from "./types";
import { ensureDir, readJson, sha256, writeJson } from "./fs-utils";

const CONFIG_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? ".", ".config"),
  "ccsync",
);
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const STATE_PATH = join(CONFIG_DIR, "state.json");
export const DEFAULT_DEBOUNCE_MS = 20_000;
export const DEFAULT_POLL_MS = 60_000;
export const CCSYNC_VERSION = "0.1.0";

export async function loadConfig(): Promise<CcSyncConfig> {
  const existing = await readJson<Partial<CcSyncConfig>>(CONFIG_PATH);
  const machineId = existing?.machineId ?? computeMachineId();
  return {
    deviceId: existing?.deviceId ?? `dev_${machineId.slice(0, 16)}`,
    deviceLabel: existing?.deviceLabel ?? hostname(),
    machineId,
    paused: existing?.paused ?? false,
    debounceMs: existing?.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    pollMs: existing?.pollMs ?? DEFAULT_POLL_MS,
    convexUrl: existing?.convexUrl ?? process.env.CCSYNC_CONVEX_URL ?? process.env.VITE_CONVEX_URL,
    siteUrl: existing?.siteUrl ?? process.env.CCSYNC_SITE_URL,
    tokenHash:
      existing?.tokenHash ??
      (process.env.CCSYNC_TOKEN ? hashToken(process.env.CCSYNC_TOKEN) : undefined),
    tokenPrefix: existing?.tokenPrefix ?? tokenPrefix(process.env.CCSYNC_TOKEN),
    lastSyncAt: existing?.lastSyncAt,
    lastPulledRevision: existing?.lastPulledRevision,
    lastPushedHash: existing?.lastPushedHash,
  };
}

export async function saveConfig(config: CcSyncConfig): Promise<void> {
  await ensureDir(CONFIG_DIR);
  await writeJson(CONFIG_PATH, config, 0o600);
}

export function getDeviceInfo(config: CcSyncConfig, agentCount: number): DeviceInfo {
  return {
    deviceId: config.deviceId,
    label: config.deviceLabel,
    hostname: hostname(),
    platform: process.platform,
    arch: process.arch,
    machineId: config.machineId,
    agentCount,
    ccsyncVersion: CCSYNC_VERSION,
  };
}

export function hashToken(token: string): string {
  return sha256(token.trim());
}

export function tokenPrefix(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const trimmed = token.trim();
  return trimmed.length <= 14 ? trimmed : `${trimmed.slice(0, 10)}...${trimmed.slice(-4)}`;
}

export async function promptForConfig(existing: CcSyncConfig): Promise<CcSyncConfig> {
  const rl = createInterface({ input, output });
  try {
    const convexUrl = await rl.question(`Convex URL [${existing.convexUrl ?? "required"}]: `);
    const siteUrl = await rl.question(`Web account URL [${existing.siteUrl ?? "optional"}]: `);
    const deviceLabel = await rl.question(`Device label [${existing.deviceLabel}]: `);
    const rawToken = await rl.question("CLI token from the ccsync web account page: ");
    const next: CcSyncConfig = {
      ...existing,
      convexUrl: emptyToUndefined(convexUrl) ?? existing.convexUrl,
      siteUrl: emptyToUndefined(siteUrl) ?? existing.siteUrl,
      deviceLabel: emptyToUndefined(deviceLabel) ?? existing.deviceLabel,
    };
    const token = emptyToUndefined(rawToken);
    if (token) {
      next.tokenHash = hashToken(token);
      next.tokenPrefix = tokenPrefix(token);
    }
    return next;
  } finally {
    rl.close();
  }
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function computeMachineId(): string {
  return sha256(`${hostname()}|${process.platform}|${process.arch}|${process.env.HOME ?? ""}`);
}
