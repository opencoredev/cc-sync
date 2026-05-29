import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, KeyRound, Monitor } from "lucide-react";
import { useState } from "react";

import { api } from "@cc-sync/backend/convex/_generated/api";
import { Button } from "@cc-sync/ui/components/button";
import { Input } from "@cc-sync/ui/components/input";
import { Label } from "@cc-sync/ui/components/label";
import { useMutation, useQuery } from "convex/react";

import { authClient } from "@/lib/auth-client";

const DOCS_URL = "https://cc-sync.dev/docs";
const HOMEBREW_INSTALL_COMMAND = `brew tap opencoredev/cc-sync https://github.com/opencoredev/cc-sync
brew install --HEAD opencoredev/cc-sync/ccsync`;
const START_COMMANDS = `ccsync init
ccsync daemon start`;

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const session = authClient.useSession();
  const [label, setLabel] = useState("Main laptop");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const issueCliToken = useMutation(api.sync.issueCliToken);
  const tokens = useQuery(api.sync.listCliTokens, session.data ? {} : "skip");
  const devices = useQuery(api.sync.listDevices, session.data ? {} : "skip");
  const providers = useQuery(api.auth.getAvailableProviders);
  const tokenCount = tokens?.filter((token) => !token.revokedAt).length ?? 0;
  const deviceCount = devices?.length ?? 0;

  async function signIn(provider: "github" | "vercel") {
    await authClient.signIn.social({
      provider,
      callbackURL: "/",
    });
  }

  async function signOut() {
    await authClient.signOut();
    setIssuedToken(null);
  }

  async function createToken() {
    const token = createPlainToken();
    await issueCliToken({
      label,
      tokenHash: await sha256(token),
      tokenPrefix: `${token.slice(0, 10)}...${token.slice(-4)}`,
    });
    setCopied(false);
    setIssuedToken(token);
  }

  async function copyToken() {
    if (!issuedToken) return;
    await navigator.clipboard.writeText(issuedToken);
    setCopied(true);
  }

  return (
    <main className="cc-page-frame min-h-svh bg-background text-foreground">
      <div className="cc-auth-stage mx-auto flex min-h-svh w-full max-w-5xl items-center justify-center px-5 py-8 sm:px-8">
        <section className="cc-auth-panel w-full max-w-[440px] rounded-xl border bg-card/96 shadow-sm">
          <div className="border-b px-5 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold tracking-normal">ccsync</p>
                <p className="mt-1 text-xs text-muted-foreground">Agent settings sync</p>
              </div>
              <div className="cc-terminal-dot-row" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>

          {session.data ? (
            <SignedInPanel
              copied={copied}
              deviceCount={deviceCount}
              issuedToken={issuedToken}
              label={label}
              setLabel={setLabel}
              signOut={signOut}
              createToken={createToken}
              copyToken={copyToken}
              tokenCount={tokenCount}
              userLabel={session.data.user.name ?? session.data.user.email ?? "Signed in"}
            />
          ) : (
            <SignedOutPanel
              providers={providers ?? { github: true, vercel: false }}
              signIn={signIn}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function SignedOutPanel({
  providers,
  signIn,
}: {
  providers: { github: boolean; vercel: boolean };
  signIn: (provider: "github" | "vercel") => Promise<void>;
}) {
  return (
    <div className="space-y-6 px-5 py-6 sm:px-6">
      <div className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-normal">Sign in to ccsync</h1>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            Create a CLI token and keep your agent skills, MCPs, and device settings in sync.
          </p>
        </div>
      </div>

      <div className="grid gap-2.5">
        <Button
          className="cc-provider-button h-11 justify-start gap-3"
          disabled={!providers.github}
          onClick={() => signIn("github")}
        >
          <GithubLogo className="h-[18px] w-[18px]" />
          Continue with GitHub
        </Button>
        <Button
          className="cc-provider-button h-11 justify-start gap-3"
          variant="outline"
          disabled={!providers.vercel}
          title={providers.vercel ? undefined : "Vercel OAuth is not configured yet"}
          onClick={() => signIn("vercel")}
        >
          <VercelLogo className="h-[18px] w-[18px]" />
          Continue with Vercel
        </Button>
      </div>

      <a
        className="cc-doc-link block rounded-lg border bg-background px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        href={DOCS_URL}
      >
        Read the Quick Start before installing
      </a>

      <div className="cc-auth-notes grid gap-2 border-t pt-4 font-mono text-[11px] leading-5 text-muted-foreground">
        <p>
          <span aria-hidden="true">01</span> scan user-level config
        </p>
        <p>
          <span aria-hidden="true">02</span> sync custom skills and MCPs
        </p>
        <p>
          <span aria-hidden="true">03</span> settle conflicts by latest push
        </p>
      </div>
    </div>
  );
}

function SignedInPanel({
  copied,
  createToken,
  copyToken,
  deviceCount,
  issuedToken,
  label,
  setLabel,
  signOut,
  tokenCount,
  userLabel,
}: {
  copied: boolean;
  createToken: () => Promise<void>;
  copyToken: () => Promise<void>;
  deviceCount: number;
  issuedToken: string | null;
  label: string;
  setLabel: (label: string) => void;
  signOut: () => Promise<void>;
  tokenCount: number;
  userLabel: string;
}) {
  return (
    <div className="space-y-5 px-5 py-6 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Signed in as</p>
          <h2 className="mt-1 text-xl font-semibold tracking-normal">{userLabel}</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 text-sm">
        <div className="rounded-lg border bg-background p-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Monitor className="h-4 w-4" aria-hidden="true" />
            Devices
          </div>
          <div className="mt-2 text-2xl font-semibold">{deviceCount}</div>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Tokens
          </div>
          <div className="mt-2 text-2xl font-semibold">{tokenCount}</div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border bg-background">
          <div className="border-b px-3 py-2 text-sm font-medium">Install with Homebrew</div>
          <pre className="overflow-x-auto px-3 py-3 font-mono text-xs leading-6 text-muted-foreground">
            <code>{HOMEBREW_INSTALL_COMMAND}</code>
          </pre>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="token-label">Device label</Label>
          <Input
            id="token-label"
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
          />
        </div>
        <Button className="h-11 w-full" onClick={createToken}>
          Create CLI token
        </Button>
      </div>

      {issuedToken ? (
        <div className="rounded-lg border bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
            <span className="font-medium">New token</span>
            <button
              className="cc-copy inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              type="button"
              onClick={copyToken}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="break-all p-3 font-mono text-xs leading-6 text-muted-foreground">
            {issuedToken}
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border bg-background">
        <div className="border-b px-3 py-2 text-sm font-medium">Start syncing</div>
        <pre className="overflow-x-auto px-3 py-3 font-mono text-xs leading-6 text-muted-foreground">
          <code>{START_COMMANDS}</code>
        </pre>
      </div>

      <a className="text-sm text-muted-foreground hover:text-foreground" href={DOCS_URL}>
        Open setup docs
      </a>
    </div>
  );
}

function GithubLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 98 96" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M48.9 0C21.9 0 0 22 0 49.1c0 21.7 14 40.1 33.5 46.6 2.4.5 3.3-1.1 3.3-2.4 0-1.2-.1-5.2-.1-9.5-13.6 3-16.5-5.9-16.5-5.9-2.2-5.7-5.4-7.2-5.4-7.2-4.4-3 .3-3 .3-3 4.9.3 7.5 5.1 7.5 5.1 4.4 7.5 11.5 5.3 14.3 4.1.4-3.2 1.7-5.3 3.1-6.5-10.9-1.2-22.3-5.5-22.3-24.3 0-5.4 1.9-9.8 5-13.2-.5-1.2-2.2-6.2.5-13 0 0 4.1-1.3 13.4 5 3.9-1.1 8.1-1.6 12.3-1.6s8.4.5 12.3 1.6c9.3-6.3 13.4-5 13.4-5 2.7 6.8 1 11.8.5 13 3.1 3.4 5 7.8 5 13.2 0 18.9-11.5 23.1-22.4 24.3 1.8 1.6 3.3 4.6 3.3 9.3 0 6.7-.1 12.1-.1 13.7 0 1.3.9 2.9 3.4 2.4C83.8 89.2 97.8 70.8 97.8 49.1 97.8 22 75.9 0 48.9 0Z"
      />
    </svg>
  );
}

function VercelLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 116 100" fill="currentColor" aria-hidden="true">
      <path d="M57.5 0 115 100H0L57.5 0Z" />
    </svg>
  );
}

function createPlainToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `ccsync_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
