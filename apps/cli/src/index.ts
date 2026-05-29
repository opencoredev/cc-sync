#!/usr/bin/env bun
import { CcSyncClient } from "./client";
import { loadConfig, promptForConfig, saveConfig, getDeviceInfo, CONFIG_PATH } from "./config";
import { runDaemon } from "./daemon";
import { scanLocalManifest, pullRemoteManifest, pushLocalManifest } from "./sync";

const args = process.argv.slice(2);

await main(args).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(argv: string[]): Promise<void> {
  const [command, subcommand, value] = argv;
  if (!command || command === "tui") {
    const { runTui } = await import("./tui");
    await runTui();
    return;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log("ccsync 0.1.0");
    return;
  }
  if (command === "init") {
    await init();
    return;
  }
  if (command === "status") {
    await status();
    return;
  }
  if (command === "scan") {
    console.log(JSON.stringify(await scanLocalManifest(), null, 2));
    return;
  }
  if (command === "push") {
    const config = await loadConfig();
    console.log((await pushLocalManifest(config)).message);
    return;
  }
  if (command === "pull") {
    const config = await loadConfig();
    const result = await pullRemoteManifest(config);
    console.log(result.message);
    for (const change of result.applyResult?.changes ?? []) {
      console.log(`${change.action.padEnd(7)} ${change.path} - ${change.message}`);
    }
    return;
  }
  if (command === "daemon") {
    await daemon(subcommand);
    return;
  }
  if (command === "devices" && subcommand === "remove" && value) {
    const config = await loadConfig();
    await new CcSyncClient(config).removeDevice(value);
    console.log(`Removed device ${value}`);
    return;
  }
  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

async function init(): Promise<void> {
  const existing = await loadConfig();
  console.log("ccsync init");
  console.log("-----------");
  console.log("Sign in with GitHub on the ccsync web app, create a CLI token, then paste it here.");
  if (existing.siteUrl) console.log(`Account page: ${existing.siteUrl}`);
  const config = await promptForConfig(existing);
  await saveConfig(config);

  const manifest = await scanLocalManifest(config);
  const client = new CcSyncClient(config);
  await client.registerDevice(
    getDeviceInfo(config, manifest.agents.filter((agent) => agent.detected).length),
  );
  const push = await pushLocalManifest(config);
  console.log(`Saved config: ${CONFIG_PATH}`);
  console.log(push.message);
  console.log("Run `ccsync daemon start` to keep this machine synced automatically.");
}

async function status(): Promise<void> {
  const config = await loadConfig();
  const manifest = await scanLocalManifest(config);
  const remote = await new CcSyncClient(config).status().catch((error: unknown) => ({
    configured: false,
    devices: [],
    error: error instanceof Error ? error.message : String(error),
  }));
  console.log("ccsync status");
  console.log("-------------");
  console.log(`Device: ${config.deviceLabel} (${config.deviceId})`);
  console.log(`Paused: ${config.paused ? "yes" : "no"}`);
  console.log(`Remote: ${remote.configured ? "configured" : "not configured"}`);
  if ("error" in remote) console.log(`Remote error: ${remote.error}`);
  console.log(
    `Detected agents: ${manifest.agents.filter((agent) => agent.detected).length}/${manifest.agents.length}`,
  );
  console.log(`Registry skills: ${manifest.registrySkills.length}`);
  console.log(`Custom skills: ${manifest.customSkills.length}`);
  console.log(`MCP servers: ${manifest.mcpServers.length}`);
  console.log(`Manifest hash: ${manifest.hash}`);
  if (remote.devices.length > 0) {
    console.log("");
    console.log("Devices:");
    for (const device of remote.devices) {
      console.log(`- ${device.label} (${device.deviceId}) ${device.platform}/${device.arch}`);
    }
  }
}

async function daemon(subcommand: string | undefined): Promise<void> {
  const config = await loadConfig();
  if (subcommand === "start") {
    await runDaemon();
    return;
  }
  if (subcommand === "pause") {
    await saveConfig({ ...config, paused: true });
    await new CcSyncClient({ ...config, paused: true }).setPaused(true).catch(() => undefined);
    console.log("ccsync daemon paused");
    return;
  }
  if (subcommand === "resume") {
    await saveConfig({ ...config, paused: false });
    await new CcSyncClient({ ...config, paused: false }).setPaused(false).catch(() => undefined);
    console.log("ccsync daemon resumed");
    return;
  }
  throw new Error("Usage: ccsync daemon start|pause|resume");
}

function printHelp(): void {
  console.log(`ccsync - cross-device sync for AI agent skills and MCP configs

Usage:
  ccsync                 Open the management TUI
  ccsync init            Configure GitHub-backed account token and register this device
  ccsync status          Show local and remote sync health
  ccsync daemon start    Start the lightweight background watcher
  ccsync daemon pause    Pause sync on this device
  ccsync daemon resume   Resume sync on this device
  ccsync scan            Print the local manifest JSON
  ccsync push            Push local manifest to Convex
  ccsync pull            Pull and apply the latest remote manifest
  ccsync devices remove <deviceId>
`);
}
