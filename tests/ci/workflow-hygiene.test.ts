import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../scripts/gate.ts";

// Workflow hygiene (U19), also run by the gate as its junit case: every workflow is pinned, read-only in every job and free of
// secrets, installs Bun only by the checksummed download and fetches gstack at one commit, and ci.yml runs the gate's command
// cases, so CI and `bun run gate` check the same things. The sealed case is left out of ci.yml because sealed.yml runs it on
// every pull request and every push to main. No job may write: train-gate.yml, whose publish job posted a check, is removed
// until a train dispatches the base's workflow instead of the head's (GST-254).
type Step = { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Job = { permissions?: unknown; steps: Step[] };
type Workflow = { on?: unknown; permissions?: unknown; jobs: Record<string, Job> };
const root = join(import.meta.dir, "..", "..");
const dir = join(root, ".github", "workflows");
const files = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();
const text = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), "utf8")]));
const workflows = Object.fromEntries(files.map((f) => [f, Bun.YAML.parse(text[f]!) as Workflow]));
const jobs = (f: string) => Object.entries(workflows[f]!.jobs);
const steps = (f: string) => jobs(f).flatMap(([, j]) => j.steps ?? []);
const READ = { contents: "read" };

describe("workflow hygiene", () => {
  test("reads the workflows the gate relies on", () => {
    expect(files).toEqual(expect.arrayContaining(["ci.yml", "sealed.yml"]));
  });

  test("pins every action to a full commit sha", () => {
    const uses = files.flatMap((f) => steps(f).flatMap((s) => (s.uses ? [f + ": " + s.uses] : [])));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });

  test("keeps every token read-only", () => {
    for (const f of files) {
      expect([f, workflows[f]!.permissions]).toEqual([f, READ]);
      for (const [name, job] of jobs(f)) expect([f + "/" + name, job.permissions ?? READ]).toEqual([f + "/" + name, READ]);
    }
  });

  test("keeps no credentials in any checkout and uses no cache or workflow_run", () => {
    for (const f of files) {
      for (const s of steps(f).filter((s) => s.uses?.startsWith("actions/checkout@"))) expect([f, s.with?.["persist-credentials"]]).toEqual([f, false]);
      expect([f, /actions\/cache@|\bcache:|workflow_run/.test(text[f]!)]).toEqual([f, false]);
    }
  });

  test("runs pull_request_target and allow-unsafe-pr-checkout only in sealed.yml", () => {
    for (const f of files.filter((f) => f !== "sealed.yml")) {
      const on = workflows[f]!.on;
      const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
      expect([f, triggers.includes("pull_request_target"), steps(f).some((s) => s.with?.["allow-unsafe-pr-checkout"] !== undefined)]).toEqual([f, false, false]);
    }
  });

  test("runs no merge train while a dispatch runs the head's workflow (GST-254)", () => {
    const policy = JSON.parse(readFileSync(join(root, ".gstack", "ship-policy.json"), "utf8")) as Record<string, unknown>;
    expect(policy.train).toBeUndefined();
  });

  test("names no secret", () => {
    for (const f of files) expect([f, /secrets\./.test(text[f]!)]).toEqual([f, false]);
  });

  test("installs Bun only by the checksummed download, at one version and digest", () => {
    const pins = new Set<string>();
    for (const f of files) {
      expect([f, text[f]!.includes("setup-bun")]).toEqual([f, false]);
      for (const [name, job] of jobs(f)) {
        const install = job.steps.findIndex((s) => s.env?.BUN_SHA256);
        const firstBun = job.steps.findIndex((s) => /(^|\s)bun\s/m.test(s.run ?? ""));
        if (firstBun >= 0) expect([f + "/" + name, install >= 0 && install < firstBun]).toEqual([f + "/" + name, true]);
      }
      for (const s of steps(f).filter((s) => s.env?.BUN_SHA256)) {
        pins.add(s.env!.BUN_VERSION + " " + s.env!.BUN_SHA256);
        expect(s.run).toContain('"https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64.zip"');
        expect(s.run).toContain('printf \'%s  %s\\n\' "$BUN_SHA256" "$RUNNER_TEMP/bun.zip" | sha256sum -c --strict -');
        expect(s.run!.indexOf("sha256sum")).toBeLessThan(s.run!.indexOf("unzip"));
      }
    }
    expect([...pins]).toHaveLength(1);
    expect([...pins][0]).toMatch(/^\d+\.\d+\.\d+ [0-9a-f]{64}$/);
  });

  test("fetches gstack at one pinned commit", () => {
    const pins = files.flatMap((f) => steps(f).flatMap((s) => (s.env?.GSTACK_SHA ? [f + " " + s.env.GSTACK_SHA] : [])));
    expect(pins.some((p) => p.startsWith("sealed.yml "))).toBe(true);
    expect(pins.some((p) => p.startsWith("ci.yml "))).toBe(true);
    const shas = new Set(pins.map((p) => p.split(" ")[1]));
    expect(shas.size).toBe(1);
    expect([...shas][0]).toMatch(/^[0-9a-f]{40}$/);
  });

  test("runs the gate's command cases in ci.yml", () => {
    const m = parseManifest(readFileSync(join(root, "gate", "manifest.json"), "utf8"));
    if ("error" in m) throw new Error(m.error);
    const runs = steps("ci.yml").map((s) => (s.run ?? "").trim());
    const cases = m.stages.m0!.filter((c) => c.kind === "command" && c.id !== "sealed");
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) expect([c.id, runs.some((r) => r.startsWith(c.run))]).toEqual([c.id, true]);
  });
});
