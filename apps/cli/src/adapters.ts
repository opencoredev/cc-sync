import { join } from "node:path";

import { getHomeDir, pathExists } from "./fs-utils";

export interface AgentAdapter {
  id: string;
  name: string;
  skillDirs: string[];
  mcpConfigFiles: string[];
  registryAgent?: string;
}

export function getAgentAdapters(home = getHomeDir()): AgentAdapter[] {
  const macApplicationSupport = join(home, "Library", "Application Support");
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      registryAgent: "claude",
      skillDirs: [
        join(home, ".claude", "skills"),
        join(home, ".claude", "commands"),
        join(home, ".claude", "agents"),
      ],
      mcpConfigFiles: [join(home, ".claude.json"), join(home, ".claude", "mcp.json")],
    },
    {
      id: "cursor",
      name: "Cursor",
      registryAgent: "cursor",
      skillDirs: [join(home, ".cursor", "skills"), join(home, ".cursor", "rules")],
      mcpConfigFiles: [join(home, ".cursor", "mcp.json")],
    },
    {
      id: "codex",
      name: "Codex CLI",
      registryAgent: "codex",
      skillDirs: [join(home, ".codex", "skills"), join(home, ".agents", "skills")],
      mcpConfigFiles: [join(home, ".codex", "config.toml")],
    },
    {
      id: "opencode",
      name: "OpenCode",
      skillDirs: [join(home, ".config", "opencode", "skills"), join(home, ".opencode", "skills")],
      mcpConfigFiles: [
        join(home, ".config", "opencode", "opencode.json"),
        join(home, ".opencode.json"),
      ],
    },
    {
      id: "windsurf",
      name: "Windsurf",
      skillDirs: [join(home, ".codeium", "windsurf", "skills"), join(home, ".windsurf", "skills")],
      mcpConfigFiles: [
        join(home, ".codeium", "windsurf", "mcp_config.json"),
        join(home, ".windsurf", "mcp.json"),
      ],
    },
    {
      id: "cline",
      name: "Cline",
      skillDirs: [join(home, ".cline", "skills")],
      mcpConfigFiles: [
        join(
          macApplicationSupport,
          "Code",
          "User",
          "globalStorage",
          "saoudrizwan.claude-dev",
          "settings",
          "cline_mcp_settings.json",
        ),
        join(home, ".cline", "mcp_settings.json"),
      ],
    },
    {
      id: "roo-code",
      name: "Roo Code",
      skillDirs: [join(home, ".roo", "skills"), join(home, ".roo-code", "skills")],
      mcpConfigFiles: [
        join(
          macApplicationSupport,
          "Code",
          "User",
          "globalStorage",
          "rooveterinaryinc.roo-cline",
          "settings",
          "mcp_settings.json",
        ),
        join(home, ".roo", "mcp_settings.json"),
      ],
    },
    {
      id: "continue",
      name: "Continue",
      skillDirs: [join(home, ".continue", "rules"), join(home, ".continue", "prompts")],
      mcpConfigFiles: [join(home, ".continue", "config.json"), join(home, ".continue", "mcp.json")],
    },
    {
      id: "aider",
      name: "Aider",
      skillDirs: [join(home, ".aider", "prompts"), join(home, ".aider", "skills")],
      mcpConfigFiles: [join(home, ".aider.conf.yml"), join(home, ".aider", "mcp.json")],
    },
    {
      id: "gemini-cli",
      name: "Gemini CLI",
      skillDirs: [join(home, ".gemini", "extensions"), join(home, ".gemini", "commands")],
      mcpConfigFiles: [join(home, ".gemini", "settings.json")],
    },
    {
      id: "qwen-code",
      name: "Qwen Code",
      skillDirs: [join(home, ".qwen", "extensions"), join(home, ".qwen", "commands")],
      mcpConfigFiles: [join(home, ".qwen", "settings.json")],
    },
    {
      id: "amp",
      name: "Amp",
      skillDirs: [join(home, ".config", "amp", "skills"), join(home, ".amp", "skills")],
      mcpConfigFiles: [
        join(home, ".config", "amp", "settings.json"),
        join(home, ".amp", "mcp.json"),
      ],
    },
    {
      id: "kiro",
      name: "Kiro",
      skillDirs: [join(home, ".kiro", "steering"), join(home, ".kiro", "skills")],
      mcpConfigFiles: [join(home, ".kiro", "mcp.json"), join(home, ".kiro", "settings.json")],
    },
  ];
}

export const AGENT_ADAPTERS: AgentAdapter[] = getAgentAdapters();

export function getAdapter(
  agentId: string,
  adapters: AgentAdapter[] = getAgentAdapters(),
): AgentAdapter | undefined {
  return adapters.find((adapter) => adapter.id === agentId);
}

export async function detectAgentPaths(adapter: AgentAdapter): Promise<string[]> {
  const paths = [...adapter.skillDirs, ...adapter.mcpConfigFiles];
  const existing: string[] = [];
  for (const path of paths) {
    if (await pathExists(path)) existing.push(path);
  }
  return existing;
}

export async function getWatchTargets(): Promise<string[]> {
  const targets = new Set<string>();
  for (const adapter of getAgentAdapters()) {
    for (const path of [...adapter.skillDirs, ...adapter.mcpConfigFiles]) {
      if (await pathExists(path)) targets.add(path);
    }
  }
  return [...targets].sort();
}
