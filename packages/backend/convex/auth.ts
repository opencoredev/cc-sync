import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";

import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const siteUrl = requireEnv("SITE_URL");
const authBaseUrl = process.env.CONVEX_SITE_URL ?? process.env.VITE_CONVEX_SITE_URL ?? siteUrl;

export const authComponent = createClient<DataModel>(components.betterAuth);

function createAuth(ctx: GenericCtx<DataModel>) {
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const vercelClientId = process.env.VERCEL_CLIENT_ID;
  const vercelClientSecret = process.env.VERCEL_CLIENT_SECRET;

  return betterAuth({
    appName: "ccsync",
    baseURL: authBaseUrl,
    trustedOrigins: trustedOrigins(),
    database: authComponent.adapter(ctx),
    socialProviders: socialProviders({
      githubClientId,
      githubClientSecret,
      vercelClientId,
      vercelClientSecret,
    }),
    plugins: [
      crossDomain({ siteUrl }),
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
    ],
  });
}

export { createAuth };

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.safeGetAuthUser(ctx);
  },
});

export const getAvailableProviders = query({
  args: {},
  handler: async () => {
    return {
      github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      vercel: Boolean(process.env.VERCEL_CLIENT_ID && process.env.VERCEL_CLIENT_SECRET),
    };
  },
});

function socialProviders({
  githubClientId,
  githubClientSecret,
  vercelClientId,
  vercelClientSecret,
}: {
  githubClientId?: string;
  githubClientSecret?: string;
  vercelClientId?: string;
  vercelClientSecret?: string;
}) {
  return {
    ...(githubClientId && githubClientSecret
      ? {
          github: {
            clientId: githubClientId,
            clientSecret: githubClientSecret,
          },
        }
      : {}),
    ...(vercelClientId && vercelClientSecret
      ? {
          vercel: {
            clientId: vercelClientId,
            clientSecret: vercelClientSecret,
          },
        }
      : {}),
  };
}

function trustedOrigins(): string[] {
  return uniqueOrigins([
    siteUrl,
    process.env.VITE_SITE_URL,
    process.env.VITE_CONVEX_SITE_URL,
    process.env.CONVEX_SITE_URL,
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://cc-sync.localhost",
    "https://cc-sync.localhost",
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ?? []),
  ]);
}

function uniqueOrigins(origins: Array<string | undefined>): string[] {
  return [...new Set(origins.map((origin) => origin?.trim()).filter(Boolean) as string[])];
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}
