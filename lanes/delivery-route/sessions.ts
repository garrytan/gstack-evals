// Copyright (c) 2026 Garry Tan. MIT License.
// B1's scripted sessions: keyless Claude Code sessions in the hm-session image, one fresh container each, driven the way a
// trial is (the harness mechanics driver, lanes/harness-mechanics/sessions-driver.py: LanebHooksAgent with only Harbor
// stubbed, the arm tar extracted by the agent's own _inject_arm after the snapshot strip) against the stub model
// (fake-model.ts). They show what each arm's first request delivers, that the gstack-shaped setup runs, that no arm but
// gstack-shaped holds a gstack file, and the detector's reading of real Claude Code output in both directions. One more
// session (gstack-real) runs the gstack-shaped setup on real gstack 1.99.5.0, from a checkout at its pinned commit, with the
// state of a long-time user who has declined routing, so each stand-in script's output can be compared byte for byte.
// caseProblems reads only a capture directory, so the same assertions check a live run and the committed fixtures under
// tests/delivery-route/fixtures/sessions/.
//
//   bun lanes/delivery-route/sessions.ts run --out <dir> [--gstack <checkout>] [--cut <fixtures dir>]
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLog } from "../../quick/laneb/l1/probes.ts";
import { sdkPython, SESSION_IMAGE } from "../harness-mechanics/sessions.ts";
import { ARMS_DIR } from "./arms.ts";
import { detect, type Detection } from "./detect.ts";
import type { Mode } from "./fake-model.ts";
import { ARM_SOURCES, ARMS, DESCRIBED_SKILL, GSTACK_WRAPPER, REPO, sha256, SKILL, type B1Arm } from "./pins.ts";

/** real: the gstack-shaped arm with real gstack in place of the stand-ins (realTar). */
export type Case = { name: string; arm: B1Arm; mode: Mode; expect?: Partial<Detection>; real?: boolean };
export const CASES: Case[] = [
  { name: "none-stop", arm: "none", mode: "stop", expect: { followed: false, test_before_source: false, source_changed: true } },
  { name: "none-prove", arm: "none", mode: "prove", expect: { followed: true, followed_tool_only: true, bash_only_source: false } },
  { name: "none-bash", arm: "none", mode: "bash", expect: { followed: true, followed_tool_only: false, bash_only_source: true } },
  { name: "none-late", arm: "none", mode: "late", expect: { followed: false, test_before_source: false } },
  { name: "none-nofail", arm: "none", mode: "nofail", expect: { followed: false, test_before_source: true, failing_before_source: false, passing_after_source: true } },
  { name: "none-background", arm: "none", mode: "background", expect: { followed: true, unread_background: 0 } },
  { name: "described-stop", arm: "described", mode: "stop" },
  { name: "described-skill", arm: "described", mode: "skill" },
  { name: "gstack-setup", arm: "gstack-shaped", mode: "setup" },
  { name: "command-stop", arm: "command", mode: "stop" },
  { name: "gstack-real", arm: "gstack-shaped", mode: "setup", real: true },
];
export const instruction = (c: Case) => "[b1-session " + c.name + "] [b1-script " + c.mode + "] add() in calc.py returns the difference of its arguments. Make it return their sum.";
// Claude Code 2.1.312's own skill that CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 leaves listed, in every arm alike.
export const CLAUDE_LISTED = ["plugin-authoring"];
export const LISTING = "The following skills are available for use with the Skill tool:\n\n";
export const BASE = (skill: string) => "Base directory for this skill: /root/.claude/skills/" + skill + "\n\n";
export const ARGS = "\n\nARGUMENTS: ";

/** What one session leaves, as a capture directory holds it: the SDK log, the final patch, the first request's skill listing
 *  and user text blocks, the text that followed the first Skill tool result, and the gstack file count in the container. */
export type Captured = { sdk: string; patch: string; listing: string | null; user: string[]; loaded: string | null; gstack_files: number | null };
const readText = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
export function loadCaptured(dir: string): Captured {
  const j = JSON.parse(readText(join(dir, "capture.json")) ?? "{}");
  return { sdk: readText(join(dir, "sdk-messages.jsonl")) ?? "", patch: readText(join(dir, "model.patch")) ?? "", listing: j.listing ?? null, user: j.user ?? [], loaded: j.loaded ?? null, gstack_files: j.gstack_files ?? null };
}

const listed = (listing: string) => [...listing.matchAll(/^- ([\w:-]+): /gm)].map((m) => m[1]!);
const steps = () => readFileSync(join(REPO, ARM_SOURCES, "steps.md"), "utf8");
const body = (file: string) => readFileSync(join(REPO, ARM_SOURCES, file), "utf8").replace(/^---\n[\s\S]*?\n---\n\n?/, "");
const description = () => /^description: (.*)$/m.exec(readFileSync(join(REPO, ARM_SOURCES, "described-SKILL.md"), "utf8"))![1]!;

/** What a treated arm delivers around the step text, as the first request (or the Skill tool's load) shows it. */
export type Delivered = { arm: B1Arm; where: "typed expansion" | "skill load"; block_bytes: number; before_steps: number; after_steps: number; listing_entry: string | null };
export function delivered(c: Case, cap: Captured): Delivered | null {
  const s = steps();
  const block = c.arm === "described" ? cap.loaded : ARMS[c.arm].typed ? cap.user.find((t) => t.includes(s)) ?? null : null;
  if (!block || !block.includes(s)) return null;
  const at = block.indexOf(s), end = block.includes(ARGS) ? block.indexOf(ARGS) : block.length;
  const name = c.arm === "described" ? DESCRIBED_SKILL : SKILL;
  const entry = cap.listing?.split("\n").find((l) => l.startsWith("- " + name + ": ")) ?? null;
  return { arm: c.arm, where: c.arm === "described" ? "skill load" : "typed expansion", block_bytes: Buffer.byteLength(block.slice(0, end)), before_steps: Buffer.byteLength(block.slice(0, at)), after_steps: Buffer.byteLength(block.slice(at + s.length, end)), listing_entry: entry };
}

/** Every assertion on one session. Empty means the session did what the prereg's delivery section says. */
export function caseProblems(c: Case, cap: Captured): string[] {
  const p: string[] = [];
  const want = (what: string, ok: boolean) => { if (!ok) p.push(c.name + ": " + what); };
  const recs = parseLog(cap.sdk);
  if (!recs.length || cap.listing === null || !cap.user.length) return [c.name + ": no session (no SDK log, or no request reached the stub model)"];
  const s = steps(), first = cap.user.join("\n"), names = listed(cap.listing);
  const own = c.arm === "described" ? [DESCRIBED_SKILL] : c.arm === "gstack-shaped" ? [SKILL] : [];
  want("the skill listing names " + names.join(", ") + ", not " + [...own, ...CLAUDE_LISTED].join(", "), JSON.stringify([...names].sort()) === JSON.stringify([...own, ...CLAUDE_LISTED].sort()));
  want("the container holds " + cap.gstack_files + " gstack files", c.real ? (cap.gstack_files ?? 0) > 4 : cap.gstack_files === (c.arm === "gstack-shaped" ? 4 : 0));
  const typed = first.includes("<command-name>/" + SKILL + "</command-name>");
  want(typed ? "the prompt is typed" : "the prompt is not typed", typed === ARMS[c.arm].typed);
  if (c.arm === "none") want("the step text reached a none session", !first.includes(s) && !cap.sdk.includes("Prove-It"));
  if (c.arm === "described") {
    want("the listing does not give the described skill its full description", cap.listing.includes("- " + DESCRIBED_SKILL + ": " + description() + "\n"));
    want("the step text reached the first request before any load", !first.includes(s));
    if (c.mode === "skill") want("the Skill load is not the base line and the skill's body", cap.loaded === BASE(DESCRIBED_SKILL) + body("described-SKILL.md"));
  }
  if (c.arm === "gstack-shaped") {
    const block = cap.user.find((t) => t.startsWith(BASE(SKILL))) ?? "";
    want("the typed expansion is not the base line, the gstack-shaped body and the arguments", block.startsWith(BASE(SKILL) + body("gstack-shaped-SKILL.md") + ARGS));
    want("the preamble does not come before the steps", block.indexOf("## Preamble (run first)") >= 0 && block.indexOf("## Preamble (run first)") < block.indexOf(s));
    want("the setup's output lacks SKILL_START_PROTO: 1 or ROUTING_DECLINED: true", /SKILL_START_PROTO: 1\\nBRANCH: [^\\]*\\nPROACTIVE: core[\s\S]*ROUTING_DECLINED: true/.test(cap.sdk));
  }
  if (c.arm === "command") {
    const block = cap.user.find((t) => t.includes(s)) ?? "";
    want("the typed expansion is not the steps and the arguments", block.startsWith(s + ARGS));
    want("the command's front matter reached the session", !first.includes("disable-model-invocation") && !first.includes("Run TDD workflow"));
  }
  if (c.expect) {
    const d = detect(recs, cap.patch) as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(c.expect)) want("detect " + k + " is " + JSON.stringify(d[k]) + ", expected " + JSON.stringify(v), d[k] === v);
  }
  return p;
}

/** The three gstack commands' outputs in a setup session, in order: skill-start, learnings-log, skill-end. */
export const SETUP_SCRIPTS = ["gstack-skill-start", "gstack-learnings-log", "gstack-skill-end"];
export function setupOutputs(cap: Captured): string[] {
  const out = new Map<string, string>();
  for (const r of parseLog(cap.sdk)) if (r.type === "UserMessage" && Array.isArray(r.content)) for (const b of r.content as any[]) {
    if (typeof b?.tool_use_id !== "string") continue;
    out.set(b.tool_use_id, typeof b.content === "string" ? b.content : (b.content ?? []).map((x: any) => x.text ?? "").join(""));
  }
  return SETUP_SCRIPTS.map((_, i) => out.get("toolu_b1_" + i) ?? "");
}
/** An output with its run-time values (session id, start time, duration) replaced, as the stand-ins fill them in. */
export const filled = (s: string) => s.replace(/^(SESSION_ID: ).*$/m, "$1<id>").replace(/^(TEL_START: ).*$/m, "$1<time>").replace(/duration_s=\d+/g, "duration_s=<s>");
export type StandIn = { script: string; stand_in_sha256: string; real_sha256: string; same_after_run_time_values: boolean; differences: string[] };
/** Each stand-in's output in the gstack-setup session against real gstack's in the gstack-real session. */
export function compareStandIns(stand: Captured, real: Captured): StandIn[] {
  const a = setupOutputs(stand), b = setupOutputs(real);
  return SETUP_SCRIPTS.map((script, i) => {
    const x = a[i]!.split("\n"), y = b[i]!.split("\n");
    const differences = [...x.filter((l) => !y.includes(l)).map((l) => "stand-in: " + l), ...y.filter((l) => !x.includes(l)).map((l) => "real: " + l)];
    return { script, stand_in_sha256: sha256(a[i]!), real_sha256: sha256(b[i]!), same_after_run_time_values: filled(a[i]!) === filled(b[i]!), differences };
  });
}

/** gstack 1.99.5.0's state for a long-time user who has declined routing: every one-time prompt answered, telemetry off,
 *  routing declined, update checks off. */
export const LONG_TIME_USER = {
  markers: [".activated", ".completeness-intro-seen", ".feature-prompted-model-overlay", ".first-loop-tip-shown", ".proactive-prompted", ".telemetry-prompted", ".writing-style-prompted"],
  config: "telemetry: off\nproactive: core\nrouting_declined: true\nupdate_check: false\n",
};
/** The gstack-shaped tar with real gstack in place of its stand-ins: the pinned commit's tree at ~/.claude/skills/gstack, less
 *  its top-level SKILL.md (so the listing stays the arm's), and LONG_TIME_USER's state in ~/.gstack. Never a counted arm. */
function realTar(out: string, gstack: string): string {
  const tree = join(out, "gstack-real-tree"), tar = join(out, "gstack-real.tar"), skills = join(tree, ".claude/skills");
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(tree, { recursive: true });
  const sh = (cmd: string) => { const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8", maxBuffer: 64 << 20 }); if (r.status !== 0) throw new Error("E_B1_PIN " + cmd.slice(0, 80) + ": " + (r.stderr ?? "").slice(-200)); };
  sh("tar -xf '" + join(ARMS_DIR(), ARMS["gstack-shaped"].tar + ".tar") + "' -C '" + tree + "' && rm -rf '" + join(skills, "gstack") + "' && mkdir -p '" + join(skills, "gstack") + "' '" + join(tree, ".gstack") + "'");
  sh("git -C '" + gstack + "' archive " + GSTACK_WRAPPER.sha + " | tar -x -C '" + join(skills, "gstack") + "' && rm -f '" + join(skills, "gstack/SKILL.md") + "'");
  for (const m of LONG_TIME_USER.markers) writeFileSync(join(tree, ".gstack", m), "");
  writeFileSync(join(tree, ".gstack/config.yaml"), LONG_TIME_USER.config);
  sh("tar -cf '" + tar + "' -C '" + tree + "' .");
  return tar;
}

const docker = (args: string[], input?: string, timeout = 600_000) => spawnSync("docker", args, { input, encoding: "utf8", timeout, maxBuffer: 64 << 20 });
const RESET = ["set -e", "mkdir -p /testbed", "cd /testbed", "printf 'def add(a, b):\\n    return a - b\\n' > calc.py", "git init -q && git add -A && git -c user.name=b1 -c user.email=b1@example.invalid commit -qm snapshot"].join("\n");
const GSTACK_FILES = 'find / -xdev \\( -path /proc -o -path /sys \\) -prune -o -iname "*gstack*" ! -iname "*sigstack*" -print 2>/dev/null | wc -l; find / -xdev -maxdepth 3 -type d -name .capy 2>/dev/null | wc -l';

function capture(trial: string, bodies: any[], dest: string, c: Case, patch: string, files: number | null) {
  mkdirSync(dest, { recursive: true });
  cpSync(join(trial, "evaluator", "sdk-messages.jsonl"), join(dest, "sdk-messages.jsonl"));
  writeFileSync(join(dest, "model.patch"), patch);
  const mine = bodies.filter((b) => b.session === c.name);
  const texts = (m: any): string[] => (typeof m?.content === "string" ? [m.content] : (m?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text));
  const sys = mine[0] ? texts(mine[0].messages.find((m: any) => m.role === "system")).join("") : "";
  const at = sys.indexOf(LISTING);
  const listing = at < 0 ? null : sys.slice(at, sys.indexOf("\n\n", at + LISTING.length) + 1);
  const user = mine[0] ? texts(mine[0].messages.find((m: any) => m.role === "user")).filter((t) => !t.startsWith("<system-reminder>")) : [];
  let loaded: string | null = null;
  for (const b of mine) {
    const i = b.messages.findIndex((m: any) => m.role === "user" && Array.isArray(m.content) && m.content.some((x: any) => x.type === "tool_result" && /^Launching skill: /.test(String(x.content))));
    if (i >= 0) { loaded = texts(b.messages[i]).join("\n"); break; }
  }
  writeFileSync(join(dest, "capture.json"), JSON.stringify({ listing, user, loaded, gstack_files: files, requests: mine.length }, null, 2) + "\n");
}

/** Runs every case, one fresh container each, and writes <out>/<case>/{trial,capture}, <out>/sessions.json. Needs Docker. */
export async function runSessions(out: string, cases: Case[] = CASES, gstack = join(process.env.HOME ?? "/root", ".local/share/gstack")) {
  mkdirSync(out, { recursive: true });
  const py = sdkPython();
  const reqLog = join(out, "requests.jsonl"), bodyLog = join(out, "bodies.jsonl");
  rmSync(reqLog, { force: true }); rmSync(bodyLog, { force: true });
  const fake = Bun.spawn(["bun", join(import.meta.dir, "fake-model.ts"), "0", reqLog, bodyLog], { stdout: "pipe", stderr: "inherit" });
  const head = new TextDecoder().decode((await fake.stdout.getReader().read()).value ?? new Uint8Array());
  const port = /127\.0\.0\.1:(\d+)/.exec(head)?.[1];
  const problems: string[] = [], runs: { c: Case; patch: string; files: number | null }[] = [];
  try {
    if (!port) throw new Error("E_B1_PIN the stub model did not start: " + head.slice(0, 200));
    for (const c of cases) {
      const name = "b1-sessions-" + c.name + "-" + process.pid, dir = join(out, c.name), trial = join(dir, "trial");
      rmSync(dir, { recursive: true, force: true }); mkdirSync(trial, { recursive: true });
      const up = docker(["run", "-d", "--name", name, "--network", "host", "--cap-drop", "NET_RAW", "--cap-drop", "NET_ADMIN", SESSION_IMAGE, "sleep", "infinity"]);
      if (up.status !== 0) { problems.push(c.name + ": container did not start: " + up.stderr.trim().slice(-200)); continue; }
      try {
        const reset = docker(["exec", "-i", name, "sh", "-s"], RESET);
        if (reset.status !== 0) { problems.push(c.name + ": reset failed: " + reset.stderr.trim().slice(-200)); continue; }
        const spec = { case: c.name, arm: c.arm, tar: c.real ? realTar(out, gstack) : join(ARMS_DIR(), ARMS[c.arm].tar + ".tar"), strip: true, told: ARMS[c.arm].typed ? SKILL : "", container: name, base_url: "http://127.0.0.1:" + port, instruction: instruction(c), out: trial };
        const r = spawnSync(py, [join(REPO, "lanes/harness-mechanics/sessions-driver.py"), JSON.stringify(spec)], { encoding: "utf8", timeout: 400_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PYTHONPATH: join(REPO, "quick/laneb/runner/agent") } });
        writeFileSync(join(dir, "driver.log"), (r.stdout ?? "") + (r.stderr ?? ""));
        if (r.status !== 0) { problems.push(c.name + ": driver exited " + r.status + " (" + join(dir, "driver.log") + ")"); continue; }
        const patch = docker(["exec", name, "sh", "-c", "cat /logs/artifacts/model.patch"]).stdout ?? "";
        const counts = (docker(["exec", name, "sh", "-c", GSTACK_FILES]).stdout ?? "").trim().split("\n").map(Number);
        if (counts[1] !== 0) problems.push(c.name + ": the container holds a .capy folder");
        runs.push({ c, patch, files: Number.isFinite(counts[0]) ? counts[0]! : null });
      } finally { docker(["rm", "-f", name]); }
    }
    await Bun.sleep(300);
    const bodies = (readText(bodyLog) ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const { c, patch, files } of runs) {
      capture(join(out, c.name, "trial"), bodies, join(out, c.name, "capture"), c, patch, files);
      problems.push(...caseProblems(c, loadCaptured(join(out, c.name, "capture"))));
    }
  } finally { fake.kill(); }
  const sizes = runs.filter(({ c }) => !c.real).map(({ c }) => delivered(c, loadCaptured(join(out, c.name, "capture")))).filter((d): d is Delivered => !!d);
  const ran = (n: string) => runs.some(({ c }) => c.name === n);
  const standIns = ran("gstack-setup") && ran("gstack-real") ? compareStandIns(loadCaptured(join(out, "gstack-setup", "capture")), loadCaptured(join(out, "gstack-real", "capture"))) : [];
  for (const x of standIns) if (!x.same_after_run_time_values) problems.push("the " + x.script + " stand-in's output differs from real gstack's: " + x.differences.join(" | "));
  writeFileSync(join(out, "sessions.json"), JSON.stringify({ cases: cases.map((c) => c.name), delivered: sizes, stand_ins: standIns, problems }, null, 2) + "\n");
  return { problems, delivered: sizes, standIns };
}

export async function main(argv: string[]): Promise<number> {
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const out = flag("--out");
  if (argv[0] !== "run" || !out) { console.error("E_USAGE usage: sessions.ts run --out <dir> [--gstack <checkout>] [--cut <fixtures dir>]"); return 2; }
  const { problems, delivered: sizes, standIns } = await runSessions(out, CASES, flag("--gstack"));
  const cut = flag("--cut");
  if (cut) for (const c of CASES) { rmSync(join(cut, c.name), { recursive: true, force: true }); if (existsSync(join(out, c.name, "capture"))) cpSync(join(out, c.name, "capture"), join(cut, c.name), { recursive: true }); }
  for (const d of sizes) console.log("DELIVERED " + d.arm + " (" + d.where + "): " + d.block_bytes + " bytes, " + d.before_steps + " before the steps, " + d.after_steps + " after" + (d.listing_entry ? "; listed as " + Buffer.byteLength(d.listing_entry) + " bytes" : "; not listed"));
  for (const x of standIns) console.log("STAND-IN " + x.script + ": stand-in output sha256 " + x.stand_in_sha256 + ", real " + x.real_sha256 + "; " + (x.same_after_run_time_values ? "the same apart from run-time values" : "DIFFERENT") + (x.differences.length ? " (" + x.differences.join(" | ") + ")" : ""));
  for (const p of problems) console.error("E_B1_PIN " + p);
  console.log("SESSIONS " + (problems.length ? "FAIL " + problems.length : "PASS") + " " + CASES.length + " cases");
  return problems.length ? 1 : 0;
}
if (import.meta.main) process.exit(await main(process.argv.slice(2)));
