import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="mb-3 text-sm font-medium text-fd-muted-foreground">ccsync docs</p>
        <h1 className="mb-4 text-3xl font-semibold tracking-normal text-fd-foreground">
          Quick Start for cross-device agent setup.
        </h1>
        <p className="mb-6 text-sm leading-6 text-fd-muted-foreground">
          Install the Homebrew CLI, sign in with GitHub, create a token, and keep global agent
          skills and MCP config aligned across machines.
        </p>
        <Link
          to="/docs/$"
          params={{
            _splat: "",
          }}
          className="mx-auto rounded-lg bg-fd-primary px-3 py-2 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
        >
          Open Quick Start
        </Link>
      </div>
    </HomeLayout>
  );
}
