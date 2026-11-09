// Copyright (c) 2026 Garry Tan. MIT License.
// Dry-run step d2-session-path (D2, the Captain's ruling): live Claude Code sessions in two real task images, driven the
// way a trial is (sessions-driver.py: LanebHooksAgent with only Harbor stubbed, the pinned SDK on the host), against the
// stub model, with no paid call. Each image is built as a trial's is: Lane B's runtime stages, the pinned task image and
// its workdir, runtime-copy.Dockerfile, then task-setup.Dockerfile. In the none, prose and hook arms the stub runs a probe
// through the Bash tool (PATH, bun, pytest, python3); in prose and hook it then runs gstack-checks (on sqlglot-7479 the
// probe edit and /verify's loop, on holoviews-6783 detect). A project UserPromptSubmit hook writes the hook's PATH. The step
// passes when the Bash tool's PATH is byte-identical across the arms and equal to the hook's, bun is found, pytest and
// python3 resolve in the task's testbed env, gstack-checks starts, and sqlglot-7479's loop prints CHECK tests PASS.
//
//   bun lanes/harness-mechanics/session-path.ts run --out <dir>
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolResults } from "../../quick/laneb/runner/fake_upstream.ts";
import { ARMS_DIR, dockerOk } from "./arms.ts";
import { EDIT_LINE, verifyLoop } from "./d1.ts";
import type { StepResult } from "./dryrun.ts";
import { REPO, taskSetup } from "./pins.ts";
import { gstackAtPin, imageRef, pool } from "./screen.ts";
import { sdkPython } from "./sessions.ts";

export type PathTask = { task: string; env: string; edit: string | null; checks: "run" | "detect" };
export const PATH_TASKS: PathTask[] = [
  { task: "tobymao__sqlglot-7479", env: "/opt/conda/envs/testbed/bin", edit: "sqlglot/diff.py", checks: "run" },
  { task: "holoviz__holoviews-6783", env: "/opt/miniconda3/envs/testbed/bin", edit: null, checks: "detect" },
];
export const PATH_PROBE = "printf 'HM_PATH=%s\\nHM_BUN=%s\\nHM_PYTEST=%s\\nHM_PYTHON3=%s\\n' \"$PATH\" \"$(command -v bun)\" \"$(command -v pytest)\" \"$(command -v python3)\"";
const ARMS3 = ["none", "prose", "hook"] as const;
const HOOK_FILE = "/tmp/hm-hook-path";
export type ArmRead = { path: string; bun: string; pytest: string; python3: string; hook_path: string | null; checks: string | null };

/** One arm's read: the probe's lines from the first Bash result, the hook's PATH, and gstack-checks' output. */
export function readArm(results: Record<string, string>, hookPath: string | null, checksId: string | null): ArmRead {
  const v = (k: string) => new RegExp("^HM_" + k + "=(.*)$", "m").exec(results.toolu_hm_c0 ?? "")?.[1] ?? "";
  return { path: v("PATH"), bun: v("BUN"), pytest: v("PYTEST"), python3: v("PYTHON3"), hook_path: hookPath, checks: checksId ? (results[checksId] ?? null) : null };
}

export function pathProblems(t: PathTask, arms: Record<string, ArmRead | null>): string[] {
  const p: string[] = [];
  for (const a of ARMS3) {
    const r = arms[a], at = t.task + " " + a + ": ";
    if (!r) { p.push(at + "no session read"); continue; }
    if (r.hook_path !== r.path) p.push(at + "the hook's PATH is not the Bash tool's");
    if (!r.bun) p.push(at + "bun is not found in the Bash tool");
    if (!r.pytest.startsWith(t.env + "/")) p.push(at + "pytest is " + (r.pytest || "missing") + ", not under " + t.env);
    if (!r.python3.startsWith(t.env + "/")) p.push(at + "python3 is " + (r.python3 || "missing") + ", not under " + t.env);
    if (a === "none") continue;
    if (!/^CHECK \S+/m.test(r.checks ?? "")) p.push(at + "gstack-checks did not start (" + (r.checks ?? "no output").trim().split("\n").at(-1)!.slice(0, 120) + ")");
    else if (t.checks === "run" && !/^CHECK tests PASS\b/m.test(r.checks!)) p.push(at + "the loop printed no CHECK tests PASS");
  }
  const paths = ARMS3.map((a) => arms[a]?.path);
  if (paths.every((x) => x !== undefined) && new Set(paths).size > 1) p.push(t.task + ": the Bash tool's PATH differs across none, prose and hook");
  return p;
}

type TaskRead = { task: string; image_path: string; arms: Record<string, ArmRead | null>; notes: string[] };
const docker = (args: string[], timeoutSec = 600, input?: string) => spawnSync("docker", args, { encoding: "utf8", input, timeout: timeoutSec * 1000, maxBuffer: 64 << 20 });
const tail = (s: string | null) => (s ?? "").trim().split("\n").at(-1)?.slice(0, 200) ?? "";

/** Builds each task's trial image, runs the three arms' sessions, and writes <out>/session-path.json. Needs Docker. */
export async function runPath(out: string, tasks: PathTask[] = PATH_TASKS): Promise<TaskRead[]> {
  mkdirSync(out, { recursive: true });
  const py = sdkPython(), gstack = gstackAtPin(), p = pool(), s = taskSetup();
  const stages = readFileSync(join(REPO, "quick/laneb/runner/runtime-stages.Dockerfile"), "utf8"), copy = readFileSync(join(REPO, "quick/laneb/runner/runtime-copy.Dockerfile"), "utf8");
  const reqLog = join(out, "requests.jsonl"), bodyLog = join(out, "bodies.jsonl");
  rmSync(reqLog, { force: true }); rmSync(bodyLog, { force: true });
  const fake = Bun.spawn(["bun", join(import.meta.dir, "fake-model.ts"), "0", reqLog, bodyLog], { stdout: "pipe", stderr: "inherit" });
  const head = new TextDecoder().decode((await fake.stdout.getReader().read()).value ?? new Uint8Array());
  const port = /127\.0\.0\.1:(\d+)/.exec(head)?.[1];
  const reads: TaskRead[] = [];
  try {
    if (!port) throw new Error("E_HM_PIN the stub model did not start: " + head.slice(0, 200));
    const settings = Buffer.from(JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "printf '%s' \"$PATH\" > " + HOOK_FILE }] }] } })).toString("base64");
    for (const [i, t] of tasks.entries()) {
      const tag = "hm-path-" + (i + 1), ref = imageRef(p.get(t.task)!), read: TaskRead = { task: t.task, image_path: "", arms: {}, notes: [] }, containers: string[] = [];
      reads.push(read);
      try {
        const pull = docker(["pull", "-q", ref], 3600);
        if (pull.status !== 0) throw new Error("pull failed: " + tail(pull.stderr));
        const ctx = mkdtempSync(join(tmpdir(), "hm-path-"));
        writeFileSync(join(ctx, "Dockerfile"), stages + "\nFROM " + ref + "\nWORKDIR /testbed\n\n" + copy + "\n" + s.text);
        const b = docker(["build", "-q", "-t", tag, ctx], 3600);
        rmSync(ctx, { recursive: true, force: true });
        if (b.status !== 0) throw new Error("docker build " + tag + " failed: " + tail(b.stderr));
        read.image_path = docker(["run", "--rm", "--entrypoint", "sh", tag, "-c", 'printf %s "$PATH"']).stdout;
        for (const arm of ARMS3) {
          const name = tag + "-" + arm + "-" + process.pid, sess = "path-" + (i + 1) + "-" + arm, trial = join(out, sess, "trial");
          rmSync(join(out, sess), { recursive: true, force: true }); mkdirSync(trial, { recursive: true });
          const up = docker(["run", "-d", "--name", name, "--network", "host", "--cap-drop", "NET_RAW", "--cap-drop", "NET_ADMIN", "--entrypoint", "sleep", tag, "infinity"]);
          if (up.status !== 0) { read.notes.push(arm + ": container did not start: " + tail(up.stderr)); continue; }
          containers.push(name);
          const hook = docker(["exec", name, "sh", "-c", "mkdir -p /testbed/.claude && echo " + settings + " | base64 -d > /testbed/.claude/settings.json && echo .claude/ >> /testbed/.git/info/exclude"]);
          if (hook.status !== 0) { read.notes.push(arm + ": the project hook was not written: " + tail(hook.stderr)); continue; }
          const cmds = [PATH_PROBE, ...(arm === "none" ? [] : [...(t.edit ? ["echo '" + EDIT_LINE + "' >> '" + t.edit + "'"] : []), t.checks === "run" ? verifyLoop(gstack) : 'C="$HOME/.claude/skills/gstack/bin/gstack-checks"; "$C" detect'])];
          const instruction = "[hm-session " + sess + "] [hm-script cmds] " + cmds.map((c) => "[hm-cmd " + btoa(c) + "]").join(" ") + " Run the commands, then stop.";
          const spec = { case: sess, arm, tar: join(ARMS_DIR(), arm + ".tar"), strip: false, told: "", container: name, base_url: "http://127.0.0.1:" + port, instruction, out: trial, checks_trust: arm !== "none" };
          const r = spawnSync(py, [join(import.meta.dir, "sessions-driver.py"), JSON.stringify(spec)], { encoding: "utf8", timeout: 1_500_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PYTHONPATH: join(REPO, "quick/laneb/runner/agent") } });
          writeFileSync(join(out, sess, "driver.log"), (r.stdout ?? "") + (r.stderr ?? ""));
          if (r.status !== 0) read.notes.push(arm + ": driver exited " + r.status + " (" + join(out, sess, "driver.log") + ")");
          const hp = docker(["exec", name, "cat", HOOK_FILE]);
          await Bun.sleep(300);
          const bodies = (existsSync(bodyLog) ? readFileSync(bodyLog, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.session === sess);
          read.arms[arm] = bodies.length ? readArm(toolResults(bodies.at(-1).messages), hp.status === 0 ? hp.stdout : null, arm === "none" ? null : "toolu_hm_c" + (cmds.length - 1)) : null;
        }
      } catch (e) {
        read.notes.push(String((e as Error).message ?? e).split("\n")[0]!);
      } finally {
        for (const c of containers) docker(["rm", "-f", c]);
        docker(["rmi", "-f", tag, ref]);
      }
    }
  } finally {
    fake.kill();
  }
  writeFileSync(join(out, "session-path.json"), JSON.stringify(reads, null, 2) + "\n");
  return reads;
}

/** Step d2-session-path: runs runPath in its own process, then checks every task's reads. */
export function stepSessionPath(out: string): StepResult {
  if (!dockerOk()) return { pass: false, detail: "needs Docker for the live sessions; docker is missing or not running" };
  const dir = join(out, "d2-session-path"), f = join(dir, "session-path.json");
  rmSync(dir, { recursive: true, force: true });
  const r = spawnSync("bun", [join(import.meta.dir, "session-path.ts"), "run", "--out", dir], { encoding: "utf8", timeout: 10_800_000 });
  if (!existsSync(f)) return { pass: false, detail: "the live sessions did not run: " + tail(r.stderr) };
  const reads = JSON.parse(readFileSync(f, "utf8")) as TaskRead[];
  const problems = reads.flatMap((x) => [...x.notes.map((n) => x.task + ": " + n), ...pathProblems(PATH_TASKS.find((t) => t.task === x.task)!, x.arms)]);
  const lines = reads.map((x) => { const a = x.arms.prose ?? x.arms.none; return x.task + ": Bash tool PATH " + (a?.path === x.image_path ? "is the image PATH" : JSON.stringify(a?.path ?? null) + " (image " + JSON.stringify(x.image_path) + ")") + "; bun " + (a?.bun || "missing") + "; pytest " + (a?.pytest || "missing") + "; python3 " + (a?.python3 || "missing") + "; " + ((x.arms.prose?.checks ?? "").match(/^CHECK tests \S+/m)?.[0] ?? "no tests line"); });
  writeFileSync(join(dir, "session-path.txt"), [...lines, "", ...problems].join("\n") + "\n");
  return problems.length ? { pass: false, detail: problems.join("; ") } : { pass: true, detail: "live sessions in none, prose and hook: " + lines.join("; ") };
}

if (import.meta.main) {
  const argv = process.argv.slice(2), i = argv.indexOf("--out");
  if (argv[0] !== "run" || i < 0 || !argv[i + 1]) { console.error("E_USAGE usage: session-path.ts run --out <dir>"); process.exit(2); }
  const reads = await runPath(argv[i + 1]!);
  console.log("SESSION-PATH " + reads.map((x) => x.task + " " + Object.keys(x.arms).length + " arms" + (x.notes.length ? " (" + x.notes.join("; ") + ")" : "")).join(", "));
}
