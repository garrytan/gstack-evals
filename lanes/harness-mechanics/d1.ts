// Copyright (c) 2026 Garry Tan. MIT License.
// Dry-run step d1-checks, live with Docker and HM_GSTACK at the pin: D1's build check that /verify's loop selects tests
// and prints a CHECK line on two tasks. It tries D1_TASK first, then calibration tasks in calibration.txt order, each from
// a repository not tried yet, and stops once D1.pass tasks pass or D1.maxTasks have been tried. For each task it builds
// the image FROM the pinned task image with the task workdir, Lane B's runtime PATH line and task-setup.Dockerfile,
// checks that origin/main is HEAD and pytest resolves in the task's env, extracts the prose tar, makes a one-line edit
// (EDIT_RULE), runs the loop before trust (it must refuse with CHECKS_CONSENT_REQUIRED), runs laneb_hooks.py's
// CHECKS_TRUST, counts the test files gstack's pregate selection picks and runs the loop command from the pin's
// verify/SKILL.md (which prints no count). A task passes with one or more selected test files and a CHECK tests PASS or
// FAIL line; one that can't (TOO_BROAD, ENV, no env pytest, no module to edit) prints a fit line and fails nothing by
// itself. On D1_TASK it also checks the none tar (the same origin and PATH, no gstack file) and that the loop exits 3
// with no pregate context once the origin is removed. Each task's containers and images are removed after it; the lines,
// commands and output go to <out>/d1-checks.txt.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepResult } from "./dryrun.ts";
import { bundleLists, REPO, SCREEN, taskSetup } from "./pins.ts";
import { gstackAtPin, imageRef, pool } from "./screen.ts";

export const D1_TASK = "tobymao__sqlglot-6413";
export const D1 = { pass: 2, maxTasks: 4, maxSelected: 300 };
export const EDIT_LINE = "# hm d1 probe edit";
export const EDIT_RULE = "the first tracked top-level package module (not a test, doc, script or private file) that a tracked test_<name>.py names and whose pregate selection is 1 to " + D1.maxSelected + " test files";
// Every tracked top-level package module (the filters above) that a tracked test_<name>.py names, in git ls-files order.
const CANDIDATES = "for f in $(git ls-files '*.py' | grep -E '^[A-Za-z0-9_]+/[a-z][A-Za-z0-9_]*[.]py$' | grep -v -E '^(tests?|docs?|scripts?|examples?|benchmarks?)/|test'); do git ls-files | grep -q \"test_$(basename \"$f\" .py)[.]py$\" && echo \"$f\"; done";

// The candidates' selection counts from HM_CANDIDATE lines, in order: the first by name, and the first in range (the edit).
export function editPick(text: string): { first: { file: string; selected: number } | null; edit: { file: string; selected: number } | null } {
  const c = [...text.matchAll(/^HM_CANDIDATE (\S+) (-?\d+)$/gm)].map((m) => ({ file: m[1]!, selected: Number(m[2]) }));
  return { first: c[0] ?? null, edit: c.find((x) => x.selected >= 1 && x.selected <= D1.maxSelected) ?? null };
}

export function checksTrust(): string {
  const m = /^CHECKS_TRUST = "([^"\n]+)"$/m.exec(readFileSync(join(REPO, "quick/laneb/runner/agent/laneb_hooks.py"), "utf8"));
  if (!m) throw new Error("E_HM_INPUT laneb_hooks.py holds no CHECKS_TRUST constant");
  return m[1]!;
}

// /verify's loop command at the pin: the bash block under "## 2. Loop" in verify/SKILL.md.
export function verifyLoop(gstack: string): string {
  const sec = readFileSync(join(gstack, "verify/SKILL.md"), "utf8").split(/^## 2\. Loop.*$/m)[1] ?? "";
  const m = /\x60\x60\x60bash\n(.+)\n\x60\x60\x60/.exec(sec);
  if (!m || !/"\$C" run$/.test(m[1]!)) throw new Error("E_HM_INPUT verify/SKILL.md at the pin has no loop run command under ## 2. Loop");
  return m[1]!;
}

// The count line the step's selection probe prints, the loop's CHECK tests verdict if one printed, and every CHECK line
// as "<name> <VERDICT>".
export function loopResult(text: string): { selected: number; check: string | null; checks: string[] } {
  const sel = /^HM_SELECTED (\d+)$/m.exec(text), check = /^CHECK tests (PASS|FAIL)\b/m.exec(text);
  return { selected: sel ? Number(sel[1]) : 0, check: check ? check[1]! : null, checks: [...text.matchAll(/^CHECK (\S+) ([A-Z_]+)\b/gm)].map((m) => m[1] + " " + m[2]) };
}

// The order d1-checks tries tasks in: D1_TASK, then calibration tasks in file order, each from a repository not tried yet.
export function d1Order(calibration: string[], repoOf: (t: string) => string | undefined): string[] {
  const seen = new Set([repoOf(D1_TASK)]), order = [D1_TASK];
  for (const t of calibration) if (!seen.has(repoOf(t))) { seen.add(repoOf(t)); order.push(t); }
  return order;
}

type Problem = { problem: string };

// The per-task rig d1-checks and hm fit share: Docker, the pin's loop and trust, the task setup, gstack's own selection
// probe, the arm tars, and the steps that build, start, check and clean a task's containers, logging every exec.
export function d1Rig(gstackDir?: string) {
  const docker = process.env.HM_DOCKER ?? "docker";
  const last = (s: string) => (s.trim().split("\n").at(-1) ?? "").slice(0, 200);
  const dk = (args: string[], timeoutSec = 600) => { const p = Bun.spawnSync([docker, ...args], { stdout: "pipe", stderr: "pipe", timeout: timeoutSec * 1000 }); return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }; };
  if (dk(["info"], 60).code !== 0) return { problem: "needs Docker; docker is missing or not running" } as Problem;
  const gstack = gstackDir ?? gstackAtPin(), loop = verifyLoop(gstack), trust = checksTrust(), s = taskSetup();
  // How many test files gstack's own pregate selection picks for the change, through the arm's installed lib/checks.ts.
  const lanesFrom = /import \{[^}]*\bselectLanes\b[^}]*\} from '(\.[^']+)'/.exec(readFileSync(join(gstack, "lib/checks.ts"), "utf8"))?.[1];
  if (!lanesFrom) throw new Error("E_HM_INPUT the pin's lib/checks.ts imports no selectLanes");
  const G = "/root/.claude/skills/gstack/lib/";
  const probe = (expr: string) => "bun --no-env-file --config=/dev/null -e 'import { load } from \"" + G + "checks\"; import { selectLanes } from \"" + join(G, lanesFrom) + "\"; const l = load(process.cwd(), undefined, 60000); console.log(" + expr + ");'";
  const selected = probe("\"HM_SELECTED \" + (\"refused\" in l ? -1 : selectLanes(l.ctx).localTests.length)");
  const lanebPath = /^ENV PATH=.*$/m.exec(readFileSync(join(REPO, "quick/laneb/runner/runtime-copy.Dockerfile"), "utf8"))?.[0];
  if (!lanebPath) throw new Error("E_HM_INPUT runtime-copy.Dockerfile holds no ENV PATH line");
  const arms = process.env.ARMS ?? join(process.env.HOME ?? "", ".capy/work/hm/arms");
  for (const t of ["prose", "none"]) if (!existsSync(join(arms, t + ".tar"))) return { problem: "no " + t + ".tar under " + arms + "; set ARMS to the built arm tars" } as Problem;
  const log: string[] = [];
  let containers: string[] = [], images: string[] = [];
  const exec = (c: string, script: string, timeoutSec = 600) => {
    const r = dk(["exec", "-e", "HOME=/root", "-w", SCREEN.workdir, c, "sh", "-c", script], timeoutSec);
    log.push("$ " + c + ": " + script, "exit " + r.code, r.out.trimEnd(), r.err.trimEnd());
    return r;
  };
  const build = (tag: string, text: string) => {
    const ctx = mkdtempSync(join(tmpdir(), "hm-d1-"));
    writeFileSync(join(ctx, "Dockerfile"), text);
    const b = dk(["build", "-q", "-t", tag, ctx], 1800);
    rmSync(ctx, { recursive: true, force: true });
    if (b.code !== 0) throw new Error("docker build " + tag + " failed: " + last(b.err));
    images.push(tag);
  };
  const start = (name: string, image: string, tar: string) => {
    dk(["rm", "-f", name]);
    const r = dk(["run", "-d", "--name", name, "--network", "none", "--entrypoint", "sleep", "-v", process.execPath + ":/opt/laneb/bin/bun:ro", "-w", SCREEN.workdir, image, "infinity"]);
    if (r.code !== 0) throw new Error("docker run " + name + " failed: " + last(r.err));
    containers.push(name);
    const x = Bun.spawnSync(["sh", "-c", '"$0" exec -i "$1" sh -c "mkdir -p /root && tar -x -C /root" < "$2"', docker, name, join(arms, tar + ".tar")], { stdout: "pipe", stderr: "pipe" });
    if (x.exitCode !== 0) throw new Error(tar + " tar extract failed in " + name + ": " + last(x.stderr.toString()));
  };
  const origin = (c: string) => {
    const r = exec(c, "git rev-parse origin/main HEAD"), [main, head] = r.out.trim().split("\n");
    if (r.code !== 0 || main !== head) throw new Error(c + ": origin/main " + (main || "missing") + " is not HEAD " + (head || "?"));
  };
  const pytest = (c: string) => exec(c, "command -v pytest").out.trim();
  const clean = () => { for (const c of containers) dk(["rm", "-f", c]); for (const im of images.reverse()) dk(["rmi", "-f", im]); containers = []; images = []; };
  // A task's image and prose container from its pinned image, the origin and env pytest checks, and the edit rule's pick.
  const prepare = (t: string, ref: string, tag: string) => {
    const c = tag + "-prose";
    const pull = dk(["pull", "-q", ref], 3600);
    if (pull.code !== 0) throw new Error(t + ": pull failed: " + last(pull.err));
    images.push(ref);
    build(tag, ["FROM " + ref, "WORKDIR " + SCREEN.workdir, lanebPath, s.text].join("\n"));
    start(c, tag, "prose");
    origin(c);
    const py = pytest(c), inEnv = py.startsWith(s.envDir + "/");
    // The edit, before any test runs: each candidate gets the one-line edit and its selection count, the first in range
    // keeps it, and the others are restored.
    const search = inEnv ? exec(c, CANDIDATES + ' | while read -r f; do echo "' + EDIT_LINE + '" >> "$f"; n=$(' + selected + ' | sed -n "s/^HM_SELECTED //p"); echo "HM_CANDIDATE $f ${n:--1}"; [ "${n:--1}" -ge 1 ] && [ "${n:--1}" -le ' + D1.maxSelected + ' ] && break; git checkout -q -- "$f"; done', 1800) : null;
    return { c, py, inEnv, pick: editPick(search ? search.out : "") };
  };
  return { last, log, loop, trust, s, probe, exec, start, origin, pytest, clean, prepare };
}
export type Rig = Exclude<ReturnType<typeof d1Rig>, Problem>;

export function stepD1Checks(out: string): StepResult {
  const r = d1Rig();
  if ("problem" in r) return { pass: false, detail: r.problem };
  const { last, log, loop, trust, s, exec, start, origin, pytest, clean } = r;
  const p = pool(), order = d1Order(bundleLists().calibration, (t) => p.get(t)?.repo);
  const lines: string[] = [], passed: string[] = [];
  let fail = "", tried = 0;
  try {
    for (const t of order) {
      if (passed.length >= D1.pass || tried >= D1.maxTasks) break;
      tried++;
      try {
        const tag = "hm-d1-" + tried, { c, py, inEnv, pick } = r.prepare(t, imageRef(p.get(t)!), tag), f = pick.edit?.file ?? "";
        if (pick.first && pick.first.selected > D1.maxSelected) lines.push("d1-checks fit " + t + ": first module " + pick.first.file + " selects " + pick.first.selected + ", over " + D1.maxSelected);
        if (!inEnv) lines.push("d1-checks fit " + t + ": pytest " + (py || "missing") + ", not under " + s.envDir);
        else if (!f) lines.push("d1-checks fit " + t + ": " + (pick.first ? "no module that a test_<name>.py names selects 1 to " + D1.maxSelected + " test files" : "no tracked module that a test_<name>.py names"));
        else {
          const before = exec(c, loop);
          if (before.code === 0 || !/CHECKS_CONSENT_REQUIRED/.test(before.out + before.err)) throw new Error(t + ": the loop did not refuse before trust (exit " + before.code + ")");
          const tr = exec(c, trust, 300);
          if (tr.code !== 0) throw new Error(t + ": trust exited " + tr.code + ": " + last(tr.err));
          const run = exec(c, loop, 1800), lr = loopResult("HM_SELECTED " + pick.edit!.selected + "\n" + run.out);
          const checks = lr.checks.map((x) => (x.startsWith("tests ") ? x + " (" + lr.selected + " selected)" : x)).join(", ") || "no CHECK line, " + lr.selected + " selected (exit " + run.code + ": " + last(run.out + "\n" + run.err) + ")";
          if (lr.selected >= 1 && lr.check) {
            passed.push(t);
            lines.push("d1-checks task " + t + " (" + f + "): " + checks + "; trust '" + (tr.out.trim().split("\n")[0] ?? "") + "'");
          } else lines.push("d1-checks fit " + t + " (" + f + "): " + checks);
        }
        if (t !== D1_TASK) continue;
        const none = tag + "-none";
        start(none, tag, "none");
        origin(none);
        const np = pytest(none), g = exec(none, "find /root /testbed/.claude -iname '*gstack*' -print 2>/dev/null | head -5").out.trim();
        if (!np.startsWith(s.envDir + "/") || g) throw new Error("the none tar: pytest " + (np || "missing") + (g ? ", gstack files " + g.split("\n").join(", ") : ""));
        const rm = exec(c, "git remote remove origin"), no = exec(c, loop);
        if (rm.code !== 0 || no.code !== 3 || !/no pregate context/.test(no.err)) throw new Error(t + ": without the origin the loop exited " + no.code + " (" + last(no.err) + "), not 3 for no pregate context");
        lines.push("d1-checks none-tar " + t + ": origin/main is HEAD, pytest " + np + ", no gstack file; without the origin the loop exits 3 (no pregate context)");
      } finally {
        clean();
      }
    }
  } catch (e) {
    fail = String((e as Error).message ?? e).split("\n")[0]!;
  }
  lines.push("d1-checks " + passed.length + " of " + tried + " tasks passed (need " + D1.pass + ", at most " + D1.maxTasks + " tried); edit rule: " + EDIT_RULE);
  writeFileSync(join(out, "d1-checks.txt"), [...lines, "", ...log].join("\n") + "\n");
  return { pass: !fail && passed.length >= D1.pass, detail: (fail ? fail + "; " : "") + lines.join("; ") };
}
