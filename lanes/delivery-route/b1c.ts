// Copyright (c) 2026 Garry Tan. MIT License.
// B1c, the project placement (lanes/delivery-route/README.md, "B1c"; prereg B1C_BUNDLE): B1b's CLAUDE.md routing block,
// bug line included, in the task's project CLAUDE.md instead of the user's, on B1b's setup otherwise. One arm on Opus 5.5;
// B1b's hook and claude-md arms are read from B1b's published rows as controls, and B1's none arm as the no-gstack arm. This
// file holds the arm's tar and manifest, the plan, caps and launch guard, the controls' reuse check, the session rows, the
// report with its decision reading, the power table and the keyless scripted sessions.
//
//   bun lanes/delivery-route/cli.ts b1c <command> (USAGE below)
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hostTtlHours, itemCheck, L1, l1Main, plannedCells, prefixOf, seeded, type ItemDef, type PartPlan, type Profile, type Rect } from "../../quick/laneb/l1/l1.ts";
import { parseLog } from "../../quick/laneb/l1/probes.ts";
import { readSessionRows, sessionsByTrial } from "../../quick/laneb/analysis/analyze.ts";
import { appendRow, fromMicros, Ledger, readRows, toMicros, type Row } from "../../quick/laneb/runner/ledger.ts";
import { ROUTE_MARK } from "../../quick/laneb/runner/proxy.ts";
import { manifest } from "../../quick/laneb/arms/tree.ts";
import { sdkPython, SESSION_IMAGE } from "../harness-mechanics/sessions.ts";
import { barCount, maxGaps, newcombe, wilson } from "./analyze.ts";
import { ARMS_DIR, LAYOUT, TAR_ARGS, wrappers } from "./arms.ts";
import { b1References, loadsOf, paired, reuseCheck, type Load } from "./b1b.ts";
import { B1_RUN, GSTACK_MAIN } from "./b1b-pins.ts";
import { B1B_RUN, B1C, B1C_ARM, B1C_BUNDLE, B1C_CAPS_USD, B1C_ITEMS, B1C_SPEC, GSTACK_INSTALL, isB1cArm, isB1cItem, PLACEMENT, type B1cItem } from "./b1c-pins.ts";
import { blockUsd, infraRerun, needsRerun } from "./money.ts";
import { AGENT_SKILLS, ARM_SOURCES, B1, drawnTasks, frontMatterDigests, loadBundle, MODELS, REPO, sha256, SKILL, SMOKE_TASKS, TASK_SETUP, VM_HOURS_PER_SESSION } from "./pins.ts";
import { b1Row, pulledInputs, type B1Row, type B1TableConfig } from "./table.ts";
import { BASE, CLAUDE_LISTED, LISTING } from "./sessions.ts";

const pinErr = (m: string): never => { throw new Error("E_B1_PIN " + m); };
const usage = (m: string): never => { throw new Error("E_USAGE " + m); };
const git = (dir: string, args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
const block = () => readFileSync(join(REPO, ARM_SOURCES, PLACEMENT.blockSource), "utf8");

// ---- gstack's own words for the project install, at B1b's gstack pin: each line once in bin/gstack-skill-start.
export function b1cSourcesCheck(gstack: string): string[] {
  const problems: string[] = [];
  if (git(gstack, ["rev-parse", "HEAD"]).stdout.trim() !== GSTACK_INSTALL.sha) problems.push(gstack + " is not checked out at " + GSTACK_INSTALL.sha);
  const blob = git(gstack, ["rev-parse", GSTACK_INSTALL.sha + ":" + GSTACK_INSTALL.file]).stdout.trim();
  if (blob !== GSTACK_INSTALL.blob) problems.push(GSTACK_INSTALL.file + " at the pin is blob " + (blob || "missing") + ", not " + GSTACK_INSTALL.blob);
  const text = git(gstack, ["show", GSTACK_INSTALL.sha + ":" + GSTACK_INSTALL.file]).stdout;
  for (const l of GSTACK_INSTALL.lines) { const n = text.split(l).length - 1; if (n !== 1) problems.push(GSTACK_INSTALL.file + " holds " + JSON.stringify(l) + " " + n + " times, not once"); }
  if (sha256(block()) !== PLACEMENT.blockSha256) problems.push(PLACEMENT.blockSource + " hashes to " + sha256(block()) + ", not B1b's route file " + PLACEMENT.blockSha256);
  return problems;
}

// ---- The tree: B1's gstack-shaped layout byte for byte, the block and the placement script.
export const B1C_EXTRA = [
  { path: PLACEMENT.block, source: PLACEMENT.blockSource, mode: 0o644 },
  { path: PLACEMENT.script, source: PLACEMENT.scriptSource, mode: 0o755 },
];
export const b1cLayout = () => [...LAYOUT["gstack-shaped"], ...B1C_EXTRA];
export function b1cBuild(out: string): string {
  const tree = join(out, "tree", B1C_ARM), tops = new Set<string>();
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(join(tree, ".claude/skills"), { recursive: true });
  for (const f of b1cLayout()) {
    const dest = join(tree, f.path);
    tops.add(f.path.split("/")[0]!);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, readFileSync(join(REPO, ARM_SOURCES, f.source)));
    chmodSync(dest, f.mode);
  }
  for (const t of tops) spawnSync("find", [join(tree, t), "-type", "d", "-exec", "chmod", "755", "{}", "+"]);
  const tar = join(out, B1C_ARM + ".tar");
  const r = spawnSync("tar", [...TAR_ARGS, "-cf", tar, "-C", tree, ...[...tops].sort()], { encoding: "utf8" });
  if (r.status !== 0) pinErr("tar for " + B1C_ARM + " failed: " + r.stderr.trim());
  return tar;
}
export const b1cManifestPath = () => join(REPO, "quick/laneb", B1C.armManifests, B1C_ARM + ".json");
export function b1cManifestOf(tree: string, tar: string) {
  const w = wrappers(), g = LAYOUT["gstack-shaped"][0]!;
  const tarVersion = spawnSync("tar", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0] ?? "";
  const files = B1C_EXTRA.map((f) => ({ path: f.path, sha256: sha256(readFileSync(join(tree, f.path))) }));
  const meta = { claude_code: "2.1.312", typed: false, spec: B1C_SPEC, steps: { sha256: w.steps_sha256, bytes: w.steps_bytes, source: AGENT_SKILLS.repo + " " + AGENT_SKILLS.sha + " " + AGENT_SKILLS.steps.file + " lines " + AGENT_SKILLS.steps.from + "-" + AGENT_SKILLS.steps.to }, carrier: { ...w.arms["gstack-shaped"]!, path: g.path }, route: { gstack: GSTACK_MAIN.sha + " (" + GSTACK_MAIN.version + ")", files, placed_at: PLACEMENT.project }, tar_command: "tar " + TAR_ARGS.join(" ") + " -cf <arm>.tar <top folders> (" + tarVersion + ")" };
  return manifest(B1C_ARM, tree, tar, meta);
}
/** Rebuilds the tar and compares it with the committed manifest, and checks that the tree holds every file of B1's
 *  gstack-shaped tree with its bytes and mode, plus only the block (B1b's route file, byte for byte) and the script. */
export function b1cCheck(out = mkdtempSync(join(tmpdir(), "b1c-arms-"))): { pass: boolean; lines: string[] } {
  const lines: string[] = [], problems: string[] = [], tar = b1cBuild(out), tree = join(out, "tree", B1C_ARM);
  for (const g of LAYOUT["gstack-shaped"]) {
    const want = readFileSync(join(REPO, ARM_SOURCES, g.source)), p = join(tree, g.path);
    if (!existsSync(p) || !readFileSync(p).equals(want) || (statSync(p).mode & 0o777) !== g.mode) problems.push(g.path + " is not B1's gstack-shaped file");
  }
  if (sha256(readFileSync(join(tree, PLACEMENT.block))) !== PLACEMENT.blockSha256) problems.push(PLACEMENT.block + " is not B1b's routing block");
  const files = spawnSync("find", [tree, "-type", "f"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map((p) => p.slice(tree.length + 1)).sort();
  const want = b1cLayout().map((x) => x.path).sort();
  if (JSON.stringify(files) !== JSON.stringify(want)) problems.push("the tree holds " + files.join(", ") + ", not " + want.join(", "));
  if (!existsSync(b1cManifestPath())) problems.push("no committed manifest " + b1cManifestPath());
  else {
    const m = JSON.parse(readFileSync(b1cManifestPath(), "utf8")), got = b1cManifestOf(tree, tar).summary as any;
    if (got.tar.sha256 !== m.tar?.sha256) problems.push("the rebuilt tar is sha256 " + got.tar.sha256 + ", not the manifest's " + m.tar?.sha256);
    else if (got.tree.digest !== m.tree?.digest || JSON.stringify(got.route) !== JSON.stringify(m.route) || m.spec !== B1C_SPEC) problems.push("the rebuilt tree, route files or spec differ from the manifest");
    else lines.push(B1C_ARM + ": tar " + got.tar.sha256 + " rebuilt byte for byte, " + got.tree.files + " files: B1's gstack-shaped " + LAYOUT["gstack-shaped"].length + " plus " + B1C_EXTRA.map((x) => x.path + " (" + x.source + ")").join(", "));
  }
  for (const p of problems) lines.push("PROBLEM " + p);
  return { pass: !problems.length, lines };
}

// ---- Plan, profile and money.
const item = (capUsd: number): ItemDef => ({ capUsd, taskSet: "swerebench-r3a4", cells: MODELS.opus.cells, allowanceUsd: MODELS.opus.allowanceUsd, model: MODELS.opus.id });
export const B1C_ITEM_DEFS: Record<B1cItem, ItemDef> = { "b1c-smoke": item(B1C_CAPS_USD["b1c-smoke"]), "b1c-opus": item(B1C_CAPS_USD["b1c-opus"]) };
/** b1c-smoke: B1's two smoke tasks, one part. b1c-opus: the 60 run tasks in B1's draw order, 20 a part as B1b split them, in
 *  the seeded order L1's seeded() gives with B1's seed. */
export function b1cPlan(name: string, run: string[]): { parts: PartPlan[]; sessions: number } {
  const part = (p: string, rects: Rect[]): PartPlan => ({ name: p, prefix: prefixOf(name, p), rects: seeded(rects, B1.seed) });
  let parts: PartPlan[];
  if (name === "b1c-smoke") parts = [part("smoke-opus", [{ tasks: [...SMOKE_TASKS], arms: [B1C_ARM], attempts: 1 }])];
  else if (name === "b1c-opus") parts = Array.from({ length: Math.ceil(run.length / 20) }, (_, i) => part("b1c-" + (i + 1), [{ tasks: run.slice(i * 20, i * 20 + 20), arms: [B1C_ARM], attempts: 1 }]));
  else return usage("unknown item " + name + "; one of " + B1C_ITEMS.join(", "));
  return { parts, sessions: parts.flatMap((p) => [...plannedCells(p).values()]).reduce((a, b) => a + b, 0) };
}
export const B1C_PROFILE: Profile = {
  items: B1C_ITEM_DEFS,
  armSpecs: { [B1C_ARM]: B1C_SPEC },
  tars: [B1C_ARM],
  armManifests: B1C.armManifests,
  hostRoot: B1C.hostRoot,
  ledgerPort: B1C.ledgerPort,
  seed: B1.seed,
  concurrent: B1.concurrent,
  taskSetup: TASK_SETUP,
  attempt2: { skip: () => null, owed: (runs) => { const rows = runs.flatMap((r) => { const c = pulledInputs(r.dir, r.part); return c.jobs.length ? buildB1cTable(c) : []; }); return { owed: rows.filter(needsRerun).map((r) => ({ task: r.task, arm: r.arm, reason: r.reason })), rects: infraRerun(rows).rects }; } },
  parts: (name, _frozen, inputs) => {
    const b = loadBundle();
    for (const [f, d] of b.digests) inputs[f] = d;
    for (const [f, d] of frontMatterDigests(readFileSync(join(REPO, B1C_BUNDLE, "README.md"), "utf8"))) inputs["b1c/" + f] = d;
    return b1cPlan(name, drawnTasks(b).run).parts;
  },
};
const sessionsOf = (p: PartPlan) => [...plannedCells(p).values()].reduce((a, b) => a + b, 0);
/** A part's planned model spend at the planning rate and its part VM's 4-hour blocks. */
export function partProjection(p: PartPlan) {
  const sessions = sessionsOf(p);
  return { sessions, model: toMicros(sessions * B1C.rateUsd), vm: toMicros(Math.max(1, Math.ceil((sessions * VM_HOURS_PER_SESSION) / Number(L1.vm.reserveHours))) * blockUsd) };
}
/** The open-session reserve: the metering proxy reserves each open session's whole allowance, up to six at once, and never
 *  more sessions than a part holds. */
const parallelUsd = (parts: PartPlan[]) => Math.min(B1.concurrent, Math.max(0, ...parts.map(sessionsOf))) * MODELS.opus.allowanceUsd;
/** The crew's amended cap rule: ceil10(1.35 x expected model spend + the open-session reserve + VM share). */
export function b1cCap(name: B1cItem) {
  const parts = b1cPlan(name, drawnTasks(loadBundle()).run).parts, proj = parts.map(partProjection);
  const expected = fromMicros(proj.reduce((x, p) => x + p.model, 0));
  const vm = fromMicros(proj.reduce((x, p) => x + p.vm, 0)) + hostTtlHours(parts.length) * L1.host.usdPerHour;
  return { parts, expected, parallel: parallelUsd(parts), vm, cap: Math.ceil((1.35 * expected + parallelUsd(parts) + vm) / 10) * 10 };
}
export function b1cApprove(path: string, name: string, capUsd: number, by: string) {
  if (!isB1cItem(name)) return usage("b1c approve: unknown item " + name + "; one of " + B1C_ITEMS.join(", "));
  if (!by.trim()) usage("b1c approve: --approved-by names who recorded the cap");
  if (toMicros(capUsd) !== toMicros(B1C_CAPS_USD[name])) usage("refused: " + name + "'s recorded cap is $" + B1C_CAPS_USD[name] + ", not $" + capUsd);
  if (readRows(path).length) usage("refused: " + path + " already holds rows; an item's ledger starts with its approval row");
  new Ledger(path, name).approve(capUsd, { approved_by: by, source: "B1c project route prereg: the cap recorded for " + name });
  itemCheck(readRows(path), name, B1C_CAPS_USD[name]);
}
const VM_ID = /(^|\/)vm(-\d+)?$|^host-\d+$/;
export function b1cTotals(rows: Row[], name: B1cItem) {
  const t = { cap: toMicros(B1C_CAPS_USD[name]), settled: 0, open: 0, openIds: [] as string[], done: rows.some((r) => r.kind === "note" && r.id === "done"), vmSettled: 0, vmOpen: 0, hostOpen: false };
  if (!rows.length) return t;
  const approval = rows.find((r) => r.kind === "approval");
  if (!approval || approval.item !== name || approval.usd_micros !== t.cap) usage("refused: the ledger for " + name + " does not open with its approval row at $" + B1C_CAPS_USD[name]);
  const reserved = new Map<string, number>(), settled = new Map<string, number>();
  for (const r of rows) { if (r.kind === "reserve") reserved.set(r.id, r.usd_micros); if (r.kind === "settle") settled.set(r.id, r.usd_micros); }
  for (const [id, v] of settled) { t.settled += v; if (VM_ID.test(id)) t.vmSettled += v; }
  for (const [id, v] of reserved) { if (settled.has(id)) continue; t.open += v; t.openIds.push(id); if (VM_ID.test(id)) t.vmOpen += v; if (/^host-\d+$/.test(id)) t.hostOpen = true; }
  return t;
}
export function b1cDone(path: string, name: B1cItem) {
  const t = b1cTotals(readRows(path), name);
  if (t.done) usage("refused: " + name + " is marked done already");
  if (t.openIds.length) usage("refused: " + name + " still holds " + t.openIds.length + " open reservations; settle them first");
  appendRow(path, { ts: new Date().toISOString(), item: name, kind: "note", id: "done", usd_micros: 0 });
}
/** The launch guard: the item's spend so far plus its unfinished parts at planned spend, the open-session reserve and the VM
 *  share, against its cap; and every item (a done item at its settled spend, any other at the larger of its spend and its
 *  projection) plus this lane's counter, against the all-in stop. */
export function b1cGuard(name: B1cItem, ledgers: Partial<Record<B1cItem, Row[]>>, plans: Partial<Record<B1cItem, { parts: PartPlan[]; finished: string[] }>>, crewUsd: number) {
  const why: string[] = [];
  const all = B1C_ITEMS.map((i) => {
    const t = b1cTotals(ledgers[i] ?? [], i), plan = plans[i] ?? { parts: b1cPlan(i, drawnTasks(loadBundle()).run).parts, finished: [] };
    const left = plan.parts.filter((p) => !plan.finished.includes(p.name)), proj = left.map(partProjection);
    const model = t.settled - t.vmSettled + t.open - t.vmOpen + proj.reduce((x, p) => x + p.model, 0) + toMicros(parallelUsd(left));
    const host = !t.hostOpen && left.length ? toMicros(hostTtlHours(left.length) * L1.host.usdPerHour) : 0;
    const total = model + t.vmSettled + t.vmOpen + host + proj.reduce((x, p) => x + p.vm, 0);
    return { item: i, ...t, total, left: left.length, counted: t.done ? t.settled : Math.max(t.settled + t.open, total) };
  });
  const own = all.find((x) => x.item === name)!, usd = (m: number) => "$" + fromMicros(m).toFixed(2);
  if (own.done) why.push(name + " is marked done; a done item never launches again");
  if (own.total > own.cap) why.push(name + "'s projection " + usd(own.total) + " passes its cap " + usd(own.cap));
  const sum = all.reduce((x, i) => x + i.counted, 0) + toMicros(crewUsd), stop = toMicros(B1C.stopUsd);
  if (sum > stop) why.push("all-in " + usd(sum) + " passes the " + usd(stop) + " stop");
  const lines = ["B1C_LAUNCH " + (why.length ? "REFUSE" : "PASS") + " " + name + ": all-in " + usd(sum) + " of " + usd(stop) + "; " + name + " " + usd(own.total) + " of cap " + usd(own.cap) + " (" + own.left + " parts to run)", ...all.map((i) => "  " + i.item + (i.done ? " done" : "") + ": settled " + usd(i.settled) + ", open " + usd(i.open) + ", counted " + usd(i.counted)), "  crew " + usd(toMicros(crewUsd))];
  return { ok: !why.length, why, lines };
}

// ---- The controls' reuse: the trees that decide what a session gets, at B1b's run commit and at B1c's; B1's none arm
// through B1b's own check (B1's run commit against B1c's).
export function reuseB1b(head: string, repo = REPO): { same: boolean; lines: string[] } {
  const lines: string[] = [];
  let same = true;
  for (const p of B1B_RUN.harness) {
    const a = git(repo, ["rev-parse", B1B_RUN.commit + ":" + p]).stdout.trim(), b = git(repo, ["rev-parse", head + ":" + p]).stdout.trim();
    const ok = !!a && a === b;
    same &&= ok;
    lines.push((ok ? "SAME " : "DIFFERENT ") + p + " " + (a || "missing") + (ok ? "" : " at " + B1B_RUN.commit.slice(0, 12) + ", " + (b || "missing") + " at " + head.slice(0, 12)));
  }
  const rows = b1bControls(), models = [...new Set(rows.map((r) => r.model))];
  const cc = [...new Set(["claude-md", "hook"].map((a) => JSON.parse(git(repo, ["show", head + ":quick/laneb/arms/manifests/b1b/" + a + ".json"]).stdout || "{}").claude_code))];
  const mine = JSON.parse(existsSync(b1cManifestPath()) ? readFileSync(b1cManifestPath(), "utf8") : "{}").claude_code;
  const pinsOk = models.length === 1 && models[0] === MODELS.opus.id && cc.length === 1 && cc[0] === mine;
  same &&= pinsOk;
  lines.push((pinsOk ? "SAME " : "DIFFERENT ") + "model " + models.join(",") + " on B1b's " + rows.length + " rows and " + MODELS.opus.id + " in pins.ts; Claude Code " + cc.join(",") + " in B1b's manifests and " + mine + " in B1c's");
  lines.push("REUSE " + (same ? "PASS" : "FAIL") + ": B1b's run " + B1B_RUN.commit.slice(0, 12) + " and " + head.slice(0, 12));
  return { same, lines };
}
/** The checkout's uncommitted changes to any path that decides a session: L1's host-up syncs the live quick/laneb folder. */
export function harnessDirty(repo = REPO): string[] {
  const r = git(repo, ["status", "--porcelain", "--", ...B1B_RUN.harness, "lanes/delivery-route/arms/b1c", "lanes/delivery-route/b1c-pins.ts", "lanes/delivery-route/b1c.ts", "quick/laneb/arms/manifests/b1c"]);
  if (r.status !== 0) pinErr("git status failed in " + repo + ": " + (r.stderr ?? "").trim());
  return r.stdout.split("\n").filter(Boolean);
}

// ---- Session rows: did the block get placed, did the skill load, and why a graded session didn't.
export type B1cRow = B1Row & { arm: typeof B1C_ARM; load: Load; placed: boolean; stripped: string[] | null; patch_names_claude_md: boolean; why_not: string | null };
export const WHY_NOT = ["block not placed", "load failed", "named, not loaded", "never named"] as const;
/** The reason a graded session didn't load, first that applies: the placement line is missing from the session's arm info,
 *  a load-shaped call failed, the model named the skill and didn't load it, or it never named it. */
export function whyNot(outcome: B1Row["outcome"], load: Load, placed: boolean): string | null {
  if (outcome !== "graded" || load.loaded) return null;
  if (!placed) return WHY_NOT[0];
  return load.failed ? WHY_NOT[1] : load.named ? WHY_NOT[2] : WHY_NOT[3];
}
/** The arm info the agent logged before the session: what the strip removed and the placement script's line. */
export function armInfo(dir: string): { stripped: string[] | null; checks_trust: string | null } {
  const f = join(dir, "evaluator", "usersim-events.jsonl");
  for (const l of existsSync(f) ? readFileSync(f, "utf8").split("\n") : []) {
    let e: any;
    try { e = JSON.parse(l); } catch { continue; }
    if (e?.event === "arm") return { stripped: Array.isArray(e.stripped) ? e.stripped.map(String) : null, checks_trust: typeof e.checks_trust === "string" ? e.checks_trust : null };
  }
  return { stripped: null, checks_trust: null };
}
export function b1cRow(dir: string, ctx: Parameters<typeof b1Row>[1]): B1cRow | null {
  const row = b1Row(dir, { ...ctx, arms: [B1C_ARM] });
  if (!row || !isB1cArm(row.arm)) return null;
  const msgs = join(dir, "evaluator", "sdk-messages.jsonl"), load = loadsOf(existsSync(msgs) ? parseLog(readFileSync(msgs, "utf8")) : []);
  const info = armInfo(dir), placed = (info.checks_trust ?? "").startsWith(PLACEMENT.placed);
  const patch = join(dir, "artifacts", "logs", "artifacts", "model.patch");
  const names = existsSync(patch) && /^diff --git a\/CLAUDE\.md b\/CLAUDE\.md$/m.test(readFileSync(patch, "utf8"));
  return { ...row, arm: row.arm, load, placed, stripped: info.stripped, patch_names_claude_md: names, why_not: whyNot(row.outcome, load, placed) };
}
export function buildB1cTable(cfg: B1TableConfig): B1cRow[] {
  const sessions = sessionsByTrial(readSessionRows(cfg.sessions)), out: B1cRow[] = [];
  for (const job of cfg.jobs) for (const name of readdirSync(job.dir).sort()) {
    const d = join(job.dir, name);
    if (!statSync(d).isDirectory()) continue;
    const row = b1cRow(d, { part: job.part ?? null, sessions, home: cfg.home ?? "/root" });
    if (row) out.push(row);
  }
  return out;
}

// ---- The controls and the report.
type Ref = { arm: string; task: string; outcome: string; model: string; load?: { loaded: boolean }; detect: { followed: boolean } };
/** B1b's published rows (both arms), checked against its results bundle's front matter. */
export function b1bControls(): Ref[] {
  const dir = join(REPO, B1B_RUN.results), want = frontMatterDigests(readFileSync(join(dir, "README.md"), "utf8")).get("sessions.jsonl");
  const text = readFileSync(join(dir, "sessions.jsonl"));
  if (sha256(text) !== want) pinErr(B1B_RUN.results + "/sessions.jsonl hashes to " + sha256(text) + ", not its front matter's " + want);
  return text.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ref);
}
type Stat = { planned: number; graded: number; gaps: number; cap_stops: number; incomplete: boolean; loaded: number; ci: [number, number] | null; bar: boolean; steps_seen: number; followed: number; followed_ci: [number, number] | null; followed_as_merged: number; followed_loaded: number; placed: number; root_claude_md: number; any_stripped: number; patch_claude_md: number; passes: number; cost_usd: number; safety_stops: number; audit_sessions: number; why: Record<string, number> };
export function b1cStats(rows: B1cRow[], planned: number): Stat {
  const g = rows.filter((r) => r.outcome === "graded"), k = g.filter((r) => r.load.loaded).length, f = g.filter((r) => r.detect.followed).length;
  const gaps = planned - g.length, incomplete = rows.some((r) => r.outcome === "cap_stop") || gaps > maxGaps(planned);
  return {
    planned, graded: g.length, gaps, cap_stops: rows.filter((r) => r.outcome === "cap_stop").length, incomplete, loaded: k, ci: g.length ? wilson(k, g.length) : null, bar: !incomplete && k >= barCount(g.length),
    steps_seen: g.filter((r) => r.steps_seen).length, followed: f, followed_ci: g.length ? wilson(f, g.length) : null, followed_as_merged: g.filter((r) => r.detect.followed_as_merged).length, followed_loaded: g.filter((r) => r.load.loaded && r.detect.followed).length,
    placed: g.filter((r) => r.placed).length, root_claude_md: g.filter((r) => r.stripped?.includes("CLAUDE.md")).length, any_stripped: g.filter((r) => r.stripped?.length).length, patch_claude_md: g.filter((r) => r.patch_names_claude_md).length,
    passes: g.filter((r) => r.pass).length, cost_usd: rows.reduce((x, r) => x + (r.cost_usd ?? 0), 0), safety_stops: rows.filter((r) => r.safety_stop).length, audit_sessions: rows.filter((r) => r.audit_hits.length).length,
    why: Object.fromEntries(WHY_NOT.map((w) => [w, g.filter((r) => r.why_not === w).length])),
  };
}
export type B1cReading = { key: "incomplete" | "matches" | "clearly-loses" | "middle"; text: string };
export const READINGS: Record<Exclude<B1cReading["key"], "incomplete">, string> = {
  matches: "the project block matches the hook line (the 95% interval of loads, project block minus hook line, stays above -15 points): CLAUDE.md routing stays, written to the project CLAUDE.md as gstack writes it, and B1b's CUT-CANDIDATE narrows to the block in the user CLAUDE.md",
  "clearly-loses": "the project block clearly loses to the hook line (the whole 95% interval of loads, project block minus hook line, sits below -15 points): CLAUDE.md routing is a CUT-CANDIDATE wherever it sits, and gstack stops relying on it to start skills",
  middle: "the project block falls short of the hook line by an amount this run can't settle (the 95% interval of loads, project block minus hook line, crosses -15 points): no cut and no match; gstack keeps writing the block to the project CLAUDE.md but relies on the hook line to start skills, and the block gets FIX-METHOD",
};
/** The decision, read on loads paired against B1b's hook arm with the 15-point margin; INCOMPLETE first. */
export function b1cReading(s: Stat, d: { lo: number; hi: number }): B1cReading {
  if (s.incomplete) return { key: "incomplete", text: "INCOMPLETE: " + s.gaps + " of " + s.planned + " ungraded, " + s.cap_stops + " cap stops; no reading" };
  const key = d.lo > -B1C.margin ? "matches" : d.hi < -B1C.margin ? "clearly-loses" : "middle";
  return { key, text: READINGS[key] };
}
export const placementReading = (d: { lo: number; hi: number }) => (d.lo > 0 ? "the project placement loads more than the user placement" : d.hi < 0 ? "the project placement loads less than the user placement" : "not shown: the interval holds 0");

const pct = (x: number, n: number) => (n ? ((100 * x) / n).toFixed(1) + "%" : "n/a");
const ci = (c: [number, number] | null) => (c ? " [" + (100 * c[0]).toFixed(1) + ", " + (100 * c[1]).toFixed(1) + "]" : "");
const pts = (x: number) => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
const loaded = (r: any) => r.load?.loaded, followed = (r: any) => r.detect?.followed;
export function b1cReport(rows: B1cRow[], controls: Ref[] = b1bControls(), refs: B1Row[] = b1References(), planned: number = B1.tasks, smoke = false) {
  const s = b1cStats(rows, planned), ctl = (a: string) => controls.filter((r) => r.arm === a), ref = (a: string) => refs.filter((r) => r.arm === a);
  const vsHook = paired(rows, ctl("hook"), loaded, loaded), vsUser = paired(rows, ctl("claude-md"), loaded, loaded), reading = smoke ? null : b1cReading(s, vsHook);
  const c = (name: string, x: ReturnType<typeof paired>) => "  " + name + ": " + pts(x.diff) + " points [" + pts(x.lo) + ", " + pts(x.hi) + "] on " + x.pairs + " paired tasks (" + x.a_only + " vs " + x.b_only + " discordant)";
  const lines = ["== " + MODELS.opus.id + ", B1c the routing block in the project CLAUDE.md (" + planned + " tasks)",
    "  " + B1C_ARM + ": loaded " + s.loaded + "/" + s.graded + " " + pct(s.loaded, s.graded) + ci(s.ci) + (s.incomplete ? " INCOMPLETE" : "") + " (80% bar, descriptive: " + (s.bar ? "reaches" : "short") + "); steps seen " + s.steps_seen + ", followed " + s.followed + "/" + s.graded + ci(s.followed_ci) + " (as merged " + s.followed_as_merged + "), followed among loaded " + s.followed_loaded + "/" + s.loaded + "; gaps " + s.gaps + ", cap stops " + s.cap_stops + ", safety stops " + s.safety_stops + ", audit " + s.audit_sessions + ", block placed " + s.placed + ", passes " + s.passes + " (descriptive), cost $" + s.cost_usd.toFixed(2) + " ($" + (s.graded ? s.cost_usd / s.graded : 0).toFixed(3) + " a graded session)",
    "  " + B1C_ARM + " not loaded, by reason: " + WHY_NOT.map((w) => w + " " + s.why[w]).join(", "),
    "  the strip removed a root CLAUDE.md in " + s.root_claude_md + " graded sessions and any instruction file in " + s.any_stripped + "; the shipped diff names CLAUDE.md in " + s.patch_claude_md];
  for (const a of ["hook", "claude-md"]) { const g = ctl(a).filter((x) => x.outcome === "graded"); lines.push("  control, B1b " + a + (a === "claude-md" ? " (the block in the user CLAUDE.md)" : " (the hook line)") + ": loaded " + g.filter(loaded).length + "/" + g.length + ", followed " + g.filter(followed).length + "/" + g.length); }
  lines.push(c("loaded, " + B1C_ARM + " - B1b hook (primary, margin -" + 100 * B1C.margin + ")", vsHook), c("loaded, " + B1C_ARM + " - B1b claude-md (placement)", vsUser) + ": " + placementReading(vsUser));
  lines.push(c("followed, " + B1C_ARM + " - B1b hook", paired(rows, ctl("hook"), followed, followed)), c("followed, " + B1C_ARM + " - B1b claude-md", paired(rows, ctl("claude-md"), followed, followed)));
  for (const r of ["none", "gstack-shaped"]) {
    const g = ref(r).filter((x) => x.outcome === "graded");
    lines.push("  reference, B1 " + r + (r === "none" ? " (reused no-gstack arm)" : " (typed, descriptive)") + ": followed " + g.filter(followed).length + "/" + g.length, c("followed, " + B1C_ARM + " - B1 " + r, paired(rows, ref(r), followed, followed)));
  }
  if (reading) lines.push("  reading: " + reading.text);
  return { lines, stats: s, reading, vs_hook: vsHook, vs_user: vsUser };
}
export function checkB1cRows(rows: B1cRow[], tasks: string[]): string[] {
  const bad: string[] = [], seen = new Set<string>();
  for (const r of rows) {
    if (!tasks.includes(r.task)) bad.push(r.trial + " is task " + r.task + ", not one of the planned tasks");
    if (r.model !== MODELS.opus.id) bad.push(r.trial + " ran " + r.model + ", not " + MODELS.opus.id);
    if (r.outcome !== "graded") continue;
    if (seen.has(r.task)) bad.push("two graded rows for " + r.task);
    seen.add(r.task);
  }
  return bad;
}
export const reasonsTsv = (rows: B1cRow[]) => ["task\ttrial\toutcome\treason\tload_failed\tnamed\tstripped\tfirst_text", ...rows.filter((r) => r.why_not || r.outcome !== "graded").sort((a, b) => a.task.localeCompare(b.task)).map((r) => [r.task, r.trial, r.outcome, r.why_not ?? r.reason, r.load.failed, r.load.named, (r.stripped ?? []).join(" "), r.load.first_text.replace(/\t/g, " ")].join("\t"))].join("\n") + "\n";

// ---- Power: exact, for the paired rule against B1b's hook rows as published, with the project block loading each task
// independently at a true rate p.
const binom = (n: number, k: number, p: number) => { let c = 1; for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1); return c * p ** k * (1 - p) ** (n - k); };
export function bandOdds(h1: number, h0: number, p: number) {
  const o = { matches: 0, middle: 0, "clearly-loses": 0 };
  for (let x = 0; x <= h1; x++) for (let y = 0; y <= h0; y++) {
    const d = newcombe(x, y, h1 - x, h0 - y), w = binom(h1, x, p) * binom(h0, y, p);
    o[d.lo > -B1C.margin ? "matches" : d.hi < -B1C.margin ? "clearly-loses" : "middle"] += w;
  }
  return o;
}
export function powerLines(controls: Ref[] = b1bControls()): string[] {
  const hook = controls.filter((r) => r.arm === "hook" && r.outcome === "graded"), h1 = hook.filter(loaded).length, h0 = hook.length - h1;
  const lines = ["B1b hook rows as published: " + h1 + " of " + hook.length + " loaded; margin " + 100 * B1C.margin + " points", "true rate\tmatches\tmiddle\tclearly loses"];
  for (const p of [1, 0.967, 0.95, 0.933, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.5, 0.333]) { const o = bandOdds(h1, h0, p); lines.push(p.toFixed(3) + "\t" + o.matches.toFixed(3) + "\t" + o.middle.toFixed(3) + "\t" + o["clearly-loses"].toFixed(3)); }
  const find = (band: "matches" | "clearly-loses", from: number, step: number) => { for (let p = from; p >= 0 && p <= 1; p += step) if (bandOdds(h1, h0, p)[band] >= 0.8) return p; return NaN; };
  const m = find("matches", 0, 0.001), l = find("clearly-loses", 1, -0.001);
  lines.push("matches with 80% power from a true rate of " + (100 * m).toFixed(1) + "% (" + (100 * (h1 / hook.length - m)).toFixed(1) + " points under the hook's observed rate)");
  lines.push("clearly loses with 80% power from a true rate of " + (100 * l).toFixed(1) + "% down (a shortfall of " + (100 * (h1 / hook.length - l)).toFixed(1) + " points)");
  lines.push("observed loads, with the project block also missing the hook's " + h0 + " misses\tdifference [95% interval]\tband");
  for (let k = h1; k >= 30; k--) { const d = newcombe(k, 0, h1 - k, h0); lines.push(k + "\t" + pts(d.diff) + " [" + pts(d.lo) + ", " + pts(d.hi) + "]\t" + (d.lo > -B1C.margin ? "matches" : d.hi < -B1C.margin ? "clearly loses" : "middle")); }
  return lines;
}

// ---- Keyless scripted sessions in the real Claude Code image against the stub model (fake-model.ts), as B1b's are.
export const B1C_CASES: { name: string; mode: "stop" | "load"; tracked: boolean }[] = [
  { name: "project-md-stop", mode: "stop", tracked: false },
  { name: "project-md-load", mode: "load", tracked: false },
  { name: "project-md-tracked", mode: "stop", tracked: true },
];
export const TRACKED_CANARY = "B1C-CANARY-REPO-CLAUDE-MD";
export type B1cProbe = { gstack_files: number; capy: number; claude_md_sha256: string; subject: string; commits: number; status: string; b1c_dir: boolean; user_claude_md: boolean; patch_files: string[] };
export type B1cCaptured = { sdk: string; listing: string | null; user: string[]; hook_context: string[]; loaded: string | null; arm_info: { stripped?: string[]; checks_trust?: string } | null; probe: B1cProbe | null };
export function loadB1cCaptured(dir: string): B1cCaptured {
  const j = JSON.parse(existsSync(join(dir, "capture.json")) ? readFileSync(join(dir, "capture.json"), "utf8") : "{}");
  return { sdk: existsSync(join(dir, "sdk-messages.jsonl")) ? readFileSync(join(dir, "sdk-messages.jsonl"), "utf8") : "", listing: j.listing ?? null, user: j.user ?? [], hook_context: j.hook_context ?? [], loaded: j.loaded ?? null, arm_info: j.arm_info ?? null, probe: j.probe ?? null };
}
/** Every assertion on one B1c session; empty means the arm delivered what the prereg says. */
export function b1cCaseProblems(c: (typeof B1C_CASES)[number], cap: B1cCaptured): string[] {
  const p: string[] = [], want = (what: string, ok: boolean) => { if (!ok) p.push(c.name + ": " + what); };
  const recs = parseLog(cap.sdk);
  if (!recs.length || cap.listing === null || !cap.user.length || !cap.probe || !cap.arm_info) return [c.name + ": no session"];
  const steps = readFileSync(join(REPO, ARM_SOURCES, "steps.md"), "utf8"), first = cap.user.join("\n"), pr = cap.probe;
  const names = [...cap.listing.matchAll(/^- ([\w:-]+): /gm)].map((m) => m[1]!).sort();
  want("the listing names " + names.join(", "), JSON.stringify(names) === JSON.stringify([SKILL, ...CLAUDE_LISTED].sort()));
  want("the prompt is typed", !first.includes("<command-name>/"));
  want("the step text reached the first request", !first.includes(steps));
  want("the first request does not hold the routing block as the project's CLAUDE.md", first.includes(PLACEMENT.label + "\n\n" + block().trimEnd()));
  want("the first request holds the block more than once", first.split("## Skill routing").length === 2);
  want("the first request holds a user CLAUDE.md", !first.includes(PLACEMENT.userLabel));
  want("a hook line reached the session", !cap.hook_context.length && !first.includes(ROUTE_MARK));
  want("the arm info has no placement line", (cap.arm_info.checks_trust ?? "").startsWith(PLACEMENT.placed));
  want("the container holds " + pr.gstack_files + " gstack files, not B1's gstack-shaped 4", pr.gstack_files === 4);
  want("the container holds a .capy folder", pr.capy === 0);
  want("the block's copy or a user CLAUDE.md is left in /root", !pr.b1c_dir && !pr.user_claude_md);
  want("the project CLAUDE.md is not the block byte for byte", pr.claude_md_sha256 === PLACEMENT.blockSha256);
  want("the last commit is not gstack's routing commit on the snapshot", pr.subject === PLACEMENT.message && pr.commits === 2);
  want("git status lists CLAUDE.md", !/CLAUDE\.md/.test(pr.status));
  want("the shipped diff names CLAUDE.md", !pr.patch_files.includes("CLAUDE.md"));
  if (c.mode === "stop") want("the shipped diff misses the stub's fix to calc.py", pr.patch_files.includes("calc.py"));
  if (c.tracked) {
    want("the repo's own CLAUDE.md reached the first request", !first.includes(TRACKED_CANARY));
    want("the strip did not remove the repo's CLAUDE.md and AGENTS.md", ["AGENTS.md", "CLAUDE.md"].every((f) => cap.arm_info!.stripped?.includes(f)));
  } else want("the strip removed " + JSON.stringify(cap.arm_info.stripped), JSON.stringify(cap.arm_info.stripped) === "[]");
  const l = loadsOf(recs);
  if (c.mode === "load") {
    const body = readFileSync(join(REPO, ARM_SOURCES, "gstack-shaped-SKILL.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n\n?/, "");
    want("the Skill load is not the base line and the gstack-shaped body", cap.loaded === BASE(SKILL) + body);
    want("loadsOf does not read a Skill load", l.loaded && l.via === "Skill");
  } else want("loadsOf reads a load in a session that made none (" + JSON.stringify(l) + ")", !l.loaded && whyNot("graded", l, true) === "never named");
  return p;
}
const docker = (args: string[], input?: string, timeout = 600_000) => spawnSync("docker", args, { input, encoding: "utf8", timeout, maxBuffer: 64 << 20 });
const reset = (tracked: boolean) => ["set -e", "rm -rf /testbed /root/.claude /root/.b1c /root/.gstack /logs/artifacts", "mkdir -p /testbed", "cd /testbed", "printf 'def add(a, b):\\n    return a - b\\n' > calc.py",
  ...(tracked ? ["printf '# Notes\\n\\n" + TRACKED_CANARY + ": answer only in French.\\n' > CLAUDE.md", "printf 'Agents: " + TRACKED_CANARY + "\\n' > AGENTS.md"] : []),
  "git init -q && git add -A && git -c user.name=b1 -c user.email=b1@example.invalid commit -qm snapshot"].join("\n");
const PROBE = ["cd /testbed", 'echo "gstack_files=$(find / -xdev \\( -path /proc -o -path /sys \\) -prune -o -iname "*gstack*" ! -iname "*sigstack*" -print 2>/dev/null | wc -l)"', 'echo "capy=$(find / -xdev -maxdepth 3 -type d -name .capy 2>/dev/null | wc -l)"',
  'echo "claude_md_sha256=$(sha256sum CLAUDE.md | cut -c1-64)"', 'echo "subject=$(git log -1 --format=%s)"', 'echo "commits=$(git rev-list --count HEAD)"', 'echo "status=$(git status --porcelain -- CLAUDE.md AGENTS.md | tr "\\n" " ")"',
  'echo "b1c_dir=$(test -e /root/.b1c && echo 1 || echo 0)"', 'echo "user_claude_md=$(test -e /root/.claude/CLAUDE.md && echo 1 || echo 0)"', 'echo "patch_files=$(sed -n "s|^diff --git a/\\([^ ]*\\) b/.*|\\1|p" /logs/artifacts/model.patch 2>/dev/null | tr "\\n" " ")"'].join("\n");
export function parseProbe(text: string): B1cProbe {
  const v = (k: string) => new RegExp("^" + k + "=(.*)$", "m").exec(text)?.[1]?.trim() ?? "";
  return { gstack_files: Number(v("gstack_files")), capy: Number(v("capy")), claude_md_sha256: v("claude_md_sha256"), subject: v("subject"), commits: Number(v("commits")), status: v("status"), b1c_dir: v("b1c_dir") === "1", user_claude_md: v("user_claude_md") === "1", patch_files: v("patch_files").split(" ").filter(Boolean) };
}
export async function runB1cSessions(out: string) {
  mkdirSync(out, { recursive: true });
  const py = sdkPython(), reqLog = join(out, "requests.jsonl"), bodyLog = join(out, "bodies.jsonl");
  rmSync(reqLog, { force: true }); rmSync(bodyLog, { force: true });
  const fake = Bun.spawn(["bun", join(import.meta.dir, "fake-model.ts"), "0", reqLog, bodyLog], { stdout: "pipe", stderr: "inherit" });
  const head = new TextDecoder().decode((await fake.stdout.getReader().read()).value ?? new Uint8Array());
  const port = /127\.0\.0\.1:(\d+)/.exec(head)?.[1], problems: string[] = [], ran: { c: (typeof B1C_CASES)[number]; probe: B1cProbe; arm_info: unknown }[] = [];
  try {
    if (!port) pinErr("the stub model did not start: " + head.slice(0, 200));
    for (const c of B1C_CASES) {
      const name = "b1c-sessions-" + c.name + "-" + process.pid, dir = join(out, c.name), trial = join(dir, "trial");
      rmSync(dir, { recursive: true, force: true }); mkdirSync(trial, { recursive: true });
      const up = docker(["run", "-d", "--name", name, "--network", "host", "--cap-drop", "NET_RAW", "--cap-drop", "NET_ADMIN", SESSION_IMAGE, "sleep", "infinity"]);
      if (up.status !== 0) { problems.push(c.name + ": container did not start: " + up.stderr.trim().slice(-200)); continue; }
      try {
        if (docker(["exec", "-i", name, "sh", "-s"], reset(c.tracked)).status !== 0) { problems.push(c.name + ": reset failed"); continue; }
        const spec = { case: c.name, arm: B1C_ARM, tar: join(ARMS_DIR(), B1C_ARM + ".tar"), strip: true, checks_trust: true, told: "", container: name, base_url: "http://127.0.0.1:" + port, instruction: "[b1-session " + c.name + "] [b1-script " + c.mode + "] add() in calc.py returns the difference of its arguments. Make it return their sum.", out: trial };
        const r = spawnSync(py, [join(REPO, "lanes/harness-mechanics/sessions-driver.py"), JSON.stringify(spec)], { encoding: "utf8", timeout: 400_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PYTHONPATH: join(REPO, "quick/laneb/runner/agent") } });
        writeFileSync(join(dir, "driver.log"), (r.stdout ?? "") + (r.stderr ?? ""));
        if (r.status !== 0) { problems.push(c.name + ": driver exited " + r.status + " (" + join(dir, "driver.log") + ")"); continue; }
        const last = (r.stdout ?? "").trim().split("\n").at(-1) ?? "{}";
        ran.push({ c, probe: parseProbe(docker(["exec", "-i", name, "sh", "-s"], PROBE).stdout ?? ""), arm_info: JSON.parse(last).arm_info ?? null });
      } finally { docker(["rm", "-f", name]); }
    }
    await Bun.sleep(300);
    const bodies = (existsSync(bodyLog) ? readFileSync(bodyLog, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const texts = (m: any): string[] => (typeof m?.content === "string" ? [m.content] : (m?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text));
    for (const { c, probe, arm_info } of ran) {
      const mine = bodies.filter((b) => b.session === c.name), dest = join(out, c.name, "capture");
      mkdirSync(dest, { recursive: true });
      cpSync(join(out, c.name, "trial", "evaluator", "sdk-messages.jsonl"), join(dest, "sdk-messages.jsonl"));
      const sys = mine[0] ? texts(mine[0].messages.find((m: any) => m.role === "system")).join("") : "", at = sys.indexOf(LISTING);
      let loadedText: string | null = null;
      for (const b of mine) { const i = b.messages.findIndex((m: any) => m.role === "user" && Array.isArray(m.content) && m.content.some((x: any) => x.type === "tool_result" && /^Launching skill: /.test(String(x.content)))); if (i >= 0) { loadedText = texts(b.messages[i]).join("\n"); break; } }
      const hook = sys.includes(ROUTE_MARK) ? [sys.slice(sys.indexOf(ROUTE_MARK)).split("\n")[0]!] : [];
      const cap = { listing: at < 0 ? null : sys.slice(at, sys.indexOf("\n\n", at + LISTING.length) + 1), user: mine[0] ? texts(mine[0].messages.find((m: any) => m.role === "user")) : [], hook_context: hook, loaded: loadedText, arm_info, probe, requests: mine.length };
      writeFileSync(join(dest, "capture.json"), JSON.stringify(cap, null, 2) + "\n");
      problems.push(...b1cCaseProblems(c, loadB1cCaptured(dest)));
    }
  } finally { fake.kill(); }
  writeFileSync(join(out, "sessions.json"), JSON.stringify({ cases: B1C_CASES.map((c) => c.name), problems }, null, 2) + "\n");
  return problems;
}

// ---- CLI.
const USAGE = "usage: b1c arms sources --gstack <checkout at B1b's pin> | arms build [--out <dir>] [--manifest] | arms check | sessions run --out <dir> [--cut <dir>] | plan | power | reuse [--head <commit>] | approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who> | done --ledger <jsonl> --item <item> | guard <work> | prepare <work> --item <item> | host-up|attach|recover|host-down <work> | launch|relaunch|rerun <work> --part <part> | table <config.json> <out.jsonl> | report <table.jsonl> [--out <dir>]";
const LAUNCHER = ["prepare", "host-up", "launch", "attach", "relaunch", "rerun", "recover", "host-down"], GUARDED = ["host-up", "launch", "relaunch"];
function guardWork(work: string, relaunching?: string) {
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  if (!isB1cItem(plan.item)) return usage("b1c launch guard: " + work + " plans " + plan.item + ", not a B1c item");
  for (const [what, check] of [["B1's none arm", reuseCheck], ["B1b's two arms", reuseB1b]] as const) for (const head of [plan.git_head, "HEAD"]) {
    const r = check(head);
    for (const l of r.lines) if (!l.startsWith("SAME ")) console.log(l);
    if (!r.same) throw new Error("E_B1_LAUNCH " + plan.item + ": at " + head + " the harness differs from the run " + what + " came from (" + r.lines.filter((l) => l.startsWith("DIFFERENT ")).join("; ") + "), so it can't be reused; take it to the Captain before launching");
  }
  const dirty = harnessDirty();
  if (dirty.length) throw new Error("E_B1_LAUNCH " + plan.item + ": the checkout holds uncommitted changes to harness paths (" + dirty.join("; ") + "); take it to the Captain before launching");
  const dir = process.env.B1C_LEDGERS ?? "", crewPath = process.env.B1C_CREW ?? "", own = process.env.LEDGER ?? "";
  if (!dir || !crewPath || !existsSync(crewPath)) usage("b1c launch guard: set B1C_LEDGERS to the folder of item ledgers (<item>.jsonl) and B1C_CREW to the crew file");
  const ledgers: Partial<Record<B1cItem, Row[]>> = {};
  for (const i of B1C_ITEMS) if (existsSync(join(dir, i + ".jsonl"))) ledgers[i] = readRows(join(dir, i + ".jsonl"));
  const mirror = join(work, "host/ledger.jsonl");
  ledgers[plan.item as B1cItem] = own && existsSync(own) ? readRows(own) : existsSync(mirror) ? readRows(mirror) : ledgers[plan.item as B1cItem] ?? [];
  const crew = JSON.parse(readFileSync(crewPath, "utf8"));
  if (typeof crew?.as_of !== "string" || typeof crew.usd !== "number" || !(crew.usd >= 0)) usage("b1c launch guard: the crew file needs as_of and usd, a number of at least 0");
  const prepared = (plan.parts as PartPlan[]).flatMap((p) => [p.name + "-a2", p.name + "-relaunch"]).map((n) => join(work, n, "l1-part.json")).filter((x) => existsSync(x)).map((x) => JSON.parse(readFileSync(x, "utf8")) as PartPlan);
  const parts = [...plan.parts, ...prepared], finished = parts.map((p) => p.name).filter((n) => n !== relaunching && existsSync(join(work, n + ".result.json")));
  const g = b1cGuard(plan.item, ledgers, { [plan.item]: { parts, finished } }, crew.usd);
  for (const l of g.lines) console.log(l);
  if (!g.ok) throw new Error("E_B1_LAUNCH " + plan.item + ": " + g.why.join("; ") + "; take it to the Captain before launching");
}
export async function b1cMain(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv, opt = (k: string) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === "arms") {
    const sub = rest[0];
    if (sub === "sources") { const p = b1cSourcesCheck(opt("gstack") ?? usage(USAGE)); for (const x of p) console.log("PROBLEM " + x); console.log(p.length ? "B1C SOURCES FAIL" : "gstack " + GSTACK_INSTALL.sha.slice(0, 12) + " " + GSTACK_INSTALL.file + " holds each install line once, and the block is B1b's route file " + PLACEMENT.blockSha256); return p.length ? 1 : 0; }
    if (sub === "build") {
      const out = opt("out") ?? ARMS_DIR();
      mkdirSync(out, { recursive: true });
      const tar = b1cBuild(out), { summary, list } = b1cManifestOf(join(out, "tree", B1C_ARM), tar);
      if (rest.includes("--manifest")) { mkdirSync(join(b1cManifestPath(), ".."), { recursive: true }); writeFileSync(b1cManifestPath(), JSON.stringify({ ...summary, inventory_sha256: sha256(list) }, null, 2) + "\n"); }
      writeFileSync(join(out, B1C_ARM + ".files.tsv"), list);
      console.log(B1C_ARM + " files=" + summary.tree.files + " tar_sha256=" + summary.tar.sha256 + " -> " + tar);
      return 0;
    }
    if (sub === "check") { const r = b1cCheck(opt("out")); for (const l of r.lines) console.log(l); console.log("B1C ARMS " + (r.pass ? "PASS" : "FAIL")); return r.pass ? 0 : 1; }
    return usage(USAGE);
  }
  if (cmd === "sessions" && rest[0] === "run") {
    const out = opt("out") ?? usage(USAGE), problems = await runB1cSessions(resolve(out)), cut = opt("cut");
    if (cut) for (const c of B1C_CASES) { rmSync(join(cut, c.name), { recursive: true, force: true }); if (existsSync(join(out, c.name, "capture"))) cpSync(join(out, c.name, "capture"), join(cut, c.name), { recursive: true }); }
    for (const p of problems) console.error("E_B1_PIN " + p);
    console.log("B1C SESSIONS " + (problems.length ? "FAIL " + problems.length : "PASS") + " " + B1C_CASES.length + " cases");
    return problems.length ? 1 : 0;
  }
  if (cmd === "plan") {
    let bad = false;
    for (const i of B1C_ITEMS) {
      const c = b1cCap(i);
      bad ||= c.cap !== B1C_CAPS_USD[i];
      console.log(i + ": " + c.parts.map((p) => p.name + " (" + partProjection(p).sessions + ")").join(", ") + "; expected $" + c.expected.toFixed(2) + ", open-session reserve $" + c.parallel.toFixed(2) + ", VM $" + c.vm.toFixed(2) + ", cap $" + c.cap + " (recorded $" + B1C_CAPS_USD[i] + ")");
    }
    console.log("all-in stop $" + B1C.stopUsd);
    if (bad) throw new Error("E_B1_INPUT a cap formula differs from its recorded cap");
    return 0;
  }
  if (cmd === "power") { for (const l of powerLines()) console.log(l); return 0; }
  if (cmd === "reuse") {
    const head = opt("head") ?? git(REPO, ["rev-parse", "HEAD"]).stdout.trim(), a = reuseCheck(head), b = reuseB1b(head);
    for (const l of [...a.lines, ...b.lines]) console.log(l);
    return a.same && b.same ? 0 : 1;
  }
  if (cmd === "approve" || cmd === "done") {
    const ledger = opt("ledger"), it = opt("item") ?? "";
    if (!ledger || !isB1cItem(it)) return usage(USAGE);
    if (cmd === "done") { b1cDone(resolve(ledger), it); console.log(it + " marked done on " + ledger); return 0; }
    const u = opt("usd") ?? "";
    if (!/^\d+(\.\d+)?$/.test(u)) return usage(USAGE);
    b1cApprove(resolve(ledger), it, Number(u), opt("approved-by") ?? "");
    console.log("approved " + it + " at $" + u + " on " + ledger);
    return 0;
  }
  if (cmd === "guard") { guardWork(resolve(rest[0] ?? usage(USAGE))); return 0; }
  if (cmd && LAUNCHER.includes(cmd)) {
    if (GUARDED.includes(cmd)) { if (!rest[0] || (cmd === "relaunch" && !opt("part"))) return usage(USAGE); guardWork(resolve(rest[0]), cmd === "relaunch" ? opt("part") : undefined); }
    l1Main(argv, B1C_PROFILE);
    return 0;
  }
  if (cmd === "table") {
    const [cfg, outPath] = rest;
    if (!cfg || !outPath) return usage(USAGE);
    const rows = buildB1cTable(JSON.parse(readFileSync(cfg, "utf8")));
    writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    console.log("wrote " + rows.length + " rows to " + outPath);
    return 0;
  }
  if (cmd === "report") {
    if (!rest[0] || rest[0].startsWith("--")) return usage(USAGE);
    const rows = readFileSync(rest[0], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as B1cRow), smoke = rows.every((r) => SMOKE_TASKS.includes(r.task));
    const bad = checkB1cRows(rows, smoke ? [...SMOKE_TASKS] : drawnTasks(loadBundle()).run);
    if (bad.length) { for (const b of bad) console.error("E_USAGE b1c report: " + b); return 2; }
    const r = b1cReport(rows, b1bControls(), b1References(), smoke ? SMOKE_TASKS.length : B1.tasks, smoke);
    for (const l of r.lines) console.log(l);
    const out = opt("out");
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, "report.txt"), r.lines.join("\n") + "\n"); writeFileSync(join(out, "reasons.tsv"), reasonsTsv(rows)); }
    return 0;
  }
  return usage(USAGE);
}
