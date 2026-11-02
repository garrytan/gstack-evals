// Copyright (c) 2026 Garry Tan. MIT License.
// The validity checker: V1 to V9 (plan section 3, with open items 2 and 9 and the Medium notes) and the leak checks,
// keyless, in Docker. It builds the agent image, reads the image's repository and filesystem for leaks, then grades
// the starting tree, gold, the introducing change (K1), base (K4: the reverse of the replay commit) and gold with
// release-file edits through verify.ts.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../mine/git.ts";
import { classifyPath, INSTALL_DIRS, isTestPath } from "../mine/paths.ts";
import { docker, dockerRun } from "./docker.ts";
import { detectLicence, installProblem, keysInEnv, readTask, regressionFrozen, REPO_DIR, sha256, TaskError, validTestId, type TaskJson } from "./format.ts";
import { resultFor, type TestResult } from "./record.ts";
import { allPass, idResults, stopped, verifyTree, type TreeResult } from "./verify.ts";

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
  trees: { label: string; prepare: TreeResult["prepare"]; runs: { seed: number; wall_ms: number; timed_out: boolean; out_full: boolean; killed: boolean; exit: number; results: Record<string, TestResult> }[] }[];
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

/** Where an image keeps installed third-party code: dependency dirs at any depth, Python's lib/pythonX.Y (its standard
 * library and site-packages), the uv cache, and Go's toolchain and module cache. */
const INSTALLED = new RegExp("(?<=^|/)(?:" + [...INSTALL_DIRS.filter((d) => d !== ".git").map((d) => d.replace(".", "\\.")), "site-packages", "dist-packages", "lib/python\\d[^/]*", "\\.cache/uv", "go/pkg/mod", "usr/local/go"].join("|") + ")/", "g");

const normName = (s: string): string => s.toLowerCase().replace(/[-_.]+/g, "_");
const stemName = (part: string): string => part.replace(/@.*$/, "").replace(/\.(dist-info|egg-info|egg-link|pth|pyi?)$/, "").replace(/-\d.*$/, "");

/** The names an installed copy of the task's own project carries: the repository's name, its Go module, its top-level
 * Python packages (dirs holding __init__.py at the root or under src/, test dirs aside) and the distribution or package
 * name its pyproject.toml, setup.cfg or package.json declares. */
export function projectNames(t: Pick<TaskJson, "repo" | "runner">, packages: string[], manifests: Record<string, string>): string[] {
  const names = [t.repo.slice(t.repo.lastIndexOf("/") + 1)];
  if (t.runner.kind === "go") names.push(t.runner.module);
  for (const p of packages) if (!isTestPath(p)) names.push(p.split("/").at(-2)!);
  const parse = (text: string | undefined, read: (text: string) => unknown) => {
    try {
      const name = text === undefined ? undefined : read(text);
      if (typeof name === "string") names.push(name);
    } catch {}
  };
  parse(manifests["pyproject.toml"], (s) => {
    const toml = Bun.TOML.parse(s) as { project?: { name?: unknown }; tool?: { poetry?: { name?: unknown } } };
    return toml.project?.name ?? toml.tool?.poetry?.name;
  });
  parse(manifests["setup.cfg"], (s) => /^\[metadata\][^[]*?^name\s*=\s*([^\s#;]+)/m.exec(s)?.[1]);
  parse(manifests["package.json"], (s) => (JSON.parse(s) as { name?: unknown }).name);
  return [...new Set(names.filter(Boolean))];
}

/** L2's hits split into leaks and installed third-party code. A hit is installed code when it sits below an install
 * location and no path part below that location names the project: an installed or vendored copy of the project itself
 * stays a leak. A file git tracks in the repository is always a leak, whatever its directory is called. */
export function sortHits(hits: string[], own: string[], tracked: string[]): { leaks: string[]; installed: string[] } {
  const inRepo = new Set(tracked.map((p) => REPO_DIR + "/" + p));
  const isInstalled = (hit: string): boolean => {
    const at = [...hit.matchAll(INSTALLED)].at(-1);
    if (inRepo.has(hit) || !at) return false;
    const rest = hit.slice(at.index + at[0].length).replace(/!([a-z])/g, (_, c: string) => c.toUpperCase());
    return !own.some((name) => (name.includes("/") ? ("/" + rest).includes("/" + name + "/") || ("/" + rest).includes("/" + name + "@") : rest.split("/").some((part) => normName(stemName(part)) === normName(name))));
  };
  const installed = new Set(hits.filter(isInstalled));
  return { leaks: hits.filter((h) => !installed.has(h)), installed: [...installed] };
}

/** V6's static half: restored files that are release files themselves, and restored files gold adds or changes that
 * name one. A restored file gold leaves alone, such as a release-automation test the repository already had, is graded
 * by the release-edit run instead. git apply reads gold's paths, quoted names included, with no repository
 * (--git-dir=/dev/null): inside a checkout's subdirectory it would drop every path outside that subdirectory. */
export function releaseReaders(taskDir: string): string[] {
  const patch = readFileSync(join(taskDir, "solution/gold.patch"), "utf8");
  const touched = new Set(patch ? git(taskDir, ["--git-dir=/dev/null", "apply", "--numstat", "-z"], patch).split("\0").filter(Boolean).map((e) => e.split("\t").slice(2).join("\t")) : []);
  const restored = readFileSync(join(taskDir, "tests/restore.list"), "utf8").split("\n").filter(Boolean);
  return restored.filter((p) => classifyPath(p) === "release" || (touched.has(p) && RELEASE.test(readFileSync(join(taskDir, "tests/restore", p), "utf8"))));
}

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
      "echo '== packages'; ls -d */__init__.py src/*/__init__.py 2>/dev/null",
      "echo '== manifests'; for f in pyproject.toml setup.cfg package.json; do [ -f \"$f\" ] && echo \"$f $(base64 -w0 \"$f\")\"; done",
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
    const scan = [
      "hits=$(grep -rIlF -f /needles.txt / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev --exclude=needles.txt 2>/dev/null)",
      "echo '== hits'; printf '%s\\n' \"$hits\"",
      "echo '== tracked'; cd " + t.repo_dir + " && printf '%s\\n' \"$hits\" | sed -n 's|^" + t.repo_dir + "/||p' | tr '\\n' '\\0' | GIT_LITERAL_PATHSPECS=1 xargs -0r git ls-files -z -- | tr '\\0' '\\n'",
      "true",
    ].join("; ");
    const r = dockerRun("real-check-" + randomBytes(6).toString("hex"), ["--rm", "--network", "none", "--user", "0:0", "--entrypoint", "sh", "-v", join(o.taskDir, "tests/leak-needles.txt") + ":/needles.txt:ro", tag, "-c", scan], { timeoutMs: 1800000 });
    const manifests = Object.fromEntries(section(repo, "manifests").map((l) => [l.slice(0, l.indexOf(" ")), Buffer.from(l.slice(l.indexOf(" ") + 1), "base64").toString("utf8")]));
    const { leaks: found, installed } = sortHits(section(r.stdout, "hits").sort(), projectNames(t, section(repo, "packages"), manifests), section(r.stdout, "tracked"));
    const note = installed.length ? " outside installed third-party code (" + installed.length + " files there hold one, such as " + installed.slice(0, 3).join(", ") + ")" : "";
    add("L2 gold lines absent", r.status === 0 && found.length === 0, found.length === 0 ? needles.length + " gold-only lines found nowhere in the image" + note : "gold lines in " + found.slice(0, 5).join(", "));
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
  const goldStopped = gold.runs.filter(stopped).length;
  add("V1 gold passes every hidden test", v1, (v1 ? required.length + " tests passed in " + gold.runs.length + " of " + gold.runs.length + " runs in random order" : required.length === 0 ? "no required tests" : "failing or flaky: " + describe(gold, required.filter((id) => !passesIn(gold, id))) + (goldStopped ? "; runs that timed out, filled /out or were killed: " + goldStopped : "")) + (flaky.length ? "; flaky: " + flaky.join(", ") : "") + (quarantine.length ? "; quarantined regression tests: " + quarantine.length : ""));

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

  const readers = releaseReaders(o.taskDir);
  const emptyFails = decoy || required.some((id) => firstStart(id).status !== "pass");
  const editedPass = allPass(edited, required);
  add("V6 an empty change fails and release files don't matter", emptyFails && editedPass && readers.length === 0, [decoy ? "decoy: the empty-change rule does not apply" : emptyFails ? "the starting tree fails" : "the starting tree passes every hidden test", editedPass ? "gold with VERSION, CHANGELOG and TODOS edits passes" : "gold with release edits fails: " + describe(edited, required.filter((id) => !idResults(edited, id).every((r) => r.status === "pass"))), readers.length ? "restored release files, or restored files gold changes that name one: " + readers.join(", ") : ""].filter(Boolean).join("; "));

  const all = trees.flatMap((tr) => tr.runs);
  const slowest = Math.max(...all.map((r) => r.wall_ms));
  const halted = trees.flatMap((tr) => tr.runs.filter(stopped).map((r) => tr.label + " " + (r.timed_out ? "timed out" : r.killed ? "killed" : "filled /out")));
  add("V7 offline and inside the time and output limits", halted.length === 0 && slowest <= t.limits.verifier_sec * 1000, "every run had --network none; slowest " + (slowest / 1000).toFixed(1) + "s of " + t.limits.verifier_sec + "s" + (halted.length ? "; stopped runs: " + halted.join(", ") : ""));

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
    trees: trees.map((tr) => ({ label: tr.label, prepare: tr.prepare, runs: tr.runs.map((r) => ({ seed: r.seed, wall_ms: r.wall_ms, timed_out: r.timed_out, out_full: r.out_full, killed: r.killed, exit: r.exit, results: Object.fromEntries(required.map((id) => [id, resultFor(r.parsed, id)])) })) })),
  };
}
