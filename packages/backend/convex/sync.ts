import { ConvexError, v } from "convex/values";

import { authComponent } from "./auth";
import { deviceValidator, manifestValidator } from "./schema";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type AuthUser = {
  _id: string;
  email?: string;
  name?: string;
  image?: string;
};

type ManifestForValidation = {
  deviceId: string;
  hash: string;
  registrySkills: unknown[];
  customSkills: Array<{
    files: Array<{
      content: string;
      size: number;
    }>;
  }>;
  mcpServers: unknown[];
};

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const MAX_TOKEN_LABEL_LENGTH = 80;
const MAX_REGISTRY_SKILLS = 500;
const MAX_CUSTOM_SKILLS = 100;
const MAX_CUSTOM_SKILL_FILES = 2_000;
const MAX_CUSTOM_SKILL_BYTES = 5 * 1024 * 1024;
const MAX_MCP_SERVERS = 200;

export const issueCliToken = mutation({
  args: {
    label: v.string(),
    tokenHash: v.string(),
    tokenPrefix: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ensureUserFromAuth(ctx);
    const label = cleanTokenLabel(args.label);
    validateTokenHash(args.tokenHash);
    const now = Date.now();
    const tokenId = await ctx.db.insert("cliTokens", {
      userId: user._id,
      label,
      tokenHash: args.tokenHash,
      tokenPrefix: cleanTokenPrefix(args.tokenPrefix),
      createdAt: now,
      expiresAt: args.expiresAt,
    });
    return { tokenId, tokenPrefix: args.tokenPrefix };
  },
});

export const revokeCliToken = mutation({
  args: {
    tokenId: v.id("cliTokens"),
  },
  handler: async (ctx, args) => {
    const user = await ensureUserFromAuth(ctx);
    const token = await ctx.db.get(args.tokenId);
    if (!token || token.userId !== user._id) throw new ConvexError("Token not found");
    await ctx.db.patch(args.tokenId, { revokedAt: Date.now() });
    return { ok: true };
  },
});

export const listCliTokens = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUserFromAuthIfExists(ctx);
    if (!user) return [];
    const tokens = await ctx.db
      .query("cliTokens")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return tokens.map(({ tokenHash: _tokenHash, userId: _userId, ...token }) => token);
  },
});

export const listDevices = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUserFromAuthIfExists(ctx);
    if (!user) return [];
    return await listActiveDevices(ctx, user._id);
  },
});

export const registerDeviceWithToken = mutation({
  args: {
    tokenHash: v.string(),
    device: deviceValidator,
  },
  handler: async (ctx, args) => {
    const token = await requireToken(ctx, args.tokenHash);
    await upsertDevice(ctx, token.userId, args.device, { seen: true });
    return { ok: true };
  },
});

export const heartbeatWithToken = mutation({
  args: {
    tokenHash: v.string(),
    device: deviceValidator,
  },
  handler: async (ctx, args) => {
    const token = await requireToken(ctx, args.tokenHash);
    await upsertDevice(ctx, token.userId, args.device, { seen: true });
    return { ok: true };
  },
});

export const pushManifestWithToken = mutation({
  args: {
    tokenHash: v.string(),
    deviceId: v.string(),
    manifest: manifestValidator,
  },
  handler: async (ctx, args) => {
    const token = await requireToken(ctx, args.tokenHash);
    validateManifestPush(args.deviceId, args.manifest);
    const now = Date.now();
    const current = await getCurrentManifest(ctx, token.userId);
    if (current?.hash === args.manifest.hash) {
      await markDevicePush(ctx, token.userId, args.deviceId, now);
      await recordEvent(
        ctx,
        token.userId,
        args.deviceId,
        "push",
        "ok",
        "No manifest changes",
        args.manifest.hash,
        current.revision,
      );
      return { revision: current.revision, changed: false };
    }
    const revision = (current?.revision ?? 0) + 1;
    if (current) {
      await ctx.db.patch(current._id, {
        revision,
        hash: args.manifest.hash,
        manifest: args.manifest,
        updatedAt: now,
        updatedByDeviceId: args.deviceId,
      });
    } else {
      await ctx.db.insert("manifests", {
        userId: token.userId,
        revision,
        hash: args.manifest.hash,
        manifest: args.manifest,
        updatedAt: now,
        updatedByDeviceId: args.deviceId,
      });
    }
    await ctx.db.insert("manifestRevisions", {
      userId: token.userId,
      revision,
      hash: args.manifest.hash,
      manifest: args.manifest,
      createdAt: now,
      deviceId: args.deviceId,
    });
    await markDevicePush(ctx, token.userId, args.deviceId, now);
    await recordEvent(
      ctx,
      token.userId,
      args.deviceId,
      "push",
      "ok",
      "Manifest pushed",
      args.manifest.hash,
      revision,
    );
    return { revision, changed: true };
  },
});

export const pullManifestWithToken = query({
  args: {
    tokenHash: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await requireTokenRead(ctx, args.tokenHash);
    const current = await getCurrentManifest(ctx, token.userId);
    if (!current) return null;
    return {
      revision: current.revision,
      hash: current.hash,
      manifest: current.manifest,
    };
  },
});

export const statusWithToken = query({
  args: {
    tokenHash: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await requireTokenRead(ctx, args.tokenHash);
    const [devices, manifest] = await Promise.all([
      listActiveDevices(ctx, token.userId),
      getCurrentManifest(ctx, token.userId),
    ]);
    return {
      configured: true,
      devices,
      manifest: manifest
        ? {
            revision: manifest.revision,
            hash: manifest.hash,
            updatedAt: manifest.updatedAt,
            updatedByDeviceId: manifest.updatedByDeviceId,
          }
        : undefined,
    };
  },
});

export const setDevicePausedWithToken = mutation({
  args: {
    tokenHash: v.string(),
    deviceId: v.string(),
    paused: v.boolean(),
  },
  handler: async (ctx, args) => {
    const token = await requireToken(ctx, args.tokenHash);
    const device = await getDevice(ctx, token.userId, args.deviceId);
    if (!device) throw new ConvexError("Device not found");
    await ctx.db.patch(device._id, { paused: args.paused, updatedAt: Date.now() });
    return { ok: true };
  },
});

export const removeDeviceWithToken = mutation({
  args: {
    tokenHash: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await requireToken(ctx, args.tokenHash);
    const device = await getDevice(ctx, token.userId, args.deviceId);
    if (!device) throw new ConvexError("Device not found");
    await ctx.db.patch(device._id, { removedAt: Date.now(), updatedAt: Date.now() });
    return { ok: true };
  },
});

async function ensureUserFromAuth(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const authUser = (await authComponent.safeGetAuthUser(ctx)) as AuthUser | undefined;
  if (!authUser) throw new ConvexError("Unauthenticated");
  const existing = await ctx.db
    .query("users")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", authUser._id))
    .unique();
  const now = Date.now();
  if (existing) {
    if ("patch" in ctx.db) {
      await ctx.db.patch(existing._id, {
        email: authUser.email,
        name: authUser.name,
        image: authUser.image,
        updatedAt: now,
      });
    }
    return existing;
  }
  if (!("insert" in ctx.db)) throw new ConvexError("User profile missing");
  const userId = await ctx.db.insert("users", {
    authUserId: authUser._id,
    email: authUser.email,
    name: authUser.name,
    image: authUser.image,
    createdAt: now,
    updatedAt: now,
  });
  const inserted = await ctx.db.get(userId);
  if (!inserted) throw new ConvexError("Failed to create user profile");
  return inserted;
}

async function getUserFromAuthIfExists(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const authUser = (await authComponent.safeGetAuthUser(ctx)) as AuthUser | undefined;
  if (!authUser) throw new ConvexError("Unauthenticated");
  return await ctx.db
    .query("users")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", authUser._id))
    .unique();
}

async function requireToken(ctx: MutationCtx, tokenHash: string): Promise<Doc<"cliTokens">> {
  const token = await requireTokenRead(ctx, tokenHash);
  await ctx.db.patch(token._id, { lastUsedAt: Date.now() });
  return token;
}

async function requireTokenRead(
  ctx: QueryCtx | MutationCtx,
  tokenHash: string,
): Promise<Doc<"cliTokens">> {
  validateTokenHash(tokenHash);
  const token = await ctx.db
    .query("cliTokens")
    .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!token || token.revokedAt || (token.expiresAt && token.expiresAt < Date.now())) {
    throw new ConvexError("Invalid ccsync token");
  }
  return token;
}

function cleanTokenLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > MAX_TOKEN_LABEL_LENGTH) {
    throw new ConvexError(`Token label must be 1-${MAX_TOKEN_LABEL_LENGTH} characters`);
  }
  return trimmed;
}

function cleanTokenPrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed || trimmed.length > 32 || !trimmed.startsWith("ccsync_")) {
    throw new ConvexError("Invalid token prefix");
  }
  return trimmed;
}

function validateTokenHash(tokenHash: string): void {
  if (!SHA256_HEX_PATTERN.test(tokenHash)) {
    throw new ConvexError("Invalid ccsync token");
  }
}

function validateManifestPush(deviceId: string, manifest: ManifestForValidation) {
  if (manifest.deviceId !== deviceId) {
    throw new ConvexError("Manifest deviceId does not match caller deviceId");
  }
  if (!SHA256_HEX_PATTERN.test(manifest.hash)) {
    throw new ConvexError("Invalid manifest hash");
  }
  if (manifest.registrySkills.length > MAX_REGISTRY_SKILLS) {
    throw new ConvexError("Manifest contains too many registry skills");
  }
  if (manifest.customSkills.length > MAX_CUSTOM_SKILLS) {
    throw new ConvexError("Manifest contains too many custom skills");
  }
  if (manifest.mcpServers.length > MAX_MCP_SERVERS) {
    throw new ConvexError("Manifest contains too many MCP servers");
  }
  let fileCount = 0;
  let byteCount = 0;
  for (const skill of manifest.customSkills) {
    fileCount += skill.files.length;
    for (const file of skill.files) {
      byteCount += file.size;
      if (file.size > 128 * 1024 || file.content.length > 256 * 1024) {
        throw new ConvexError("Manifest custom skill file is too large");
      }
    }
  }
  if (fileCount > MAX_CUSTOM_SKILL_FILES || byteCount > MAX_CUSTOM_SKILL_BYTES) {
    throw new ConvexError("Manifest custom skill payload is too large");
  }
}

async function upsertDevice(
  ctx: MutationCtx,
  userId: Id<"users">,
  device: {
    deviceId: string;
    label: string;
    hostname: string;
    platform: string;
    arch: string;
    machineId: string;
    agentCount: number;
    ccsyncVersion: string;
  },
  options: { seen: boolean },
) {
  const now = Date.now();
  const existing = await getDevice(ctx, userId, device.deviceId);
  const patch = {
    label: device.label,
    hostname: device.hostname,
    platform: device.platform,
    arch: device.arch,
    machineId: device.machineId,
    agentCount: device.agentCount,
    ccsyncVersion: device.ccsyncVersion,
    updatedAt: now,
    lastSeenAt: options.seen ? now : (existing?.lastSeenAt ?? now),
    removedAt: undefined,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("devices", {
    userId,
    deviceId: device.deviceId,
    ...patch,
    paused: false,
    createdAt: now,
  });
}

async function getDevice(ctx: QueryCtx | MutationCtx, userId: Id<"users">, deviceId: string) {
  return await ctx.db
    .query("devices")
    .withIndex("by_user_device", (q) => q.eq("userId", userId).eq("deviceId", deviceId))
    .unique();
}

async function listActiveDevices(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const devices = await ctx.db
    .query("devices")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return devices
    .filter((device) => !device.removedAt)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map(
      ({
        _id,
        _creationTime,
        userId: _userId,
        machineId: _machineId,
        removedAt: _removedAt,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...device
      }) => device,
    );
}

async function getCurrentManifest(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("manifests")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function markDevicePush(
  ctx: MutationCtx,
  userId: Id<"users">,
  deviceId: string,
  now: number,
): Promise<void> {
  const device = await getDevice(ctx, userId, deviceId);
  if (device) {
    await ctx.db.patch(device._id, { lastPushAt: now, lastSeenAt: now, updatedAt: now });
  }
}

async function recordEvent(
  ctx: MutationCtx,
  userId: Id<"users">,
  deviceId: string,
  direction: "push" | "pull" | "apply" | "scan",
  status: "ok" | "error",
  message: string,
  manifestHash?: string,
  revision?: number,
): Promise<void> {
  await ctx.db.insert("syncEvents", {
    userId,
    deviceId,
    direction,
    status,
    message,
    manifestHash,
    revision,
    createdAt: Date.now(),
  });
}
