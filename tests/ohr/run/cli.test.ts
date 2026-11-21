// Value: protects=the run command's refusals before anything is built or spent: the upstream override, briefs and out dirs inside the repo, a model the launch does not run, caps past the launch's frozen ledger line, and a launch with no fresh receipts sink.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRun } from "../../../lanes/office-hours-rewrite/run/cli.ts";
import { LEDGER_LINES } from "../../../lanes/office-hours-rewrite/run/manifest.ts";

const briefs = mkdtempSync(join(tmpdir(), "ohr-cli-briefs-"));
const out = () => join(mkdtempSync(join(tmpdir(), "ohr-cli-")), "out");
const env = () => ({ GSTACK_EVALS_EPHEMERAL: "1", GSTACK_EVALS_RECEIPTS: join(mkdtempSync(join(tmpdir(), "ohr-cli-sink-")), "sink") });
const argv = (o: Record<string, string> = {}, extra: string[] = []) => Object.entries({ "--launch": "stage1", "--briefs-dir": briefs, "--out": out(), "--item": "a", "--spend-cap": "150", "--sim-item": "s", "--sim-spend-cap": "30", ...o }).flat().concat(extra);
const why = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  return "";
};

test("a launch inside every limit plans", () => {
  const p = planRun(argv(), env());
  expect(p.input.models).toEqual(["opus", "sol", "particle"]);
  expect(p.input.cap + p.input.simCap).toBe(180_000_000);
});
test("--upstream is refused", () => expect(why(() => planRun(argv({ "--upstream": "http://x" }), env()))).toContain("--upstream"));
test("an out dir inside the repo is refused", () => expect(why(() => planRun(argv({ "--out": join(import.meta.dir, "out") }), env()))).toContain("inside the repo"));
test("a briefs dir inside the repo is refused", () => expect(why(() => planRun(argv({ "--briefs-dir": import.meta.dir }), env()))).toContain("inside the repo"));
test("a model the launch does not run is refused", () => expect(why(() => planRun(argv({ "--launch": "stage2" }, ["--models", "particle"]), env()))).toContain("particle is not a model"));
test("caps one micro-dollar past the launch's frozen line are refused", () => {
  expect(why(() => planRun(argv({ "--spend-cap": String(LEDGER_LINES.stage1.cap - 30), "--sim-spend-cap": "30" }), env()))).toBe("");
  expect(why(() => planRun(argv({ "--spend-cap": String(LEDGER_LINES.stage1.cap - 30), "--sim-spend-cap": "30.000001" }), env()))).toStartWith("E_OHR_CAP_LINE");
});
test("a launch with no receipts sink is refused", () => expect(why(() => planRun(argv(), {}))).toContain("GSTACK_EVALS_EPHEMERAL=1"));

// Pre-run change 3 (rule R113): stage 2 runs its preregistered half first, and its second part runs only what the
// interim read allows.
const s2 = (o: Record<string, string> = {}, extra: string[] = []) => argv({ "--launch": "stage2", "--spend-cap": "1000", "--sim-spend-cap": "50", ...o }, extra);
const lookFile = (action: string) => {
  const p = join(mkdtempSync(join(tmpdir(), "ohr-cli-look-")), "interim.json");
  const half = { first: { founder: ["f1"], builder: ["b1"], clusters: 1 }, second: { founder: ["f2"], builder: ["b2"], clusters: 1 } };
  writeFileSync(p, JSON.stringify({ schema: 1, part1_manifest_sha256: "0".repeat(64), half, read: { C: 16, C2: 16, estimate: 0, sd: 0, z: 0, bound: 3.27, final_bound: 2.06, cp: 1, action } }, null, 2) + "\n");
  return { p, half, sha: createHash("sha256").update(readFileSync(p)).digest("hex") };
};
test("stage 2 without --part is refused: it runs its preregistered half first", () => expect(why(() => planRun(s2(), env()))).toContain("--part"));
test("--part first plans the half", () => expect(planRun(s2({ "--part": "first" }), env()).input.look).toEqual({ part: "first" }));
test("--part first refuses an interim read", () => expect(why(() => planRun(s2({ "--part": "first", "--interim": lookFile("continue").p }), env()))).toContain("--interim"));
test("--part second needs the interim read", () => expect(why(() => planRun(s2({ "--part": "second" }), env()))).toContain("--interim"));
test("--part second after a read that continued or stopped for the new skill plans the second part on that read", () => {
  for (const action of ["continue", "stop-new"] as const) {
    const f = lookFile(action);
    expect(planRun(s2({ "--part": "second", "--interim": f.p }), env()).input.look).toEqual({ part: "second", half: f.half, action, interim_sha256: f.sha });
  }
});
test("--part second after a read that stopped the other way or for futility is refused: stage 2 ends at its half", () => {
  for (const action of ["stop-current", "stop-futility"]) expect(why(() => planRun(s2({ "--part": "second", "--interim": lookFile(action).p }), env()))).toContain("ends at its half");
});
test("--part on any launch but stage 2 is refused", () => {
  expect(why(() => planRun(argv({ "--part": "first" }), env()))).toContain("--part");
  expect(why(() => planRun(argv({ "--launch": "stage2-particle", "--spend-cap": "90", "--sim-spend-cap": "30", "--part": "first" }), env()))).toContain("--part");
});
