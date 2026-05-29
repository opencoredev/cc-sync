import { Text, createCliRenderer, instantiate, type TextRenderable } from "@opentui/core";

import { CcSyncClient, type RemoteDevice, type RemoteStatus } from "./client";
import { loadConfig } from "./config";
import { scanLocalManifest, pullRemoteManifest, pushLocalManifest } from "./sync";
import type { CcSyncConfig, CcSyncManifest } from "./types";

type Tab = "dashboard" | "devices" | "skills" | "mcps";

interface TuiState {
  tab: Tab;
  config: CcSyncConfig;
  manifest?: CcSyncManifest;
  remoteMessage: string;
  lines: string[];
  selectedDevice: number;
  remoteDevices: Array<Partial<RemoteDevice>>;
}

const TABS: Tab[] = ["dashboard", "devices", "skills", "mcps"];

export async function runTui(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 12,
  });
  const view = instantiate(
    renderer,
    Text({ content: "Loading ccsync...", fg: "#d7dde8" }),
  ) as TextRenderable;
  renderer.root.add(view);

  const state: TuiState = {
    tab: "dashboard",
    config: await loadConfig(),
    remoteMessage: "Ready",
    lines: [],
    selectedDevice: 0,
    remoteDevices: [],
  };

  await refresh(state);
  render(view, state);

  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on("data", async (buffer: Buffer) => {
    const key = buffer.toString("utf-8");
    if (key === "\u0003" || key === "q") {
      renderer.destroy();
      process.exit(0);
    }
    if (key >= "1" && key <= "4") {
      state.tab = TABS[Number(key) - 1] ?? "dashboard";
    } else if (key === "r") {
      await refresh(state);
    } else if (key === "p") {
      state.remoteMessage = (await pushLocalManifest(state.config)).message;
      state.config = await loadConfig();
      await refresh(state, false);
    } else if (key === "l") {
      state.remoteMessage = (await pullRemoteManifest(state.config)).message;
      state.config = await loadConfig();
      await refresh(state, false);
    } else if (key === " ") {
      state.config.paused = !state.config.paused;
      const client = new CcSyncClient(state.config);
      await client.setPaused(state.config.paused).catch(() => undefined);
      const { saveConfig } = await import("./config");
      await saveConfig(state.config);
      state.remoteMessage = state.config.paused
        ? "Paused local daemon sync"
        : "Resumed local daemon sync";
    } else if (key === "x" && state.tab === "devices") {
      const device = state.remoteDevices[state.selectedDevice];
      if (device?.deviceId) {
        await new CcSyncClient(state.config).removeDevice(device.deviceId);
        state.remoteMessage = `Removed ${device.label ?? device.deviceId}`;
        state.selectedDevice = 0;
        await refresh(state, false);
      }
    } else if (key === "\u001b[B" || key === "j") {
      state.selectedDevice = Math.min(
        Math.max(0, state.remoteDevices.length - 1),
        state.selectedDevice + 1,
      );
    } else if (key === "\u001b[A" || key === "k") {
      state.selectedDevice = Math.max(0, state.selectedDevice - 1);
    }
    render(view, state);
  });
}

async function refresh(state: TuiState, updateMessage = true): Promise<void> {
  state.config = await loadConfig();
  state.manifest = await scanLocalManifest(state.config);
  const client = new CcSyncClient(state.config);
  const remote = await client.status().catch((error: unknown) => ({
    configured: false,
    devices: [],
    manifest: undefined,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (updateMessage) {
    state.remoteMessage =
      "error" in remote
        ? remote.error
        : remote.configured
          ? "Connected"
          : "Local only. Run ccsync init.";
  }
  state.remoteDevices = remote.devices;
  state.lines = buildLines(state, remote);
}

function render(view: TextRenderable, state: TuiState): void {
  view.content = state.lines.join("\n");
  view.requestRender();
}

function buildLines(state: TuiState, remote: TuiRemoteStatus): string[] {
  const manifest = state.manifest;
  const detectedAgents = manifest?.agents.filter((agent) => agent.detected) ?? [];
  const header = [
    "ccsync",
    "======",
    `Device: ${state.config.deviceLabel} (${state.config.deviceId})`,
    `Sync: ${state.config.paused ? "paused" : "active"} | Remote: ${remote.configured ? "configured" : "not configured"} | ${state.remoteMessage}`,
    "",
    `[1] Dashboard  [2] Devices  [3] Skills  [4] MCPs    r refresh  p push  l pull  space pause/resume  x remove device  q quit`,
    `Active: ${state.tab}`,
    "",
  ];

  if (!manifest) return [...header, "Scanning local setup..."];
  if (state.tab === "dashboard") {
    return [
      ...header,
      "Status overview",
      "---------------",
      `Detected agents: ${detectedAgents.length}/${manifest.agents.length}`,
      `Registry skills: ${manifest.registrySkills.length}`,
      `Custom skills: ${manifest.customSkills.length}`,
      `MCP servers: ${manifest.mcpServers.length}`,
      `Local manifest hash: ${manifest.hash.slice(0, 12)}`,
      `Remote revision: ${typeof remote.manifest?.revision === "number" ? remote.manifest.revision : "none"}`,
      "",
      "Detected paths",
      "--------------",
      ...detectedAgents.flatMap((agent) => [
        `${agent.name}`,
        ...agent.paths.map((path) => `  ${path}`),
      ]),
    ];
  }
  if (state.tab === "devices") {
    const devices = remote.devices;
    return [
      ...header,
      "Devices",
      "-------",
      ...(devices.length > 0
        ? devices.map((device, index) => {
            const marker = index === state.selectedDevice ? ">" : " ";
            return `${marker} ${device.label ?? "device"} ${device.deviceId ?? ""} ${device.platform ?? ""} last seen ${formatTime(device.lastSeenAt ?? 0)}`;
          })
        : ["No remote devices yet. Run ccsync init on this machine, then another one."]),
    ];
  }
  if (state.tab === "skills") {
    return [
      ...header,
      "Skills",
      "------",
      `Registry references (${manifest.registrySkills.length})`,
      ...manifest.registrySkills
        .slice(0, 12)
        .map((skill) => `  ${skill.agent}: ${skill.name} (${skill.id})`),
      manifest.registrySkills.length > 12 ? `  ...${manifest.registrySkills.length - 12} more` : "",
      "",
      `Custom skills (${manifest.customSkills.length})`,
      ...manifest.customSkills
        .slice(0, 16)
        .map((skill) => `  ${skill.agent}: ${skill.name} ${skill.files.length} file(s)`),
    ].filter(Boolean);
  }
  return [
    ...header,
    "MCP servers",
    "-----------",
    ...(manifest.mcpServers.length > 0
      ? manifest.mcpServers.map(
          (server) =>
            `  ${server.agent}: ${server.name} ${server.transport} ${server.command ?? server.url ?? ""}`,
        )
      : ["No MCP server definitions found in known global config files."]),
  ];
}

function formatTime(value: number): string {
  if (!value) return "never";
  return new Date(value).toLocaleString();
}

type TuiRemoteStatus = Omit<RemoteStatus, "devices"> & {
  devices: Array<Partial<RemoteDevice>>;
  error?: string;
};
