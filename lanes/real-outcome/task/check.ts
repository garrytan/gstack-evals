// Copyright (c) 2026 Garry Tan. MIT License.
// The validity checker: V1 to V9 (plan section 3, with open items 2 and 9 and the Medium notes) and the leak checks,
// keyless, in Docker. It builds the agent image, reads the image's repository and filesystem for leaks, then grades
// the starting tree, gold, the introducing change (K1), base (K4: the reverse of the replay commit) and gold with
// release-file edits through verify.ts.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { docker, dockerRun } from "./docker.ts";
import { detectLicence, installProblem, keysInEnv, readTask, regressionFrozen, sha256, TaskError, validTestId, type TaskJson } from "./format.ts";
import { resultFor, type TestResult } from "./record.ts";
import { allPass, idResults, verifyTree, type TreeResult } from "./verify.ts";

export interface Rule {
  rule: string;
  pass: boolean;
  detail: string;
}

export interface CheckResult {
  schema: "real-outcome.check.v1";
  task: string;
  kind: TaskJson["kind"];
  image: { tag: string; id: string };
  verdict: "valid" | "invalid";
  rules: Rule[];
  derived: { regression: string[]; quarantine: string[] };
  /** Whether task.json already holds the frozen regression list; verify refuses the task until it does. */
  regression_frozen: boolean;
  trees: { label: string; prepare: TreeResult["prepare"]; runs: { seed: number; wall_ms: number; timed_out: boolean; out_full: boolean; exit: number; results: Record<string, TestResult> }[] }[];
}

export interface CheckOptions {
  taskDir: string;
  work: string;
  runs?: number;
  seed?: number;
  cpus?: number;
  /** Skip V4 and V5's audit records (the mechanical rules still run). The verdict then reads valid only mechanically. */
  mechanical?: boolean;
}

const RELEASE = /\b(VERSION|CHANGELOG|TODOS)\b/;

function inImage(image: string, script: string): string {
  const r = dockerRun("real-check-" + randomBytes(6).toString("hex"), ["--rm", "--network", "none", "--user", "0:0", "--entrypoint", "sh", image, "-c", script], { timeoutMs: 600000 });
  if (r.status !== 0) throw new TaskError("E_REAL_TASK_DOCKER", "a read of the image failed: " + r.stderr.trim().slice(0, 300));
  return r.stdout;
}

const section = (out: string, name: string): string[] => {
  const m = new RegExp("^== " + name + "\\n([\\s\\S]*?)(?=^== |(?![\\s\\S]))", "m").exec(out);
  return m ? m[1].split("\n").filter(Boolean) : [];
};

/** Builds the agent image from environment/ (installs run here, in build containers with no build args or secrets). */
export function buildImage(taskDir: string, t: TaskJson): { tag: string; id: string } {
  if (t.trust === "upstream" && keysInEnv().length > 0) throw new TaskError("E_REAL_TASK_KEYED_HOST", "this host's environment holds " + keysInEnv().join(", ") + "; build and check upstream tasks on a keyless build host");
  const tag = "real-task-" + t.id.toLowerCase() + ":" + sha256(readFileSync(join(taskDir, "task.json"))).slice(0, 12);
  const build = docker(["build", "-q", "-t", tag, join(taskDir, "environment")], { timeoutMs: 1800000 });
  if (build.status !== 0) throw new TaskError("E_REAL_TASK_DOCKER", "docker build failed: " + build.stderr.trim().slice(-600));
  return { tag, id: docker(["image", "inspect", "-f", "{{.Id}}", tag]).stdout.trim() };
}

export function checkTask(o: CheckOptions): CheckResult {
  const t = readTask(o.taskDir);
  const rules: Rule[] = [];
  const add = (rule: string, pass: boolean, detail: string) => rules.push({ rule, pass, detail });

  const { tag, id: imageId } = buildImage(o.taskDir, t);

  const tips = t.replay ? [t.base_commit, t.replay.commit] : [t.base_commit];
  const quoted = (xs: string[]) => xs.map((x) => "'" + x.replaceAll("'", "") + "'").join(" ");
  const repo = inImage(
    tag,
    [
      "cd " + t.repo_dir,
      "echo '== refs'; git for-each-ref --format='%(refname) %(objectname)'",
      "echo '== remotes'; git remote",
      "echo '== head'; git symbolic-ref -q HEAD; git rev-parse HEAD",
      "echo '== extra'; git rev-list --all " + tips.map((s) => "^" + s).join(" "),
      "echo '== stash'; git stash list",
      "echo '== logs'; ls -A .git/logs 2>/dev/null; ls .git/FETCH_HEAD .git/ORIG_HEAD 2>/dev/null",
      "echo '== unreachable'; git fsck --unreachable --no-reflogs --no-progress 2>/dev/null | head -5",
      "echo '== status'; git status --porcelain=v1 --untracked-files=all",
      "echo '== claude'; ls -d .claude .mcp.json 2>/dev/null",
      "echo '== new_tests'; for p in " + quoted(t.new_test_files) + "; do [ -e \"$p\" ] && echo \"$p\"; done",
      "echo '== licence'; for f in LICENSE LICENSE.md LICENSE.txt LICENCE LICENCE.md COPYING; do [ -f \"$f\" ] && sha256sum \"$f\" && break; done",
      "echo '== lockfile'; " + (t.install.lockfile ? "sha256sum " + quoted([t.install.lockfile]) : "true"),
      ...(t.replay ? ["echo '== replay'; git rev-parse " + t.replay.commit + "^1; git diff --binary --full-index --no-renames " + t.base_commit + " " + t.replay.commit + " | sha256sum"] : []),
      "echo '== end'",
    ].join("; "),
  );
  const refs = section(repo, "refs");
  const wantRefs = ["refs/heads/" + t.base_branch + " " + t.base_commit, ...(t.replay ? ["refs/heads/" + t.replay.branch + " " + t.replay.commit] : [])].sort();
  const leaks: string[] = [];
  if (JSON.stringify([...refs].sort()) !== JSON.stringify(wantRefs)) leaks.push("refs " + JSON.stringify(refs));
  for (const name of ["remotes", "extra", "stash", "logs", "unreachable"]) if (section(repo, name).length > 0) leaks.push(name + ": " + section(repo, name).slice(0, 3).join(" | "));
  add("L1 history", leaks.length === 0, leaks.length === 0 ? "only base's ancestry" + (t.replay ? " and the replay commit" : "") + "; no remotes, tags, reflog, stash or unreachable objects" : leaks.join("; "));
  const head = section(repo, "head");
  add("L1 start ref", head[0] === "refs/heads/" + t.start_ref && head[1] === (t.replay ? t.replay.commit : t.base_commit), "HEAD " + head.join(" "));
  add("L5 clean start", section(repo, "status").length === 0, section(repo, "status").length === 0 ? "git status is clean" : "untracked or changed: " + section(repo, "status").slice(0, 5).join(" | "));
  add("L6 no Claude project config", section(repo, "claude").length === 0, section(repo, "claude").join(", ") || "none");
  add("L3 new test files absent", section(repo, "new_tests").length === 0, section(repo, "new_tests").length === 0 ? t.new_test_files.length + " new test files are not in the image" : "present: " + section(repo, "new_tests").join(", "));

  const needles = readFileSync(join(o.taskDir, "tests/leak-needles.txt"), "utf8").split("\n").filter(Boolean);
  if (needles.length > 0) {
    const r = dockerRun("real-check-" + randomBytes(6).toString("hex"), ["--rm", "--network", "none", "--user", "0:0", "--entrypoint", "sh", "-v", join(o.taskDir, "tests/leak-needles.txt") + ":/needles.txt:ro", tag, "-c", "grep -rIlF -f /needles.txt / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev --exclude=needles.txt 2>/dev/null; true"], { timeoutMs: 1800000 });
    const hits = r.stdout.split("\n").filter(Boolean);
    add("L2 gold lines absent", r.status === 0 && hits.length === 0, hits.length === 0 ? needles.length + " gold-only lines found nowhere in the image" : "gold lines in " + hits.slice(0, 5).join(", "));
  } else add("L2 gold lines absent", t.replay?.role === "decoy", "no gold-only lines to scan for");
  const meta = docker(["image", "inspect", tag]).stdout + docker(["history", "--no-trunc", "--format", "{{.CreatedBy}}", tag]).stdout;
  const shas = [t.upstream.change, t.upstream.fix, t.upstream.revert].filter((s): s is string => !!s).filter((s) => meta.includes(s.slice(0, 12)));
  add("L4 image metadata", shas.length === 0 && !/\/pull\/\d+/.test(meta), shas.length === 0 ? "no upstream change id or pull request link in the image's config or history" : "names " + shas.join(", "));

  const lockLine = section(repo, "lockfile")[0] ?? "";
  const lockText = t.install.lockfile ? inImage(tag, "cat " + quoted([t.repo_dir + "/" + t.install.lockfile])) : null;
  const goMod = t.runner.kind === "go" ? inImage(tag, "cat " + t.repo_dir + "/go.mod") : null;
  const installIssue = installProblem(t.install, t.runner, (p) => (p === t.install.lockfile ? lockText : p === "go.mod" ? goMod : null));
  add("install policy", installIssue === null && (t.install.lockfile === null || lockLine.length > 0), installIssue ?? (t.install.lockfile ? "frozen install from " + t.install.lockfile : "no dependencies to install"));

  const licenceLine = section(repo, "licence")[0] ?? "";
  const upstreamLicence = readFileSync(join(o.taskDir, "upstream/LICENSE"), "utf8");
  add("V8 licence and attribution", licenceLine.startsWith(sha256(upstreamLicence)) && detectLicence(upstreamLicence) === t.licence && t.attribution.length > 0, licenceLine ? "the image's " + licenceLine.split(/\s+/)[1] + " matches upstream/LICENSE (" + t.licence + ")" : "no licence file in the image");

  const runs = o.runs ?? 10;
  const seed = o.seed ?? 1;
  const tree = (label: string, what: string, patch: string, n: number, releaseEdits = false) => {
    const r = verifyTree({ taskDir: o.taskDir, task: t, image: tag, label, patch, runs: n, seed, work: o.work, releaseEdits, cpus: o.cpus });
    if (r.prepare.patch === "failed") throw new TaskError("E_REAL_TASK_FORMAT", label + ": " + what + " does not apply to the starting tree: " + r.prepare.error);
    return r;
  };
  const file = (p: string) => readFileSync(join(o.taskDir, p), "utf8");
  const decoy = t.replay?.role === "decoy";
  const start = tree("start", "the empty patch", "", decoy ? runs : 1);
  const gold = decoy ? start : tree("gold", "solution/gold.patch", file("solution/gold.patch"), runs);
  const edited = tree("gold-release-edits", decoy ? "the empty patch" : "solution/gold.patch", decoy ? "" : file("solution/gold.patch"), 1, true);
  const intro = t.kind === "K1" ? tree("introducing", "solution/introducing.patch", file("solution/introducing.patch"), 1) : null;
  const base = t.replay ? tree("base", "the reverse of the replay commit", inImage(tag, "cd " + t.repo_dir + " && git diff --no-ext-diff --no-textconv --binary --full-index --no-renames " + t.replay.commit + " " + t.base_commit), 1) : start;
  const trees = [start, ...(decoy ? [] : [gold]), edited, ...(intro ? [intro] : []), ...(t.replay ? [base] : [])];

  const { functional, escaped_defect: escaped } = t.tests;
  const core = [...functional, ...escaped];
  const seen = new Set([...base.runs, ...start.runs, ...gold.runs].flatMap((r) => Object.keys(r.parsed.results)).filter((id) => !id.startsWith("collect:") && !core.includes(id) && validTestId(t.runner.kind, id)));
  const passesIn = (tr: TreeResult, id: string) => idResults(tr, id).every((r) => r.status === "pass");
  let regression = t.tests.regression;
  let quarantine = t.tests.quarantine;
  if (!regressionFrozen(t)) {
    const kept = (id: string) => passesIn(base, id) || passesIn(start, id);
    const goldPasses = (id: string) => idResults(gold, id).filter((r) => r.status === "pass").length;
    regression = [...seen].filter((id) => kept(id) && goldPasses(id) === gold.runs.length).sort();
    quarantine = [...seen].filter((id) => kept(id) && goldPasses(id) > 0 && goldPasses(id) < gold.runs.length).sort();
  }
  const required = [...core, ...regression];
  const statement = readFileSync(join(o.taskDir, "instruction.md"), "utf8");
  const named = (name: string | undefined) => !!name && new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(statement);
  const describe = (tr: TreeResult, ids: string[]) => ids.map((id) => id + "=" + idResults(tr, id).map((r) => r.status + (r.cls ? "/" + r.cls : "")).join(",")).join("; ");

  const flaky = core.filter((id) => {
    const n = idResults(gold, id).filter((r) => r.status === "pass").length;
    return n > 0 && n < gold.runs.length;
  });
  const v1 = allPass(gold, required);
  const stopped = gold.runs.filter((r) => r.timed_out || r.out_full).length;
  add("V1 gold passes every hidden test", v1, (v1 ? required.length + " tests passed in " + gold.runs.length + " of " + gold.runs.length + " runs in random order" : required.length === 0 ? "no required tests" : "failing or flaky: " + describe(gold, required.filter((id) => !passesIn(gold, id))) + (stopped ? "; runs that timed out or filled /out: " + stopped : "")) + (flaky.length ? "; flaky: " + flaky.join(", ") : "") + (quarantine.length ? "; quarantined regression tests: " + quarantine.length : ""));

  const firstStart = (id: string) => resultFor(start.runs[0].parsed, id);
  if (t.kind !== "K4") {
    const hit = functional.filter((id) => {
      const r = firstStart(id);
      return r.status === "fail" && (r.cls === "assert" || (r.cls === "missing_name" && named(r.name)));
    });
    add("V2 base fails a functional test at assertion level", hit.length > 0, hit.length > 0 ? hit.join(", ") : "base: " + describe(start, functional));
  }
  if (intro) {
    const hit = escaped.filter((id) => {
      const r = resultFor(intro.runs[0].parsed, id);
      return r.status === "fail" && r.cls === "assert";
    });
    add("V3 the introducing change fails an escaped-defect test", hit.length > 0, hit.length > 0 ? hit.join(", ") : "introducing: " + describe(intro, escaped));
  }
  const unnamed = [...start.runs, ...(intro?.runs ?? [])].flatMap((r) => core.map((id) => resultFor(r.parsed, id))).filter((r) => r.cls === "missing_name" && !named(r.name)).map((r) => r.name!);
  const loads = core.filter((id) => firstStart(id).cls === "load");
  const v4Mech = unnamed.length === 0;
  const v4Audit = o.mechanical ? true : t.audit.v4?.pass === true;
  add("V4 hidden tests call only interfaces at base or named in the statement", v4Mech && v4Audit, (v4Mech ? "every missing name is in the statement" : "names neither at base nor in the statement: " + [...new Set(unnamed)].join(", ")) + (loads.length ? "; load failures at base for the auditor: " + loads.join(", ") : "") + (o.mechanical ? "; audit not read (--mechanical)" : t.audit.v4 ? "; audit by " + t.audit.v4.by + ": " + (t.audit.v4.pass ? "pass" : "fail") : "; no audit record"));
  add("V5 every required behavior follows from the statement", o.mechanical ? true : t.audit.v5?.pass === true, o.mechanical ? "audit not read (--mechanical)" : t.audit.v5 ? "audit by " + t.audit.v5.by + ": " + (t.audit.v5.pass ? "pass" : "fail") + (t.audit.v5.note ? " (" + t.audit.v5.note + ")" : "") : "no audit record");

  const restored = readFileSync(join(o.taskDir, "tests/restore.list"), "utf8").split("\n").filter(Boolean);
  const readers = restored.filter((p) => RELEASE.test(readFileSync(join(o.taskDir, "tests/restore", p), "utf8")));
  const emptyFails = decoy || required.some((id) => firstStart(id).status !== "pass");
  const editedPass = allPass(edited, required);
  add("V6 an empty change fails and release files don't matter", emptyFails && editedPass && readers.length === 0, [decoy ? "decoy: the empty-change rule does not apply" : emptyFails ? "the starting tree fails" : "the starting tree passes every hidden test", editedPass ? "gold with VERSION, CHANGELOG and TODOS edits passes" : "gold with release edits fails: " + describe(edited, required.filter((id) => !idResults(edited, id).every((r) => r.status === "pass"))), readers.length ? "restored files name release files: " + readers.join(", ") : ""].filter(Boolean).join("; "));

  const all = trees.flatMap((tr) => tr.runs);
  const slowest = Math.max(...all.map((r) => r.wall_ms));
  add("V7 offline and inside the time limit", all.every((r) => !r.timed_out) && slowest <= t.limits.verifier_sec * 1000, "every run had --network none; slowest " + (slowest / 1000).toFixed(1) + "s of " + t.limits.verifier_sec + "s");

  if (t.replay) {
    const replayLines = section(repo, "replay");
    const exact = replayLines[0] === t.base_commit && (replayLines[1] ?? "").startsWith(t.replay.change_sha256);
    if (t.replay.role === "replay") {
      const hit = escaped.filter((id) => {
        const r = firstStart(id);
        return r.status === "fail" && r.cls === "assert";
      });
      add("V9 the replay branch holds the change and fails an escaped-defect test", exact && hit.length > 0, (exact ? "the branch is base plus exactly the change" : "the branch is not base plus exactly the change") + "; " + (hit.length > 0 ? "fails " + hit.join(", ") : "as given: " + describe(start, escaped)));
    } else {
      const asGiven = allPass(start, required);
      const broken = [...seen].filter((id) => passesIn(base, id) && idResults(start, id).every((r) => r.status !== "pass")).sort();
      add("V9 the decoy holds the change, passes as given and keeps every test that passes at base", exact && asGiven && broken.length === 0, (exact ? "the branch is base plus exactly the change" : "the branch is not base plus exactly the change") + "; " + (asGiven ? "passes every hidden test as given" : "fails as given") + (broken.length ? "; breaks tests that pass at base: " + broken.join(", ") : ""));
    }
  }

  return {
    schema: "real-outcome.check.v1",
    task: t.id,
    kind: t.kind,
    image: { tag, id: imageId },
    verdict: rules.every((r) => r.pass) ? "valid" : "invalid",
    rules,
    derived: { regression, quarantine },
    regression_frozen: regressionFrozen(t),
    trees: trees.map((tr) => ({ label: tr.label, prepare: tr.prepare, runs: tr.runs.map((r) => ({ seed: r.seed, wall_ms: r.wall_ms, timed_out: r.timed_out, out_full: r.out_full, exit: r.exit, results: Object.fromEntries(required.map((id) => [id, resultFor(r.parsed, id)])) })) })),
  };
}
