import { ConvexHttpClient } from "convex/browser";

import { api } from "@cc-sync/backend/convex/_generated/api";

import type { CcSyncConfig, CcSyncManifest, DeviceInfo } from "./types";

export interface RemoteStatus {
  configured: boolean;
  devices: RemoteDevice[];
  manifest?: {
    revision: number;
    hash: string;
    updatedAt: number;
    updatedByDeviceId: string;
  };
}

export interface RemoteDevice {
  deviceId: string;
  label: string;
  hostname: string;
  platform: string;
  arch: string;
  agentCount: number;
  paused: boolean;
  lastSeenAt: number;
  lastPushAt?: number;
  lastPullAt?: number;
}

export interface CcSyncRemoteClient {
  registerDevice(device: DeviceInfo): Promise<void>;
  pushManifest(manifest: CcSyncManifest): Promise<{ revision: number; changed: boolean }>;
  pullManifest(): Promise<{
    revision: number;
    manifest: CcSyncManifest;
    hash: string;
  } | null>;
  status(): Promise<RemoteStatus>;
  heartbeat(device: DeviceInfo): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  removeDevice(deviceId: string): Promise<void>;
}

export class CcSyncClient implements CcSyncRemoteClient {
  private readonly client?: ConvexHttpClient;

  constructor(private readonly config: CcSyncConfig) {
    if (config.convexUrl) {
      this.client = new ConvexHttpClient(config.convexUrl);
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.client && this.config.tokenHash);
  }

  async registerDevice(device: DeviceInfo): Promise<void> {
    if (!this.client || !this.config.tokenHash)
      throw new Error("ccsync is not configured. Run ccsync init.");
    await this.client.mutation(api.sync.registerDeviceWithToken, {
      tokenHash: this.config.tokenHash,
      device,
    });
  }

  async pushManifest(manifest: CcSyncManifest): Promise<{ revision: number; changed: boolean }> {
    if (!this.client || !this.config.tokenHash)
      throw new Error("ccsync is not configured. Run ccsync init.");
    return await this.client.mutation(api.sync.pushManifestWithToken, {
      tokenHash: this.config.tokenHash,
      deviceId: this.config.deviceId,
      manifest,
    });
  }

  async pullManifest(): Promise<{
    revision: number;
    manifest: CcSyncManifest;
    hash: string;
  } | null> {
    if (!this.client || !this.config.tokenHash)
      throw new Error("ccsync is not configured. Run ccsync init.");
    return await this.client.query(api.sync.pullManifestWithToken, {
      tokenHash: this.config.tokenHash,
      deviceId: this.config.deviceId,
    });
  }

  async status(): Promise<RemoteStatus> {
    if (!this.client || !this.config.tokenHash) return { configured: false, devices: [] };
    return await this.client.query(api.sync.statusWithToken, {
      tokenHash: this.config.tokenHash,
      deviceId: this.config.deviceId,
    });
  }

  async heartbeat(device: DeviceInfo): Promise<void> {
    if (!this.client || !this.config.tokenHash) return;
    await this.client.mutation(api.sync.heartbeatWithToken, {
      tokenHash: this.config.tokenHash,
      device,
    });
  }

  async setPaused(paused: boolean): Promise<void> {
    if (!this.client || !this.config.tokenHash)
      throw new Error("ccsync is not configured. Run ccsync init.");
    await this.client.mutation(api.sync.setDevicePausedWithToken, {
      tokenHash: this.config.tokenHash,
      deviceId: this.config.deviceId,
      paused,
    });
  }

  async removeDevice(deviceId: string): Promise<void> {
    if (!this.client || !this.config.tokenHash)
      throw new Error("ccsync is not configured. Run ccsync init.");
    await this.client.mutation(api.sync.removeDeviceWithToken, {
      tokenHash: this.config.tokenHash,
      deviceId,
    });
  }
}
