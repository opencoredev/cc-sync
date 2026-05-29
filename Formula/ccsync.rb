class Ccsync < Formula
  desc "Sync AI agent skills and MCP config across machines"
  homepage "https://github.com/opencoredev/cc-sync"
  license :cannot_represent
  head "https://github.com/opencoredev/cc-sync.git", branch: "main"

  depends_on "oven-sh/bun/bun"

  def install
    system "bun", "install", "--frozen-lockfile"
    system "bun", "run", "cli:build"
    bin.install "apps/cli/dist/ccsync"
  end

  test do
    assert_match "ccsync 0.1.0", shell_output("#{bin}/ccsync --version")
  end
end
