import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { openLease } from "../../src/runner/ledger/ledger.ts";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { lockCommand } from "../../src/skill-eval/lock/cli.ts";
import { skillEvalCommand } from "../../src/skill-eval/cli/skill-eval.ts";
import { DEFAULT_POLICY } from "../../src/skill-eval/cli/policy.ts";
import { buildTrialImage } from "../../src/trial/image.ts";
import { approvalRecord, collect, commitAll, git, learnRepo, TMP, tree } from "./helpers.ts";

// Each preflight runs the vacuity check on learn's ten tasks, which runs gstack's seed script per task.
setDefaultTimeout(60_000);

const KEYS = { ANTHROPIC_API_KEY: "fake-anthropic-value", OPENAI_API_KEY: "fake-openai-value", OPENROUTER_API_KEY: "fake-openrouter-value" };
const FAKE = { GSTACK_EVALS_FAKE_HOST: "1", ...KEYS };

async function run(argv: string[], env: Record<string, string> = FAKE, mode: "run" | "preflight" = "preflight") {
  const io = collect();
  const code = await skillEvalCommand(argv, io, env, mode);
  return { code, ...io.text() };
}

/** learn locked and committed under the given policy, and the call's flags for it. */
async function lockedLearn(policy = DEFAULT_POLICY) {
  const repo = learnRepo();
  const policyArgs = policy === DEFAULT_POLICY ? [] : ["--policy", policy];
  expect(await lockCommand(["--tasks", repo.tasks, ...policyArgs], collect())).toBe(0);
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-q", "-m", "lock");
  const record = approvalRecord("learn-fake", 500);
  const args = (host: string, model: string, extra: string[] = []) => ["--arms", "before=" + repo.skill + ",after=" + repo.skill + ",none", "--tasks", repo.tasks, "--host", host, "--model", model, "--spend-cap", "300", "--item", "learn-fake", "--ledger", join(TMP, "ledger.sqlite"), "--ledger-record", record, "--out", join(TMP, "out"), "--isolation", "process", ...policyArgs, ...extra];
  return { repo, record, args };
}

describe("preflight on gstack's learn tasks", () => {
  // Value: protects=the brief's done-means: /learn passes preflight on fake Claude and Codex hosts, every step included (keys, policy, ledger, lock, vacuity); fails_when=any step refuses learn's committed tasks or the fake host; why_new=preflight is new; seam=the fake host (GSTACK_EVALS_FAKE_HOST); no_claim=a real host's adapter
  test("/learn passes preflight on fake Claude and Codex hosts", async () => {
    const { args } = await lockedLearn();
    for (const [host, model] of [["claude", "claude-opus-5-5"], ["codex", "gpt-6.1-sol"]]) {
      const r = await run(args(host!, model!));
      expect([host, r.code, r.err]).toEqual([host, 0, "NEGATIVE_UNVALIDATED no-code-change: a safety task with no mutant in tasks.ext.json, so nothing showed it fails on a violation"]);
      expect(r.out).toContain("ok contract: 10 tasks (1 safety, 0 interactive)");
      expect(r.out).toContain("ok vacuity: 9 tasks bite on their control");
      expect(r.out).toMatch(/ok lock: .*tasks\.lock\.json committed at [0-9a-f]{12}/);
      expect(r.out).toContain("ok ledger: line item learn-fake approved at $500.00");
      expect(r.out).toContain("PREFLIGHT: pass");
    }
  });

  // Value: protects=Garry's 2026-10-29 rulings under the default policy: Sonnet 5.5 passes as a subject and as a cross-family judge, and particle-1 and DeepSeek V4.1 Flash pass on codex now the proxy routes OpenRouter (GST-227); fails_when=the default refuses any of them; why_new=GST-225, the last Sonnet ruling and the proxy's OpenRouter route; seam=policy/models.json and routable(); no_claim=a real OpenRouter session
  test("Sonnet 5.5 passes as a subject and as a judge; particle-1 and DeepSeek V4.1 Flash pass under the default policy", async () => {
    const { args } = await lockedLearn();
    expect((await run(args("claude", "claude-sonnet-5-5"))).code).toBe(0);
    expect((await run(args("codex", "gpt-6.1-sol", ["--judge-model", "claude-sonnet-5-5"]))).code).toBe(0);
    for (const model of ["particle-ai/particle-1", "deepseek/deepseek-v4.1-flash-1017"]) {
      const r = await run(args("codex", model));
      expect([model, r.code, r.out]).toEqual([model, 0, expect.stringContaining("ok keys: OPENROUTER_API_KEY set")]);
    }
    const same = await run(args("claude", "claude-opus-5-5", ["--judge-model", "claude-opus-5-5"]));
    expect(same.err).toContain("judges come from another model family");
  });

  // Value: protects=--policy lets a caller narrow or widen the subject list through the same preflight; fails_when=a narrowing policy still admits Haiku or a widening one cannot admit gpt-5.5; why_new=GST-225's custom-policy test; seam=the lock pins the policy, so each policy locks its own set; no_claim=none beyond protects
  test("a caller's own policy narrows or widens the subject list in preflight", async () => {
    const def = JSON.parse(readFileSync(DEFAULT_POLICY, "utf8"));
    const write = (name: string, models: Record<string, unknown>) => {
      const path = join(TMP, name + "-policy.json");
      writeFileSync(path, JSON.stringify({ ...def, name, models }));
      return path;
    };
    const narrow = write("narrow", Object.fromEntries(Object.entries(def.models).filter(([id]) => !id.includes("haiku"))));
    const n = await lockedLearn(narrow);
    expect((await run(n.args("claude", "claude-haiku-5-5"))).err).toContain("E_MODEL_POLICY claude-haiku-5-5 as a model under test: not in the policy narrow");
    expect((await run(n.args("claude", "claude-opus-5-5"))).code).toBe(0);
    const wide = write("wide", { ...def.models, "gpt-5.5": { provider: "openai", roles: ["subject"] } });
    const w = await lockedLearn(wide);
    const gpt55 = w.args("codex", "gpt-5.5").map((a, i, all) => (all[i - 1] === "--spend-cap" ? "400" : a));
    expect((await run(gpt55)).code).toBe(0);
    expect((await run(gpt55.filter((a, i, all) => a !== "--policy" && all[i - 1] !== "--policy"))).err).toContain("LOCK_DRIFT policy changed");
  });
});

describe("preflight's lock step", () => {
  // Value: protects=LOCK_MISSING prints the exact --lock command and git steps, and running them makes preflight pass; fails_when=the printed command or git line is wrong or incomplete; why_new=interface v0.4's LOCK_MISSING text; seam=bin/gstack-evals; no_claim=none beyond protects
  test("LOCK_MISSING prints the --lock command and the git steps, and running them clears it", async () => {
    const repo = learnRepo();
    const record = approvalRecord("learn-fake", 500);
    const args = ["--arms", "before=" + repo.skill + ",after=" + repo.skill + ",none", "--tasks", repo.tasks, "--host", "claude", "--model", "claude-opus-5-5", "--spend-cap", "300", "--item", "learn-fake", "--ledger", join(TMP, "l.sqlite"), "--ledger-record", record, "--out", join(TMP, "o"), "--isolation", "process"];
    const missing = await run(args);
    expect(missing.code).toBe(2);
    const lines = missing.err.split("\n").filter((l) => l.startsWith("LOCK_MISSING "));
    const command = lines.find((l) => l.startsWith("LOCK_MISSING run: "))!.slice("LOCK_MISSING run: ".length);
    const gitStep = lines.find((l) => l.startsWith("LOCK_MISSING then: "))!.slice("LOCK_MISSING then: ".length);
    expect(command).toBe("gstack-evals skill-eval --lock --tasks " + repo.tasks);
    expect(gitStep).toBe("git -C " + join(repo.root, "test/fixtures/skill-evals/learn") + " add tasks.lock.json tasks.json && git -C " + join(repo.root, "test/fixtures/skill-evals/learn") + " commit -m 'Lock the learn eval tasks'");
    const bin = join(REPO_ROOT, "bin", "gstack-evals");
    expect(spawnSync("bash", ["-c", command.replace(/^gstack-evals/, bin) + " && " + gitStep], { encoding: "utf8" }).status).toBe(0);
    expect((await run(args)).code).toBe(0);
  });

  // Value: protects=under the default --isolation docker, preflight runs no task control on this machine: with no daemon it stops E_ISOLATION_UNSAFE, and with no pinned trial image E_IMAGE_STALE; fails_when=a setup, mutant or check runs on the host without --isolation process; why_new=PR #45 review, then U9's container runner (U7 handoff); seam=containerRunner, PreflightOptions.runner; no_claim=the controls in containers, which the Docker tier covers
  test("under --isolation docker, preflight runs no task control without a daemon or a pinned trial image", async () => {
    const { args } = await lockedLearn();
    const docker = (body: string) => {
      const bin = join(tree({ docker: "#!/bin/sh\n" + body + "\n" }), "docker");
      spawnSync("chmod", ["+x", bin]);
      return bin;
    };
    const argv = args("claude", "claude-opus-5-5").filter((a, i, all) => a !== "--isolation" && all[i - 1] !== "--isolation");
    const none = await run(argv, { ...FAKE, GSTACK_EVALS_DOCKER_BIN: docker("exit 1") });
    expect(none.code).toBe(2);
    expect(none.err).toContain("E_ISOLATION_UNSAFE no Docker daemon answered");
    expect(none.err).toContain("E_ISOLATION_UNSAFE fix: Start Docker, or pass --isolation process on purpose");
    expect(none.out).not.toContain("ok vacuity");
    expect(none.out).toContain("ok lock: ");
    const unpinned = await run(argv, { ...FAKE, GSTACK_EVALS_DOCKER_BIN: docker('[ "$1" = version ] && exit 0; exit 1'), XDG_STATE_HOME: join(TMP, "no-pins") });
    expect(unpinned.code).toBe(2);
    expect(unpinned.err).toContain("E_IMAGE_STALE no trial image is pinned for recipe");
    expect(unpinned.err).toContain("E_IMAGE_STALE fix: Run gstack-evals doctor");
    expect(unpinned.out).not.toContain("ok vacuity");
  });

  test.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("Docker tier: with a pinned trial image, preflight runs every control in containers", async () => {
    const built = buildTrialImage({ state: join(TMP, "pinned-xdg", "gstack-evals") });
    if (!built.ok) throw new Error(built.message);
    const { args } = await lockedLearn();
    const r = await run(args("claude", "claude-opus-5-5").filter((a, i, all) => a !== "--isolation" && all[i - 1] !== "--isolation"), { ...FAKE, XDG_STATE_HOME: join(TMP, "pinned-xdg") });
    expect(r.err.trim()).toBe("NEGATIVE_UNVALIDATED no-code-change: a safety task with no mutant in tasks.ext.json, so nothing showed it fails on a violation");
    expect(r.out).toContain("ok vacuity: 9 tasks bite on their control, 1 safety tasks without a mutant (controls ran in containers)");
    expect(r.code).toBe(0);
  }, 900_000);

  // Value: protects=--resume passes preflight's ledger step for the run its line item is bound to, and only that run: a fresh call or a resume of another run is still E_ITEM_BOUND; fails_when=the documented --resume call is refused by its own binding, or a bound item funds a second run; why_new=Capy's review of #68; seam=preflight's ledger step with call.resume; no_claim=lease recovery and settlement, which runOnRealHost and recoverRun cover
  test("--resume of the run a line item is bound to passes the ledger step", async () => {
    const { record, args } = await lockedLearn();
    openLease(record, null, { item: "learn-fake", run_id: "run-a", amount_micros: 1_000_000 });
    const runDir = (id: string) => {
      const d = mkdtempSync(join(TMP, "resume-"));
      writeFileSync(join(d, "run.json"), JSON.stringify({ run_id: id }));
      return d;
    };
    expect((await run(args("claude", "claude-opus-5-5"))).err).toContain("E_ITEM_BOUND line item learn-fake is bound to run run-a");
    const own = await run(args("claude", "claude-opus-5-5", ["--resume", runDir("run-a")]));
    expect([own.code, own.err.includes("E_ITEM_BOUND")]).toEqual([0, false]);
    expect((await run(args("claude", "claude-opus-5-5", ["--resume", runDir("run-b")]))).err).toContain("E_ITEM_BOUND line item learn-fake is bound to run run-a");
  });

  // Value: protects=a lock row edit is caught when only before is a folder and after is a repo@sha arm; fails_when=mixed arm types skip the re-derivation; why_new=PR #45 review; seam=U6's rederiveLock, which needs only the before copy; no_claim=a before arm given as repo@sha, whose files are not read yet
  test("a hand-edited lock row is LOCK_DRIFT when after is a repo@sha arm", async () => {
    const { repo, args } = await lockedLearn();
    const lockPath = join(repo.root, "test/fixtures/skill-evals/learn/tasks.lock.json");
    writeFileSync(lockPath, readFileSync(lockPath, "utf8").replace('"kind":"prose"', '"kind":"heading"'));
    git(repo.root, "commit", "-q", "-am", "edit a row");
    const mixed = args("claude", "claude-opus-5-5", ["--skill", "learn"]).map((a) => (a.startsWith("before=") ? "before=" + repo.skill + ",after=gstack@" + "c".repeat(40) + ",none" : a));
    const r = await run(mixed);
    expect(r.err).toMatch(/LOCK_DRIFT lines\[\d+\] \(B:SKILL:\d{4}\): kind is "heading" in the lock and "prose" from the before copy/);
  });

  // Value: protects=a hand-edited lock row is LOCK_DRIFT naming the re-derived row (brief item 8's LOCK_DRIFT text); fails_when=preflight trusts the stored row; why_new=U6's re-derivation was not in preflight; seam=U6's rederiveLock; no_claim=none beyond protects
  test("a hand-edited lock row is LOCK_DRIFT, naming the re-derived row", async () => {
    const { repo, args } = await lockedLearn();
    const lockPath = join(repo.root, "test/fixtures/skill-evals/learn/tasks.lock.json");
    writeFileSync(lockPath, readFileSync(lockPath, "utf8").replace('"kind":"prose"', '"kind":"heading"'));
    git(repo.root, "commit", "-q", "-am", "edit a row");
    const r = await run(args("claude", "claude-opus-5-5"));
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/LOCK_DRIFT lines\[\d+\] \(B:SKILL:\d{4}\): kind is "heading" in the lock and "prose" from the before copy/);
  });

  // Value: protects=GST-109 decision 1: vacuity and sanity run before any --lock; preflight reports VACUOUS_CHECK beside LOCK_MISSING and --lock refuses a vacuous set; fails_when=a vacuous set can be locked or the vacuity verdict waits for the lock; why_new=the rebuilt office-hours set counts as new; seam=U5's checkVacuity; no_claim=continuity with earlier pilot numbers, which the CLI never claims
  test("vacuity runs before any --lock: preflight reports it beside LOCK_MISSING, and --lock refuses a vacuous set", async () => {
    const root = tree({ "demo/SKILL.md": "---\nname: demo\ndescription: d\n---\n\nNEVER guess.\n", "test/fixtures/skill-evals/demo/tasks.json": JSON.stringify([{ id: "always-true", prompt: "Do it.", check: "true" }]) });
    commitAll(root);
    const tasks = join(root, "test/fixtures/skill-evals/demo/tasks.json");
    const r = await run(["--arms", "before=" + join(root, "demo") + ",after=" + join(root, "demo"), "--tasks", tasks, "--host", "claude", "--model", "claude-opus-5-5", "--out", join(TMP, "v"), "--isolation", "process"]);
    expect(r.err).toContain("VACUOUS_CHECK always-true: passes on the no-op control");
    expect(r.err).toContain("LOCK_MISSING no lock committed");
    const lock = await run(["--lock", "--tasks", tasks], FAKE, "run");
    expect(lock.code).toBe(2);
    expect(lock.err).toContain("VACUOUS_CHECK --lock refuses a task set that fails the vacuity check");
    expect(existsSync(join(root, "test/fixtures/skill-evals/demo/tasks.lock.json"))).toBe(false);
  });
});

describe("preflight's ledger, key and host steps", () => {
  // Value: protects=brief item 6: an approval's cap is compared with the run's limit, and a higher limit is refused; also no item, no approval and a cap under one round; fails_when=--spend-cap above the approved cap passes; why_new=GSTA-11's ledger note; seam=U4's ledgerStatus; no_claim=lease binding at run time
  test("a spend cap above the approved cap, a missing approval or item, and a cap under one round are refused", async () => {
    const { args } = await lockedLearn();
    const low = approvalRecord("learn-fake", 50);
    const swap = (list: string[], flag: string, value: string) => list.map((a, i) => (list[i - 1] === flag ? value : a));
    const above = await run(swap(args("claude", "claude-opus-5-5"), "--ledger-record", low));
    expect(above.err).toContain("E_LEDGER_MISSING --spend-cap $300.00 is above the approved cap of $50.00 for line item learn-fake");
    expect((await run(swap(args("claude", "claude-opus-5-5"), "--item", "other-item"))).err).toContain("E_LEDGER_MISSING no approved cap is on record for line item other-item");
    expect((await run(args("claude", "claude-opus-5-5").filter((a, i, all) => a !== "--item" && all[i - 1] !== "--item"))).err).toContain("E_USAGE --item (or GSTACK_EVALS_ITEM) must name the ledger line item");
    const tiny = await run(swap(args("claude", "claude-opus-5-5"), "--spend-cap", "10"));
    expect(tiny.err).toContain("E_CAP_TOO_LOW --spend-cap $10.00 is below one arm-balanced round, $281.60");
  });

  // Value: protects=no --spend-cap is E_USAGE with the dry-run matrix and never a cap to copy; fails_when=the matrix is missing or a suggested cap is printed; why_new=interface v0.4's spend rule; seam=none; no_claim=none beyond protects
  test("no --spend-cap is E_USAGE with the dry-run matrix and no cap to copy", async () => {
    const { args } = await lockedLearn();
    const r = await run(args("claude", "claude-opus-5-5").filter((a, i, all) => a !== "--spend-cap" && all[i - 1] !== "--spend-cap"));
    expect(r.code).toBe(2);
    expect(r.err).toContain("E_USAGE --spend-cap is required on a call that can spend");
    expect(r.out).toContain("matrix: 1 model x 4 arms (before, before2, after, none) x 10 tasks x 3 trials = 120 sessions");
    expect(r.out).not.toMatch(/--spend-cap \d/);
  });

  // Value: protects=keys are checked by name and their values never printed; fails_when=a missing key passes or a value appears in output; why_new=new step; seam=none; no_claim=a key's validity, which only the provider knows
  test("a missing key is E_KEY_MISSING by name, and no value is printed", async () => {
    const { args } = await lockedLearn();
    const r = await run(args("claude", "claude-opus-5-5"), { GSTACK_EVALS_FAKE_HOST: "1", OPENAI_API_KEY: "sk-should-never-print-123456" });
    expect(r.err).toContain("E_KEY_MISSING not set: ANTHROPIC_API_KEY");
    expect(r.out + r.err).not.toContain("sk-should-never-print");
  });

  // Value: protects=an interactive task on --host codex is E_INTERACTIVE_HOST naming the ids and both fixes; a real host takes a gstack-base call past the arm check (GST-272 installs it) and still refuses it outside --isolation docker; fails_when=codex accepts an interactive task, a gstack base is still refused as unbuilt, or a base runs under process isolation; why_new=new step, then U10's readiness check, then GST-272; seam=hostReadiness; no_claim=the install itself, which tests/arms and the Docker tier cover
  test("an interactive task on codex is E_INTERACTIVE_HOST; a real host takes a gstack base but only under Docker", async () => {
    const { repo, args } = await lockedLearn();
    writeFileSync(join(repo.root, "test/fixtures/skill-evals/learn/tasks.ext.json"), JSON.stringify({ schema_version: 1, tasks: { "prune-stale": { interactive: true } } }));
    const r = await run(args("codex", "gpt-6.1-sol"));
    expect(r.err).toContain("E_INTERACTIVE_HOST --host codex runs only non-interactive tasks in v1; these tasks are declared interactive: prune-stale");
    expect(r.err).toContain("E_INTERACTIVE_HOST fix: Use --host claude, or --tasks-only show,search,stats,export,add,prune-conflict,cross-project,empty,no-code-change");
    const real = await run(args("claude", "claude-opus-5-5"), KEYS);
    expect(real.err).not.toContain("GST-272");
    expect(real.err).toContain("E_USAGE a real host runs under --isolation docker only; process isolation has no arm install");
  });

  // Value: protects=brief item 3: preflight flags a task that sends a PDF; fails_when=a PDF in the prompt or fixtures passes silently; why_new=U3 accepted inline base64 PDFs as won't-fix; seam=none; no_claim=how much the reservation is off
  test("a task that sends a PDF gets the PDF_INPUT warning", async () => {
    const root = tree({ "demo/SKILL.md": "---\nname: demo\ndescription: d\n---\n\nNEVER guess.\n", "test/fixtures/skill-evals/demo/tasks.json": JSON.stringify([{ id: "read-pdf", prompt: "Summarize report.pdf for me.", must: ["revenue"] }, { id: "plain", prompt: "Hi.", must: ["hello"] }]) });
    const r = await run(["--arms", "before=" + join(root, "demo") + ",after=" + join(root, "demo"), "--tasks", join(root, "test/fixtures/skill-evals/demo/tasks.json"), "--host", "claude", "--model", "claude-opus-5-5", "--out", join(TMP, "p")]);
    expect(r.err).toContain("PDF_INPUT these tasks may send a PDF, which the metering proxy reserves loosely when it is inline base64: read-pdf");
  });

  // Value: protects=--dry-run prints the matrix and the worst case in parts and needs no key, ledger or lock; fails_when=dry-run refuses for a missing key or lock, or drops a part; why_new=new; seam=none; no_claim=the allowance matching real spend
  test("--dry-run prints the matrix and the worst case in parts, with no key, ledger or lock", async () => {
    const repo = learnRepo();
    const dry = ["--arms", "before=" + repo.skill + ",after=" + repo.skill + ",none", "--tasks", repo.tasks, "--host", "claude", "--model", "claude-opus-5-5", "--dry-run", "--parallel", "2"];
    const io = collect();
    expect(await skillEvalCommand(dry, io, {})).toBe(0);
    const { out } = io.text();
    expect(out).toContain("sessions claude-opus-5-5     120 x $7.04 = $844.80");
    expect(out).toContain("rerun stage claude-opus-5-5  120 x $7.04 = $844.80");
    expect(out).toContain("one arm-balanced round: $281.60");
    expect(out).toContain("parallel 2; worst-case wall time 20.8 h (every agent session at its timeout, task timeouts, rerun stage and calibration included; judge calls not counted)");
    writeFileSync(join(repo.root, "test/fixtures/skill-evals/learn/tasks.ext.json"), JSON.stringify({ schema_version: 1, tasks: { show: { timeout_s: 7200 } } }));
    const slow = collect();
    expect(await skillEvalCommand(dry, slow, {})).toBe(0);
    expect(slow.text().out).toContain("worst-case wall time 44.7 h");
  });

  // Value: protects=--json writes <out>/error.json for a --dry-run that preflight refuses, as for any failure; fails_when=a dry-run stop leaves no record; why_new=PR #45 review; seam=U6's writeErrorRecord; no_claim=none beyond protects
  test("a refused --dry-run with --json writes error.json", async () => {
    const root = tree({ "demo/SKILL.md": "---\nname: demo\ndescription: d\n---\n\nNEVER guess.\n" });
    const out = join(root, "out");
    const r = await run(["--arms", "before=" + join(root, "demo") + ",after=" + join(root, "demo"), "--tasks", join(root, "missing.json"), "--host", "claude", "--model", "claude-opus-5-5", "--dry-run", "--json", "--out", out]);
    expect(r.code).toBe(2);
    expect(JSON.parse(readFileSync(join(out, "error.json"), "utf8"))).toMatchObject({ code: "E_TASKS_INVALID", operation: "preflight" });
  });
});
