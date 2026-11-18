// Value: protects=the run command's refusals before anything is built or spent: the upstream override, briefs and out dirs inside the repo, a model the launch does not run, caps past the launch's frozen ledger line, and a launch with no fresh receipts sink.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
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
