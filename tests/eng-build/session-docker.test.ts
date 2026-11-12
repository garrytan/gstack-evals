// Copyright (c) 2026 Garry Tan. MIT License.
// The build stage's session image in Docker (GSTACK_EVALS_DOCKER=1), keyless: the runtime layer on a pinned fixture base
// image, Claude Code's start-up skill list in it under CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 against a stub upstream in
// this process, and, with EB_HARBOR naming a Harbor binary at its pin, the whole keyless build run (lanes/eng-build/e2e.ts).
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preflight } from "../../lanes/eng-build/build-stage.ts";
import { claudePin, removeSessionImages, sessionImage } from "../../lanes/eng-build/session-image.ts";
import { sse } from "../../quick/laneb/runner/fake_upstream.ts";
import { IMAGES } from "./fixture.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const HARBOR = process.env.EB_HARBOR ?? "";
const docker = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 600_000 });

describe.skipIf(!DOCKER)("build session image in Docker (GSTACK_EVALS_DOCKER=1)", () => {
  test("the runtime layer sits on the unit image, which keeps its id; claude is the review stage's pin; the clean room holds", () => {
    const ref = IMAGES["golang:1.23"]!;
    expect(docker(["pull", "-q", ref]).status).toBe(0);
    const base = docker(["image", "inspect", "-f", "{{.Id}}", ref]).stdout.trim();
    try {
      const img = sessionImage(base);
      expect(img.claude).toBe(claudePin().version);
      expect(docker(["image", "inspect", "-f", "{{.Id}}", ref]).stdout.trim()).toBe(base);
      const env = docker(["image", "inspect", "-f", "{{json .Config.Env}}", img.id]).stdout;
      expect(env).toContain("CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1");
      expect(docker(["run", "--rm", "--network", "none", "--entrypoint", "sh", img.id, "-c", "git config --system --get-all safe.directory; /opt/laneb/bin/node --version"]).stdout).toMatch(/^\/work\/repo\nv24\./);
      const tree = mkdtempSync(join(tmpdir(), "eb-tree-"));
      try {
        expect(() => preflight({ docker: "docker", image: img.tag, digest: img.id, mounts: [tree + ":/work/repo"] })).not.toThrow();
      } finally {
        rmSync(tree, { recursive: true, force: true });
      }
      expect(sessionImage(base).id).toBe(img.id);
    } finally {
      expect(removeSessionImages()).toBeGreaterThanOrEqual(1);
    }
  }, 1_800_000);

  test("with bundled skills off, Claude Code still lists doctor and plugin-authoring at start-up, and only plugin-authoring reaches the model", async () => {
    const ref = IMAGES["golang:1.23"]!;
    const base = docker(["image", "inspect", "-f", "{{.Id}}", ref]).stdout.trim();
    const bodies: string[] = [];
    const stub = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        if (req.method !== "POST") return Response.json({});
        const body = (await req.json()) as Record<string, any>;
        if (new URL(req.url).pathname.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
        bodies.push(JSON.stringify(body));
        return new Response(sse(body.model, [{ type: "text", text: "Done." }] as any), { headers: { "content-type": "text/event-stream" } });
      },
    });
    try {
      const img = sessionImage(base);
      const p = Bun.spawn(["docker", "run", "--rm", "--network", "host", "-e", "HOME=/root", "-e", "CLAUDE_CONFIG_DIR=/root/.claude", "-e", "ANTHROPIC_BASE_URL=http://127.0.0.1:" + stub.port, "-e", "ANTHROPIC_API_KEY=stub-not-a-key", "-e", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1", "-w", "/tmp", "--entrypoint", "claude", img.id, "-p", "hello", "--output-format", "stream-json", "--verbose", "--model", "claude-opus-5-5", "--setting-sources", "user,project", "--strict-mcp-config"], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
      const out = await new Response(p.stdout).text();
      await p.exited;
      const init = out.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.type === "system" && m.subtype === "init");
      expect(init.claude_code_version).toBe(claudePin().version);
      expect([...init.skills].sort()).toEqual(["doctor", "plugin-authoring"]);
      expect(init.plugins.map((x: { source: string }) => x.source)).toContain("cc-plugin-plugin-authoring@builtin");
      const listing = bodies[0]!.slice(bodies[0]!.indexOf("The following skills are available"));
      expect([...listing.slice(0, 4000).matchAll(/\\n- ([a-z][a-z0-9:-]*): /g)].map((m) => m[1])).toEqual(["plugin-authoring"]);
    } finally {
      stub.stop(true);
      removeSessionImages();
    }
  }, 1_800_000);


  // Value: protects=a src-layout Python builder importing its own edits at /work/repo; fails_when=the session's editable
  // install still resolves the package from the unit image's /testbed, or the unit image itself changes.
  test("an editable install on /testbed resolves to /work/repo in the session, and the unit image keeps /testbed", () => {
    const ctx = mkdtempSync(join(tmpdir(), "eb-py-"));
    const tree = mkdtempSync(join(tmpdir(), "eb-py-tree-"));
    const tag = "gstack-evals-eb-pytest:editable";
    try {
      const put = (root: string, p: string, s: string) => (mkdirSync(join(root, p, ".."), { recursive: true }), writeFileSync(join(root, p), s));
      put(ctx, "proj/pyproject.toml", '[build-system]\nrequires = ["setuptools>=64"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "ebpkg"\nversion = "0.1"\n\n[tool.setuptools.packages.find]\nwhere = ["src"]\n');
      put(ctx, "proj/src/ebpkg/__init__.py", 'VALUE = "base"\n');
      put(ctx, "Dockerfile", "FROM " + IMAGES["python:3.12"] + "\nCOPY proj /testbed\nRUN pip install -q -e /testbed\n");
      expect(docker(["build", "-q", "--label", "gstack-evals.eb=pytest", "-t", tag, ctx]).status).toBe(0);
      const base = docker(["image", "inspect", "-f", "{{.Id}}", tag]).stdout.trim();
      const img = sessionImage(base);
      put(tree, "src/ebpkg/__init__.py", 'VALUE = "tree"\n');
      const probe = ["python", "-c", "import ebpkg; print(ebpkg.__file__, ebpkg.VALUE)"];
      expect(docker(["run", "--rm", "--network", "none", "-e", "PYTHONDONTWRITEBYTECODE=1", "-v", tree + ":/work/repo", "--entrypoint", probe[0]!, img.id, ...probe.slice(1)]).stdout.trim()).toBe("/work/repo/src/ebpkg/__init__.py tree");
      expect(docker(["run", "--rm", "--network", "none", "--entrypoint", probe[0]!, base, ...probe.slice(1)]).stdout.trim()).toBe("/testbed/src/ebpkg/__init__.py base");
      expect(docker(["image", "inspect", "-f", "{{.Id}}", tag]).stdout.trim()).toBe(base);
    } finally {
      removeSessionImages();
      docker(["rmi", "-f", tag]);
      rmSync(ctx, { recursive: true, force: true });
      rmSync(tree, { recursive: true, force: true });
    }
  }, 1_800_000);

  test.skipIf(!HARBOR)("the keyless build run passes every check (EB_HARBOR)", () => {
    const keys = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !keys.test(k))) as Record<string, string>;
    const r = spawnSync("bun", [join(import.meta.dir, "../../lanes/eng-build/e2e.ts"), "--harbor", HARBOR], { encoding: "utf8", env, timeout: 3_000_000, maxBuffer: 64 * 1024 * 1024 });
    const checks = r.stdout.split("\n").filter((l) => /^(PASS|FAIL) /.test(l));
    expect(checks.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(8);
    expect(r.status).toBe(0);
  }, 3_600_000);
});
