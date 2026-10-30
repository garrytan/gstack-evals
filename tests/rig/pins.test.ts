import { describe, expect, test } from "bun:test";
import { dockerDirFindings, dockerfiles, unpinnedInstalls } from "../../src/rig/pins.ts";

const DIGEST = "@sha256:" + "a".repeat(64);

describe("unpinned installs under docker/ (U20)", () => {
  test("every Dockerfile under docker/ installs only pinned bytes", () => {
    expect(dockerfiles()).toContain("docker/trial.Dockerfile");
    expect(dockerDirFindings()).toEqual([]);
  });

  test("each kind of unpinned install is refused, and its pinned form passes", () => {
    const bad = [
      "FROM oven/bun:1.4.4",
      "RUN curl -fsSL https://example.com/install.sh | bash",
      "RUN curl -fsSL -o /tmp/x.tgz https://example.com/x.tgz && tar xf /tmp/x.tgz",
      "RUN git clone https://github.com/a/b.git /b",
      "RUN apt-get update && apt-get install -y --no-install-recommends git curl",
      "RUN npm install -g @anthropic-ai/claude-code",
      "RUN bun install",
      "RUN pip install requests",
      "RUN pip install -r requirements.txt",
      "ADD https://example.com/x.tgz /x.tgz",
      "RUN bunx some-tool",
    ];
    const findings = unpinnedInstalls("docker/bad.Dockerfile", bad.join("\n"));
    expect(findings.map((f) => f.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const good = [
      "FROM oven/bun:1.4.4" + DIGEST + " AS base",
      "FROM base",
      "RUN curl -fsSL -o /tmp/x.tgz https://example.com/x.tgz && echo \"abc  /tmp/x.tgz\" | sha256sum -c - && tar xf /tmp/x.tgz",
      "RUN git clone https://github.com/a/b.git /b && git -C /b checkout " + "f".repeat(40),
      "RUN apt-get install -y git=1:2.43.0-1 curl=8.5.0-2",
      "RUN npm install -g @anthropic-ai/claude-code@2.1.314 \\",
      "    @openai/codex@0.166.0",
      "RUN bun install --frozen-lockfile",
      "RUN pip install requests==2.32.3 && pip install --require-hashes -r requirements.txt",
      "ADD --checksum=sha256:" + "b".repeat(64) + " https://example.com/x.tgz /x.tgz",
    ];
    expect(unpinnedInstalls("docker/good.Dockerfile", good.join("\n"))).toEqual([]);
  });
});
