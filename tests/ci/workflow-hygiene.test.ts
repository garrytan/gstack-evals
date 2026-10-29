import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../scripts/gate.ts";

// Workflow hygiene (U19), also run by the gate as its junit case: every workflow is pinned, read-only except the train gate's
// publish job and free of secrets, installs Bun only by the checksummed download and fetches gstack at one commit, and ci.yml
// runs the gate's command cases, so the free run and the train gate check the same things. The sealed case is left out of
// ci.yml because sealed.yml runs it on every pull request and every push to main.
type Step = { uses?: string; run?: string; env?: Record<string, string> };
type Job = { permissions?: unknown; steps: Step[] };
type Workflow = { permissions?: unknown; jobs: Record<string, Job> };
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
const WRITERS: Record<string, unknown> = { "train-gate.yml/publish": { contents: "read", checks: "write" } };

describe("workflow hygiene", () => {
  test("reads the workflows the gate relies on", () => {
    expect(files).toEqual(expect.arrayContaining(["ci.yml", "sealed.yml", "train-gate.yml"]));
  });

  test("pins every action to a full commit sha", () => {
    const uses = files.flatMap((f) => steps(f).flatMap((s) => (s.uses ? [f + ": " + s.uses] : [])));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });

  test("keeps every token read-only except the train gate's publish job", () => {
    for (const f of files) {
      expect([f, workflows[f]!.permissions]).toEqual([f, READ]);
      for (const [name, job] of jobs(f)) expect([f + "/" + name, job.permissions ?? READ]).toEqual([f + "/" + name, WRITERS[f + "/" + name] ?? READ]);
    }
    for (const key of Object.keys(WRITERS)) expect(workflows[key.split("/")[0]!]?.jobs[key.split("/")[1]!]).toBeDefined();
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
    expect(pins.some((p) => p.startsWith("train-gate.yml "))).toBe(true);
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
