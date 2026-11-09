// Copyright (c) 2026 Garry Tan. MIT License.
// Dry-run step d1-checks, live with Docker and HM_GSTACK at the pin: D1's build check that /verify's loop selects tests
// and prints a CHECK line on two tasks. On D1_TASK and the first calibration task from another repository it builds the
// task image FROM the pinned image with the task workdir, Lane B's runtime PATH line and task-setup.Dockerfile, checks
// that origin/main is HEAD and pytest resolves in the task's env, extracts the prose tar, makes a one-line edit to a
// tracked source file, runs the loop before trust (it must refuse with CHECKS_CONSENT_REQUIRED), runs laneb_hooks.py's
// CHECKS_TRUST, counts the test files gstack's pregate selection picks and runs the loop command from the pin's
// verify/SKILL.md (which prints no count). On D1_TASK it also checks the none tar (the same
// origin and PATH, no gstack file) and that the loop exits 3 once the origin is removed. Every container and image it
// made is removed after; the commands and their output go to <out>/d1-checks.txt.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepResult } from "./dryrun.ts";
import { bundleLists, REPO, SCREEN, taskSetup } from "./pins.ts";
import { gstackAtPin, imageRef, pool } from "./screen.ts";

export const D1_TASK = "tobymao__sqlglot-6413";
// The edit goes to the first tracked top-level package module (not a test, doc, script or private file) that a tracked
// test_<name>.py names, so pregate has a test to select.
const PICK = "for f in $(git ls-files '*.py' | grep -E '^[A-Za-z0-9_]+/[a-z][A-Za-z0-9_]*[.]py$' | grep -v -E '^(tests?|docs?|scripts?|examples?|benchmarks?)/|test'); do git ls-files | grep -q \"test_$(basename \"$f\" .py)[.]py$\" && { echo \"$f\"; break; }; done";

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

// The count line SELECTED prints and the loop's CHECK tests verdict, if a line printed one.
export function loopResult(text: string): { selected: number; check: string | null } {
  const sel = /^HM_SELECTED (\d+)$/m.exec(text), check = /^CHECK tests (PASS|FAIL)\b/m.exec(text);
  return { selected: sel ? Number(sel[1]) : 0, check: check ? check[1]! : null };
}

export function stepD1Checks(out: string): StepResult {
  const docker = process.env.HM_DOCKER ?? "docker";
  const last = (s: string) => (s.trim().split("\n").at(-1) ?? "").slice(0, 200);
  const dk = (args: string[], timeoutSec = 600) => { const p = Bun.spawnSync([docker, ...args], { stdout: "pipe", stderr: "pipe", timeout: timeoutSec * 1000 }); return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }; };
  if (dk(["info"], 60).code !== 0) return { pass: false, detail: "needs Docker; docker is missing or not running" };
  const gstack = gstackAtPin(), loop = verifyLoop(gstack), trust = checksTrust(), s = taskSetup();
  // How many test files gstack's own pregate selection picks for the change, through the arm's installed lib/checks.ts.
  const lanesFrom = /import \{[^}]*\bselectLanes\b[^}]*\} from '(\.[^']+)'/.exec(readFileSync(join(gstack, "lib/checks.ts"), "utf8"))?.[1];
  if (!lanesFrom) throw new Error("E_HM_INPUT the pin's lib/checks.ts imports no selectLanes");
  const G = "/root/.claude/skills/gstack/lib/";
  const selected = "bun --no-env-file --config=/dev/null -e 'import { load } from \"" + G + "checks\"; import { selectLanes } from \"" + join(G, lanesFrom) + "\"; const l = load(process.cwd(), undefined, 60000); console.log(\"HM_SELECTED \" + (\"refused\" in l ? -1 : selectLanes(l.ctx).localTests.length));'";
  const lanebPath = /^ENV PATH=.*$/m.exec(readFileSync(join(REPO, "quick/laneb/runner/runtime-copy.Dockerfile"), "utf8"))?.[0];
  if (!lanebPath) throw new Error("E_HM_INPUT runtime-copy.Dockerfile holds no ENV PATH line");
  const arms = process.env.ARMS ?? join(process.env.HOME ?? "", ".capy/work/hm/arms");
  for (const t of ["prose", "none"]) if (!existsSync(join(arms, t + ".tar"))) return { pass: false, detail: "no " + t + ".tar under " + arms + "; set ARMS to the built arm tars" };
  const p = pool(), other = bundleLists().calibration.find((t) => p.get(t)?.repo !== p.get(D1_TASK)?.repo);
  if (!other) return { pass: false, detail: "no calibration task from another repository" };
  const log: string[] = [], containers: string[] = [], images: string[] = [], found: string[] = [];
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
  const originAndPath = (c: string) => {
    const r = exec(c, "git rev-parse origin/main HEAD && command -v pytest");
    const [main, head, pytest] = r.out.trim().split("\n");
    if (r.code !== 0 || main !== head || !(pytest ?? "").startsWith(s.envDir + "/")) throw new Error(c + ": origin/main " + (main || "missing") + ", HEAD " + (head || "?") + ", pytest " + (pytest || "missing"));
  };
  let fail = "";
  try {
    for (const [i, t] of [D1_TASK, other].entries()) {
      const ref = imageRef(p.get(t)!), tag = "hm-d1-" + i, c = tag + "-prose";
      const pull = dk(["pull", "-q", ref], 3600);
      if (pull.code !== 0) throw new Error(t + ": pull failed: " + last(pull.err));
      images.push(ref);
      build(tag, ["FROM " + ref, "WORKDIR " + SCREEN.workdir, lanebPath, s.text].join("\n"));
      start(c, tag, "prose");
      originAndPath(c);
      const edit = exec(c, 'f=$(' + PICK + ') && [ -n "$f" ] && echo "# hm d1 probe edit" >> "$f" && echo "$f"');
      if (edit.code !== 0) throw new Error(t + ": no tracked source file to edit");
      const before = exec(c, loop);
      if (before.code === 0 || !/CHECKS_CONSENT_REQUIRED/.test(before.out + before.err)) throw new Error(t + ": the loop did not refuse before trust (exit " + before.code + ")");
      const tr = exec(c, trust, 300);
      if (tr.code !== 0) throw new Error(t + ": trust exited " + tr.code + ": " + last(tr.err));
      const count = exec(c, selected, 300), run = exec(c, loop, 1800), lr = loopResult(count.out + "\n" + run.out);
      if (!(lr.selected > 0) || !lr.check) throw new Error(t + ": the loop selected " + lr.selected + " test files and printed " + (lr.check ? "CHECK tests " + lr.check : "no CHECK tests line") + " (exit " + run.code + ")");
      found.push(t + " (" + edit.out.trim() + "): " + lr.selected + " test files, CHECK tests " + lr.check + ", trust '" + (tr.out.trim().split("\n")[0] ?? "") + "', refused before trust");
      if (i > 0) continue;
      const none = tag + "-none";
      start(none, tag, "none");
      originAndPath(none);
      const g = exec(none, "find /root /testbed/.claude -iname '*gstack*' -print 2>/dev/null | head -5");
      if (g.out.trim()) throw new Error("the none tar left gstack files: " + g.out.trim().split("\n").join(", "));
      const rm = exec(c, "git remote remove origin"), no = exec(c, loop);
      if (rm.code !== 0 || no.code !== 3 || !/no pregate context/.test(no.err)) throw new Error(t + ": without the origin the loop exited " + no.code + " (" + last(no.err) + "), not 3 for no pregate context");
      found.push("none tar: origin and PATH, no gstack file; no origin: exit 3");
    }
  } catch (e) {
    fail = String((e as Error).message ?? e).split("\n")[0]!;
  } finally {
    for (const c of containers) dk(["rm", "-f", c]);
    for (const im of images.reverse()) dk(["rmi", "-f", im]);
  }
  writeFileSync(join(out, "d1-checks.txt"), log.join("\n") + "\n");
  return fail ? { pass: false, detail: fail } : { pass: true, detail: found.join("; ") };
}
