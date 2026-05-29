import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const fileSnapshot = v.object({
  path: v.string(),
  content: v.string(),
  sha256: v.string(),
  size: v.number(),
  updatedAt: v.number(),
});

const registrySkill = v.object({
  agent: v.string(),
  id: v.string(),
  name: v.string(),
  source: v.union(v.literal("skills.sh"), v.literal("unknown")),
  version: v.optional(v.string()),
});

const customSkill = v.object({
  agent: v.string(),
  root: v.string(),
  name: v.string(),
  files: v.array(fileSnapshot),
  hash: v.string(),
});

const mcpServer = v.object({
  agent: v.string(),
  configPath: v.string(),
  name: v.string(),
  enabled: v.boolean(),
  transport: v.union(v.literal("stdio"), v.literal("http"), v.literal("sse"), v.literal("unknown")),
  command: v.optional(v.string()),
  args: v.optional(v.array(v.string())),
  url: v.optional(v.string()),
  env: v.optional(
    v.array(
      v.object({
        key: v.string(),
        value: v.optional(v.string()),
        redacted: v.boolean(),
      }),
    ),
  ),
  raw: v.optional(v.string()),
});

const agentDetection = v.object({
  id: v.string(),
  name: v.string(),
  detected: v.boolean(),
  paths: v.array(v.string()),
});

export const manifestValidator = v.object({
  schemaVersion: v.literal(1),
  createdAt: v.number(),
  deviceId: v.string(),
  machineName: v.string(),
  platform: v.string(),
  agents: v.array(agentDetection),
  registrySkills: v.array(registrySkill),
  customSkills: v.array(customSkill),
  mcpServers: v.array(mcpServer),
  hash: v.string(),
});

export const deviceValidator = v.object({
  deviceId: v.string(),
  label: v.string(),
  hostname: v.string(),
  platform: v.string(),
  arch: v.string(),
  machineId: v.string(),
  agentCount: v.number(),
  ccsyncVersion: v.string(),
});

export default defineSchema({
  users: defineTable({
    authUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_auth_user", ["authUserId"]),

  cliTokens: defineTable({
    userId: v.id("users"),
    label: v.string(),
    tokenHash: v.string(),
    tokenPrefix: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_hash", ["tokenHash"])
    .index("by_user", ["userId"]),

  devices: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    label: v.string(),
    hostname: v.string(),
    platform: v.string(),
    arch: v.string(),
    machineId: v.string(),
    agentCount: v.number(),
    ccsyncVersion: v.string(),
    paused: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.number(),
    lastPushAt: v.optional(v.number()),
    lastPullAt: v.optional(v.number()),
    removedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_device", ["userId", "deviceId"]),

  manifests: defineTable({
    userId: v.id("users"),
    revision: v.number(),
    hash: v.string(),
    manifest: manifestValidator,
    updatedAt: v.number(),
    updatedByDeviceId: v.string(),
  }).index("by_user", ["userId"]),

  manifestRevisions: defineTable({
    userId: v.id("users"),
    revision: v.number(),
    hash: v.string(),
    manifest: manifestValidator,
    createdAt: v.number(),
    deviceId: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_user_revision", ["userId", "revision"]),

  syncEvents: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    direction: v.union(v.literal("push"), v.literal("pull"), v.literal("apply"), v.literal("scan")),
    status: v.union(v.literal("ok"), v.literal("error")),
    message: v.string(),
    manifestHash: v.optional(v.string()),
    revision: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),
});
