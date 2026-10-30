import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeRecord, FakeHostError, loadScript, sampleMatch } from "../../src/adapters/_fake/host.ts";
import { REPO_ROOT } from "../../src/cli.ts";
import { finishCalibration } from "../../src/skill-eval/cli/run.ts";
import { skillEvalCommand } from "../../src/skill-eval/cli/skill-eval.ts";
import { approvalRecord, collect, git, learnRepo, TMP } from "./helpers.ts";

// Each run's preflight runs the vacuity check on learn's ten tasks, which runs gstack's seed script per task.
setDefaultTimeout(60_000);

const task = (must: string[]) => ({ id: "t", safety: false, interactive: false, judge: false, must, must_not: [], check: false });

describe("the fake host's records", () => {
  // Value: protects=the fake host writes passing answers for the patterns gstack's task files use; fails_when=a learn pattern stops sampling or a sample stops matching; why_new=new; seam=sampleMatch; no_claim=arbitrary regular expressions, which the script's answers cover
  test("it samples a matching string for learn's patterns and refuses constructs it does not handle", () => {
    const learn = JSON.parse(readFileSync(join(REPO_ROOT, "tests/contract/fixtures/gstack/learn/tasks.json"), "utf8")) as { must?: string[] }[];
    for (const pattern of learn.flatMap((t) => t.must ?? [])) {
      const sample = sampleMatch(pattern);
      expect([pattern, sample !== null && new RegExp(pattern, "i").test(sample)]).toEqual([pattern, true]);
    }
    expect(sampleMatch("colou?r [0-9]{2}x+ (?:a|b)")).toBe("color 00x a");
    expect(sampleMatch("(?=lookahead)")).toBeNull();
    expect(sampleMatch("\\p{L}")).toBeNull();
  });

  // Value: protects=a record carries only the outcome U6 grades it with, and a pattern the sampler cannot meet stops the run unless the script gives the answer; fails_when=the fake host reports a pass U6 would grade fail, or cannot fail a task that only forbids things; why_new=new; seam=U6's gradeTrial; no_claim=none beyond protects
  test("every record grades as the script asked, or the run stops, prohibition-only tasks included", () => {
    const cell = (must: string[]) => ({ model: "m", arm: "after", task: task(must), round: 1 as const, trial: 0 });
    expect(fakeRecord(cell(["\\bdone\\b"]), { arms: { after: "1" } }).turns).toEqual(["Done. ;  done "]);
    expect(() => fakeRecord(cell(["(?=x)y"]), { arms: { after: "1" } })).toThrow(FakeHostError);
    expect(fakeRecord(cell(["(?=x)xy"]), { arms: { after: "1" }, answers: { t: "xy" } }).turns).toEqual(["xy"]);
    expect(fakeRecord(cell(["a"]), { arms: { after: "0" } })).toMatchObject({ turns: [], check: null });
    expect(fakeRecord(cell(["a"]), { arms: { after: "t" } }).termination).toEqual({ kind: "timeout" });
    expect(() => fakeRecord(cell(["a"]), { arms: { after: "y" } })).toThrow("must use only 1, 0 and t");
    const forbids = { ...task([]), safety: true, must_not: ["rm -rf"] };
    const failed = fakeRecord({ model: "m", arm: "none", task: forbids, round: 1, trial: 0 }, { arms: { none: "0" } });
    expect(failed.turns).toEqual(["Done.\n\n```\nrm -rf\n```\n"]);
    expect(fakeRecord({ model: "m", arm: "after", task: forbids, round: 1, trial: 0 }, { arms: { after: "1" } }).turns).toEqual(["Done."]);
    const lookahead = { ...forbids, must_not: ["(?=y)y"] };
    expect(() => fakeRecord({ model: "m", arm: "none", task: lookahead, round: 1, trial: 0 }, { arms: { none: "0" } })).toThrow("failing_answers");
    expect(fakeRecord({ model: "m", arm: "none", task: lookahead, round: 1, trial: 0 }, { arms: { none: "0" }, failing_answers: { t: "```\ny\n```" } }).turns).toEqual(["```\ny\n```"]);
  });

  // Value: protects=a safety task with a judge rubric and only must_not lines can fail under the fake host, since no judge grades a safety task; fails_when=the fake host throws or leaves the answer empty for that shape; why_new=Capy's review of #51; seam=fakeRecord's failing-answer branch; no_claim=judge grading
  test("a safety task with a judge rubric fails with its forbidden answer", () => {
    const judged = { ...task([]), safety: true, judge: true, must_not: ["rm -rf"] };
    expect(fakeRecord({ model: "m", arm: "none", task: judged, round: 1, trial: 0 }, { arms: { none: "0" } }).turns).toEqual(["Done.\n\n```\nrm -rf\n```\n"]);
  });

  // Value: protects=a script with a negative, infinite or non-numeric session_usd is refused before any record, so spend.committed is never negative; fails_when=such a script loads; why_new=PR #49 review; seam=loadScript; no_claim=none beyond protects
  test("a bad session_usd is refused when the script loads", () => {
    for (const bad of [-1, "1", 1e300]) {
      const path = join(TMP, "bad-usd-" + String(bad) + ".json");
      writeFileSync(path, JSON.stringify({ arms: {}, session_usd: bad }));
      expect(() => loadScript(path)).toThrow("session_usd must be a finite, non-negative number of dollars");
    }
    const ok = join(TMP, "ok-usd.json");
    writeFileSync(ok, JSON.stringify({ arms: {}, session_usd: 0.25 }));
    expect(loadScript(ok).session_usd).toBe(0.25);
  });
});

describe("a run on the fake host", () => {
  const KEYS = { ANTHROPIC_API_KEY: "fake-anthropic-value", OPENAI_API_KEY: "fake-openai-value" };
  async function setup() {
    const repo = learnRepo();
    const bin = join(REPO_ROOT, "bin", "gstack-evals");
    const tasks = "test/fixtures/skill-evals/learn/tasks.json";
    const lock = spawnSync(bin, ["skill-eval", "--lock", "--tasks", tasks], { cwd: repo.root, encoding: "utf8" });
    expect([lock.status, lock.stdout.includes("LOCKED ")]).toEqual([0, true]);
    expect(spawnSync("bash", ["-c", 'git add test/fixtures/skill-evals/learn/ && git commit -m "test: lock learn eval tasks"'], { cwd: repo.root, encoding: "utf8" }).status).toBe(0);
    const record = approvalRecord("learn-diet", 500);
    const call = (out: string, extra: string[] = []) => ["--arms", "before=" + repo.skill + ",after=" + repo.skill + ",none", "--tasks", join(repo.root, tasks), "--host", "claude", "--model", "claude-opus-5-5", "--trials", "3", "--spend-cap", "100", "--out", out, "--item", "learn-diet", "--ledger", join(TMP, "run-ledger.sqlite"), "--ledger-record", record, "--isolation", "process", ...extra];
    return { repo, bin, call };
  }

  // Value: protects=the done-means: diet.md's literal lock step and commit run on learn, and the contract call then runs on the fake host to a real verdict.json with U6's exit code; fails_when=any step of diet.md's call stops on learn; why_new=skill-eval had no run path; seam=GSTACK_EVALS_FAKE_HOST and bin/gstack-evals; no_claim=a real host, which U10 adds; --margin reaches U6, which refuses a margin at ceiling
  test("diet.md's literal call runs on learn with the fake host", async () => {
    const { repo, bin, call } = await setup();
    const out = join(TMP, "diet-run");
    const r = spawnSync(bin, ["skill-eval", ...call(out)], { cwd: repo.root, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: TMP, GSTACK_EVALS_FAKE_HOST: "1", ...KEYS } });
    expect([r.status, r.stderr]).toEqual([0, "NEGATIVE_UNVALIDATED no-code-change: a safety task with no mutant in tasks.ext.json, so nothing showed it fails on a violation\n"]);
    expect(r.stdout).toContain("VERDICT: PASS (exit 0) for claude-opus-5-5, 3 trials");
    const verdict = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"));
    expect(verdict).toMatchObject({ verdict: "PASS", exit_code: 0, harness: { host: "claude", host_version: "fake" }, effective: { isolation: "process", skill: "learn" }, spend: { line_item: "learn-diet", committed: 0, cap: 100_000_000 } });
    expect(verdict.lock.commit).toBe(git(repo.root, "rev-parse", "HEAD").trim());
    expect(verdict.lock_drift).toEqual([]);
    expect(Object.keys(verdict.arm_trees)).toEqual(["before", "before2", "after"]);
    const margin = collect();
    expect(await skillEvalCommand(call(join(TMP, "margin-run"), ["--margin", "10"]), margin, { GSTACK_EVALS_FAKE_HOST: "1", ...KEYS })).toBe(2);
    expect(JSON.parse(readFileSync(join(TMP, "margin-run", "verdict.json"), "utf8"))).toMatchObject({ reasons: ["MARGIN_NOT_ATTEMPTED the old copies passed every run (ceiling)"], effective: { margin: 10 } });
  });

  // Value: protects=a fake-host script drives the run, the rerun stage runs when round 1 goes red, and a cap stop keeps whole rounds; fails_when=a script is ignored, the rerun stage is skipped, or a round is split at the cap; why_new=new; seam=GSTACK_EVALS_FAKE_HOST=<script.json>; no_claim=none beyond protects
  test("a script makes after miss a task, and session costs stop the run at the cap", async () => {
    const { call } = await setup();
    const miss = join(TMP, "miss.json");
    writeFileSync(miss, JSON.stringify({ arms: { before: "1", after: "1", none: "0" }, tasks: { search: { after: "0" } } }));
    const io = collect();
    expect(await skillEvalCommand(call(join(TMP, "miss-run")), io, { GSTACK_EVALS_FAKE_HOST: miss, ...KEYS })).toBe(1);
    const verdict = JSON.parse(readFileSync(join(TMP, "miss-run", "verdict.json"), "utf8"));
    expect(verdict.reasons).toContain("MISS search");
    expect(verdict.models[0].rerun).toMatchObject({ red: ["search"], state: "done" });
    const costly = join(TMP, "costly.json");
    writeFileSync(costly, JSON.stringify({ arms: { before: "1", after: "1", none: "0" }, session_usd: 2 }));
    const cap = collect();
    expect(await skillEvalCommand(call(join(TMP, "cap-run")), cap, { GSTACK_EVALS_FAKE_HOST: costly, ...KEYS })).toBe(2);
    expect(cap.text().out).toContain("STOP: reason=budget_exhausted spent=$80.00 reserved=$0.00 unknown=0 cap=$100.00");
    const bad = collect();
    expect(await skillEvalCommand(call(join(TMP, "bad-run")), bad, { GSTACK_EVALS_FAKE_HOST: join(TMP, "no-such-script.json"), ...KEYS }, "preflight")).toBe(2);
    expect(bad.text().err).toContain("E_USAGE GSTACK_EVALS_FAKE_HOST is neither 1 nor a readable script file");
  });
  // Value: protects=--calibrate runs calibration and no trial: calibration.json holds each model's checks and the spend, no verdict.json is written, and --dry-run prices only the calibration sessions; a failed check exits 3 and names the model and check; fails_when=--calibrate runs trials, writes a verdict, prices the full matrix, or exits 0 on a failed check; why_new=--calibrate was U10's unbuilt flag; seam=skillEvalCommand on the fake host, finishCalibration, plan; no_claim=calibration on a real host, which tests/adapters/run-host.test.ts covers
  test("--calibrate writes calibration.json and no verdict, and --dry-run prices only calibration", async () => {
    const { call } = await setup();
    const out = join(TMP, "calibrate-run");
    const io = collect();
    expect(await skillEvalCommand(call(out, ["--calibrate"]), io, { GSTACK_EVALS_FAKE_HOST: "1", ...KEYS })).toBe(0);
    expect(io.text().out).toMatch(/CALIBRATION: pass for claude-opus-5-5  skill pass  none pass  shell pass  config n\/a  usersim (pass|n\/a)  egress pass/);
    const record = JSON.parse(readFileSync(join(out, "calibration.json"), "utf8"));
    expect(record).toMatchObject({ exit_code: 0, failures: [], spend: { committed: 0, unknown: 0, lease_id: null, cap: 100_000_000 } });
    expect(Object.keys(record.calibration)).toEqual(["claude-opus-5-5"]);
    expect(existsSync(join(out, "verdict.json"))).toBe(false);
    const dry = collect();
    expect(await skillEvalCommand(call(join(TMP, "calibrate-dry"), ["--calibrate", "--dry-run"]), dry, KEYS)).toBe(0);
    expect(dry.text().out).toContain("calibration only (--calibrate), no trial sessions");
    expect(dry.text().out).toContain("calibration claude-opus-5-5");
    expect(dry.text().out).not.toContain("rerun stage");
    const failed = collect();
    const calibration = { m: { skill: true, none: true, shell: true, config: null, usersim: null, egress: false } };
    const failure = { code: "CALIBRATION_EGRESS" as const, message: "an agent session on the trial network reached a non-model host", fix: "rerun with --calibrate" };
    const failedOut = join(TMP, "calibrate-failed");
    expect(finishCalibration({ input: { tasks: [], models: ["m"], arms: [], records: [], calibration, stops: [] }, spent: 0, stopped: false }, [failure], { committed: 0, unknown: 0, lease_id: null, cap: 1 }, failedOut, failed, false)).toBe(3);
    expect(failed.text().out).toContain("CALIBRATION: fail for m  skill pass  none pass  shell pass  config n/a  usersim n/a  egress fail");
    expect(JSON.parse(readFileSync(join(failedOut, "calibration.json"), "utf8")).failures).toEqual([failure]);
  });
});
