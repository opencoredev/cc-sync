import { watch, type FSWatcher } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { getWatchTargets } from "./adapters";
import { CcSyncClient } from "./client";
import { getDeviceInfo, loadConfig, saveConfig } from "./config";
import { scanLocalManifest, pullRemoteManifest, pushLocalManifest } from "./sync";

export async function runDaemon(): Promise<void> {
  let config = await loadConfig();
  const client = new CcSyncClient(config);
  const initialManifest = await scanLocalManifest(config);
  await client.heartbeat(
    getDeviceInfo(config, initialManifest.agents.filter((agent) => agent.detected).length),
  );

  console.log(`ccsync daemon started for ${config.deviceLabel}`);
  console.log(`debounce=${config.debounceMs}ms poll=${config.pollMs}ms paused=${config.paused}`);

  const watchers: FSWatcher[] = [];
  const targets = await getWatchTargets();
  for (const target of targets) {
    watchers.push(
      watch(target, { recursive: false }, () => {
        schedulePush();
      }),
    );
  }

  if (targets.length === 0) {
    console.log("No known agent paths exist yet. The daemon will still poll for remote updates.");
  } else {
    console.log(`Watching ${targets.length} agent path(s).`);
  }

  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  let syncing = false;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (pushTimer) clearTimeout(pushTimer);
    for (const watcher of watchers) watcher.close();
    console.log("\nccsync daemon stopped");
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  schedulePush();
  void pollLoop();

  await new Promise(() => undefined);

  function schedulePush(): void {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      void syncOnce("local change");
    }, config.debounceMs);
  }

  async function pollLoop(): Promise<void> {
    while (!stopped) {
      await sleep(config.pollMs);
      await syncOnce("poll");
    }
  }

  async function syncOnce(reason: string): Promise<void> {
    if (syncing) return;
    syncing = true;
    try {
      config = await loadConfig();
      if (config.paused) {
        console.log(`[${new Date().toLocaleTimeString()}] paused; skipped ${reason}`);
        return;
      }
      const pull = await pullRemoteManifest(config).catch((error: unknown) => ({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }));
      console.log(`[${new Date().toLocaleTimeString()}] pull: ${pull.message}`);
      config = await loadConfig();
      const push = await pushLocalManifest(config).catch((error: unknown) => ({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }));
      console.log(`[${new Date().toLocaleTimeString()}] push: ${push.message}`);
      await saveConfig({ ...(await loadConfig()), lastSyncAt: Date.now() });
    } finally {
      syncing = false;
    }
  }
}
