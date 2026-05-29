export const MANIFEST_SCHEMA_VERSION = 1 as const;

export type SyncDirection = "push" | "pull" | "apply" | "scan";

export interface RegistrySkillRef {
  agent: string;
  id: string;
  name: string;
  source: "skills.sh" | "unknown";
  version?: string;
}

export interface FileSnapshot {
  path: string;
  content: string;
  sha256: string;
  size: number;
  updatedAt: number;
}

export interface CustomSkillSnapshot {
  agent: string;
  root: string;
  name: string;
  files: FileSnapshot[];
  hash: string;
}

export interface McpEnvEntry {
  key: string;
  value?: string;
  redacted: boolean;
}

export interface McpServerSnapshot {
  agent: string;
  configPath: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http" | "sse" | "unknown";
  command?: string;
  args?: string[];
  url?: string;
  env?: McpEnvEntry[];
  raw?: string;
}

export interface AgentDetection {
  id: string;
  name: string;
  detected: boolean;
  paths: string[];
}

export interface CcSyncManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  createdAt: number;
  deviceId: string;
  machineName: string;
  platform: string;
  agents: AgentDetection[];
  registrySkills: RegistrySkillRef[];
  customSkills: CustomSkillSnapshot[];
  mcpServers: McpServerSnapshot[];
  hash: string;
}

export interface DeviceInfo {
  deviceId: string;
  label: string;
  hostname: string;
  platform: string;
  arch: string;
  machineId: string;
  agentCount: number;
  ccsyncVersion: string;
}

export interface CcSyncConfig {
  convexUrl?: string;
  siteUrl?: string;
  tokenHash?: string;
  tokenPrefix?: string;
  deviceId: string;
  deviceLabel: string;
  machineId: string;
  paused: boolean;
  debounceMs: number;
  pollMs: number;
  lastSyncAt?: number;
  lastPulledRevision?: number;
  lastPushedHash?: string;
}

export interface SyncResult {
  ok: boolean;
  message: string;
  changed?: boolean;
  revision?: number;
}

export interface ApplyChange {
  path: string;
  action: "created" | "updated" | "skipped" | "failed";
  message: string;
}

export interface ApplyResult {
  changes: ApplyChange[];
}
