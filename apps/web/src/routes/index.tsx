import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  KeyRound,
  Terminal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { api } from "@cc-sync/backend/convex/_generated/api";
import { Button } from "@cc-sync/ui/components/button";
import { Input } from "@cc-sync/ui/components/input";
import { Label } from "@cc-sync/ui/components/label";
import { useMutation, useQuery } from "convex/react";

import { authClient } from "@/lib/auth-client";

const HOMEBREW_INSTALL_COMMAND = "brew install --HEAD opencoredev/cc-sync/ccsync";
const START_COMMANDS = `ccsync init
ccsync daemon start`;

export const Route = createFileRoute("/")({
  validateSearch: (search): { error?: string; error_description?: string } => ({
    error: typeof search.error === "string" ? search.error : undefined,
    error_description:
      typeof search.error_description === "string" ? search.error_description : undefined,
  }),
  component: HomeComponent,
});

function HomeComponent() {
  const session = authClient.useSession();
  const search = Route.useSearch();
  const [label, setLabel] = useState("Main laptop");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<"install" | "start" | null>(null);
  const issueCliToken = useMutation(api.sync.issueCliToken);
  const providers = useQuery(api.auth.getAvailableProviders);

  async function signIn(provider: "github" | "vercel") {
    await authClient.signIn.social({
      provider,
      callbackURL: getCallbackUrl(),
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

  async function copyCommand(value: string, key: "install" | "start") {
    await navigator.clipboard.writeText(value);
    setCopiedCommand(key);
  }

  return (
    <main className="cc-page-frame min-h-svh bg-background text-foreground">
      <div className="cc-auth-stage mx-auto flex min-h-svh w-full items-center justify-center px-5 py-8 sm:px-8">
        <section className="cc-auth-panel w-full max-w-[420px] border bg-card/95 shadow-xl">
          {session.data ? (
            <SignedInPanel
              copiedCommand={copiedCommand}
              copied={copied}
              issuedToken={issuedToken}
              label={label}
              setLabel={setLabel}
              signOut={signOut}
              createToken={createToken}
              copyToken={copyToken}
              copyCommand={copyCommand}
              userLabel={session.data.user.name ?? session.data.user.email ?? "Signed in"}
            />
          ) : (
            <SignedOutPanel
              authError={formatAuthError(search.error ?? search.error_description)}
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
  authError,
  providers,
  signIn,
}: {
  authError?: string;
  providers: { github: boolean; vercel: boolean };
  signIn: (provider: "github" | "vercel") => Promise<void>;
}) {
  const hasProvider = providers.github || providers.vercel;

  return (
    <div className="space-y-6 px-6 py-8 sm:px-8">
      <div className="space-y-3 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border bg-background text-foreground shadow-sm">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-[1.65rem] font-semibold tracking-normal">Sign in to ccsync</h1>
          <p className="mx-auto max-w-[24rem] text-sm leading-6 text-muted-foreground">
            Create a CLI token for your synced agent setup.
          </p>
        </div>
      </div>

      {authError ? (
        <div className="cc-auth-error flex gap-2 rounded-md border px-3 py-2.5 text-xs leading-5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{authError}</span>
        </div>
      ) : null}

      <div className="grid gap-2">
        <Button
          className="cc-provider-button h-10 justify-center gap-2 rounded-md text-sm"
          disabled={!providers.github}
          onClick={() => signIn("github")}
        >
          <GithubLogo className="h-[18px] w-[18px]" />
          {providers.github ? "Continue with GitHub" : "GitHub OAuth not configured"}
        </Button>
        {providers.vercel ? (
          <Button
            className="cc-provider-button h-10 justify-center gap-2 rounded-md text-sm"
            variant="outline"
            onClick={() => signIn("vercel")}
          >
            <VercelLogo className="h-[18px] w-[18px]" />
            Continue with Vercel
          </Button>
        ) : null}
      </div>

      {!hasProvider ? (
        <p className="text-center text-xs leading-5 text-muted-foreground">
          Add production OAuth keys in Convex to enable sign in.
        </p>
      ) : null}
    </div>
  );
}

function SignedInPanel({
  copied,
  copiedCommand,
  createToken,
  copyCommand,
  copyToken,
  issuedToken,
  label,
  setLabel,
  signOut,
  userLabel,
}: {
  copied: boolean;
  copiedCommand: "install" | "start" | null;
  createToken: () => Promise<void>;
  copyCommand: (value: string, key: "install" | "start") => Promise<void>;
  copyToken: () => Promise<void>;
  issuedToken: string | null;
  label: string;
  setLabel: (label: string) => void;
  signOut: () => Promise<void>;
  userLabel: string;
}) {
  return (
    <div className="space-y-4 px-5 py-5 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-normal">Set up ccsync</h1>
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{userLabel}</span>
          </div>
        </div>
        <Button className="rounded-md" variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>

      <div className="cc-setup-list divide-y rounded-md border bg-background">
        <SetupSection>
          <CommandBlock
            command={HOMEBREW_INSTALL_COMMAND}
            copied={copiedCommand === "install"}
            icon={Download}
            label="Install"
            onCopy={() => copyCommand(HOMEBREW_INSTALL_COMMAND, "install")}
          />
        </SetupSection>

        <SetupSection>
          <div className="mb-2 flex items-center justify-between gap-3">
            <Label className="text-sm font-medium" htmlFor="token-label">
              Create CLI token
            </Label>
            <span className="text-xs text-muted-foreground">Paste into init</span>
          </div>
          <Input
            className="h-9 rounded-md bg-card text-sm"
            id="token-label"
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
          />
          <Button className="mt-3 h-10 w-full rounded-md text-sm" onClick={createToken}>
            Create CLI token
          </Button>

          {issuedToken ? (
            <div className="mt-3 rounded-md border bg-card">
              <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
                <span className="font-medium">CLI token</span>
                <CopyButton copied={copied} onClick={copyToken} />
              </div>
              <div className="break-all px-3 py-3 font-mono text-xs leading-6 text-muted-foreground">
                {issuedToken}
              </div>
            </div>
          ) : null}
        </SetupSection>

        <SetupSection>
          <CommandBlock
            command={START_COMMANDS}
            copied={copiedCommand === "start"}
            icon={Terminal}
            label="Run after install"
            onCopy={() => copyCommand(START_COMMANDS, "start")}
          />
        </SetupSection>
      </div>
    </div>
  );
}

function SetupSection({ children }: { children: ReactNode }) {
  return <div className="p-3">{children}</div>;
}

function CommandBlock({
  command,
  copied,
  icon: Icon,
  label,
  onCopy,
}: {
  command: string;
  copied: boolean;
  icon: LucideIcon;
  label: string;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {label}
        </div>
        <CopyButton copied={copied} onClick={onCopy} />
      </div>
      <pre className="cc-command-line overflow-x-auto rounded-md border bg-card px-3 py-3 font-mono text-xs leading-6 text-muted-foreground">
        <code>{command}</code>
      </pre>
    </div>
  );
}

function CopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <button
      className="cc-copy inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      type="button"
      onClick={onClick}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
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

function getCallbackUrl(): string {
  if (typeof window === "undefined") return "https://cc-sync.dev/";
  return new URL("/", window.location.origin).toString();
}

function formatAuthError(error: string | undefined): string | undefined {
  if (!error) return undefined;
  if (error === "please_restart_the_process") {
    return "That OAuth session expired. Start again here and it will use the production app.";
  }
  return "Sign-in could not finish. Start again here and ccsync will restart the OAuth flow.";
}
