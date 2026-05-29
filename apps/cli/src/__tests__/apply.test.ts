import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { applyManifest } from "../apply";
import { getAgentAdapters } from "../adapters";
import { pathExists, sha256 } from "../fs-utils";
import { scanManifest } from "../manifest";
import { MANIFEST_SCHEMA_VERSION, type CcSyncManifest } from "../types";
import {
  createTempHome,
  must,
  readFixture,
  removeTempHome,
  seedAgentFixtures,
  withHome,
} from "./test-utils";

const tempHomes: string[] = [];

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map(removeTempHome));
});

describe("manifest apply", () => {
  test("applies custom skills and MCP configs into a second fake home", async () => {
    const sourceHome = await createTempHome("apply-source");
    const targetHome = await createTempHome("apply-target");
    tempHomes.push(sourceHome, targetHome);
    await seedAgentFixtures(sourceHome);

    const sourceManifest = await withHome(sourceHome, async () =>
      scanManifest({
        deviceId: "device-a",
        machineName: "Fake Device A",
        adapters: getAgentAdapters(),
      }),
    );

    const applyResult = await withHome(targetHome, async () =>
      applyManifest(sourceManifest, { adapters: getAgentAdapters() }),
    );

    expect(applyResult.changes.some((change) => change.action === "created")).toBe(true);
    expect(
      await readFixture(
        join(targetHome, ".codex", "skills", "custom-skills", "team-skill", "SKILL.md"),
      ),
    ).toContain("Keep the shared workflow in sync.");

    const cursorConfig = JSON.parse(await readFixture(join(targetHome, ".cursor", "mcp.json"))) as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    const cursorTool = must(cursorConfig.mcpServers?.["cursor-tool"], "cursor MCP server");
    expect(cursorTool.env?.PUBLIC_FLAG).toBe("yes");
    expect(cursorTool.env?.API_TOKEN).toBeUndefined();

    const codexConfig = await readFixture(join(targetHome, ".codex", "config.toml"));
    expect(codexConfig).toContain("[mcp_servers.codexTool]");
    expect(codexConfig).toContain('args = ["codex-mcp"]');

    const claudeConfig = JSON.parse(await readFixture(join(targetHome, ".claude.json"))) as {
      mcpServers: Record<string, { command: string }>;
    };
    expect(must(claudeConfig.mcpServers["claude-memory"], "Claude MCP server").command).toBe("uvx");

    const targetManifest = await withHome(targetHome, async () =>
      scanManifest({
        deviceId: "device-b",
        machineName: "Fake Device B",
        adapters: getAgentAdapters(),
      }),
    );
    expect(targetManifest.hash).toBe(sourceManifest.hash);
  });

  test("skips custom skill files that try to escape their skill root", async () => {
    const targetHome = await createTempHome("path-safety");
    tempHomes.push(targetHome);
    const unsafeManifest: CcSyncManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      createdAt: Date.now(),
      deviceId: "device-a",
      machineName: "Fake Device A",
      platform: process.platform,
      agents: [],
      registrySkills: [],
      customSkills: [
        {
          agent: "codex",
          root: "~/.codex/skills/safety",
          name: "safety",
          files: [
            {
              path: "../escape.txt",
              content: "do not write me",
              sha256: sha256("do not write me"),
              size: "do not write me".length,
              updatedAt: Date.now(),
            },
          ],
          hash: "unsafe",
        },
      ],
      mcpServers: [],
      hash: "unsafe",
    };

    const applyResult = await withHome(targetHome, async () =>
      applyManifest(unsafeManifest, { adapters: getAgentAdapters() }),
    );

    expect(applyResult.changes).toContainEqual({
      path: "../escape.txt",
      action: "skipped",
      message: "path escapes skill root",
    });
    expect(await pathExists(join(targetHome, ".codex", "skills", "escape.txt"))).toBe(false);
  });

  test("skips MCP config paths outside known agent config files", async () => {
    const targetHome = await createTempHome("mcp-safety");
    tempHomes.push(targetHome);
    const unsafeManifest: CcSyncManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      createdAt: Date.now(),
      deviceId: "device-a",
      machineName: "Fake Device A",
      platform: process.platform,
      agents: [],
      registrySkills: [],
      customSkills: [],
      mcpServers: [
        {
          agent: "codex",
          configPath: "~/.zshrc.toml",
          name: "unsafe",
          enabled: true,
          transport: "stdio",
          command: "node",
          args: ["unsafe.js"],
        },
      ],
      hash: "unsafe",
    };

    const applyResult = await withHome(targetHome, async () =>
      applyManifest(unsafeManifest, { adapters: getAgentAdapters() }),
    );

    expect(applyResult.changes).toContainEqual({
      path: "~/.zshrc.toml",
      action: "skipped",
      message: "MCP config path is not a known user-level config for this agent",
    });
    expect(await pathExists(join(targetHome, ".zshrc.toml"))).toBe(false);
  });
});
