// Value: protects=the closed review-models eval refuses every step that could pay, write over the pilot's evidence, run,
// resume or validate a batch, or issue a judge or visibility qualification, before it reads, writes or spends anything, and
// keeps the pilot readout readable; fails_when=an rm-post, rm-supply, rm-run or review-units --cell-items step gets past its
// entry point, writes a file, opens a lease or calls the network; why_new=the Captain's containment ruling after #466's
// final review (GEVA-590); seam=requireLive at each CLI entry point; no_claim=library functions called directly from code
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contaminationInputs, main as rmPost } from "../../../lanes/review-models/post/cli.ts";
import { loadPilot } from "../../../lanes/review-models/post/pilot.ts";
import { main as reviewUnits } from "../../../src/trial/review/cli.ts";
import { readContamination, writeContamination } from "../../../src/trial/review/contamination.ts";
import { main as rmRun, pilotArgv } from "../../../src/trial/review/rm-run.ts";
import { main as rmSupply } from "../../../src/trial/review/supply/cli.ts";
import { ITEMS, plant } from "../post/fixture.ts";

const tree = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[p] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
};

const realFetch = globalThis.fetch;
const realError = console.error;
let calls = 0;
let errors: string[] = [];
const quiet = () => {
  calls = 0;
  errors = [];
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network refused in this test");
  }) as unknown as typeof fetch;
  console.error = (...a: unknown[]) => void errors.push(a.join(" "));
};
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

describe("the closed review-models eval", () => {
  test("rm-post contamination and the validation readout refuse and leave the pilot's evidence as it was", async () => {
    const s = plant();
    const p0 = loadPilot(s.run, s.key, s.post);
    writeContamination(join(s.post, "contamination"), readContamination(contaminationInputs(p0), p0.markers, []), p0.markers);
    const before = tree(s.dir);
    const args = ["--run", s.run, "--key", s.keyPath, "--post", s.post];
    quiet();
    expect(await rmPost(["contamination", ...args])).toBe(2);
    expect(await rmPost(["contamination", ...args, "--batch", "validation"])).toBe(2);
    expect(await rmPost(["readout", ...args, "--validation-run", s.run, "--history", s.history, "--md", join(s.dir, "v.md")])).toBe(2);
    expect(errors.filter((e) => e.startsWith("E_RM_CLOSED rm-post "))).toHaveLength(3);
    expect(tree(s.dir)).toEqual(before);
    errors = [];
    await rmPost(["readout", ...args, "--history", s.history, "--md", join(s.dir, "pilot.md")]);
    expect(errors.join("\n")).not.toContain("E_RM_CLOSED");
  }, 120_000);

  test("rm-post's paid steps refuse before any lease or call", async () => {
    const s = plant();
    const before = tree(s.dir);
    const args = ["--run", s.run, "--key", s.keyPath, "--post", s.post, "--run-id", "x"];
    quiet();
    for (const [sub, item] of [["judge-send", ITEMS.judge], ["second-read-send", ITEMS.second], ["label-send", ITEMS.labels]] as const)
      for (const batch of ["pilot", "validation"]) expect(await rmPost([sub, ...args, "--item", item, "--batch", batch])).toBe(2);
    expect(errors.filter((e) => e.startsWith("E_RM_CLOSED rm-post "))).toHaveLength(6);
    expect(calls).toBe(0);
    expect(tree(s.dir)).toEqual(before);
  }, 120_000);

  test("rm-supply's visibility steps refuse before writing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rm-closed-"));
    quiet();
    for (const sub of ["vis-requests", "vis-send", "vis-read"]) expect(await rmSupply([sub, "--out", join(dir, sub + ".json")])).toBe(2);
    expect(errors.filter((e) => e.startsWith("E_RM_CLOSED rm-supply vis-"))).toHaveLength(3);
    expect(calls).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("rm-run refuses its pilot plan, pilot and e2e steps but not the pilot's dry run, and review-units refuses --cell-items unless it is a dry run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rm-closed-"));
    const err: string[] = [];
    const io = { out: () => {}, err: (l: string) => void err.push(l) };
    const env = { PATH: process.env.PATH ?? "", HOME: dir, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "" };
    const o = { plan: join(dir, "plan"), unitRepos: join(dir, "units"), out: join(dir, "out"), record: join(dir, "record"), upstream: "http://127.0.0.1:9", ledger: join(dir, "ledger.jsonl"), date: null };
    mkdirSync(o.plan);
    writeFileSync(join(o.plan, "pilot-units.txt"), "acme/app#1\nacme/app#2\n");
    quiet();
    expect(await rmRun(["pilot-plan", "--unit-repos", o.unitRepos, "--out", o.plan], io, env)).toBe(2);
    expect(await rmRun(["pilot", "--plan", o.plan, "--unit-repos", o.unitRepos, "--ledger-record", o.record, "--out", o.out], io, env)).toBe(2);
    expect(await rmRun(["pilot", "--plan", o.plan, "--unit-repos", o.unitRepos, "--ledger-record", o.record, "--out", o.out, "--resume"], io, env)).toBe(2);
    expect(await rmRun(["e2e", "--out", o.out], io, env)).toBe(2);
    expect(err.filter((l) => l.startsWith("E_RM_CLOSED rm-run "))).toHaveLength(4);
    err.length = 0;
    for (const resume of [[], ["--resume"]]) expect(await reviewUnits([...pilotArgv({ ...o, dryRun: false }), ...resume], io, env)).toBe(2);
    expect(err.filter((l) => l.startsWith("E_RM_CLOSED review-units --cell-items"))).toHaveLength(2);
    err.length = 0;
    await reviewUnits(pilotArgv({ ...o, dryRun: true }), io, env);
    expect(err.join("\n")).not.toContain("E_RM_CLOSED");
    expect(calls).toBe(0);
    expect(readdirSync(dir)).toEqual(["plan"]);
    expect(readdirSync(o.plan)).toEqual(["pilot-units.txt"]);
  });
});
