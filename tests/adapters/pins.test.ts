import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_CLI, HAS_CLAUDE_CLI, REPO } from "./harness.ts";

const pins = JSON.parse(readFileSync(join(REPO, "docker", "host-cli.json"), "utf8")) as Record<string, string | null>;
const dockerfile = readFileSync(join(REPO, "docker", "trial.Dockerfile"), "utf8");
const sdk = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).dependencies["@anthropic-ai/claude-agent-sdk"] as string;
const bundled = JSON.parse(readFileSync(join(REPO, "node_modules", "@anthropic-ai", "claude-agent-sdk", "package.json"), "utf8")) as { version: string; claudeCodeVersion: string };

// Value: protects=the Claude Code in the trial image is the one the evaluator's Agent SDK speaks to: host-cli.json, the Dockerfile's checked tarball and the SDK's bundled CLI name one version; fails_when=one is bumped without the others, so the image runs a CLI the SDK was not built for; why_new=U10 bakes the host CLI into the trial image; seam=docker/host-cli.json, docker/trial.Dockerfile, package.json; no_claim=the image builds, which the Docker tier covers
test("host-cli.json, the Dockerfile and the Agent SDK name one Claude Code version", () => {
  const version = pins.claude!;
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(sdk).toMatch(/^\d+\.\d+\.\d+$/);
  expect(bundled).toMatchObject({ version: sdk, claudeCodeVersion: version });
  expect(dockerfile).toMatch(new RegExp("ADD --checksum=sha256:[0-9a-f]{64} https://registry\\.npmjs\\.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-" + version.replaceAll(".", "\\.") + "\\.tgz "));
  if (HAS_CLAUDE_CLI) expect(spawnSync(CLAUDE_CLI, ["--version"], { encoding: "utf8" }).stdout.trim()).toBe(version + " (Claude Code)");
});
