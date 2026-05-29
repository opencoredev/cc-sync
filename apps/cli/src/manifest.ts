import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { detectAgentPaths, getAgentAdapters, type AgentAdapter } from "./adapters";
import {
  compactHome,
  hashObject,
  listFiles,
  pathExists,
  readSmallTextFile,
  readText,
  snapshotFile,
} from "./fs-utils";
import {
  MANIFEST_SCHEMA_VERSION,
  type CcSyncManifest,
  type CustomSkillSnapshot,
  type FileSnapshot,
  type McpServerSnapshot,
  type RegistrySkillRef,
} from "./types";

const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|apikey|api_key|auth|bearer|client_secret)/i;

export async function scanManifest(options: {
  deviceId: string;
  machineName: string;
  adapters?: AgentAdapter[];
}): Promise<CcSyncManifest> {
  const agents = [];
  const registrySkills: RegistrySkillRef[] = [];
  const customSkills: CustomSkillSnapshot[] = [];
  const mcpServers: McpServerSnapshot[] = [];

  for (const adapter of options.adapters ?? getAgentAdapters()) {
    const paths = await detectAgentPaths(adapter);
    agents.push({
      id: adapter.id,
      name: adapter.name,
      detected: paths.length > 0,
      paths: paths.map(compactHome),
    });

    const skillScan = await scanSkillDirs(adapter.id, adapter.skillDirs);
    registrySkills.push(
      ...(await scanRegistrySkills(adapter.registryAgent ?? adapter.id, adapter.id)),
    );
    registrySkills.push(...skillScan.references);
    customSkills.push(...skillScan.custom);
    mcpServers.push(...(await scanMcpConfigFiles(adapter.id, adapter.mcpConfigFiles)));
  }

  const manifestBase = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    createdAt: Date.now(),
    deviceId: options.deviceId,
    machineName: options.machineName,
    platform: process.platform,
    agents,
    registrySkills: dedupeRegistrySkills(registrySkills),
    customSkills: customSkills.sort(sortByAgentName),
    mcpServers: mcpServers.sort(sortByAgentConfigName),
  } satisfies Omit<CcSyncManifest, "hash">;

  return {
    ...manifestBase,
    hash: hashManifest(manifestBase),
  };
}

async function scanRegistrySkills(
  registryAgent: string,
  agentId: string,
): Promise<RegistrySkillRef[]> {
  if (process.env.CCSYNC_SKIP_REGISTRY_CLI === "1") return [];
  const executable = Bun.which("skills");
  if (!executable) return [];
  const proc = Bun.spawn([executable, "list", "-g", "-a", registryAgent, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return [];
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const rows = Array.isArray(parsed) ? parsed : getArrayProperty(parsed, "skills");
    return rows.flatMap((row) => registrySkillFromUnknown(row, agentId));
  } catch {
    return [];
  }
}

function getArrayProperty(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object") return [];
  const maybeArray = (value as Record<string, unknown>)[key];
  return Array.isArray(maybeArray) ? maybeArray : [];
}

function registrySkillFromUnknown(value: unknown, agentId: string): RegistrySkillRef[] {
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const id = stringFrom(row.id) ?? stringFrom(row.name) ?? stringFrom(row.slug);
  if (!id) return [];
  const name = stringFrom(row.name) ?? id;
  return [
    {
      agent: agentId,
      id,
      name,
      source: "skills.sh",
      version: stringFrom(row.version),
    },
  ];
}

async function scanSkillDirs(
  agent: string,
  roots: string[],
): Promise<{ references: RegistrySkillRef[]; custom: CustomSkillSnapshot[] }> {
  const references: RegistrySkillRef[] = [];
  const custom: CustomSkillSnapshot[] = [];
  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    const rootsToRead = await findSkillRoots(root);
    for (const skillRoot of rootsToRead) {
      if (!(await isExplicitCustomSkillRoot(skillRoot))) {
        references.push({
          agent,
          id: basename(skillRoot),
          name: basename(skillRoot),
          source: "unknown",
        });
        continue;
      }
      const files = [];
      for (const file of await listFiles(skillRoot, { maxFiles: 200, maxDepth: 8 })) {
        const snapshot = await snapshotFile(skillRoot, file);
        if (snapshot) files.push(snapshot);
      }
      if (files.length === 0) continue;
      const skill = {
        agent,
        root: compactHome(skillRoot),
        name: basename(skillRoot),
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
      };
      custom.push({
        ...skill,
        hash: hashObject(stableCustomSkillForHash(skill)),
      });
    }
  }
  return { references, custom };
}

function hashManifest(manifest: Omit<CcSyncManifest, "hash">): string {
  return hashObject({
    schemaVersion: manifest.schemaVersion,
    registrySkills: manifest.registrySkills.filter((skill) => skill.source === "skills.sh"),
    customSkills: manifest.customSkills.map(stableCustomSkillForHash),
    mcpServers: manifest.mcpServers.map(stableMcpServerForHash),
  });
}

function stableCustomSkillForHash(
  skill: Pick<CustomSkillSnapshot, "agent" | "root" | "name" | "files">,
) {
  return {
    agent: skill.agent,
    root: skill.root,
    name: skill.name,
    files: skill.files.map(stableFileForHash),
  };
}

function stableFileForHash(file: FileSnapshot) {
  return {
    path: file.path,
    content: file.content,
    sha256: file.sha256,
    size: file.size,
  };
}

function stableMcpServerForHash(server: McpServerSnapshot) {
  return {
    agent: server.agent,
    configPath: server.configPath,
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    env: server.env
      ?.filter((entry) => !entry.redacted)
      .map((entry) => ({ key: entry.key, value: entry.value })),
  };
}

async function findSkillRoots(root: string): Promise<string[]> {
  const ownSkillFile = join(root, "SKILL.md");
  if (await pathExists(ownSkillFile)) return [root];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const skillRoots: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const child = join(root, entry.name);
    if (entry.name === "custom-skills") {
      const customChildren = await readdir(child, { withFileTypes: true }).catch(() => []);
      for (const customChild of customChildren) {
        if (!customChild.isDirectory() || customChild.name.startsWith(".")) continue;
        const customRoot = join(child, customChild.name);
        if (await pathExists(join(customRoot, "SKILL.md"))) {
          skillRoots.push(customRoot);
        }
      }
      continue;
    }
    if (await pathExists(join(child, "SKILL.md"))) {
      skillRoots.push(child);
    }
  }
  return skillRoots.sort();
}

async function isExplicitCustomSkillRoot(skillRoot: string): Promise<boolean> {
  if (skillRoot.includes("/custom-skills/") || skillRoot.includes("\\custom-skills\\")) return true;
  if (await pathExists(join(skillRoot, ".ccsync-custom"))) return true;
  const skillFile = await readSmallTextFile(join(skillRoot, "SKILL.md"), 32 * 1024);
  return Boolean(skillFile && /^ccsync:\s*custom\s*$/im.test(skillFile));
}

async function scanMcpConfigFiles(
  agent: string,
  configFiles: string[],
): Promise<McpServerSnapshot[]> {
  const servers: McpServerSnapshot[] = [];
  for (const configPath of configFiles) {
    if (!(await pathExists(configPath))) continue;
    const extension = extname(configPath).toLowerCase();
    if (extension === ".json") {
      const text = await readText(configPath);
      if (!text) continue;
      servers.push(...extractMcpServersFromJson(agent, configPath, text));
    } else if (extension === ".toml") {
      const text = await readSmallTextFile(configPath, 256 * 1024);
      if (!text) continue;
      servers.push(...extractMcpServersFromToml(agent, configPath, text));
    }
  }
  return servers;
}

function extractMcpServersFromJson(
  agent: string,
  configPath: string,
  text: string,
): McpServerSnapshot[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const mcpServers = findMcpServersObject(parsed);
  if (!mcpServers) return [];
  return Object.entries(mcpServers).map(([name, config]) =>
    normalizeJsonMcpServer(agent, configPath, name, config),
  );
}

function findMcpServersObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["mcpServers", "mcp_servers", "servers"]) {
    const candidate = record[key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return undefined;
}

function normalizeJsonMcpServer(
  agent: string,
  configPath: string,
  name: string,
  value: unknown,
): McpServerSnapshot {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const url = stringFrom(record.url) ?? stringFrom(record.endpoint);
  const command = stringFrom(record.command);
  const args = arrayOfStrings(record.args);
  const env = envEntries(record.env);
  return {
    agent,
    configPath: compactHome(configPath),
    name,
    enabled: record.disabled !== true && record.enabled !== false,
    transport: inferTransport(record, command, url),
    command,
    args: args.length > 0 ? args : undefined,
    url,
    env: env.length > 0 ? env : undefined,
  };
}

function extractMcpServersFromToml(
  agent: string,
  configPath: string,
  text: string,
): McpServerSnapshot[] {
  const blocks = text.split(/\n(?=\[mcp_servers\.[^\]]+\])/g);
  const servers: McpServerSnapshot[] = [];
  for (const block of blocks) {
    const header = block.match(/^\[mcp_servers\.([^\]]+)\]/m);
    if (!header?.[1]) continue;
    const name = header[1].replace(/^"|"$/g, "");
    const command = block.match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1];
    const url = block.match(/^\s*url\s*=\s*"([^"]+)"/m)?.[1];
    const args = parseTomlStringArray(block.match(/^\s*args\s*=\s*\[([^\]]*)\]/m)?.[1]);
    servers.push({
      agent,
      configPath: compactHome(configPath),
      name,
      enabled: !/^\s*disabled\s*=\s*true/m.test(block),
      transport: url ? "http" : command ? "stdio" : "unknown",
      command,
      args: args.length > 0 ? args : undefined,
      url,
      raw: redactTomlBlock(block.trim()),
    });
  }
  return servers;
}

function parseTomlStringArray(value: string | undefined): string[] {
  if (!value) return [];
  return [...value.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "");
}

function inferTransport(
  record: Record<string, unknown>,
  command?: string,
  url?: string,
): McpServerSnapshot["transport"] {
  const transport = stringFrom(record.transport) ?? stringFrom(record.type);
  if (transport === "stdio" || transport === "http" || transport === "sse") return transport;
  if (url) return url.includes("/sse") ? "sse" : "http";
  if (command) return "stdio";
  return "unknown";
}

function envEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([key, rawValue]) => {
    const redacted = SECRET_KEY_PATTERN.test(key);
    return {
      key,
      value: redacted ? undefined : stringFrom(rawValue),
      redacted,
    };
  });
}

function redactTomlBlock(block: string): string {
  return block
    .split("\n")
    .map((line) =>
      SECRET_KEY_PATTERN.test(line.split("=")[0] ?? "")
        ? `${line.split("=")[0]?.trim()} = "<redacted>"`
        : line,
    )
    .join("\n");
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function dedupeRegistrySkills(skills: RegistrySkillRef[]): RegistrySkillRef[] {
  const seen = new Set<string>();
  const output: RegistrySkillRef[] = [];
  for (const skill of skills.sort(sortByAgentName)) {
    const key = `${skill.agent}:${skill.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(skill);
  }
  return output;
}

function sortByAgentName(
  a: { agent: string; name: string },
  b: { agent: string; name: string },
): number {
  return `${a.agent}:${a.name}`.localeCompare(`${b.agent}:${b.name}`);
}

function sortByAgentConfigName(
  a: { agent: string; configPath: string; name: string },
  b: { agent: string; configPath: string; name: string },
): number {
  return `${a.agent}:${a.configPath}:${a.name}`.localeCompare(
    `${b.agent}:${b.configPath}:${b.name}`,
  );
}
