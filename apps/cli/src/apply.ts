import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { getAdapter, type AgentAdapter } from "./adapters";
import {
  compactHome,
  expandHome,
  pathExists,
  readText,
  safeResolveInside,
  sha256,
  writeText,
} from "./fs-utils";
import type {
  ApplyChange,
  ApplyResult,
  CcSyncManifest,
  CustomSkillSnapshot,
  McpServerSnapshot,
  RegistrySkillRef,
} from "./types";

export async function applyManifest(
  manifest: CcSyncManifest,
  options?: { skipAgents?: string[]; adapters?: AgentAdapter[] },
): Promise<ApplyResult> {
  const changes: ApplyChange[] = [];
  const skipAgents = new Set(options?.skipAgents ?? []);

  for (const skill of manifest.registrySkills) {
    if (skipAgents.has(skill.agent)) continue;
    changes.push(await installRegistrySkill(skill));
  }

  for (const skill of manifest.customSkills) {
    if (skipAgents.has(skill.agent)) continue;
    changes.push(...(await applyCustomSkill(skill, options?.adapters)));
  }

  for (const server of manifest.mcpServers) {
    if (skipAgents.has(server.agent)) continue;
    changes.push(await applyMcpServer(server, options?.adapters));
  }

  return { changes };
}

async function installRegistrySkill(skill: RegistrySkillRef): Promise<ApplyChange> {
  if (skill.source !== "skills.sh") {
    return {
      path: `${skill.agent}:${skill.id}`,
      action: "skipped",
      message: "lightweight skill reference; content was not marked custom",
    };
  }
  const skillsCli = Bun.which("skills");
  if (!skillsCli) {
    return {
      path: `skills.sh:${skill.agent}:${skill.id}`,
      action: "skipped",
      message: "skills CLI is not installed",
    };
  }
  const proc = Bun.spawn([skillsCli, "install", skill.id, "-a", skill.agent], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return {
    path: `skills.sh:${skill.agent}:${skill.id}`,
    action: exitCode === 0 ? "updated" : "skipped",
    message:
      exitCode === 0
        ? "registry skill installed or already present"
        : stderr.trim() || "skills install failed",
  };
}

async function applyCustomSkill(
  skill: CustomSkillSnapshot,
  adapters?: AgentAdapter[],
): Promise<ApplyChange[]> {
  const adapter = getAdapter(skill.agent, adapters);
  const targetRoot = adapter?.skillDirs[0];
  if (!targetRoot) {
    return [
      {
        path: skill.root,
        action: "skipped",
        message: `unknown agent ${skill.agent}`,
      },
    ];
  }
  const skillRoot = resolveCustomSkillRoot(skill, adapter);
  const changes: ApplyChange[] = [];
  for (const file of skill.files) {
    const targetPath = safeResolveInside(skillRoot, file.path);
    if (!targetPath) {
      changes.push({ path: file.path, action: "skipped", message: "path escapes skill root" });
      continue;
    }
    const existing = await readFile(targetPath).catch(() => undefined);
    if (existing && sha256(existing) === file.sha256) {
      changes.push({
        path: compactHome(targetPath),
        action: "skipped",
        message: "already up to date",
      });
      continue;
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content, "utf-8");
    changes.push({
      path: compactHome(targetPath),
      action: existing ? "updated" : "created",
      message: `synced ${skill.agent} custom skill ${skill.name}`,
    });
  }
  return changes;
}

function resolveCustomSkillRoot(skill: CustomSkillSnapshot, adapter: AgentAdapter): string {
  const expandedRoot = resolve(expandHome(skill.root));
  for (const skillDir of adapter.skillDirs.map((dir) => resolve(dir))) {
    if (expandedRoot === skillDir || expandedRoot.startsWith(`${skillDir}/`)) {
      return expandedRoot;
    }
  }
  return join(adapter.skillDirs[0]!, basename(skill.name));
}

async function applyMcpServer(
  server: McpServerSnapshot,
  adapters?: AgentAdapter[],
): Promise<ApplyChange> {
  const configPath = resolveMcpConfigPath(server, adapters);
  if (!configPath) {
    return {
      path: server.configPath,
      action: "skipped",
      message: "MCP config path is not a known user-level config for this agent",
    };
  }
  if (configPath.endsWith(".json")) {
    return await applyJsonMcpServer(configPath, server);
  }
  if (configPath.endsWith(".toml")) {
    return await applyTomlMcpServer(configPath, server);
  }
  return {
    path: server.configPath,
    action: "skipped",
    message: "unsupported MCP config format",
  };
}

function resolveMcpConfigPath(
  server: McpServerSnapshot,
  adapters?: AgentAdapter[],
): string | undefined {
  const adapter = getAdapter(server.agent, adapters);
  const expandedConfigPath = resolve(expandHome(server.configPath));
  return adapter?.mcpConfigFiles
    .map((configPath) => resolve(configPath))
    .find((configPath) => configPath === expandedConfigPath);
}

async function applyJsonMcpServer(
  configPath: string,
  server: McpServerSnapshot,
): Promise<ApplyChange> {
  const existingText = await readText(configPath);
  const existing = existingText ? parseJsonObject(existingText) : {};
  const root = existing ?? {};
  const mcpServers = getOrCreateObject(root, "mcpServers");
  const nextServer: Record<string, unknown> = {
    disabled: !server.enabled,
  };
  if (server.command) nextServer.command = server.command;
  if (server.args?.length) nextServer.args = server.args;
  if (server.url) nextServer.url = server.url;
  const env = Object.fromEntries(
    (server.env ?? [])
      .filter((entry) => !entry.redacted && entry.value !== undefined)
      .map((entry) => [entry.key, entry.value]),
  );
  if (Object.keys(env).length > 0) nextServer.env = env;
  mcpServers[server.name] = nextServer;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
  return {
    path: compactHome(configPath),
    action: existingText ? "updated" : "created",
    message: `merged MCP server ${server.name}`,
  };
}

async function applyTomlMcpServer(
  configPath: string,
  server: McpServerSnapshot,
): Promise<ApplyChange> {
  const existed = await pathExists(configPath);
  const existing = (await readText(configPath)) ?? "";
  const block = buildTomlBlock(server);
  const escapedName = escapeRegExp(server.name);
  const blockPattern = new RegExp(
    `\\n?\\[mcp_servers\\.${escapedName}\\][\\s\\S]*?(?=\\n\\[mcp_servers\\.|\\n\\[[^\\]]+\\]|$)`,
    "m",
  );
  const next = blockPattern.test(existing)
    ? existing.replace(blockPattern, `\n${block}\n`)
    : `${existing.trimEnd()}\n\n${block}\n`;
  await writeText(configPath, next.trimStart());
  return {
    path: compactHome(configPath),
    action: existed ? "updated" : "created",
    message: `merged MCP server ${server.name}`,
  };
}

function buildTomlBlock(server: McpServerSnapshot): string {
  const lines = [`[mcp_servers.${server.name}]`];
  if (server.command) lines.push(`command = "${escapeToml(server.command)}"`);
  if (server.args?.length)
    lines.push(`args = [${server.args.map((arg) => `"${escapeToml(arg)}"`).join(", ")}]`);
  if (server.url) lines.push(`url = "${escapeToml(server.url)}"`);
  if (!server.enabled) lines.push("disabled = true");
  return lines.join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
    return undefined;
  } catch {
    return undefined;
  }
}

function getOrCreateObject(root: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = root[key];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  root[key] = next;
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeToml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
