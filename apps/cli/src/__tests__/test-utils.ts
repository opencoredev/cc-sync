import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function createTempHome(label: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `ccsync-${label}-`));
}

export async function removeTempHome(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function writeFixture(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
}

export async function readFixture(path: string): Promise<string> {
  return await readFile(path, "utf-8");
}

export async function writeJsonFixture(path: string, content: unknown): Promise<void> {
  await writeFixture(path, `${JSON.stringify(content, null, 2)}\n`);
}

export async function withHome<T>(home: string, run: () => Promise<T>): Promise<T> {
  const previousHome = process.env.CCSYNC_HOME;
  const previousSkipRegistry = process.env.CCSYNC_SKIP_REGISTRY_CLI;
  process.env.CCSYNC_HOME = home;
  process.env.CCSYNC_SKIP_REGISTRY_CLI = "1";
  try {
    return await run();
  } finally {
    restoreEnv("CCSYNC_HOME", previousHome);
    restoreEnv("CCSYNC_SKIP_REGISTRY_CLI", previousSkipRegistry);
  }
}

export async function seedAgentFixtures(home: string): Promise<void> {
  await writeFixture(
    join(home, ".codex", "skills", "custom-skills", "team-skill", "SKILL.md"),
    `ccsync: custom
# Team Skill

Keep the shared workflow in sync.
`,
  );
  await writeFixture(
    join(home, ".codex", "skills", "custom-skills", "team-skill", "notes", "checklist.md"),
    "# Checklist\n\n- Verify sync\n",
  );
  await writeFixture(
    join(home, ".cursor", "rules", "registry-only", "SKILL.md"),
    "# Registry Only\n\nThis should stay a lightweight reference.\n",
  );
  await writeJsonFixture(join(home, ".cursor", "mcp.json"), {
    mcpServers: {
      "cursor-tool": {
        command: "bunx",
        args: ["cursor-mcp"],
        env: {
          PUBLIC_FLAG: "yes",
          API_TOKEN: "super-secret",
        },
      },
    },
  });
  await writeFixture(
    join(home, ".codex", "config.toml"),
    `[mcp_servers.codexTool]
command = "bunx"
args = ["codex-mcp"]
`,
  );
  await writeJsonFixture(join(home, ".claude.json"), {
    mcpServers: {
      "claude-memory": {
        command: "uvx",
        args: ["claude-memory"],
      },
    },
  });
}

export function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing test fixture value: ${label}`);
  return value;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
