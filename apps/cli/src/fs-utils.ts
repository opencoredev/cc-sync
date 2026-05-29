import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });
const TEXT_ENCODER = new TextEncoder();

export function expandHome(path: string): string {
  const home = getHomeDir();
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

export function compactHome(path: string): string {
  const home = getHomeDir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function getHomeDir(): string {
  return process.env.CCSYNC_HOME ?? homedir();
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return undefined;
  }
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  const text = await readText(path);
  if (!text) return undefined;
  return JSON.parse(text) as T;
}

export async function writeJson(path: string, value: unknown, mode?: number): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  if (mode !== undefined) {
    await chmod(path, mode);
  }
}

export async function writeText(path: string, value: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, value, "utf-8");
}

export function sha256(value: string | Buffer | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortForJson(value));
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForJson);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries.map(([key, entryValue]) => [key, sortForJson(entryValue)]));
}

export function hashObject(value: unknown): string {
  return sha256(stableJson(value));
}

export async function readSmallTextFile(
  path: string,
  maxBytes = 128 * 1024,
): Promise<string | undefined> {
  const fileStat = await stat(path).catch(() => undefined);
  if (!fileStat?.isFile() || fileStat.size > maxBytes) return undefined;
  const bytes = await readFile(path);
  if (bytes.includes(0)) return undefined;
  return TEXT_DECODER.decode(bytes);
}

export async function listFiles(
  root: string,
  options?: { maxFiles?: number; maxDepth?: number },
): Promise<string[]> {
  const maxFiles = options?.maxFiles ?? 300;
  const maxDepth = options?.maxDepth ?? 6;
  const output: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (output.length >= maxFiles || depth > maxDepth) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (output.length >= maxFiles) return;
      if (shouldSkipEntry(entry.name)) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        output.push(fullPath);
      }
    }
  }

  await walk(root, 0);
  return output.sort();
}

function shouldSkipEntry(name: string): boolean {
  return [".git", ".jj", "node_modules", "dist", "build", ".turbo", ".cache", "coverage"].includes(
    name,
  );
}

export function relativePosix(root: string, path: string): string {
  return relative(root, path).split("\\").join("/");
}

export function safeResolveInside(root: string, childPath: string): string | undefined {
  const resolvedRoot = resolve(root);
  const resolvedChild = resolve(root, childPath);
  if (resolvedChild === resolvedRoot || resolvedChild.startsWith(`${resolvedRoot}/`)) {
    return resolvedChild;
  }
  return undefined;
}

export async function snapshotFile(root: string, path: string) {
  const content = await readSmallTextFile(path);
  if (content === undefined) return undefined;
  const fileStat = await stat(path);
  return {
    path: relativePosix(root, path),
    content,
    sha256: sha256(TEXT_ENCODER.encode(content)),
    size: fileStat.size,
    updatedAt: fileStat.mtimeMs,
  };
}
