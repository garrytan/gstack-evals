// Copyright (c) 2026 Garry Tan. MIT License.
// B1b, the prose routes (lanes/delivery-route/README.md, "B1b"; prereg B1B_BUNDLE): B1's gstack-shaped prove-it skill on
// Opus 5.5, reached by name in prose two ways instead of by a typed command. claude-md: gstack's CLAUDE.md routing block names
// the skill. hook: gstack's prompt-routing hook adds its line naming the skill. B1's tasks, prompt, rig and scorer, with B1's
// Opus none and typed-route arms read from B1's published rows as references. This file holds the arm sources and tars, the
// plan and launcher profile, the caps and launch guard, the session rows (did the skill load, and why not), the report, the
// none arm's reuse check, the route table over the 62 prompts and the keyless scripted sessions.
//
//   bun lanes/delivery-route/cli.ts b1b <command> (USAGE below)
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hostTtlHours, itemCheck, L1, l1Main, plannedCells, prefixOf, seeded, type ItemDef, type PartPlan, type Profile, type Rect } from "../../quick/laneb/l1/l1.ts";
import { parseLog, type Rec } from "../../quick/laneb/l1/probes.ts";
import { readSessionRows, sessionsByTrial } from "../../quick/laneb/analysis/analyze.ts";
import { appendRow, fromMicros, Ledger, readRows, toMicros, type Row } from "../../quick/laneb/runner/ledger.ts";
import { ROUTE_CONTEXT, ROUTE_MARK } from "../../quick/laneb/runner/proxy.ts";
import { sdkPython, SESSION_IMAGE } from "../harness-mechanics/sessions.ts";
import { barCount, maxGaps, newcombe, wilson } from "./analyze.ts";
import { ARMS_DIR, LAYOUT, TAR_ARGS, wrappers } from "./arms.ts";
import { manifest } from "../../quick/laneb/arms/tree.ts";
import { B1_RUN, B1B, B1B_ARM_NAMES, B1B_ARMS, B1B_BUNDLE, B1B_CAPS_USD, B1B_ITEMS, GSTACK_MAIN, HOOK_DIR, HOOK_FILES, HOOK_REGISTRATION, HOOK_SUBSTITUTIONS, HOOK_SWITCH, isB1bArm, isB1bItem, ROUTING, type B1bArm, type B1bItem } from "./b1b-pins.ts";
import { blockUsd, infraRerun, needsRerun } from "./money.ts";
import { AGENT_SKILLS, ARM_SOURCES, B1, CLOSING, drawnTasks, loadBundle, MODELS, REPO, sha256, SKILL, SMOKE_TASKS, TASK_SETUP, VM_HOURS_PER_SESSION, frontMatterDigests } from "./pins.ts";
import { b1Row, pulledInputs, type B1Row, type B1TableConfig } from "./table.ts";
import { BASE, CLAUDE_LISTED, LISTING } from "./sessions.ts";

const pinErr = (m: string): never => { throw new Error("E_B1_PIN " + m); };
const usage = (m: string): never => { throw new Error("E_USAGE " + m); };
const SRC = join(REPO, ARM_SOURCES, "b1b");
const srcName = (f: string) => (f.endsWith(".ts") ? f + ".txt" : f);
const git = (dir: string, args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
const once = (text: string, a: string, b: string, what: string) => { const n = text.split(a).length - 1; if (n !== 1) pinErr(what + " holds " + JSON.stringify(a.slice(0, 50)) + " " + n + " times, not once"); return text.replace(a, b); };

// ---- Arm sources: regenerated from a gstack checkout at the pin (HEAD must be the pin, since two of them are what the
// pin's own gstack-settings-hook and gstack-config write when run).
export function b1bSources(gstack: string): Record<string, string> {
  if (git(gstack, ["rev-parse", "HEAD"]).stdout.trim() !== GSTACK_MAIN.sha) pinErr(gstack + " is not checked out at " + GSTACK_MAIN.sha);
  const show = (f: keyof typeof GSTACK_MAIN.blobs) => {
    const got = git(gstack, ["rev-parse", GSTACK_MAIN.sha + ":" + f]).stdout.trim();
    if (got !== GSTACK_MAIN.blobs[f]) pinErr(f + " at the pin is blob " + (got || "missing") + ", not " + GSTACK_MAIN.blobs[f]);
    return git(gstack, ["show", GSTACK_MAIN.sha + ":" + f]).stdout;
  };
  const start = show("bin/gstack-skill-start"), at = start.indexOf(ROUTING.heading);
  if (at < 0 || start.indexOf(ROUTING.heading, at + 1) >= 0) pinErr(ROUTING.file + " must hold " + JSON.stringify(ROUTING.heading) + " once");
  const end = start.indexOf(ROUTING.end, at);
  if (end < 0) pinErr(ROUTING.file + " has no " + JSON.stringify(ROUTING.end) + " after the routing block");
  const out: Record<string, string> = { "CLAUDE.md": once(start.slice(at, end) + "\n", ROUTING.bug[0], ROUTING.bug[1], "the routing block") };
  for (const { file } of HOOK_FILES) {
    let text = show(file as keyof typeof GSTACK_MAIN.blobs);
    if (file.endsWith("skill-route-hook.ts")) for (const [a, b] of HOOK_SUBSTITUTIONS) text = once(text, a, b, file);
    out["gstack/" + srcName(file)] = text;
  }
  const tmp = mkdtempSync(join(tmpdir(), "b1b-src-")), env = { ...process.env, HOME: join(tmp, "home"), GSTACK_STATE_ROOT: join(tmp, "state") };
  try {
    mkdirSync(join(tmp, "home/.claude"), { recursive: true });
    const run = (cmd: string, args: string[]) => { const r = spawnSync(join(gstack, cmd), args, { encoding: "utf8", env }); if (r.status !== 0) pinErr(cmd + " exited " + r.status + ": " + (r.stderr ?? "").slice(-200)); };
    run("bin/gstack-settings-hook", ["ensure-event", "--event", HOOK_REGISTRATION.event, "--command", HOOK_REGISTRATION.command, "--source", HOOK_REGISTRATION.source, "--timeout", String(HOOK_REGISTRATION.timeout)]);
    run("bin/gstack-config", ["set", HOOK_SWITCH.key, HOOK_SWITCH.value]);
    out["settings.json"] = readFileSync(join(tmp, "home/.claude/settings.json"), "utf8");
    out["config.yaml"] = readFileSync(join(tmp, "state/config.yaml"), "utf8");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return out;
}

// ---- The trees: B1's gstack-shaped layout, byte for byte, plus each route's own files.
export const B1B_EXTRA: Record<B1bArm, { path: string; source: string; mode: number }[]> = {
  "claude-md": [{ path: ROUTING.path, source: "b1b/CLAUDE.md", mode: 0o644 }],
  hook: [
    { path: HOOK_REGISTRATION.settings, source: "b1b/settings.json", mode: 0o600 },
    { path: HOOK_SWITCH.config, source: "b1b/config.yaml", mode: 0o644 },
    ...HOOK_FILES.map((f) => ({ path: HOOK_DIR + "/" + f.file, source: "b1b/gstack/" + srcName(f.file), mode: f.mode })),
  ],
};
export const b1bLayout = (arm: B1bArm) => [...LAYOUT["gstack-shaped"], ...B1B_EXTRA[arm]];

export function b1bBuild(out: string): Record<B1bArm, string> {
  const tars = {} as Record<B1bArm, string>;
  for (const arm of B1B_ARM_NAMES) {
    const tree = join(out, "tree", arm), tops = new Set<string>();
    rmSync(tree, { recursive: true, force: true });
    mkdirSync(join(tree, ".claude/skills"), { recursive: true });
    for (const f of b1bLayout(arm)) {
      const dest = join(tree, f.path);
      tops.add(f.path.split("/")[0]!);
      mkdirSync(join(dest, ".."), { recursive: true });
      writeFileSync(dest, readFileSync(join(REPO, ARM_SOURCES, f.source)));
      chmodSync(dest, f.mode);
    }
    for (const t of tops) spawnSync("find", [join(tree, t), "-type", "d", "-exec", "chmod", "755", "{}", "+"]);
    const tar = join(out, B1B_ARMS[arm].tar + ".tar");
    const r = spawnSync("tar", [...TAR_ARGS, "-cf", tar, "-C", tree, ...[...tops].sort()], { encoding: "utf8" });
    if (r.status !== 0) pinErr("tar for " + arm + " failed: " + r.stderr.trim());
    tars[arm] = tar;
  }
  return tars;
}

export const b1bManifestDir = () => join(REPO, "quick/laneb", B1B.armManifests);
export function b1bManifestOf(arm: B1bArm, tree: string, tar: string) {
  const w = wrappers(), g = LAYOUT["gstack-shaped"][0]!;
  const tarVersion = spawnSync("tar", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0] ?? "";
  const route = B1B_EXTRA[arm].map((f) => ({ path: f.path, sha256: sha256(readFileSync(join(tree, f.path))) }));
  const meta = { claude_code: "2.1.312", typed: false, spec: B1B_ARMS[arm].spec, steps: { sha256: w.steps_sha256, bytes: w.steps_bytes, source: AGENT_SKILLS.repo + " " + AGENT_SKILLS.sha + " " + AGENT_SKILLS.steps.file + " lines " + AGENT_SKILLS.steps.from + "-" + AGENT_SKILLS.steps.to }, carrier: { ...w.arms["gstack-shaped"]!, path: g.path }, route: { gstack: GSTACK_MAIN.sha + " (" + GSTACK_MAIN.version + ")", files: route }, tar_command: "tar " + TAR_ARGS.join(" ") + " -cf <arm>.tar <top folders> (" + tarVersion + ")" };
  return manifest(arm, tree, tar, meta);
}

/** Rebuilds both tars and compares them with the committed manifests, and checks that each tree holds every file of B1's
 *  gstack-shaped tree with its bytes and mode, plus only its route's files. */
export function b1bCheck(out = mkdtempSync(join(tmpdir(), "b1b-arms-"))): { pass: boolean; lines: string[] } {
  const lines: string[] = [], problems: string[] = [];
  const tars = b1bBuild(out);
  for (const arm of B1B_ARM_NAMES) {
    const tree = join(out, "tree", arm), f = join(b1bManifestDir(), B1B_ARMS[arm].tar + ".json");
    for (const g of LAYOUT["gstack-shaped"]) {
      const want = readFileSync(join(REPO, ARM_SOURCES, g.source)), p = join(tree, g.path);
      if (!existsSync(p) || !readFileSync(p).equals(want) || (statSync(p).mode & 0o777) !== g.mode) problems.push(arm + ": " + g.path + " is not B1's gstack-shaped file");
    }
    const files = spawnSync("find", [tree, "-type", "f"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map((p) => p.slice(tree.length + 1)).sort();
    const want = b1bLayout(arm).map((x) => x.path).sort();
    if (JSON.stringify(files) !== JSON.stringify(want)) problems.push(arm + ": the tree holds " + files.join(", ") + ", not " + want.join(", "));
    if (!existsSync(f)) { problems.push(arm + ": no committed manifest " + f); continue; }
    const m = JSON.parse(readFileSync(f, "utf8")), got = b1bManifestOf(arm, tree, tars[arm]).summary as any;
    if (got.tar.sha256 !== m.tar?.sha256) problems.push(arm + ": the rebuilt tar is sha256 " + got.tar.sha256 + ", not the manifest's " + m.tar?.sha256);
    else if (got.tree.digest !== m.tree?.digest || JSON.stringify(got.route) !== JSON.stringify(m.route)) problems.push(arm + ": the rebuilt tree or route files differ from the manifest");
    else lines.push(arm + ": tar " + got.tar.sha256 + " rebuilt byte for byte, " + got.tree.files + " files: B1's gstack-shaped " + LAYOUT["gstack-shaped"].length + " plus " + B1B_EXTRA[arm].map((x) => x.path + " (" + x.source.split("/").pop() + ")").join(", "));
  }
  for (const p of problems) lines.push("PROBLEM " + p);
  return { pass: !problems.length, lines };
}

// ---- Plan, profile and money.
const item = (capUsd: number): ItemDef => ({ capUsd, taskSet: "swerebench-r3a4", cells: MODELS.opus.cells, allowanceUsd: MODELS.opus.allowanceUsd, model: MODELS.opus.id });
export const B1B_ITEM_DEFS: Record<B1bItem, ItemDef> = { "b1b-smoke": item(B1B_CAPS_USD["b1b-smoke"]), "b1b-opus": item(B1B_CAPS_USD["b1b-opus"]) };
/** b1b-smoke: B1's two smoke tasks x both arms, one part. b1b-opus: the 60 run tasks in B1's draw order, 20 a part, both
 *  arms of a task in one part, in the seeded order L1's seeded() gives with B1's seed. */
export function b1bPlan(name: string, run: string[]): { parts: PartPlan[]; sessions: number } {
  const part = (p: string, rects: Rect[]): PartPlan => ({ name: p, prefix: prefixOf(name, p), rects: seeded(rects, B1.seed) });
  const arms = [...B1B_ARM_NAMES];
  let parts: PartPlan[];
  if (name === "b1b-smoke") parts = [part("smoke-opus", [{ tasks: [...SMOKE_TASKS], arms, attempts: 1 }])];
  else if (name === "b1b-opus") parts = Array.from({ length: Math.ceil(run.length / 20) }, (_, i) => part("b1b-" + (i + 1), [{ tasks: run.slice(i * 20, i * 20 + 20), arms, attempts: 1 }]));
  else return usage("unknown item " + name + "; one of " + B1B_ITEMS.join(", "));
  return { parts, sessions: parts.flatMap((p) => [...plannedCells(p).values()]).reduce((a, b) => a + b, 0) };
}
export const B1B_PROFILE: Profile = {
  items: B1B_ITEM_DEFS,
  armSpecs: Object.fromEntries(B1B_ARM_NAMES.map((a) => [a, B1B_ARMS[a].spec])),
  tars: B1B_ARM_NAMES.map((a) => B1B_ARMS[a].tar),
  armManifests: B1B.armManifests,
  hostRoot: B1B.hostRoot,
  ledgerPort: B1B.ledgerPort,
  seed: B1.seed,
  concurrent: B1.concurrent,
  taskSetup: TASK_SETUP,
  attempt2: { skip: () => null, owed: (runs) => { const rows = runs.flatMap((r) => { const c = pulledInputs(r.dir, r.part); return c.jobs.length ? buildB1bTable(c) : []; }); return { owed: rows.filter(needsRerun).map((r) => ({ task: r.task, arm: r.arm, reason: r.reason })), rects: infraRerun(rows).rects }; } },
  parts: (name, _frozen, inputs) => {
    const b = loadBundle();
    for (const [f, d] of b.digests) inputs[f] = d;
    for (const [f, d] of frontMatterDigests(readFileSync(join(REPO, B1B_BUNDLE, "README.md"), "utf8"))) inputs["b1b/" + f] = d;
    return b1bPlan(name, drawnTasks(b).run).parts;
  },
};

/** A part's planned model spend at the planning rate and its part VM's 4-hour blocks. */
export function partProjection(p: PartPlan) {
  const sessions = [...plannedCells(p).values()].reduce((a, b) => a + b, 0);
  return { sessions, model: toMicros(sessions * B1B.rateUsd), vm: toMicros(Math.max(1, Math.ceil((sessions * VM_HOURS_PER_SESSION) / Number(L1.vm.reserveHours))) * blockUsd) };
}
const parallelUsd = () => B1.concurrent * MODELS.opus.allowanceUsd;
/** B1's cap formula: ceil10(1.35 x expected model spend + concurrent x the allowance + VM share). The parallel term is there
 *  because Lane B's metering proxy reserves each open session's whole allowance as it opens, up to six at once, and latches
 *  a cap stop on the first reserve the ledger refuses. */
export function b1bCap(name: B1bItem) {
  const parts = b1bPlan(name, drawnTasks(loadBundle()).run).parts, proj = parts.map(partProjection);
  const expected = fromMicros(proj.reduce((x, p) => x + p.model, 0));
  const vm = fromMicros(proj.reduce((x, p) => x + p.vm, 0)) + hostTtlHours(parts.length) * L1.host.usdPerHour;
  return { parts, expected, parallel: parallelUsd(), vm, cap: Math.ceil((1.35 * expected + parallelUsd() + vm) / 10) * 10 };
}

export function b1bApprove(path: string, name: string, capUsd: number, by: string) {
  if (!isB1bItem(name)) return usage("b1b approve: unknown item " + name + "; one of " + B1B_ITEMS.join(", "));
  if (!by.trim()) usage("b1b approve: --approved-by names who recorded the cap");
  if (toMicros(capUsd) !== toMicros(B1B_CAPS_USD[name])) usage("refused: " + name + "'s recorded cap is $" + B1B_CAPS_USD[name] + ", not $" + capUsd);
  if (readRows(path).length) usage("refused: " + path + " already holds rows; an item's ledger starts with its approval row");
  new Ledger(path, name).approve(capUsd, { approved_by: by, source: "B1b prose route prereg: the cap recorded for " + name });
  itemCheck(readRows(path), name, B1B_CAPS_USD[name]);
}
const VM_ID = /(^|\/)vm(-\d+)?$|^host-\d+$/;
export function b1bTotals(rows: Row[], name: B1bItem) {
  const t = { cap: toMicros(B1B_CAPS_USD[name]), settled: 0, open: 0, openIds: [] as string[], done: rows.some((r) => r.kind === "note" && r.id === "done"), vmSettled: 0, vmOpen: 0, hostOpen: false };
  if (!rows.length) return t;
  const approval = rows.find((r) => r.kind === "approval");
  if (!approval || approval.item !== name || approval.usd_micros !== t.cap) usage("refused: the ledger for " + name + " does not open with its approval row at $" + B1B_CAPS_USD[name]);
  const reserved = new Map<string, number>(), settled = new Map<string, number>();
  for (const r of rows) { if (r.kind === "reserve") reserved.set(r.id, r.usd_micros); if (r.kind === "settle") settled.set(r.id, r.usd_micros); }
  for (const [id, v] of settled) { t.settled += v; if (VM_ID.test(id)) t.vmSettled += v; }
  for (const [id, v] of reserved) { if (settled.has(id)) continue; t.open += v; t.openIds.push(id); if (VM_ID.test(id)) t.vmOpen += v; if (/^host-\d+$/.test(id)) t.hostOpen = true; }
  return t;
}
export function b1bDone(path: string, name: B1bItem) {
  const t = b1bTotals(readRows(path), name);
  if (t.done) usage("refused: " + name + " is marked done already");
  if (t.openIds.length) usage("refused: " + name + " still holds " + t.openIds.length + " open reservations; settle them first");
  appendRow(path, { ts: new Date().toISOString(), item: name, kind: "note", id: "done", usd_micros: 0 });
}
/** The launch guard: the item's spend so far plus its unfinished parts at planned spend, the parallel reserve and the VM
 *  share, against its cap; and every item (a done item at its settled spend, any other at the larger of its spend and its
 *  projection) plus the crew's counter, against the $250 all-in stop. */
export function b1bGuard(name: B1bItem, ledgers: Partial<Record<B1bItem, Row[]>>, plans: Partial<Record<B1bItem, { parts: PartPlan[]; finished: string[] }>>, crewUsd: number) {
  const why: string[] = [];
  const all = B1B_ITEMS.map((i) => {
    const t = b1bTotals(ledgers[i] ?? [], i), plan = plans[i] ?? { parts: b1bPlan(i, drawnTasks(loadBundle()).run).parts, finished: [] };
    const left = plan.parts.filter((p) => !plan.finished.includes(p.name)), proj = left.map(partProjection);
    const model = t.settled - t.vmSettled + t.open - t.vmOpen + proj.reduce((x, p) => x + p.model, 0) + (left.length ? toMicros(parallelUsd()) : 0);
    const host = !t.hostOpen && left.length ? toMicros(hostTtlHours(left.length) * L1.host.usdPerHour) : 0;
    const total = model + t.vmSettled + t.vmOpen + host + proj.reduce((x, p) => x + p.vm, 0);
    return { item: i, ...t, total, left: left.length, counted: t.done ? t.settled : Math.max(t.settled + t.open, total) };
  });
  const own = all.find((x) => x.item === name)!, usd = (m: number) => "$" + fromMicros(m).toFixed(2);
  if (own.done) why.push(name + " is marked done; a done item never launches again");
  if (own.total > own.cap) why.push(name + "'s projection " + usd(own.total) + " passes its cap " + usd(own.cap));
  const sum = all.reduce((x, i) => x + i.counted, 0) + toMicros(crewUsd), stop = toMicros(B1B.stopUsd);
  if (sum > stop) why.push("all-in " + usd(sum) + " passes the " + usd(stop) + " stop");
  const lines = ["B1B_LAUNCH " + (why.length ? "REFUSE" : "PASS") + " " + name + ": all-in " + usd(sum) + " of " + usd(stop) + "; " + name + " " + usd(own.total) + " of cap " + usd(own.cap) + " (" + own.left + " parts to run)", ...all.map((i) => "  " + i.item + (i.done ? " done" : "") + ": settled " + usd(i.settled) + ", open " + usd(i.open) + ", counted " + usd(i.counted)), "  crew " + usd(toMicros(crewUsd))];
  return { ok: !why.length, why, lines };
}

// ---- The none arm's reuse: the trees that decide what a session gets, at B1's run commit and at B1b's.
export function reuseCheck(head: string, repo = REPO): { same: boolean; lines: string[] } {
  const lines: string[] = [];
  let same = true;
  for (const p of B1_RUN.harness) {
    const a = git(repo, ["rev-parse", B1_RUN.commit + ":" + p]).stdout.trim(), b = git(repo, ["rev-parse", head + ":" + p]).stdout.trim();
    const ok = !!a && a === b;
    same &&= ok;
    lines.push((ok ? "SAME " : "DIFFERENT ") + p + " " + (a || "missing") + (ok ? "" : " at " + B1_RUN.commit.slice(0, 12) + ", " + (b || "missing") + " at " + head.slice(0, 12)));
  }
  lines.push("REUSE " + (same ? "PASS" : "FAIL") + ": B1's run " + B1_RUN.commit.slice(0, 12) + " and " + head.slice(0, 12) + "; model " + MODELS.opus.id + " on both");
  return { same, lines };
}
/** The checkout's uncommitted changes to any path that decides a session: L1's host-up syncs the live quick/laneb folder. */
export function harnessDirty(repo = REPO): string[] {
  const r = git(repo, ["status", "--porcelain", "--", ...B1_RUN.harness]);
  if (r.status !== 0) pinErr("git status failed in " + repo + ": " + (r.stderr ?? "").trim());
  return r.stdout.split("\n").filter(Boolean);
}

// ---- Session rows: did the skill load, did the hook line arrive, and why a graded session didn't load.
const SKILL_MD = "/.claude/skills/" + SKILL + "/SKILL.md";
const skillLines = () => readFileSync(join(REPO, ARM_SOURCES, "gstack-shaped-SKILL.md"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l.length >= 40);
const blocksOf = (r: Rec): any[] => (Array.isArray(r.content) ? r.content : []);
const resultText = (b: any): string => (typeof b?.content === "string" ? b.content : Array.isArray(b?.content) ? b.content.map((x: any) => x?.text ?? "").join("\n") : "");
export type Load = { loaded: boolean; via: "Skill" | "Read" | "Bash" | null; at_call: number | null; failed: number; named: boolean; first_text: string };
/** A load is a Skill call naming the skill whose result is not an error, a Read of its SKILL.md that did not error, or a Bash
 *  call naming its SKILL.md whose result holds a line of that file (40 characters or more). A load-shaped call that fails
 *  those tests counts as failed. named: the skill's name appears in the model's text or in any other tool input. */
export function loadsOf(recs: Rec[]): Load {
  const calls: { id: string; name: string; input: any; n: number }[] = [], results = new Map<string, any>();
  let first = "", named = false, n = 0;
  for (const r of recs) for (const b of blocksOf(r)) {
    if (r.type === "AssistantMessage" && typeof b?.text === "string") { if (!first && b.text.trim()) first = b.text.replace(/\s+/g, " ").trim().slice(0, 200); if (b.text.includes(SKILL)) named = true; }
    else if (r.type === "AssistantMessage" && typeof b?.name === "string" && typeof b?.id === "string") calls.push({ id: b.id, name: b.name, input: b.input ?? {}, n: ++n });
    else if (r.type === "UserMessage" && typeof b?.tool_use_id === "string") results.set(b.tool_use_id, b);
  }
  const lines = skillLines();
  const shaped = (c: (typeof calls)[number]) => (c.name === "Skill" && String(c.input.skill ?? "").replace(/^\//, "") === SKILL) || (c.name === "Read" && String(c.input.file_path ?? "").replace(/^~/, "/root").endsWith(SKILL_MD)) || (c.name === "Bash" && String(c.input.command ?? "").includes(".claude/skills/" + SKILL + "/SKILL.md"));
  const works = (c: (typeof calls)[number]) => { const res = results.get(c.id); if (!res || res.is_error) return false; return c.name !== "Bash" || lines.some((l) => resultText(res).includes(l)); };
  let load: (typeof calls)[number] | undefined, failed = 0;
  for (const c of calls) {
    if (shaped(c)) { if (works(c)) { load ??= c; } else failed++; }
    else if (JSON.stringify(c.input).includes(SKILL)) named = true;
  }
  return { loaded: !!load, via: (load?.name as Load["via"]) ?? null, at_call: load?.n ?? null, failed, named, first_text: first };
}

export type B1bRow = B1Row & { arm: B1bArm; load: Load; route_mark: boolean | "quoted" | null; route_logged: boolean | null; why_not: string | null };
export const WHY_NOT = ["line not delivered", "load failed", "named, not loaded", "never named"] as const;
/** The reason a graded session didn't load, first that applies: the hook line never reached the first request (hook arm,
 *  by the proxy's reading), a load-shaped call failed, the model named the skill and didn't load it, or it never named it. */
export function whyNot(arm: B1bArm, outcome: B1Row["outcome"], load: Load, mark: B1bRow["route_mark"]): string | null {
  if (outcome !== "graded" || load.loaded) return null;
  if (arm === "hook" && mark !== true) return WHY_NOT[0];
  return load.failed ? WHY_NOT[1] : load.named ? WHY_NOT[2] : WHY_NOT[3];
}
export function b1bRow(dir: string, ctx: Parameters<typeof b1Row>[1]): B1bRow | null {
  const row = b1Row(dir, { ...ctx, arms: B1B_ARM_NAMES });
  if (!row || !isB1bArm(row.arm)) return null;
  const msgs = join(dir, "evaluator", "sdk-messages.jsonl"), load = loadsOf(existsSync(msgs) ? parseLog(readFileSync(msgs, "utf8")) : []);
  const last: any = ctx.sessions.get(row.trial)?.at(-1), mark = last ? (last.route_mark_before_output ?? false) : null;
  const log = join(dir, "evaluator", "gstack-hooks", "hooks", "skill-route.log");
  const logged = row.arm === "hook" ? existsSync(log) && /\bevent=routed\b/.test(readFileSync(log, "utf8")) : null;
  return { ...row, arm: row.arm, load, route_mark: mark, route_logged: logged, why_not: whyNot(row.arm, row.outcome, load, mark) };
}
export function buildB1bTable(cfg: B1TableConfig): B1bRow[] {
  const sessions = sessionsByTrial(readSessionRows(cfg.sessions)), out: B1bRow[] = [];
  for (const job of cfg.jobs) for (const name of readdirSync(job.dir).sort()) {
    const d = join(job.dir, name);
    if (!statSync(d).isDirectory()) continue;
    const row = b1bRow(d, { part: job.part ?? null, sessions, home: cfg.home ?? "/root" });
    if (row) out.push(row);
  }
  return out;
}

// ---- Report.
type Stat = { arm: B1bArm; planned: number; graded: number; gaps: number; cap_stops: number; incomplete: boolean; loaded: number; ci: [number, number] | null; reaches: boolean; steps_seen: number; followed: number; followed_ci: [number, number] | null; followed_as_merged: number; followed_loaded: number; route_marked: number; route_logged: number; passes: number; cost_usd: number; safety_stops: number; audit_sessions: number; why: Record<string, number> };
export function b1bStats(rows: B1bRow[], planned: number): Stat[] {
  const capped = rows.some((r) => r.outcome === "cap_stop");
  return B1B_ARM_NAMES.map((arm) => {
    const all = rows.filter((r) => r.arm === arm), g = all.filter((r) => r.outcome === "graded"), k = g.filter((r) => r.load.loaded).length, f = g.filter((r) => r.detect.followed).length;
    const gaps = planned - g.length, incomplete = capped || gaps > maxGaps(planned);
    return {
      arm, planned, graded: g.length, gaps, cap_stops: all.filter((r) => r.outcome === "cap_stop").length, incomplete, loaded: k, ci: g.length ? wilson(k, g.length) : null, reaches: !incomplete && k >= barCount(g.length),
      steps_seen: g.filter((r) => r.steps_seen).length, followed: f, followed_ci: g.length ? wilson(f, g.length) : null, followed_as_merged: g.filter((r) => r.detect.followed_as_merged).length, followed_loaded: g.filter((r) => r.load.loaded && r.detect.followed).length,
      route_marked: g.filter((r) => r.route_mark === true).length, route_logged: g.filter((r) => r.route_logged === true).length, passes: g.filter((r) => r.pass).length,
      cost_usd: all.reduce((x, r) => x + (r.cost_usd ?? 0), 0), safety_stops: all.filter((r) => r.safety_stop).length, audit_sessions: all.filter((r) => r.audit_hits.length).length,
      why: Object.fromEntries(WHY_NOT.map((w) => [w, g.filter((r) => r.why_not === w).length])),
    };
  });
}
type Pick = (r: { outcome: string; task: string }) => boolean | undefined;
/** Paired contrast of a minus b on the tasks graded in both, with Newcombe's method 10. */
export function paired(a: { task: string; outcome: string }[], b: { task: string; outcome: string }[], pa: Pick, pb: Pick) {
  const B = new Map(b.filter((r) => r.outcome === "graded").map((r) => [r.task, !!pb(r)]));
  let both = 0, aOnly = 0, bOnly = 0, neither = 0;
  for (const r of a) { if (r.outcome !== "graded" || !B.has(r.task)) continue; const x = !!pa(r), y = B.get(r.task)!; if (x && y) both++; else if (x) aOnly++; else if (y) bOnly++; else neither++; }
  return { pairs: both + aOnly + bOnly + neither, both, a_only: aOnly, b_only: bOnly, neither, ...newcombe(both, aOnly, bOnly, neither) };
}
export type B1bReading = { key: "incomplete" | "both" | "hook" | "claude-md" | "neither" | "not-shown"; text: string };
export const READINGS: Record<Exclude<B1bReading["key"], "incomplete">, string> = {
  both: "both prose routes load the skill: gstack keeps CLAUDE.md routing as the default and leaves its prompt-routing hook, destructive-command check and start hook opt-in",
  hook: "only the hook line loads the skill: gstack turns on its prompt-routing hook, destructive-command check and start hook by default for OpenClaw and Hermes, and stops relying on CLAUDE.md routing",
  "claude-md": "only CLAUDE.md loads the skill: gstack keeps CLAUDE.md routing as the default, leaves the three hooks opt-in, and the hook line's wording goes to FIX-METHOD",
  neither: "neither prose route loads the skill: gstack launches skills only by typed command",
  "not-shown": "one route reaches the bar and the other doesn't, but their paired difference's interval includes 0: not shown, so gstack changes nothing (CLAUDE.md routing stays as offered and the three hooks stay opt-in)",
};
/** The decision table, read on loads: an arm reaches the bar at ceil(0.8 x graded); a reading that rests on one route
 *  beating the other also needs that paired difference's 95% interval above 0. */
export function b1bReading(stats: Stat[], hookMinusClaude: { lo: number; hi: number }): B1bReading {
  if (stats.some((s) => s.incomplete)) return { key: "incomplete", text: "INCOMPLETE: " + stats.filter((s) => s.incomplete).map((s) => s.arm + " (" + s.gaps + " of " + s.planned + " ungraded, " + s.cap_stops + " cap stops)").join("; ") + "; no reading" };
  const H = stats.find((s) => s.arm === "hook")!.reaches, C = stats.find((s) => s.arm === "claude-md")!.reaches;
  const key = H && C ? "both" : H ? (hookMinusClaude.lo > 0 ? "hook" : "not-shown") : C ? (hookMinusClaude.hi < 0 ? "claude-md" : "not-shown") : "neither";
  return { key, text: READINGS[key] };
}

const pct = (x: number, n: number) => (n ? ((100 * x) / n).toFixed(1) + "%" : "n/a");
const ci = (c: [number, number] | null) => (c ? " [" + (100 * c[0]).toFixed(1) + ", " + (100 * c[1]).toFixed(1) + "]" : "");
const pts = (x: number) => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
/** B1's published Opus rows, checked against its results bundle's front matter. */
export function b1References(): B1Row[] {
  const dir = join(REPO, B1_RUN.results), want = frontMatterDigests(readFileSync(join(dir, "README.md"), "utf8")).get("sessions.jsonl");
  const text = readFileSync(join(dir, "sessions.jsonl"));
  if (sha256(text) !== want) pinErr(B1_RUN.results + "/sessions.jsonl hashes to " + sha256(text) + ", not its front matter's " + want);
  return text.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as B1Row).filter((r) => r.model === MODELS.opus.id);
}
export function b1bReport(rows: B1bRow[], refs: B1Row[] = b1References(), planned: number = B1.tasks, smoke = false) {
  const stats = b1bStats(rows, planned), arm = (a: string) => rows.filter((r) => r.arm === a), ref = (a: string) => refs.filter((r) => r.arm === a);
  const loaded: Pick = (r: any) => r.load?.loaded, followed: Pick = (r: any) => r.detect?.followed;
  const hc = paired(arm("hook"), arm("claude-md"), loaded, loaded), reading = smoke ? null : b1bReading(stats, hc);
  const lines = ["== " + MODELS.opus.id + ", B1b prose routes (" + planned + " tasks an arm)"];
  for (const s of stats) lines.push("  " + s.arm + ": loaded " + s.loaded + "/" + s.graded + " " + pct(s.loaded, s.graded) + ci(s.ci) + (s.reaches ? " REACHES" : "") + (s.incomplete ? " INCOMPLETE" : "") + "; steps seen " + s.steps_seen + ", followed " + s.followed + "/" + s.graded + ci(s.followed_ci) + " (as merged " + s.followed_as_merged + "), followed among loaded " + s.followed_loaded + "/" + s.loaded + "; gaps " + s.gaps + ", cap stops " + s.cap_stops + ", safety stops " + s.safety_stops + ", audit " + s.audit_sessions + (s.arm === "hook" ? ", hook line in the first request " + s.route_marked + " (proxy), routed in the hook's log " + s.route_logged : "") + ", passes " + s.passes + " (descriptive), cost $" + s.cost_usd.toFixed(2) + " ($" + (s.graded ? s.cost_usd / s.graded : 0).toFixed(3) + " a graded session)");
  for (const s of stats) lines.push("  " + s.arm + " not loaded, by reason: " + WHY_NOT.map((w) => w + " " + s.why[w]).join(", "));
  const c = (name: string, x: ReturnType<typeof paired>) => "  " + name + ": " + pts(x.diff) + " points [" + pts(x.lo) + ", " + pts(x.hi) + "] on " + x.pairs + " paired tasks (" + x.a_only + " vs " + x.b_only + " discordant)";
  lines.push(c("loaded, hook - claude-md", hc), c("followed, hook - claude-md", paired(arm("hook"), arm("claude-md"), followed, followed)));
  for (const r of ["none", "gstack-shaped", "command"]) {
    const g = ref(r).filter((x) => x.outcome === "graded");
    lines.push("  reference, B1 " + r + (r === "none" ? " (reused no-gstack arm)" : " (typed, descriptive)") + ": followed " + g.filter((x) => x.detect.followed).length + "/" + g.length + ", steps seen " + g.filter((x) => x.steps_seen).length);
    for (const a of B1B_ARM_NAMES) lines.push(c("followed, " + a + " - B1 " + r, paired(arm(a), ref(r), followed, followed)));
  }
  if (reading) lines.push("  reading: " + reading.text);
  return { lines, stats, reading, hook_minus_claude_md: hc };
}
export function checkB1bRows(rows: B1bRow[], tasks: string[]): string[] {
  const bad: string[] = [], seen = new Set<string>();
  for (const r of rows) {
    if (!tasks.includes(r.task)) bad.push(r.trial + " is task " + r.task + ", not one of the planned tasks");
    if (r.model !== MODELS.opus.id) bad.push(r.trial + " ran " + r.model + ", not " + MODELS.opus.id);
    if (r.outcome !== "graded") continue;
    const k = r.arm + " " + r.task;
    if (seen.has(k)) bad.push("two graded rows for " + k);
    seen.add(k);
  }
  return bad;
}
export const reasonsTsv = (rows: B1bRow[]) => ["arm\ttask\ttrial\toutcome\treason\tload_failed\tnamed\tfirst_text", ...rows.filter((r) => r.why_not || r.outcome !== "graded").sort((a, b) => (a.arm + a.task).localeCompare(b.arm + b.task)).map((r) => [r.arm, r.task, r.trial, r.outcome, r.why_not ?? r.reason, r.load.failed, r.load.named, r.load.first_text.replace(/\t/g, " ")].join("\t"))].join("\n") + "\n";

// ---- The route table: B1's prompt for each of the 62 tasks, the hook as shipped, gstack's scorer, and the arm's hook line.
export const promptOf = (instruction: string) => { const p = readFileSync(join(REPO, "quick/laneb/runner/prompt-wrapper.md"), "utf8").replace("{instruction}", instruction); return p + (p.endsWith("\n") ? "\n" : "\n\n") + CLOSING.text + "\n"; };
export async function routeTable(exportDir: string, tree: string): Promise<string> {
  const lib = await import(join(tree, HOOK_DIR, "lib/skill-route.ts"));
  const { skills } = lib.scanInstalledSkills(join(tree, ".claude/skills"));
  const t = drawnTasks(loadBundle()), out = ["kind\ttask\tprompt_sha256\tchars\tas_shipped\tbest_score\tbest_trigger\troutable_if_listed\tline_trigger\tline_sha256"];
  for (const [kind, list] of [["run", t.run], ["smoke", t.smoke]] as const) for (const task of list) {
    const prompt = promptOf(readFileSync(join(exportDir, task, "instruction.md"), "utf8")), shipped = lib.routePrompt(prompt, skills), best = lib.scorePrompt(prompt, skills).find((x: any) => x.skill === SKILL);
    const r = spawnSync("bash", [join(tree, HOOK_REGISTRATION.command.replace(/^\/root\//, ""))], { input: JSON.stringify({ session_id: "b1b-route-" + task.slice(0, 40).replace(/[^\w-]/g, "-"), prompt }), encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: tree } });
    const line = (JSON.parse(r.stdout || "{}").hookSpecificOutput?.additionalContext ?? "") as string;
    const cited = /matched the installed \/[\w-]+ trigger "([^"]*)"/.exec(line)?.[1] ?? "";
    if (!line.includes("this request fits /" + SKILL + ". Run /" + SKILL + " with the Skill tool before you start")) pinErr(task + ": the hook printed no line naming /" + SKILL + " (" + (r.stderr || r.stdout).slice(0, 200) + ")");
    out.push([kind, task, sha256(prompt), prompt.length, shipped.route ? "routed " + shipped.route.skill : shipped.reason, best ? best.score : 0, best ? best.trigger : "", !!best && best.score >= lib.ROUTE_THRESHOLD && prompt.length <= lib.PROMPT_MAX_CHARS, cited, sha256(line)].join("\t"));
  }
  return out.join("\n") + "\n";
}

// ---- Keyless scripted sessions in the real Claude Code image against the stub model (fake-model.ts), as B1's are.
export const B1B_CASES: { name: string; arm: B1bArm; mode: "stop" | "load" }[] = [
  { name: "claude-md-stop", arm: "claude-md", mode: "stop" },
  { name: "claude-md-load", arm: "claude-md", mode: "load" },
  { name: "hook-stop", arm: "hook", mode: "stop" },
  { name: "hook-load", arm: "hook", mode: "load" },
];
export type B1bCaptured = { sdk: string; listing: string | null; user: string[]; hook_context: string[]; loaded: string | null; gstack_files: number | null; hook_log: string | null };
export function loadB1bCaptured(dir: string): B1bCaptured {
  const j = JSON.parse(existsSync(join(dir, "capture.json")) ? readFileSync(join(dir, "capture.json"), "utf8") : "{}");
  return { sdk: existsSync(join(dir, "sdk-messages.jsonl")) ? readFileSync(join(dir, "sdk-messages.jsonl"), "utf8") : "", listing: j.listing ?? null, user: j.user ?? [], hook_context: j.hook_context ?? [], loaded: j.loaded ?? null, gstack_files: j.gstack_files ?? null, hook_log: j.hook_log ?? null };
}
export const B1B_GSTACK_FILES: Record<B1bArm, number> = { "claude-md": 4, hook: 5 };
/** Every assertion on one B1b session; empty means the arm delivered what the prereg says. */
export function b1bCaseProblems(c: (typeof B1B_CASES)[number], cap: B1bCaptured): string[] {
  const p: string[] = [], want = (what: string, ok: boolean) => { if (!ok) p.push(c.name + ": " + what); };
  const recs = parseLog(cap.sdk);
  if (!recs.length || cap.listing === null || !cap.user.length) return [c.name + ": no session"];
  const steps = readFileSync(join(REPO, ARM_SOURCES, "steps.md"), "utf8"), first = cap.user.join("\n"), block = readFileSync(join(SRC, "CLAUDE.md"), "utf8");
  const names = [...cap.listing.matchAll(/^- ([\w:-]+): /gm)].map((m) => m[1]!).sort();
  want("the listing names " + names.join(", "), JSON.stringify(names) === JSON.stringify([SKILL, ...CLAUDE_LISTED].sort()));
  want("the prompt is typed", !first.includes("<command-name>/"));
  want("the step text reached the first request", !first.includes(steps) && !cap.hook_context.some((h) => h.includes(steps)));
  want("the container holds " + cap.gstack_files + " gstack files, not " + B1B_GSTACK_FILES[c.arm], cap.gstack_files === B1B_GSTACK_FILES[c.arm]);
  if (c.arm === "claude-md") {
    want("the first request does not hold the routing block", first.includes(block.trimEnd()));
    want("a hook line reached a claude-md session", !cap.hook_context.length);
  } else {
    want("the first request does not carry one hook line naming /" + SKILL, cap.hook_context.length === 1 && cap.hook_context[0]!.startsWith(ROUTE_MARK) && cap.hook_context[0]!.includes("this request fits /" + SKILL + ". Run /" + SKILL + " with the Skill tool before you start"));
    want("the routing block reached a hook session", !first.includes("## Skill routing"));
    want("the hook's log does not say routed", /\bevent=routed\b/.test(cap.hook_log ?? "") && new RegExp("\\bskill=" + SKILL + "\\b").test(cap.hook_log ?? ""));
  }
  const l = loadsOf(recs);
  if (c.mode === "load") {
    const body = readFileSync(join(REPO, ARM_SOURCES, "gstack-shaped-SKILL.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n\n?/, "");
    want("the Skill load is not the base line and the gstack-shaped body", cap.loaded === BASE(SKILL) + body);
    want("loadsOf does not read a Skill load", l.loaded && l.via === "Skill");
  } else want("loadsOf reads a load in a session that made none (" + JSON.stringify(l) + ")", !l.loaded && whyNot(c.arm, "graded", l, true) === "never named");
  return p;
}
const docker = (args: string[], input?: string, timeout = 600_000) => spawnSync("docker", args, { input, encoding: "utf8", timeout, maxBuffer: 64 << 20 });
const RESET = ["set -e", "mkdir -p /testbed", "cd /testbed", "printf 'def add(a, b):\\n    return a - b\\n' > calc.py", "git init -q && git add -A && git -c user.name=b1 -c user.email=b1@example.invalid commit -qm snapshot"].join("\n");
const GSTACK_FILES = 'find / -xdev \\( -path /proc -o -path /sys \\) -prune -o -iname "*gstack*" ! -iname "*sigstack*" -print 2>/dev/null | wc -l; find / -xdev -maxdepth 3 -type d -name .capy 2>/dev/null | wc -l';
export async function runB1bSessions(out: string) {
  mkdirSync(out, { recursive: true });
  const py = sdkPython(), reqLog = join(out, "requests.jsonl"), bodyLog = join(out, "bodies.jsonl");
  rmSync(reqLog, { force: true }); rmSync(bodyLog, { force: true });
  const fake = Bun.spawn(["bun", join(import.meta.dir, "fake-model.ts"), "0", reqLog, bodyLog], { stdout: "pipe", stderr: "inherit" });
  const head = new TextDecoder().decode((await fake.stdout.getReader().read()).value ?? new Uint8Array());
  const port = /127\.0\.0\.1:(\d+)/.exec(head)?.[1], problems: string[] = [], ran: { c: (typeof B1B_CASES)[number]; files: number | null }[] = [];
  try {
    if (!port) pinErr("the stub model did not start: " + head.slice(0, 200));
    for (const c of B1B_CASES) {
      const name = "b1b-sessions-" + c.name + "-" + process.pid, dir = join(out, c.name), trial = join(dir, "trial");
      rmSync(dir, { recursive: true, force: true }); mkdirSync(trial, { recursive: true });
      const up = docker(["run", "-d", "--name", name, "--network", "host", "--cap-drop", "NET_RAW", "--cap-drop", "NET_ADMIN", SESSION_IMAGE, "sleep", "infinity"]);
      if (up.status !== 0) { problems.push(c.name + ": container did not start: " + up.stderr.trim().slice(-200)); continue; }
      try {
        if (docker(["exec", "-i", name, "sh", "-s"], RESET).status !== 0) { problems.push(c.name + ": reset failed"); continue; }
        const spec = { case: c.name, arm: c.arm, tar: join(ARMS_DIR(), B1B_ARMS[c.arm].tar + ".tar"), strip: true, told: "", container: name, base_url: "http://127.0.0.1:" + port, instruction: "[b1-session " + c.name + "] [b1-script " + c.mode + "] add() in calc.py returns the difference of its arguments. Make it return their sum.", out: trial };
        const r = spawnSync(py, [join(REPO, "lanes/harness-mechanics/sessions-driver.py"), JSON.stringify(spec)], { encoding: "utf8", timeout: 400_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PYTHONPATH: join(REPO, "quick/laneb/runner/agent") } });
        writeFileSync(join(dir, "driver.log"), (r.stdout ?? "") + (r.stderr ?? ""));
        if (r.status !== 0) { problems.push(c.name + ": driver exited " + r.status + " (" + join(dir, "driver.log") + ")"); continue; }
        const counts = (docker(["exec", name, "sh", "-c", GSTACK_FILES]).stdout ?? "").trim().split("\n").map(Number);
        if (counts[1] !== 0) problems.push(c.name + ": the container holds a .capy folder");
        const log = docker(["exec", name, "sh", "-c", "cat /root/.gstack/hooks/skill-route.log 2>/dev/null | sed 's/session=[^ ]*/session=<id>/'"]).stdout ?? "";
        writeFileSync(join(dir, "hook.log"), log);
        ran.push({ c, files: Number.isFinite(counts[0]) ? counts[0]! : null });
      } finally { docker(["rm", "-f", name]); }
    }
    await Bun.sleep(300);
    const bodies = (existsSync(bodyLog) ? readFileSync(bodyLog, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const texts = (m: any): string[] => (typeof m?.content === "string" ? [m.content] : (m?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text));
    for (const { c, files } of ran) {
      const mine = bodies.filter((b) => b.session === c.name), dest = join(out, c.name, "capture");
      mkdirSync(dest, { recursive: true });
      cpSync(join(out, c.name, "trial", "evaluator", "sdk-messages.jsonl"), join(dest, "sdk-messages.jsonl"));
      const sys = mine[0] ? texts(mine[0].messages.find((m: any) => m.role === "system")).join("") : "", at = sys.indexOf(LISTING);
      const hook = sys.split(ROUTE_CONTEXT.slice(0, -ROUTE_MARK.length)).slice(1).map((s: string) => s.split("\n")[0]!);
      let loaded: string | null = null;
      for (const b of mine) { const i = b.messages.findIndex((m: any) => m.role === "user" && Array.isArray(m.content) && m.content.some((x: any) => x.type === "tool_result" && /^Launching skill: /.test(String(x.content)))); if (i >= 0) { loaded = texts(b.messages[i]).join("\n"); break; } }
      const cap = { listing: at < 0 ? null : sys.slice(at, sys.indexOf("\n\n", at + LISTING.length) + 1), user: mine[0] ? texts(mine[0].messages.find((m: any) => m.role === "user")) : [], hook_context: hook, loaded, gstack_files: files, hook_log: readFileSync(join(out, c.name, "hook.log"), "utf8") || null, requests: mine.length };
      writeFileSync(join(dest, "capture.json"), JSON.stringify(cap, null, 2) + "\n");
      problems.push(...b1bCaseProblems(c, loadB1bCaptured(dest)));
    }
  } finally { fake.kill(); }
  writeFileSync(join(out, "sessions.json"), JSON.stringify({ cases: B1B_CASES.map((c) => c.name), problems }, null, 2) + "\n");
  return problems;
}

// ---- CLI.
const USAGE = "usage: b1b arms sources --gstack <checkout> [--check] | arms build [--out <dir>] [--manifests] | arms check | sessions run --out <dir> [--cut <dir>] | routes --export <swe-rebench export> [--out <tsv>] | plan | reuse [--head <commit>] | approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who> | done --ledger <jsonl> --item <item> | guard <work> | prepare <work> --item <item> | host-up|attach|recover|host-down <work> | launch|relaunch|rerun <work> --part <part> | table <config.json> <out.jsonl> | report <table.jsonl> [--out <dir>]";
const LAUNCHER = ["prepare", "host-up", "launch", "attach", "relaunch", "rerun", "recover", "host-down"], GUARDED = ["host-up", "launch", "relaunch"];
function guardWork(work: string, relaunching?: string) {
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  if (!isB1bItem(plan.item)) return usage("b1b launch guard: " + work + " plans " + plan.item + ", not a B1b item");
  const reuse = reuseCheck(plan.git_head);
  for (const l of reuse.lines) console.log(l);
  if (!reuse.same) throw new Error("E_B1_LAUNCH " + plan.item + ": the run commit's harness differs from B1's, so B1's none arm can't be reused; take it to the Captain before launching");
  const live = reuseCheck("HEAD");
  if (!live.same) throw new Error("E_B1_LAUNCH " + plan.item + ": the checkout's head differs from B1's harness (" + live.lines.filter((l) => l.startsWith("DIFFERENT ")).join("; ") + "); take it to the Captain before launching");
  const dirty = harnessDirty();
  if (dirty.length) throw new Error("E_B1_LAUNCH " + plan.item + ": the checkout holds uncommitted changes to harness paths (" + dirty.join("; ") + "); take it to the Captain before launching");
  const dir = process.env.B1B_LEDGERS ?? "", crewPath = process.env.B1B_CREW ?? "", own = process.env.LEDGER ?? "";
  if (!dir || !crewPath || !existsSync(crewPath)) usage("b1b launch guard: set B1B_LEDGERS to the folder of item ledgers (<item>.jsonl) and B1B_CREW to the crew file");
  const ledgers: Partial<Record<B1bItem, Row[]>> = {};
  for (const i of B1B_ITEMS) if (existsSync(join(dir, i + ".jsonl"))) ledgers[i] = readRows(join(dir, i + ".jsonl"));
  const mirror = join(work, "host/ledger.jsonl");
  ledgers[plan.item as B1bItem] = own && existsSync(own) ? readRows(own) : existsSync(mirror) ? readRows(mirror) : ledgers[plan.item as B1bItem] ?? [];
  const crew = JSON.parse(readFileSync(crewPath, "utf8"));
  if (typeof crew?.as_of !== "string" || typeof crew.usd !== "number" || !(crew.usd >= 0)) usage("b1b launch guard: the crew file needs as_of and usd, a number of at least 0");
  const prepared = (plan.parts as PartPlan[]).flatMap((p) => [p.name + "-a2", p.name + "-relaunch"]).map((n) => join(work, n, "l1-part.json")).filter((x) => existsSync(x)).map((x) => JSON.parse(readFileSync(x, "utf8")) as PartPlan);
  const parts = [...plan.parts, ...prepared], finished = parts.map((p) => p.name).filter((n) => n !== relaunching && existsSync(join(work, n + ".result.json")));
  const g = b1bGuard(plan.item, ledgers, { [plan.item]: { parts, finished } }, crew.usd);
  for (const l of g.lines) console.log(l);
  if (!g.ok) throw new Error("E_B1_LAUNCH " + plan.item + ": " + g.why.join("; ") + "; take it to the Captain before launching");
}
export async function b1bMain(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv, opt = (k: string) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === "arms") {
    const sub = rest[0];
    if (sub === "sources") {
      const g = opt("gstack") ?? usage(USAGE), s = b1bSources(g);
      const differ = Object.entries(s).filter(([f, t]) => !existsSync(join(SRC, f)) || readFileSync(join(SRC, f), "utf8") !== t).map(([f]) => f);
      if (rest.includes("--check")) { console.log(differ.length ? "differ: " + differ.join(", ") : "every B1b arm source matches gstack " + GSTACK_MAIN.sha.slice(0, 12)); return differ.length ? 1 : 0; }
      for (const [f, t] of Object.entries(s)) { mkdirSync(join(SRC, f, ".."), { recursive: true }); writeFileSync(join(SRC, f), t); }
      console.log("wrote " + Object.keys(s).join(", ") + " under " + ARM_SOURCES + "/b1b");
      return 0;
    }
    if (sub === "build") {
      const out = opt("out") ?? ARMS_DIR();
      mkdirSync(out, { recursive: true });
      const tars = b1bBuild(out);
      for (const a of B1B_ARM_NAMES) {
        const { summary, list } = b1bManifestOf(a, join(out, "tree", a), tars[a]);
        if (rest.includes("--manifests")) { mkdirSync(b1bManifestDir(), { recursive: true }); writeFileSync(join(b1bManifestDir(), B1B_ARMS[a].tar + ".json"), JSON.stringify({ ...summary, inventory_sha256: sha256(list) }, null, 2) + "\n"); }
        writeFileSync(join(out, B1B_ARMS[a].tar + ".files.tsv"), list);
        console.log(a + " files=" + summary.tree.files + " tar_sha256=" + summary.tar.sha256 + " -> " + tars[a]);
      }
      return 0;
    }
    if (sub === "check") { const r = b1bCheck(opt("out")); for (const l of r.lines) console.log(l); console.log("B1B ARMS " + (r.pass ? "PASS" : "FAIL")); return r.pass ? 0 : 1; }
    return usage(USAGE);
  }
  if (cmd === "sessions" && rest[0] === "run") {
    const out = opt("out") ?? usage(USAGE), problems = await runB1bSessions(resolve(out)), cut = opt("cut");
    if (cut) for (const c of B1B_CASES) { rmSync(join(cut, c.name), { recursive: true, force: true }); if (existsSync(join(out, c.name, "capture"))) cpSync(join(out, c.name, "capture"), join(cut, c.name), { recursive: true }); }
    for (const p of problems) console.error("E_B1_PIN " + p);
    console.log("B1B SESSIONS " + (problems.length ? "FAIL " + problems.length : "PASS") + " " + B1B_CASES.length + " cases");
    return problems.length ? 1 : 0;
  }
  if (cmd === "routes") {
    const tree = mkdtempSync(join(tmpdir(), "b1b-routes-"));
    b1bBuild(tree);
    const tsv = await routeTable(resolve(opt("export") ?? usage(USAGE)), join(tree, "tree", "hook"));
    rmSync(tree, { recursive: true, force: true });
    if (opt("out")) writeFileSync(opt("out")!, tsv); else process.stdout.write(tsv);
    return 0;
  }
  if (cmd === "plan") {
    let bad = false;
    for (const i of B1B_ITEMS) {
      const c = b1bCap(i);
      bad ||= c.cap !== B1B_CAPS_USD[i];
      console.log(i + ": " + c.parts.map((p) => p.name + " (" + partProjection(p).sessions + ")").join(", ") + "; expected $" + c.expected.toFixed(2) + ", parallel $" + c.parallel.toFixed(2) + ", VM $" + c.vm.toFixed(2) + ", cap $" + c.cap + " (recorded $" + B1B_CAPS_USD[i] + ")");
    }
    console.log("all-in stop $" + B1B.stopUsd);
    if (bad) throw new Error("E_B1_INPUT a cap formula differs from its recorded cap");
    return 0;
  }
  if (cmd === "reuse") { const r = reuseCheck(opt("head") ?? git(REPO, ["rev-parse", "HEAD"]).stdout.trim()); for (const l of r.lines) console.log(l); return r.same ? 0 : 1; }
  if (cmd === "approve" || cmd === "done") {
    const ledger = opt("ledger"), it = opt("item") ?? "";
    if (!ledger || !isB1bItem(it)) return usage(USAGE);
    if (cmd === "done") { b1bDone(resolve(ledger), it); console.log(it + " marked done on " + ledger); return 0; }
    const u = opt("usd") ?? "";
    if (!/^\d+(\.\d+)?$/.test(u)) return usage(USAGE);
    b1bApprove(resolve(ledger), it, Number(u), opt("approved-by") ?? "");
    console.log("approved " + it + " at $" + u + " on " + ledger);
    return 0;
  }
  if (cmd === "guard") { guardWork(resolve(rest[0] ?? usage(USAGE))); return 0; }
  if (cmd && LAUNCHER.includes(cmd)) {
    if (GUARDED.includes(cmd)) { if (!rest[0] || (cmd === "relaunch" && !opt("part"))) return usage(USAGE); guardWork(resolve(rest[0]), cmd === "relaunch" ? opt("part") : undefined); }
    l1Main(argv, B1B_PROFILE);
    return 0;
  }
  if (cmd === "table") {
    const [cfg, outPath] = rest;
    if (!cfg || !outPath) return usage(USAGE);
    const rows = buildB1bTable(JSON.parse(readFileSync(cfg, "utf8")));
    writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    console.log("wrote " + rows.length + " rows to " + outPath);
    return 0;
  }
  if (cmd === "report") {
    if (!rest[0] || rest[0].startsWith("--")) return usage(USAGE);
    const rows = readFileSync(rest[0], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as B1bRow), smoke = rows.every((r) => SMOKE_TASKS.includes(r.task));
    const bad = checkB1bRows(rows, smoke ? [...SMOKE_TASKS] : drawnTasks(loadBundle()).run);
    if (bad.length) { for (const b of bad) console.error("E_USAGE b1b report: " + b); return 2; }
    const r = b1bReport(rows, b1References(), smoke ? SMOKE_TASKS.length : B1.tasks, smoke);
    for (const l of r.lines) console.log(l);
    const out = opt("out");
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, "report.txt"), r.lines.join("\n") + "\n"); writeFileSync(join(out, "reasons.tsv"), reasonsTsv(rows)); }
    return 0;
  }
  return usage(USAGE);
}
