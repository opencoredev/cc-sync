import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getAgentAdapters } from "../adapters";
import type { CcSyncRemoteClient, RemoteStatus } from "../client";
import { scanManifest } from "../manifest";
import { pullRemoteManifest, pushLocalManifest } from "../sync";
import type { CcSyncConfig, CcSyncManifest, DeviceInfo } from "../types";
import {
  createTempHome,
  must,
  readFixture,
  removeTempHome,
  seedAgentFixtures,
  withHome,
  writeFixture,
  writeJsonFixture,
} from "./test-utils";

const tempHomes: string[] = [];

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map(removeTempHome));
});

describe("two fake device sync smoke", () => {
  test("pushes from one fake device, pulls to another, and avoids same-content churn", async () => {
    const deviceAHome = await createTempHome("device-a");
    const deviceBHome = await createTempHome("device-b");
    tempHomes.push(deviceAHome, deviceBHome);
    await seedAgentFixtures(deviceAHome);

    const store = new FakeSyncStore();
    const deviceA = testConfig("device-a");
    const deviceB = testConfig("device-b");

    const pushA = await withHome(deviceAHome, async () =>
      pushLocalManifest(deviceA, syncOptions(store, deviceA)),
    );
    expect(pushA.changed).toBe(true);
    expect(pushA.revision).toBe(1);

    const pullB = await withHome(deviceBHome, async () =>
      pullRemoteManifest(deviceB, syncOptions(store, deviceB)),
    );
    expect(pullB.changed).toBe(true);
    expect(pullB.revision).toBe(1);

    expect(
      await readFixture(
        join(deviceBHome, ".codex", "skills", "custom-skills", "team-skill", "SKILL.md"),
      ),
    ).toContain("Keep the shared workflow in sync.");
    const cursorConfig = JSON.parse(
      await readFixture(join(deviceBHome, ".cursor", "mcp.json")),
    ) as { mcpServers: Record<string, { command: string; env?: Record<string, string> }> };
    const cursorTool = must(cursorConfig.mcpServers["cursor-tool"], "device B cursor MCP server");
    expect(cursorTool.command).toBe("bunx");
    expect(cursorTool.env?.PUBLIC_FLAG).toBe("yes");
    expect(cursorTool.env?.API_TOKEN).toBeUndefined();

    const scanB = await withHome(deviceBHome, async () =>
      scanManifest({
        deviceId: "device-b",
        machineName: "Fake Device B",
        adapters: getAgentAdapters(),
      }),
    );
    expect(scanB.hash).toBe(must(store.hash, "remote manifest hash"));

    const pushB = await withHome(deviceBHome, async () =>
      pushLocalManifest(deviceB, syncOptions(store, deviceB)),
    );
    expect(pushB.changed).toBe(false);
    expect(pushB.revision).toBe(1);
  });

  test("resolves fake-device conflicts with last write wins across agent harnesses", async () => {
    const deviceAHome = await createTempHome("conflict-a");
    const deviceBHome = await createTempHome("conflict-b");
    tempHomes.push(deviceAHome, deviceBHome);
    await seedAgentFixtures(deviceAHome);

    const store = new FakeSyncStore();
    const deviceA = testConfig("device-a");
    const deviceB = testConfig("device-b");

    await withHome(deviceAHome, async () =>
      pushLocalManifest(deviceA, syncOptions(store, deviceA)),
    );
    await withHome(deviceBHome, async () =>
      pullRemoteManifest(deviceB, syncOptions(store, deviceB)),
    );

    await seedConflictingDeviceBState(deviceBHome);

    const pushB = await withHome(deviceBHome, async () =>
      pushLocalManifest(deviceB, syncOptions(store, deviceB)),
    );
    expect(pushB.changed).toBe(true);
    expect(pushB.revision).toBe(2);

    const pullA = await withHome(deviceAHome, async () =>
      pullRemoteManifest(deviceA, syncOptions(store, deviceA)),
    );
    expect(pullA.changed).toBe(true);
    expect(pullA.revision).toBe(2);

    expect(
      await readFixture(
        join(deviceAHome, ".codex", "skills", "custom-skills", "team-skill", "SKILL.md"),
      ),
    ).toContain("Device B version wins.");
    const cursorConfig = JSON.parse(
      await readFixture(join(deviceAHome, ".cursor", "mcp.json")),
    ) as { mcpServers: Record<string, { command: string; args?: string[] }> };
    const cursorTool = must(cursorConfig.mcpServers["cursor-tool"], "device A cursor MCP server");
    expect(cursorTool.command).toBe("node");
    expect(cursorTool.args).toEqual(["cursor-v2.js"]);

    const codexConfig = await readFixture(join(deviceAHome, ".codex", "config.toml"));
    expect(codexConfig).toContain('args = ["codex-v2"]');
    const claudeConfig = JSON.parse(await readFixture(join(deviceAHome, ".claude.json"))) as {
      mcpServers: Record<string, { command: string }>;
    };
    expect(
      must(claudeConfig.mcpServers["claude-memory"], "device A Claude MCP server").command,
    ).toBe("uvx");

    const pushA = await withHome(deviceAHome, async () =>
      pushLocalManifest(deviceA, syncOptions(store, deviceA)),
    );
    expect(pushA.changed).toBe(false);
    expect(pushA.revision).toBe(2);
  });
});

class FakeSyncStore {
  revision = 0;
  manifest?: CcSyncManifest;
  hash?: string;
  updatedAt?: number;
  updatedByDeviceId?: string;
  devices = new Map<string, DeviceInfo>();

  push(deviceId: string, manifest: CcSyncManifest): { revision: number; changed: boolean } {
    const changed = this.hash !== manifest.hash;
    if (changed) {
      this.revision += 1;
      this.manifest = cloneManifest(manifest);
      this.hash = manifest.hash;
      this.updatedAt = Date.now();
      this.updatedByDeviceId = deviceId;
    }
    return { revision: this.revision, changed };
  }
}

class FakeClient implements CcSyncRemoteClient {
  constructor(
    private readonly store: FakeSyncStore,
    private readonly config: CcSyncConfig,
  ) {}

  async registerDevice(device: DeviceInfo): Promise<void> {
    this.store.devices.set(device.deviceId, device);
  }

  async pushManifest(manifest: CcSyncManifest): Promise<{ revision: number; changed: boolean }> {
    return this.store.push(this.config.deviceId, manifest);
  }

  async pullManifest(): Promise<{
    revision: number;
    manifest: CcSyncManifest;
    hash: string;
  } | null> {
    if (!this.store.manifest || !this.store.hash) return null;
    return {
      revision: this.store.revision,
      manifest: cloneManifest(this.store.manifest),
      hash: this.store.hash,
    };
  }

  async status(): Promise<RemoteStatus> {
    return {
      configured: true,
      devices: [...this.store.devices.values()].map((device) => ({
        ...device,
        paused: false,
        lastSeenAt: Date.now(),
      })),
      manifest:
        this.store.manifest && this.store.hash
          ? {
              revision: this.store.revision,
              hash: this.store.hash,
              updatedAt: this.store.updatedAt ?? Date.now(),
              updatedByDeviceId: this.store.updatedByDeviceId ?? "unknown",
            }
          : undefined,
    };
  }

  async heartbeat(device: DeviceInfo): Promise<void> {
    this.store.devices.set(device.deviceId, device);
  }

  async setPaused(_paused: boolean): Promise<void> {}

  async removeDevice(deviceId: string): Promise<void> {
    this.store.devices.delete(deviceId);
  }
}

function syncOptions(store: FakeSyncStore, config: CcSyncConfig) {
  return {
    adapters: getAgentAdapters(),
    client: new FakeClient(store, config),
    saveConfig: async (nextConfig: CcSyncConfig) => {
      Object.assign(config, nextConfig);
    },
  };
}

function testConfig(deviceId: string): CcSyncConfig {
  return {
    convexUrl: "https://fake.convex.cloud",
    tokenHash: "fake-token-hash",
    deviceId,
    deviceLabel: deviceId,
    machineId: `${deviceId}-machine`,
    paused: false,
    debounceMs: 20_000,
    pollMs: 60_000,
  };
}

async function seedConflictingDeviceBState(home: string): Promise<void> {
  await writeFixture(
    join(home, ".codex", "skills", "custom-skills", "team-skill", "SKILL.md"),
    `ccsync: custom
# Team Skill

Device B version wins.
`,
  );
  await writeJsonFixture(join(home, ".cursor", "mcp.json"), {
    mcpServers: {
      "cursor-tool": {
        command: "node",
        args: ["cursor-v2.js"],
        env: {
          PUBLIC_FLAG: "v2",
        },
      },
    },
  });
  await writeFixture(
    join(home, ".codex", "config.toml"),
    `[mcp_servers.codexTool]
command = "bunx"
args = ["codex-v2"]
`,
  );
}

function cloneManifest(manifest: CcSyncManifest): CcSyncManifest {
  return JSON.parse(JSON.stringify(manifest)) as CcSyncManifest;
}
