import { afterEach, describe, expect, test } from "bun:test";

import { getAgentAdapters } from "../adapters";
import { scanManifest } from "../manifest";
import { createTempHome, removeTempHome, seedAgentFixtures, withHome } from "./test-utils";

const tempHomes: string[] = [];

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map(removeTempHome));
});

describe("manifest scanning", () => {
  test("detects supported agent paths, custom skills, registry references, and MCP configs", async () => {
    const home = await createTempHome("manifest");
    tempHomes.push(home);
    await seedAgentFixtures(home);

    const manifest = await withHome(home, async () =>
      scanManifest({
        deviceId: "device-a",
        machineName: "Fake Device A",
        adapters: getAgentAdapters(),
      }),
    );

    expect(manifest.agents).toHaveLength(13);
    expect(manifest.agents.find((agent) => agent.id === "codex")?.detected).toBe(true);
    expect(manifest.agents.find((agent) => agent.id === "cursor")?.detected).toBe(true);
    expect(manifest.agents.find((agent) => agent.id === "claude-code")?.detected).toBe(true);

    const registrySkill = manifest.registrySkills.find(
      (skill) => skill.agent === "cursor" && skill.id === "registry-only",
    );
    expect(registrySkill?.source).toBe("unknown");

    const customSkill = manifest.customSkills.find(
      (skill) => skill.agent === "codex" && skill.name === "team-skill",
    );
    expect(customSkill?.root).toBe("~/.codex/skills/custom-skills/team-skill");
    expect(customSkill?.files.map((file) => file.path)).toContain("SKILL.md");
    expect(customSkill?.files.map((file) => file.path)).toContain("notes/checklist.md");

    const cursorTool = manifest.mcpServers.find(
      (server) => server.agent === "cursor" && server.name === "cursor-tool",
    );
    expect(cursorTool?.transport).toBe("stdio");
    expect(cursorTool?.command).toBe("bunx");
    expect(cursorTool?.args).toEqual(["cursor-mcp"]);
    expect(cursorTool?.env).toContainEqual({
      key: "PUBLIC_FLAG",
      value: "yes",
      redacted: false,
    });
    expect(cursorTool?.env).toContainEqual({
      key: "API_TOKEN",
      redacted: true,
    });

    const codexTool = manifest.mcpServers.find(
      (server) => server.agent === "codex" && server.name === "codexTool",
    );
    expect(codexTool?.transport).toBe("stdio");
    expect(codexTool?.command).toBe("bunx");
    expect(codexTool?.args).toEqual(["codex-mcp"]);

    const claudeTool = manifest.mcpServers.find(
      (server) => server.agent === "claude-code" && server.name === "claude-memory",
    );
    expect(claudeTool?.command).toBe("uvx");
  });

  test("keeps content hash stable across device identity and scan timestamps", async () => {
    const home = await createTempHome("stable-hash");
    tempHomes.push(home);
    await seedAgentFixtures(home);

    const first = await withHome(home, async () =>
      scanManifest({
        deviceId: "device-a",
        machineName: "Fake Device A",
        adapters: getAgentAdapters(),
      }),
    );
    const second = await withHome(home, async () =>
      scanManifest({
        deviceId: "device-b",
        machineName: "Fake Device B",
        adapters: getAgentAdapters(),
      }),
    );

    expect(first.deviceId).not.toBe(second.deviceId);
    expect(first.hash).toBe(second.hash);
  });
});
