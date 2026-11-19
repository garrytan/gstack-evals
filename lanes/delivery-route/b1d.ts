// Copyright (c) 2026 Garry Tan. MIT License.
// B1d, the hook on by default (lanes/delivery-route/README.md, "B1d"; prereg B1D_BUNDLE): gstack main at the commit that
// makes installed skills routable, installed by its own setup with its hooks on by default, and B1's prove-it skill beside
// it. On Opus 5.5, unattended, with B1's plain prompt, does gstack's own prompt-routing hook get prove-it loaded? The primary
// is the point count on B1's 60 run tasks (in-sample for gstack's routing, which was tuned on those prompts). A held-out set
// of 60 tasks, drawn with a sealed seed, runs the arm beside B1c's project-file arm, that arm without its escape clause and
// B1's no-gstack arm. This file holds the arms' manifests and checks, the keyless route table, the plan, caps and launch
// guard, the reuse checks, the session rows, the report with its decision readings, the power table and the keyless
// scripted sessions.
//
//   bun lanes/delivery-route/cli.ts b1d <command> (USAGE below)
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hostTtlHours, itemCheck, L1, l1Main, plannedCells, prefixOf, seeded, type ItemDef, type PartPlan, type Profile, type Rect } from "../../quick/laneb/l1/l1.ts";
import { parseLog, type Rec } from "../../quick/laneb/l1/probes.ts";
import { readSessionRows, sessionsByTrial } from "../../quick/laneb/analysis/analyze.ts";
import { appendRow, fromMicros, Ledger, readRows, toMicros, type Row } from "../../quick/laneb/runner/ledger.ts";
import { ROUTE_CONTEXT, ROUTE_MARK } from "../../quick/laneb/runner/proxy.ts";
import { manifest } from "../../quick/laneb/arms/tree.ts";
import { sdkPython, SESSION_IMAGE } from "../harness-mechanics/sessions.ts";
import { maxGaps, newcombe, wilson } from "./analyze.ts";
import { build as b1Build, LAYOUT, TAR_ARGS, wrappers } from "./arms.ts";
import { b1References, loadsOf, paired, promptOf, reuseCheck, type Load } from "./b1b.ts";
import { armInfo, b1cBuild, whyNot as blockWhyNot } from "./b1c.ts";
import { PLACEMENT } from "./b1c-pins.ts";
import { B1C_RUN, B1D, B1D_ARM, B1D_ARM_NAMES, B1D_ARMS, B1D_BUNDLE, B1D_CAPS_USD, B1D_ITEMS, B1D_SMOKE, B1D_SPEC, COPIED_MANIFESTS, GSTACK_ARM, HELDOUT, isB1dArm, isB1dItem, NOESCAPE, NOESCAPE_SPEC, PROVE_IT, type B1dArm, type B1dItem } from "./b1d-pins.ts";
import { blockUsd, infraRerun, needsRerun } from "./money.ts";
import { AGENT_SKILLS, ARM_SOURCES, B1, drawnTasks, frontMatterDigests, loadBundle, MODELS, REPO, sha256, SKILL, TASK_SETUP, VM_HOURS_PER_SESSION } from "./pins.ts";
import { b1Row, pulledInputs, type B1Row, type B1TableConfig } from "./table.ts";
import { BASE, CLAUDE_LISTED, LISTING } from "./sessions.ts";

const pinErr = (m: string): never => { throw new Error("E_B1_PIN " + m); };
const usage = (m: string): never => { throw new Error("E_USAGE " + m); };
const git = (dir: string, args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
export const ARMS_DIR = () => process.env.B1D_ARMS_DIR ?? join(process.env.HOME ?? "", ".capy/work/b1d/arms");
export const manifestDir = () => join(REPO, "quick/laneb", B1D.armManifests);
const tarVersion = () => spawnSync("tar", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0] ?? "";
const gstackFile = (tree: string, f: string) => join(tree, ".claude/skills/gstack", f);

// ---- The gstack-main arm. b1d-build.sh builds the tree and tar (gstack's setup is not byte for byte from one build to the
// next, so the tar is kept and checked against its manifest, never rebuilt); this checks what the tree must hold.
const MARKERS = [".activated", ".completeness-intro-seen", ".feature-prompted-model-overlay", ".first-loop-tip-shown", ".proactive-prompted", ".telemetry-prompted"];
export function settingsHooks(tree: string): [string, string | null, string, number, string][] {
  const s = JSON.parse(readFileSync(join(tree, ".claude/settings.json"), "utf8")), out: [string, string | null, string, number, string][] = [];
  for (const [event, entries] of Object.entries(s.hooks ?? {})) for (const e of entries as any[]) for (const h of e.hooks ?? []) {
    const cmd = String(h.command ?? ""), dir = "/root/.claude/skills/gstack/hosts/claude/hooks/";
    out.push([event, e.matcher ?? null, cmd.startsWith(dir) ? cmd.slice(dir.length) : cmd, Number(h.timeout), String(e._gstack_source ?? "")]);
  }
  return out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
/** What the built tree must hold: B1's prove-it skill byte for byte, gstack's files at their pinned blobs, the checkout at the
 *  pin, the four hook registrations setup writes, and Lane B's seeded long-time user. */
export function armProblems(tree: string): string[] {
  const p: string[] = [], skill = join(tree, PROVE_IT.path);
  if (!existsSync(skill) || !readFileSync(skill).equals(readFileSync(join(REPO, ARM_SOURCES, PROVE_IT.source))) || (statSync(skill).mode & 0o777) !== PROVE_IT.mode) p.push(PROVE_IT.path + " is not B1's " + PROVE_IT.source + " at mode 644");
  for (const [f, blob] of Object.entries(GSTACK_ARM.blobs)) {
    const got = existsSync(gstackFile(tree, f)) ? spawnSync("git", ["hash-object", gstackFile(tree, f)], { encoding: "utf8" }).stdout.trim() : "missing";
    if (got !== blob) p.push(".claude/skills/gstack/" + f + " is blob " + got + ", not " + blob);
  }
  const head = spawnSync("git", ["--git-dir", gstackFile(tree, ".git"), "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  if (head !== GSTACK_ARM.sha) p.push("the gstack checkout is at " + (head || "nothing") + ", not " + GSTACK_ARM.sha);
  const want = [...GSTACK_ARM.hooks].map((h) => [...h]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (!existsSync(join(tree, ".claude/settings.json"))) p.push("no .claude/settings.json");
  else if (JSON.stringify(settingsHooks(tree)) !== JSON.stringify(want)) p.push("settings.json registers " + JSON.stringify(settingsHooks(tree)) + ", not " + JSON.stringify(want));
  const cfg = existsSync(join(tree, ".gstack/config.yaml")) ? readFileSync(join(tree, ".gstack/config.yaml"), "utf8") : "";
  for (const l of ["update_check: false", "routing_declined: true"]) if (!new RegExp("^" + l + "$", "m").test(cfg)) p.push(".gstack/config.yaml does not set " + l);
  if (/^skill_routing:|^skill_contracts:/m.test(cfg)) p.push(".gstack/config.yaml sets a switch; both stay at gstack's default");
  for (const m of MARKERS) if (!existsSync(join(tree, ".gstack", m))) p.push("the seeded user's marker .gstack/" + m + " is missing");
  return p;
}
export function mainManifestOf(out: string) {
  const tree = join(out, "trees", B1D_ARM), tar = join(out, B1D_ARM + ".tar"), gz = join(out, B1D_ARM + ".tar.gz"), w = wrappers();
  const fetch = JSON.parse(readFileSync(join(out, "fetch-pin.json"), "utf8"));
  if (fetch.sha !== GSTACK_ARM.sha || fetch.head !== GSTACK_ARM.sha) pinErr("fetch-pin.json is not the pin " + GSTACK_ARM.sha);
  const config = Object.fromEntries(readFileSync(join(out, B1D_ARM + ".gstack-config.tsv"), "utf8").trim().split("\n").map((l) => l.split("\t")));
  if (JSON.stringify(config) !== JSON.stringify(GSTACK_ARM.config)) pinErr("gstack-config reads " + JSON.stringify(config) + " in the built arm, not " + JSON.stringify(GSTACK_ARM.config));
  const files = Object.keys(GSTACK_ARM.blobs).map((f) => ({ path: ".claude/skills/gstack/" + f, sha256: sha256(readFileSync(gstackFile(tree, f))) }));
  const meta = {
    claude_code: "2.1.312", typed: false, spec: B1D_SPEC, tar_gz_sha256: sha256(readFileSync(gz)),
    gstack: { repo: GSTACK_ARM.repo, sha: GSTACK_ARM.sha, version: GSTACK_ARM.version, setup: GSTACK_ARM.setup, git_archive_sha256: fetch.git_archive_sha256, fetch: fetch.method },
    update_check: "false", routing_declined: "true", onboarding_markers: MARKERS.map((m) => ".gstack/" + m).join(" "), gstack_config: config, loadout_lock_sha256: sha256(readFileSync(join(out, B1D_ARM + ".loadout.lock.json"))),
    steps: { sha256: w.steps_sha256, bytes: w.steps_bytes, source: AGENT_SKILLS.repo + " " + AGENT_SKILLS.sha + " " + AGENT_SKILLS.steps.file + " lines " + AGENT_SKILLS.steps.from + "-" + AGENT_SKILLS.steps.to },
    carrier: { ...w.arms["gstack-shaped"]!, path: PROVE_IT.path }, route: { files },
    tar_command: "tar " + TAR_ARGS.join(" ") + " -cf <arm>.tar .claude .gstack (" + tarVersion() + ", in quick/laneb/arms/Dockerfile's builder image)",
  };
  return manifest(B1D_ARM, tree, tar, meta);
}

// ---- The held-out arms beside it: B1c's project-md and B1's none rebuilt byte for byte, and project-md-noescape, B1c's arm
// with its block's escape clause removed. Their manifests sit in B1d's manifest folder: B1c's and B1's copied byte for byte.
export function noescapeBlock(): string {
  const b = readFileSync(join(REPO, ARM_SOURCES, PLACEMENT.blockSource), "utf8");
  if (sha256(b) !== PLACEMENT.blockSha256) pinErr(PLACEMENT.blockSource + " is not B1b's routing block");
  if (b.split(NOESCAPE.from).length !== 2) pinErr("B1b's block holds the escape clause " + (b.split(NOESCAPE.from).length - 1) + " times, not once");
  return b.replace(NOESCAPE.from, NOESCAPE.to);
}
export const noescapeLayout = () => [...LAYOUT["gstack-shaped"], { path: PLACEMENT.block, source: NOESCAPE.source, mode: 0o644 }, { path: PLACEMENT.script, source: PLACEMENT.scriptSource, mode: 0o755 }];
export function noescapeBuild(out: string): string {
  const tree = join(out, "tree", NOESCAPE.arm), tops = new Set<string>();
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(join(tree, ".claude/skills"), { recursive: true });
  for (const f of noescapeLayout()) {
    const dest = join(tree, f.path);
    tops.add(f.path.split("/")[0]!);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, readFileSync(join(REPO, ARM_SOURCES, f.source)));
    chmodSync(dest, f.mode);
  }
  for (const t of tops) spawnSync("find", [join(tree, t), "-type", "d", "-exec", "chmod", "755", "{}", "+"]);
  const tar = join(out, NOESCAPE.arm + ".tar");
  const r = spawnSync("tar", [...TAR_ARGS, "-cf", tar, "-C", tree, ...[...tops].sort()], { encoding: "utf8" });
  if (r.status !== 0) pinErr("tar for " + NOESCAPE.arm + " failed: " + r.stderr.trim());
  return tar;
}
export function noescapeManifestOf(out: string) {
  const tree = join(out, "tree", NOESCAPE.arm), w = wrappers();
  const files = noescapeLayout().slice(LAYOUT["gstack-shaped"].length).map((f) => ({ path: f.path, sha256: sha256(readFileSync(join(tree, f.path))) }));
  const meta = { claude_code: "2.1.312", typed: false, spec: NOESCAPE_SPEC, steps: { sha256: w.steps_sha256, bytes: w.steps_bytes, source: AGENT_SKILLS.repo + " " + AGENT_SKILLS.sha + " " + AGENT_SKILLS.steps.file + " lines " + AGENT_SKILLS.steps.from + "-" + AGENT_SKILLS.steps.to }, carrier: { ...w.arms["gstack-shaped"]!, path: LAYOUT["gstack-shaped"][0]!.path }, route: { from: "B1c's project-md arm", block_change: { removed: NOESCAPE.from, put: NOESCAPE.to }, files, placed_at: PLACEMENT.project }, tar_command: "tar " + TAR_ARGS.join(" ") + " -cf <arm>.tar <top folders> (" + tarVersion() + ")" };
  return manifest(NOESCAPE.arm, tree, join(out, NOESCAPE.arm + ".tar"), meta);
}
/** Builds the three small held-out tars into out (none and project-md by B1's and B1c's own builders) and returns their paths. */
export function smallBuild(out: string): Record<string, string> {
  const scratch = mkdtempSync(join(tmpdir(), "b1d-b1-"));
  try { copyFileSync(b1Build(scratch).none, join(out, "none.tar")); } finally { rmSync(scratch, { recursive: true, force: true }); }
  return { none: join(out, "none.tar"), "project-md": b1cBuild(out), [NOESCAPE.arm]: noescapeBuild(out) };
}
/** Every arm's tar at its manifest, the copied manifests byte for byte, the noescape block one change from B1b's, the small
 *  tars rebuilt byte for byte, and the gstack-main tree's own checks. */
export function armsCheck(out = ARMS_DIR()): { pass: boolean; lines: string[] } {
  const lines: string[] = [], problems: string[] = [], m = (a: string) => join(manifestDir(), a + ".json");
  for (const [a, src] of Object.entries(COPIED_MANIFESTS)) {
    if (!existsSync(m(a)) || !readFileSync(m(a)).equals(readFileSync(join(REPO, "quick/laneb", src)))) problems.push(B1D.armManifests + "/" + a + ".json is not " + src + " byte for byte");
    else lines.push(a + ": manifest is " + src + " byte for byte");
  }
  const block = readFileSync(join(REPO, ARM_SOURCES, NOESCAPE.source), "utf8");
  if (block !== noescapeBlock()) problems.push(NOESCAPE.source + " is not B1b's block with only its escape clause removed");
  else lines.push(NOESCAPE.arm + ": block is B1b's with " + JSON.stringify(NOESCAPE.from) + " replaced by " + JSON.stringify(NOESCAPE.to) + ", sha256 " + sha256(block));
  const scratch = mkdtempSync(join(tmpdir(), "b1d-arms-"));
  try {
    const small = smallBuild(scratch);
    for (const [a, tar] of Object.entries(small)) {
      const want = existsSync(m(a)) ? JSON.parse(readFileSync(m(a), "utf8")).tar?.sha256 : null, got = sha256(readFileSync(tar));
      if (got !== want) problems.push(a + ": the rebuilt tar is sha256 " + got + ", not the manifest's " + want);
      else lines.push(a + ": tar " + got + " rebuilt byte for byte");
    }
    if (existsSync(m(NOESCAPE.arm))) {
      const got = noescapeManifestOf(scratch).summary as any, want = JSON.parse(readFileSync(m(NOESCAPE.arm), "utf8"));
      if (got.tree.digest !== want.tree?.digest || JSON.stringify(got.route) !== JSON.stringify(want.route) || want.spec !== NOESCAPE_SPEC) problems.push(NOESCAPE.arm + ": the rebuilt tree, route files or spec differ from the manifest");
    } else problems.push("no manifest " + m(NOESCAPE.arm));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  if (!existsSync(m(B1D_ARM))) problems.push("no manifest " + m(B1D_ARM));
  else {
    const want = JSON.parse(readFileSync(m(B1D_ARM), "utf8")), gz = join(out, B1D_ARM + ".tar.gz");
    const got = existsSync(gz) ? spawnSync("sh", ["-c", 'gzip -dc "$1" | sha256sum', "sh", gz], { encoding: "utf8" }).stdout.split(" ")[0] : "missing";
    if (got !== want.tar?.sha256) problems.push(B1D_ARM + ": " + gz + " unpacks to sha256 " + got + ", not the manifest's " + want.tar?.sha256);
    else if (sha256(readFileSync(gz)) !== want.tar_gz_sha256) problems.push(B1D_ARM + ": the tar.gz is not the manifest's tar_gz_sha256");
    else lines.push(B1D_ARM + ": tar.gz " + want.tar_gz_sha256 + " unpacks to the manifest's tar " + want.tar.sha256);
    if (want.spec !== B1D_SPEC) problems.push(B1D_ARM + ": the manifest's spec is not " + B1D_SPEC);
    const tree = join(out, "trees", B1D_ARM);
    if (existsSync(tree)) { const p = armProblems(tree); problems.push(...p.map((x) => B1D_ARM + ": " + x)); if (!p.length) lines.push(B1D_ARM + ": the tree holds prove-it byte for byte, gstack " + GSTACK_ARM.sha.slice(0, 12) + "'s files at their blobs, " + GSTACK_ARM.hooks.length + " hook registrations and the seeded user"); }
    else problems.push(B1D_ARM + ": no tree at " + tree);
  }
  for (const p of problems) lines.push("PROBLEM " + p);
  return { pass: !problems.length, lines };
}

// ---- The keyless route table: gstack's own matcher (lib/skill-route.ts) and its real hook, from the built arm tree, on each
// task's prompt as the rig sends it (b1b.ts promptOf). The hook runs with HOME at a scratch folder that links the tree's
// .claude and holds a copy of its .gstack, so its log never lands in the tree.
export const HOOK = ".claude/skills/gstack/hosts/claude/hooks/skill-route-hook";
export const LINE = /this request fits \/([\w:-]+)(?: or \/([\w:-]+))?\./;
export type Position = "only" | "first of two" | "second of two" | "not named";
export const POSITIONS: Position[] = ["only", "first of two", "second of two", "not named"];
export const positionOf = (names: string[]): Position => { const i = names.indexOf(SKILL); return i === 0 ? (names.length === 2 ? "first of two" : "only") : i === 1 ? "second of two" : "not named"; };
export const ROUTE_HEADER = "kind\ttask\tprompt_sha256\tchars\tlib_routes\thook_names\tagree\tprove_it\tline_sha256";
export async function routeTable(tree: string, prompts: { kind: string; task: string; prompt: string }[]): Promise<string[][]> {
  const home = mkdtempSync(join(tmpdir(), "b1d-routes-"));
  try {
    symlinkSync(join(tree, ".claude"), join(home, ".claude"));
    cpSync(join(tree, ".gstack"), join(home, ".gstack"), { recursive: true });
    const lib = await import(join(tree, ".claude/skills/gstack/lib/skill-route.ts"));
    const { skills, problems } = lib.scanInstalledSkills(join(home, ".claude/skills"));
    if (problems.length) pinErr("gstack's skill scan reports " + problems.join("; "));
    return prompts.map(({ kind, task, prompt }) => {
      const d = lib.routePrompt(prompt, skills), libNames: string[] = d.route ? d.routes.map((r: any) => r.skill) : [];
      const r = spawnSync("bash", [join(tree, HOOK)], { input: JSON.stringify({ session_id: "b1d-route", prompt }), encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: home } });
      if (r.status !== 0) pinErr(task + ": the hook exited " + r.status + " (" + (r.stderr ?? "").slice(0, 200) + ")");
      const line = (JSON.parse(r.stdout || "{}").hookSpecificOutput?.additionalContext ?? "") as string, m = LINE.exec(line);
      if (line && !m) pinErr(task + ": the hook printed a line that names no skill the way gstack's hint lines do");
      const names = m ? [m[1]!, m[2]].filter((x): x is string => !!x) : [];
      return [kind, task, sha256(prompt), String(prompt.length), libNames.join(",") || "-", names.join(",") || "-", String(libNames.join(",") === names.join(",")), positionOf(names), line ? sha256(line) : "-"];
    });
  } finally { rmSync(home, { recursive: true, force: true }); }
}
export const routeTsv = (rows: string[][]) => [ROUTE_HEADER, ...rows.map((r) => r.join("\t"))].join("\n") + "\n";
export const readRouteTsv = (text: string) => text.trim().split("\n").slice(1).map((l) => l.split("\t"));
/** The counts the prereg reports from a route table's rows of one kind. */
export function routeCounts(rows: string[][]) {
  const n = { tasks: rows.length, only: 0, "first of two": 0, "second of two": 0, "not named": 0, verify: 0, qa: 0, review: 0, other: 0, nothing: 0, two_names: 0, disagree: 0 };
  for (const r of rows) {
    n[r[7] as Position]++;
    const names = r[5] === "-" ? [] : r[5]!.split(",");
    if (!names.length) n.nothing++;
    if (names.length === 2) n.two_names++;
    for (const s of names) if (s === "verify" || s === "qa" || s === "review") n[s]++; else if (s !== SKILL) n.other++;
    if (r[6] !== "true") n.disagree++;
  }
  return n;
}
/** Whether a route table's held-out counts are the committed draw's coverage. */
export const isHeldoutCoverage = (n: ReturnType<typeof routeCounts>) => n.only === HELDOUT.coverage.only && n["first of two"] === HELDOUT.coverage.first && n["second of two"] === HELDOUT.coverage.second && n["not named"] === HELDOUT.coverage.none;
/** Each task's keyless route and prompt length, from a route table: the strata the report splits loads by. */
export type TaskRoute = { position: Position; chars: number };
export const routesByTask = (rows: string[][]) => new Map(rows.map((r) => [r[1]!, { position: r[7] as Position, chars: Number(r[3]) }]));
export const routeFile = () => join(REPO, B1D_BUNDLE, "route-table.tsv");
function committedRouteRows(): string[][] {
  const want = frontMatterDigests(readFileSync(join(REPO, B1D_BUNDLE, "README.md"), "utf8")).get("route-table.tsv"), text = readFileSync(routeFile(), "utf8");
  if (sha256(text) !== want) pinErr(B1D_BUNDLE + "/route-table.tsv hashes to " + sha256(text) + ", not its front matter's " + want);
  return readRouteTsv(text);
}
export function inSampleRoutes(): Map<string, TaskRoute> {
  return routesByTask(committedRouteRows().filter((r) => r[0] === "run" || r[0] === "calibration"));
}

// ---- The held-out list: read from B1D_HELDOUT, refused unless it is the committed draw.
export function heldoutTasks(path = process.env[HELDOUT.env] ?? ""): string[] {
  if (!path || !existsSync(path)) usage("set " + HELDOUT.env + " to the sealed held-out list (draw.py's out file)");
  const text = readFileSync(path, "utf8"), list = text.split("\n").filter(Boolean), h = (xs: string[]) => sha256(xs.join("\n") + "\n");
  if (list.length !== HELDOUT.tasks || h(list) !== HELDOUT.drawSha256 || h([...list].sort()) !== HELDOUT.sortedSha256) pinErr(path + " is not the committed held-out draw (draw-order sha256 " + HELDOUT.drawSha256 + ")");
  return list;
}

// ---- Plan, profile and money.
const item = (capUsd: number): ItemDef => ({ capUsd, taskSet: "swerebench-r3a4", cells: MODELS.opus.cells, allowanceUsd: MODELS.opus.allowanceUsd, model: MODELS.opus.id });
export const B1D_ITEM_DEFS = Object.fromEntries(B1D_ITEMS.map((i) => [i, item(B1D_CAPS_USD[i])])) as Record<B1dItem, ItemDef>;
/** b1d-smoke: the pilot, the two smoke tasks on all four arms, one part. b1d-in: B1's 60 run tasks in draw order, gstack-main, 20 a part.
 *  b1d-ho: the 60 held-out tasks in draw order, all four arms, 20 tasks a part with every arm of a task in its part. Each
 *  part's cells run in the order L1's seeded() gives with B1's seed. A held-out list of null plans placeholder names, for
 *  counts and caps only. */
export function b1dPlan(name: string, run: string[], heldout: string[] | null): { parts: PartPlan[]; sessions: number } {
  const part = (p: string, rects: Rect[]): PartPlan => ({ name: p, prefix: prefixOf(name, p), rects: seeded(rects, B1.seed) });
  const split = (tasks: string[], arms: string[], tag: string) => Array.from({ length: Math.ceil(tasks.length / B1D.partTasks) }, (_, i) => part(tag + "-" + (i + 1), [{ tasks: tasks.slice(i * B1D.partTasks, (i + 1) * B1D.partTasks), arms, attempts: 1 }]));
  let parts: PartPlan[];
  if (name === "b1d-smoke") parts = [part("smoke-opus", [{ tasks: [...B1D_SMOKE], arms: [...B1D_ARM_NAMES], attempts: 1 }])];
  else if (name === "b1d-in") parts = split(run, [B1D_ARM], "b1d-in");
  else if (name === "b1d-ho") parts = split(heldout ?? Array.from({ length: HELDOUT.tasks }, (_, k) => "held-out-" + k), [...B1D_ARM_NAMES], "b1d-ho");
  else return usage("unknown item " + name + "; one of " + B1D_ITEMS.join(", "));
  return { parts, sessions: parts.flatMap((p) => [...plannedCells(p).values()]).reduce((a, b) => a + b, 0) };
}
export const B1D_PROFILE: Profile = {
  items: B1D_ITEM_DEFS,
  armSpecs: Object.fromEntries(B1D_ARM_NAMES.map((a) => [a, B1D_ARMS[a].spec])),
  tars: [...B1D_ARM_NAMES],
  armManifests: B1D.armManifests,
  hostRoot: B1D.hostRoot,
  ledgerPort: B1D.ledgerPort,
  seed: B1.seed,
  concurrent: B1.concurrent,
  taskSetup: TASK_SETUP,
  attempt2: { skip: () => null, owed: (runs) => { const rows = runs.flatMap((r) => { const c = pulledInputs(r.dir, r.part); return c.jobs.length ? buildB1dTable(c) : []; }); return { owed: rows.filter(needsRerun).map((r) => ({ task: r.task, arm: r.arm, reason: r.reason })), rects: infraRerun(rows).rects }; } },
  parts: (name, _frozen, inputs) => {
    const b = loadBundle();
    for (const [f, d] of b.digests) inputs[f] = d;
    for (const [f, d] of frontMatterDigests(readFileSync(join(REPO, B1D_BUNDLE, "README.md"), "utf8"))) inputs["b1d/" + f] = d;
    if (name === "b1d-ho") inputs["b1d/heldout"] = HELDOUT.drawSha256;
    return b1dPlan(name, drawnTasks(b).run, name === "b1d-ho" ? heldoutTasks() : null).parts;
  },
};
const sessionsOf = (p: PartPlan) => [...plannedCells(p).values()].reduce((a, b) => a + b, 0);
/** A part's planned model spend at each arm's planning rate and its part VM's 4-hour blocks. */
export function partProjection(p: PartPlan) {
  let model = 0;
  for (const [cell, n] of plannedCells(p)) { const arm = cell.split("\t")[1]!; model += toMicros(n * (isB1dArm(arm) ? B1D_ARMS[arm].rateUsd : usage("a planned cell has arm " + arm))); }
  const sessions = sessionsOf(p);
  return { sessions, model, vm: toMicros(Math.max(1, Math.ceil((sessions * VM_HOURS_PER_SESSION) / Number(L1.vm.reserveHours))) * blockUsd) };
}
const parallelUsd = (parts: PartPlan[]) => Math.min(B1.concurrent, Math.max(0, ...parts.map(sessionsOf))) * MODELS.opus.allowanceUsd;
/** The crew's cap rule: ceil10(1.35 x expected model spend + the open-session reserve + VM share). */
export function b1dCap(name: B1dItem) {
  const parts = b1dPlan(name, drawnTasks(loadBundle()).run, null).parts, proj = parts.map(partProjection);
  const expected = fromMicros(proj.reduce((x, p) => x + p.model, 0));
  const vm = fromMicros(proj.reduce((x, p) => x + p.vm, 0)) + hostTtlHours(parts.length) * L1.host.usdPerHour;
  return { parts, sessions: proj.reduce((x, p) => x + p.sessions, 0), expected, parallel: parallelUsd(parts), vm, cap: Math.ceil((1.35 * expected + parallelUsd(parts) + vm) / 10) * 10 };
}
export function b1dApprove(path: string, name: string, capUsd: number, by: string) {
  if (!isB1dItem(name)) return usage("b1d approve: unknown item " + name + "; one of " + B1D_ITEMS.join(", "));
  if (!by.trim()) usage("b1d approve: --approved-by names who recorded the cap");
  if (toMicros(capUsd) !== toMicros(B1D_CAPS_USD[name])) usage("refused: " + name + "'s recorded cap is $" + B1D_CAPS_USD[name] + ", not $" + capUsd);
  if (readRows(path).length) usage("refused: " + path + " already holds rows; an item's ledger starts with its approval row");
  new Ledger(path, name).approve(capUsd, { approved_by: by, source: "B1d hook default prereg: the cap recorded for " + name });
  itemCheck(readRows(path), name, B1D_CAPS_USD[name]);
}
const VM_ID = /(^|\/)vm(-\d+)?$|^host-\d+$/;
export function b1dTotals(rows: Row[], name: B1dItem) {
  const t = { cap: toMicros(B1D_CAPS_USD[name]), settled: 0, open: 0, openIds: [] as string[], done: rows.some((r) => r.kind === "note" && r.id === "done"), vmSettled: 0, vmOpen: 0, hostOpen: false };
  if (!rows.length) return t;
  const approval = rows.find((r) => r.kind === "approval");
  if (!approval || approval.item !== name || approval.usd_micros !== t.cap) usage("refused: the ledger for " + name + " does not open with its approval row at $" + B1D_CAPS_USD[name]);
  const reserved = new Map<string, number>(), settled = new Map<string, number>();
  for (const r of rows) { if (r.kind === "reserve") reserved.set(r.id, r.usd_micros); if (r.kind === "settle") settled.set(r.id, r.usd_micros); }
  for (const [id, v] of settled) { t.settled += v; if (VM_ID.test(id)) t.vmSettled += v; }
  for (const [id, v] of reserved) { if (settled.has(id)) continue; t.open += v; t.openIds.push(id); if (VM_ID.test(id)) t.vmOpen += v; if (/^host-\d+$/.test(id)) t.hostOpen = true; }
  return t;
}
export function b1dDone(path: string, name: B1dItem) {
  const t = b1dTotals(readRows(path), name);
  if (t.done) usage("refused: " + name + " is marked done already");
  if (t.openIds.length) usage("refused: " + name + " still holds " + t.openIds.length + " open reservations; settle them first");
  appendRow(path, { ts: new Date().toISOString(), item: name, kind: "note", id: "done", usd_micros: 0 });
}
/** The launch guard: the item's spend so far plus its unfinished parts at planned spend, the open-session reserve and the VM
 *  share, against its cap; and every item (a done item at its settled spend, any other at the larger of its spend and its
 *  projection) plus this lane's counter, against the all-in stop. */
export function b1dGuard(name: B1dItem, ledgers: Partial<Record<B1dItem, Row[]>>, plans: Partial<Record<B1dItem, { parts: PartPlan[]; finished: string[] }>>, crewUsd: number) {
  const why: string[] = [];
  const all = B1D_ITEMS.map((i) => {
    const t = b1dTotals(ledgers[i] ?? [], i), plan = plans[i] ?? { parts: b1dPlan(i, drawnTasks(loadBundle()).run, null).parts, finished: [] };
    const left = plan.parts.filter((p) => !plan.finished.includes(p.name)), proj = left.map(partProjection);
    const model = t.settled - t.vmSettled + t.open - t.vmOpen + proj.reduce((x, p) => x + p.model, 0) + toMicros(parallelUsd(left));
    const host = !t.hostOpen && left.length ? toMicros(hostTtlHours(left.length) * L1.host.usdPerHour) : 0;
    const total = model + t.vmSettled + t.vmOpen + host + proj.reduce((x, p) => x + p.vm, 0);
    return { item: i, ...t, total, left: left.length, counted: t.done ? t.settled : Math.max(t.settled + t.open, total) };
  });
  const own = all.find((x) => x.item === name)!, usd = (m: number) => "$" + fromMicros(m).toFixed(2);
  if (own.done) why.push(name + " is marked done; a done item never launches again");
  if (own.total > own.cap) why.push(name + "'s projection " + usd(own.total) + " passes its cap " + usd(own.cap));
  const sum = all.reduce((x, i) => x + i.counted, 0) + toMicros(crewUsd), stop = toMicros(B1D.stopUsd);
  if (sum > stop) why.push("all-in " + usd(sum) + " passes the " + usd(stop) + " stop");
  const lines = ["B1D_LAUNCH " + (why.length ? "REFUSE" : "PASS") + " " + name + ": all-in " + usd(sum) + " of " + usd(stop) + "; " + name + " " + usd(own.total) + " of cap " + usd(own.cap) + " (" + own.left + " parts to run)", ...all.map((i) => "  " + i.item + (i.done ? " done" : "") + ": settled " + usd(i.settled) + ", open " + usd(i.open) + ", counted " + usd(i.counted)), "  crew " + usd(toMicros(crewUsd))];
  return { ok: !why.length, why, lines };
}

// ---- Reuse: B1c's arm runs again on the held-out set and its published rows are the in-sample control, so the trees that
// decided what its sessions got must be the same at B1d's run commit as at B1c's; B1's none arm likewise (b1b.ts reuseCheck).
export function reuseB1c(head: string, repo = REPO): { same: boolean; lines: string[] } {
  const lines: string[] = [];
  let same = true;
  for (const p of B1C_RUN.harness) {
    const a = git(repo, ["rev-parse", B1C_RUN.commit + ":" + p]).stdout.trim(), b = git(repo, ["rev-parse", head + ":" + p]).stdout.trim();
    const ok = !!a && a === b;
    same &&= ok;
    lines.push((ok ? "SAME " : "DIFFERENT ") + p + " " + (a || "missing") + (ok ? "" : " at " + B1C_RUN.commit.slice(0, 12) + ", " + (b || "missing") + " at " + head.slice(0, 12)));
  }
  const models = [...new Set(b1cRows().map((r) => r.model))], ok = models.length === 1 && models[0] === MODELS.opus.id;
  same &&= ok;
  lines.push((ok ? "SAME " : "DIFFERENT ") + "model " + models.join(",") + " on B1c's rows and " + MODELS.opus.id + " in pins.ts");
  lines.push("REUSE " + (same ? "PASS" : "FAIL") + ": B1c's run " + B1C_RUN.commit.slice(0, 12) + " and " + head.slice(0, 12));
  return { same, lines };
}
export const B1D_FILES = ["lanes/delivery-route/arms/b1d", "lanes/delivery-route/b1d-pins.ts", "lanes/delivery-route/b1d.ts", "lanes/delivery-route/b1d-build.sh", "quick/laneb/arms/manifests/b1d", "quick/laneb/arms/Dockerfile"];
/** The checkout's uncommitted changes to any path that decides a session: L1's host-up syncs the live quick/laneb folder. */
export function harnessDirty(repo = REPO): string[] {
  const r = git(repo, ["status", "--porcelain", "--", ...new Set([...B1C_RUN.harness, ...B1D_FILES])]);
  if (r.status !== 0) pinErr("git status failed in " + repo + ": " + (r.stderr ?? "").trim());
  return r.stdout.split("\n").filter(Boolean);
}

// ---- Session rows: did prove-it load, what did the hook name, did /verify load instead, and why a graded session didn't.
const blocksOf = (r: Rec): any[] => (Array.isArray(r.content) ? r.content : []);
const resultText = (b: any): string => (typeof b?.content === "string" ? b.content : Array.isArray(b?.content) ? b.content.map((x: any) => x?.text ?? "").join("\n") : "");
export type VerifyLoad = { loaded: boolean; via: "Skill" | "Read" | "Bash" | null; at_call: number | null };
/** gstack's own /verify loaded: a Skill call naming verify, a Read of a verify/SKILL.md, or a Bash call that prints one, each
 *  with a result that is not an error (a Bash result must hold the skill's "# /verify" heading). */
export function verifyLoadOf(recs: Rec[]): VerifyLoad {
  const calls: { id: string; name: string; input: any; n: number }[] = [], results = new Map<string, any>();
  let n = 0;
  for (const r of recs) for (const b of blocksOf(r)) {
    if (r.type === "AssistantMessage" && typeof b?.name === "string" && typeof b?.id === "string") calls.push({ id: b.id, name: b.name, input: b.input ?? {}, n: ++n });
    else if (r.type === "UserMessage" && typeof b?.tool_use_id === "string") results.set(b.tool_use_id, b);
  }
  const hit = calls.find((c) => {
    const shaped = (c.name === "Skill" && String(c.input.skill ?? "").replace(/^\//, "") === "verify") || (c.name === "Read" && /\/verify\/SKILL\.md$/.test(String(c.input.file_path ?? ""))) || (c.name === "Bash" && String(c.input.command ?? "").includes("/verify/SKILL.md"));
    const res = results.get(c.id);
    return shaped && !!res && !res.is_error && (c.name !== "Bash" || resultText(res).includes("# /verify"));
  });
  return { loaded: !!hit, via: (hit?.name as VerifyLoad["via"]) ?? null, at_call: hit?.n ?? null };
}
/** The skills the hook named in a session, from its own log (gstack-hooks/hooks/skill-route.log, copied out after the
 *  session): the routed line's skill= and also=. null when the copy failed, the arm has no hook, or the log holds no
 *  event= line (the hook logs one on every prompt, routed or not, so such a log is no evidence it ran). */
export function namedOf(log: string | null): string[] | null {
  if (log === null || !/\bevent=/.test(log)) return null;
  const line = log.split("\n").filter((l) => /\bevent=routed\b/.test(l)).at(-1);
  if (!line) return [];
  return [/\bskill=(\S+)/.exec(line)?.[1], /\balso=(\S+)/.exec(line)?.[1]].filter((x): x is string => !!x);
}
export type B1dRow = B1Row & { arm: B1dArm; load: Load; verify: VerifyLoad; named: string[] | null; position: Position | null; route_mark: boolean | "quoted" | null; placed: boolean | null; first_call: boolean; why_not: string | null };
export const WHY_NOT_MAIN = ["hook log missing", "hook did not name prove-it", "line not delivered", "loaded /verify instead", "load failed", "named, not loaded", "never named"] as const;
/** The reason a graded gstack-main session didn't load prove-it, first that applies; a project-file arm's reason is B1c's. */
export function whyNot(r: Pick<B1dRow, "arm" | "outcome" | "load" | "verify" | "named" | "route_mark" | "placed">): string | null {
  if (r.outcome !== "graded" || r.load.loaded || r.arm === "none") return null;
  if (r.arm !== B1D_ARM) return blockWhyNot(r.outcome, r.load, !!r.placed);
  if (r.named === null) return "hook log missing";
  if (!r.named.includes(SKILL)) return "hook did not name prove-it";
  if (r.route_mark !== true) return "line not delivered";
  if (r.verify.loaded) return "loaded /verify instead";
  return r.load.failed ? "load failed" : r.load.named ? "named, not loaded" : "never named";
}
export function b1dRow(dir: string, ctx: Parameters<typeof b1Row>[1]): B1dRow | null {
  const row = b1Row(dir, { ...ctx, arms: B1D_ARM_NAMES });
  if (!row || !isB1dArm(row.arm)) return null;
  const msgs = join(dir, "evaluator", "sdk-messages.jsonl"), recs = existsSync(msgs) ? parseLog(readFileSync(msgs, "utf8")) : [];
  const load = loadsOf(recs), verify = verifyLoadOf(recs), main = row.arm === B1D_ARM;
  const last: any = ctx.sessions.get(row.trial)?.at(-1), log = join(dir, "evaluator", "gstack-hooks", "hooks", "skill-route.log");
  const named = main ? namedOf(existsSync(log) ? readFileSync(log, "utf8") : null) : null;
  const placed = row.arm === "project-md" || row.arm === NOESCAPE.arm ? (armInfo(dir).checks_trust ?? "").startsWith(PLACEMENT.placed) : null;
  const out = { ...row, arm: row.arm, load, verify, named, position: named ? positionOf(named) : null, route_mark: main ? (last ? (last.route_mark_before_output ?? false) : null) : null, placed, first_call: load.loaded && load.at_call === 1, why_not: null as string | null };
  out.why_not = whyNot(out);
  return out;
}
export function buildB1dTable(cfg: B1TableConfig): B1dRow[] {
  const sessions = sessionsByTrial(readSessionRows(cfg.sessions)), out: B1dRow[] = [];
  for (const job of cfg.jobs) for (const name of readdirSync(job.dir).sort()) {
    const d = join(job.dir, name);
    if (!statSync(d).isDirectory()) continue;
    const row = b1dRow(d, { part: job.part ?? null, sessions, home: cfg.home ?? "/root" });
    if (row) out.push(row);
  }
  return out;
}

// ---- The controls, the readings and the report.
type Ref = { arm: string; task: string; outcome: string; model: string; load?: { loaded: boolean }; detect: { followed: boolean } };
/** B1c's published rows, checked against its results bundle's front matter. */
export function b1cRows(): Ref[] {
  const dir = join(REPO, B1C_RUN.results), want = frontMatterDigests(readFileSync(join(dir, "README.md"), "utf8")).get("sessions.jsonl");
  const text = readFileSync(join(dir, "sessions.jsonl"));
  if (sha256(text) !== want) pinErr(B1C_RUN.results + "/sessions.jsonl hashes to " + sha256(text) + ", not its front matter's " + want);
  return text.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ref);
}
const loaded = (r: any) => !!r.load?.loaded, followed = (r: any) => !!r.detect?.followed;
export type Stat = { arm: string; planned: number; graded: number; gaps: number; cap_stops: number; incomplete: boolean; loaded: number; ci: [number, number] | null; first_call: number; followed: number; followed_ci: [number, number] | null; verify_loaded: number; passes: number; cost_usd: number; safety_stops: number; audit_sessions: number; why: Record<string, number> };
export function b1dStats(rows: B1dRow[], arm: B1dArm, planned: number): Stat {
  const all = rows.filter((r) => r.arm === arm), g = all.filter((r) => r.outcome === "graded"), k = g.filter(loaded).length, f = g.filter(followed).length, gaps = planned - g.length;
  const reasons = arm === B1D_ARM ? WHY_NOT_MAIN : arm === "none" ? [] : ["block not placed", "load failed", "named, not loaded", "never named"];
  return {
    arm, planned, graded: g.length, gaps, cap_stops: all.filter((r) => r.outcome === "cap_stop").length, incomplete: all.some((r) => r.outcome === "cap_stop") || gaps > maxGaps(planned),
    loaded: k, ci: g.length ? wilson(k, g.length) : null, first_call: g.filter((r) => r.first_call).length, followed: f, followed_ci: g.length ? wilson(f, g.length) : null, verify_loaded: g.filter((r) => r.verify.loaded).length,
    passes: g.filter((r) => r.pass).length, cost_usd: all.reduce((x, r) => x + (r.cost_usd ?? 0), 0), safety_stops: all.filter((r) => r.safety_stop).length, audit_sessions: all.filter((r) => r.audit_hits.length).length,
    why: Object.fromEntries(reasons.map((w) => [w, g.filter((r) => r.why_not === w).length])),
  };
}
/** Garry's rule on the in-sample 60: the point count of loads against the bar; INCOMPLETE first. */
export type InReading = { key: "incomplete" | "clears" | "short"; text: string };
export function inReading(s: Stat): InReading {
  if (s.incomplete) return { key: "incomplete", text: "INCOMPLETE: " + s.gaps + " of " + s.planned + " ungraded, " + s.cap_stops + " cap stops; no reading, and the block stays until the Captain decides" };
  return s.loaded >= B1D.bar ? { key: "clears", text: "the hook loaded prove-it in " + s.loaded + " of " + s.graded + ", at or above Garry's bar of " + B1D.bar + ": the CLAUDE.md routing block is cut, unless the held-out readings below stop it" } : { key: "short", text: "the hook loaded prove-it in " + s.loaded + " of " + s.graded + ", under Garry's bar of " + B1D.bar + ": the CLAUDE.md routing block stays and the result goes to Garry" };
}
export type Band = "matches" | "middle" | "clearly loses";
/** B1c's bands for arm a against arm b on paired loads: matches when the 95% interval of a minus b stays above -15 points,
 *  clearly loses when it sits wholly below -15, middle otherwise. */
export const band = (d: { lo: number; hi: number }): Band => (d.lo > -B1D.margin ? "matches" : d.hi < -B1D.margin ? "clearly loses" : "middle");
export type HoReading = { incomplete: boolean; disagree: boolean; block: Band | null; noescape: Band | null; verdict: string; decision: string };
/** The held-out readings and the decision they and the in-sample reading give together (README section 1). */
export function hoReading(inR: InReading, ho: { incomplete: boolean; mainVsBlock: { diff: number; lo: number; hi: number } | null; blockVsMain: { lo: number; hi: number } | null; noescapeVsMain: { lo: number; hi: number } | null }): HoReading {
  const disagree = !ho.incomplete && !!ho.mainVsBlock && ho.mainVsBlock.diff <= -B1D.hoMdd + 1e-9;
  const blockBand = ho.incomplete || !ho.blockVsMain ? null : band(ho.blockVsMain), noBand = ho.incomplete || !ho.noescapeVsMain ? null : band(ho.noescapeVsMain);
  let verdict: string;
  if (blockBand === null) verdict = "no held-out verdict for CLAUDE.md routing (the held-out set is INCOMPLETE)";
  else if (blockBand === "matches") verdict = "no R48 verdict for CLAUDE.md routing: the current block matches the hook on the held-out set, so it is not a losing part, and whether it is cut as redundant rests on Garry's rule on the 60";
  else if (noBand === "matches") verdict = "FIX-METHOD for CLAUDE.md routing: the block without its escape clause matches the hook, so rewrite the block, not cut it";
  else if (noBand === "clearly loses") verdict = "CUT-CANDIDATE for the current block and for CLAUDE.md routing in general: without its escape clause the block still clearly loses to the hook";
  else verdict = "CUT-CANDIDATE for the current block's wording and FIX-METHOD for CLAUDE.md routing in general: removing the escape clause did not settle it";
  let decision: string;
  if (inR.key === "incomplete") decision = "no decision: the in-sample run is INCOMPLETE; the block stays until the Captain decides";
  else if (inR.key === "short") decision = "the block stays and the result goes to Garry";
  else if (ho.incomplete) decision = "not cut on its own: the hook clears the bar but the held-out set is INCOMPLETE; it goes to Garry with both results";
  else if (disagree) decision = "not cut on its own: the hook clears the bar in-sample but loads " + (100 * -ho.mainVsBlock!.diff).toFixed(1) + " points fewer than the block on the held-out set, at least the " + (100 * B1D.hoMdd).toFixed(0) + "-point MDD; it goes to Garry with both numbers";
  else if (blockBand !== "matches" && noBand === "matches") decision = "not cut on its own: the hook clears the bar and the current block falls short of it on the held-out set, but the block without its escape clause matches the hook, so the verdict says rewrite the block, and it goes to Garry";
  else decision = "the CLAUDE.md routing block is cut (Garry's rule)";
  return { incomplete: ho.incomplete, disagree, block: blockBand, noescape: noBand, verdict, decision };
}

const pct = (x: number, n: number) => (n ? ((100 * x) / n).toFixed(1) + "%" : "n/a");
const ci = (c: [number, number] | null) => (c ? " [" + (100 * c[0]).toFixed(1) + ", " + (100 * c[1]).toFixed(1) + "]" : "");
const pts = (x: number) => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
const pairLine = (name: string, x: ReturnType<typeof paired>) => "  " + name + ": " + pts(x.diff) + " points [" + pts(x.lo) + ", " + pts(x.hi) + "] on " + x.pairs + " paired tasks (" + x.a_only + " vs " + x.b_only + " discordant)";
const statLine = (s: Stat) => "  " + s.arm + ": loaded " + s.loaded + "/" + s.graded + " " + pct(s.loaded, s.graded) + ci(s.ci) + (s.incomplete ? " INCOMPLETE" : "") + "; at the first call " + s.first_call + "; /verify loaded " + s.verify_loaded + "; followed " + s.followed + "/" + s.graded + ci(s.followed_ci) + "; gaps " + s.gaps + ", cap stops " + s.cap_stops + ", safety stops " + s.safety_stops + ", audit " + s.audit_sessions + ", passes " + s.passes + " (descriptive), cost $" + s.cost_usd.toFixed(2) + " ($" + (s.graded ? s.cost_usd / s.graded : 0).toFixed(3) + " a graded session)" + (Object.keys(s.why).length ? "; not loaded: " + Object.entries(s.why).map(([w, n]) => w + " " + n).join(", ") : "");
/** The tertile of each task's prompt length among the tasks given: ascending by length, ties by task id, 20 a tertile. */
export function tertiles(routes: Map<string, TaskRoute>, tasks: string[]): Map<string, number> {
  const order = [...tasks].sort((a, b) => routes.get(a)!.chars - routes.get(b)!.chars || a.localeCompare(b)), size = Math.ceil(order.length / 3);
  return new Map(order.map((t, i) => [t, Math.floor(i / size) + 1]));
}
/** Descriptive strata: loads per arm where the hook names prove-it or not (keyless, the route table), on _interface tasks or
 *  not, and by prompt-length tertile. */
export function strataLines(rows: B1dRow[], arms: B1dArm[], routes: Map<string, TaskRoute>, tasks: string[]): string[] {
  const t3 = tertiles(routes, tasks), lines: string[] = [];
  const groups: [string, (t: string) => boolean][] = [["hook names prove-it", (t) => routes.get(t)!.position !== "not named"], ["hook does not name prove-it", (t) => routes.get(t)!.position === "not named"], ["_interface tasks", (t) => t.endsWith("_interface")], ["other tasks", (t) => !t.endsWith("_interface")], ...[1, 2, 3].map((k) => ["length tertile " + k + " (" + tasks.filter((t) => t3.get(t) === k).map((t) => routes.get(t)!.chars).reduce((a, b) => [Math.min(a[0]!, b), Math.max(a[1]!, b)], [Infinity, 0]).join(" to ") + " characters)", (t: string) => t3.get(t) === k] as [string, (t: string) => boolean])];
  for (const [name, pick] of groups) {
    const ts = new Set(tasks.filter(pick));
    lines.push("  " + name + " (" + ts.size + " tasks): " + arms.map((a) => { const g = rows.filter((r) => r.arm === a && r.outcome === "graded" && ts.has(r.task)); return a + " " + g.filter(loaded).length + "/" + g.length; }).join(", "));
  }
  return lines;
}
/** The preregistered split of gstack-main's loads by where the hook put prove-it (each session's own hook log). */
export function splitLines(rows: B1dRow[]): string[] {
  const g = rows.filter((r) => r.arm === B1D_ARM && r.outcome === "graded");
  return [...POSITIONS.map((p) => { const s = g.filter((r) => r.position === p); return "  hook put prove-it " + p + " (" + s.length + " sessions): prove-it loaded " + s.filter(loaded).length + ", /verify loaded " + s.filter((r) => r.verify.loaded).length + ", neither " + s.filter((r) => !r.load.loaded && !r.verify.loaded).length; }),
    "  hook log missing (" + g.filter((r) => r.position === null).length + " sessions): prove-it loaded " + g.filter((r) => r.position === null && r.load.loaded).length,
    "  hook line before the first output (proxy): " + g.filter((r) => r.route_mark === true).length + " of " + g.length + ", quoted " + g.filter((r) => r.route_mark === "quoted").length];
}
export function inReport(rows: B1dRow[], routes: Map<string, TaskRoute>, controls: Ref[] = b1cRows(), refs: B1Row[] = b1References(), tasks: string[] = drawnTasks(loadBundle()).run) {
  const s = b1dStats(rows, B1D_ARM, tasks.length), reading = inReading(s), main = rows.filter((r) => r.arm === B1D_ARM);
  const vsBlock = paired(main, controls.filter((r) => r.arm === "project-md"), loaded, loaded), vsNone = paired(main, refs.filter((r) => r.arm === "none"), followed, followed);
  const lines = ["== " + MODELS.opus.id + ", B1d in-sample: gstack main " + GSTACK_ARM.sha.slice(0, 12) + " (" + GSTACK_ARM.version + "), hooks on by default, on B1's " + tasks.length + " run tasks", statLine(s), "  reading (Garry's bar, " + B1D.bar + " of " + tasks.length + "): " + reading.text, ...splitLines(rows),
    pairLine("loaded, gstack-main - B1c project-md (published rows)", vsBlock), pairLine("followed, gstack-main - B1 none (published rows)", vsNone), ...strataLines(rows, [B1D_ARM], routes, tasks)];
  return { lines, stats: s, reading, vs_block: vsBlock };
}
export function hoReport(rows: B1dRow[], inR: InReading, routes: Map<string, TaskRoute>, tasks: string[]) {
  const st = Object.fromEntries(B1D_ARM_NAMES.map((a) => [a, b1dStats(rows, a, tasks.length)])) as Record<B1dArm, Stat>, of = (a: B1dArm) => rows.filter((r) => r.arm === a);
  const incomplete = B1D_ARM_NAMES.some((a) => st[a].incomplete);
  const mainVsBlock = paired(of(B1D_ARM), of("project-md"), loaded, loaded), blockVsMain = paired(of("project-md"), of(B1D_ARM), loaded, loaded), noVsMain = paired(of(NOESCAPE.arm), of(B1D_ARM), loaded, loaded), noVsBlock = paired(of(NOESCAPE.arm), of("project-md"), loaded, loaded);
  const reading = hoReading(inR, { incomplete, mainVsBlock, blockVsMain, noescapeVsMain: noVsMain });
  const cov = POSITIONS.map((p) => p + " " + tasks.filter((t) => routes.get(t)?.position === p).length).join(", ");
  const lines = ["== " + MODELS.opus.id + ", B1d held-out: " + tasks.length + " tasks, four arms", "  keyless coverage (the hook at the pin on each prompt): prove-it " + cov, ...B1D_ARM_NAMES.map((a) => statLine(st[a])), ...splitLines(rows),
    pairLine("loaded, gstack-main - project-md", mainVsBlock) + " (disagreement when the difference is at or below -" + (100 * B1D.hoMdd).toFixed(0) + " points: " + (reading.disagree ? "yes" : "no") + ")",
    pairLine("loaded, project-md - gstack-main", blockVsMain) + ": " + (reading.block ?? "no band"), pairLine("loaded, " + NOESCAPE.arm + " - gstack-main", noVsMain) + ": " + (reading.noescape ?? "no band"), pairLine("loaded, " + NOESCAPE.arm + " - project-md (the escape clause)", noVsBlock),
    ...([B1D_ARM, "project-md", NOESCAPE.arm] as B1dArm[]).map((a) => pairLine("followed, " + a + " - none", paired(of(a), of("none"), followed, followed))), ...strataLines(rows, B1D_ARM_NAMES, routes, tasks),
    "  R48 for CLAUDE.md routing: " + reading.verdict, "  decision: " + reading.decision];
  return { lines, stats: st, reading };
}
/** The pilot on the smoke tasks, per arm: each task has one graded row (its task can be supplied) with no audit hit, the
 *  gstack-main hook named what the route table's hook_names gives for the task, and each project-file arm's block was placed.
 *  One PASS or FAIL line per arm, and the arms that failed. */
export function pilotCheck(rows: B1dRow[], routeRows: string[][], tasks: string[] = [...B1D_SMOKE]): { lines: string[]; failed: B1dArm[] } {
  const lines: string[] = [], failed: B1dArm[] = [];
  for (const arm of B1D_ARM_NAMES) {
    const why: string[] = [];
    for (const t of tasks) {
      const g = rows.filter((r) => r.arm === arm && r.task === t && r.outcome === "graded");
      if (g.length !== 1) { why.push(t + " has " + g.length + " graded rows"); continue; }
      const r = g[0]!, route = routeRows.find((x) => x[1] === t), want = route ? (route[5] === "-" ? [] : route[5]!.split(",")) : null;
      if (r.audit_hits.length) why.push(t + " has " + r.audit_hits.length + " audit hits");
      if (arm === B1D_ARM && (want === null || JSON.stringify(r.named) !== JSON.stringify(want))) why.push(t + ": the hook named " + (r.named === null ? "nothing (no hook log)" : "[" + r.named.join(",") + "]") + ", the route table " + (want === null ? "has no row" : "[" + want.join(",") + "]"));
      if ((arm === "project-md" || arm === NOESCAPE.arm) && r.placed !== true) why.push(t + ": the block was not placed");
    }
    if (why.length) failed.push(arm);
    lines.push("  pilot " + (why.length ? "FAIL " + arm + ": " + why.join("; ") : "PASS " + arm));
  }
  return { lines, failed };
}
export function checkB1dRows(rows: B1dRow[], tasks: string[], arms: B1dArm[]): string[] {
  const bad: string[] = [], seen = new Set<string>();
  for (const r of rows) {
    if (!tasks.includes(r.task)) bad.push(r.trial + " is task " + r.task + ", not one of the planned tasks");
    if (!arms.includes(r.arm)) bad.push(r.trial + " is arm " + r.arm + ", not one of " + arms.join(", "));
    if (r.model !== MODELS.opus.id) bad.push(r.trial + " ran " + r.model + ", not " + MODELS.opus.id);
    if (r.outcome !== "graded") continue;
    if (seen.has(r.arm + "\t" + r.task)) bad.push("two graded rows for " + r.arm + " " + r.task);
    seen.add(r.arm + "\t" + r.task);
  }
  return bad;
}
export const reasonsTsv = (rows: B1dRow[]) => ["arm\ttask\ttrial\toutcome\treason\tposition\tverify\tload_failed\tnamed\tfirst_text", ...rows.filter((r) => r.why_not || r.outcome !== "graded").sort((a, b) => (a.arm + a.task).localeCompare(b.arm + b.task)).map((r) => [r.arm, r.task, r.trial, r.outcome, r.why_not ?? r.reason, r.position ?? "-", r.verify.loaded, r.load.failed, r.load.named, r.load.first_text.replace(/\t/g, " ")].join("\t"))].join("\n") + "\n";

// ---- Power and odds, exact, from the committed route table and B1c's published rows.
const binom = (n: number, p: number) => { const out = new Array(n + 1).fill(0); out[0] = 1; for (let i = 0; i < n; i++) for (let k = i + 1; k >= 0; k--) out[k] = out[k] * (1 - p) + (k ? out[k - 1] * p : 0); return out; };
const conv = (a: number[], b: number[]) => { const o = new Array(a.length + b.length - 1).fill(0); a.forEach((x, i) => b.forEach((y, j) => (o[i + j] += x * y))); return o; };
const dist = (groups: [number, number][]) => groups.reduce((acc, [n, p]) => conv(acc, binom(n, p)), [1]);
const atLeast = (d: number[], k: number) => d.slice(k).reduce((x, y) => x + y, 0);
/** P(loads >= the bar) when sessions where the hook names prove-it first or alone load at f, second of two at f x second,
 *  and unnamed at u. */
export const clearOdds = (c: { first: number; second: number; none: number }, f: number, u = 0, second = 1) => atLeast(dist([[c.first, f], [c.second, f * second], [c.none, u]]), B1D.bar);
/** Paired against fixed control rows: P(the 95% interval of hook minus control sits wholly above 0, wholly below 0). */
export function pairedPower(control: Map<string, boolean>, pOf: (t: string) => number) {
  const tasks = [...control.keys()], yes = tasks.filter((t) => control.get(t)), no = tasks.filter((t) => !control.get(t));
  const dx = dist(yes.map((t) => [1, pOf(t)] as [number, number])), dy = dist(no.map((t) => [1, pOf(t)] as [number, number]));
  let above = 0, below = 0, mean = 0;
  dx.forEach((px, x) => dy.forEach((py, y) => { const p = px * py; if (!p) return; const r = newcombe(x, y, yes.length - x, no.length - y); if (r.lo > 0) above += p; if (r.hi < 0) below += p; mean += p * r.diff; }));
  return { above, below, mean };
}
/** Two arms run on the same n tasks, each loading independently at its own rate: P(the interval of a minus b sits wholly
 *  above 0, wholly below 0) and the odds of each band against the margin. */
export function twoArmPower(pa: number, pb: number, n = 60) {
  const q = [pa * pb, pa * (1 - pb), (1 - pa) * pb, (1 - pa) * (1 - pb)], lf = [0];
  for (let i = 1; i <= n; i++) lf[i] = lf[i - 1]! + Math.log(i);
  const o = { above: 0, below: 0, matches: 0, middle: 0, "clearly loses": 0, le: 0 };
  for (let a = 0; a <= n; a++) for (let b = 0; a + b <= n; b++) for (let c = 0; a + b + c <= n; c++) {
    const d = n - a - b - c, k = [a, b, c, d], lp = lf[n]! - k.reduce((s, x) => s + lf[x]!, 0) + k.reduce((s, x, i) => s + (x ? x * Math.log(q[i] || 1e-300) : 0), 0), p = Math.exp(lp);
    if (p < 1e-15) continue;
    const r = newcombe(a, b, c, d);
    if (r.lo > 0) o.above += p;
    if (r.hi < 0) o.below += p;
    o[band(r)] += p;
    if (r.diff <= -B1D.hoMdd + 1e-9) o.le += p;
  }
  return o;
}
/** The held-out MDD for the disagreement rule: the hook's shortfall against the block, with the block at B1c's rate, that
 *  this many paired tasks detect (interval wholly below 0) with 80% power, scanned in whole points. */
export function hoMdd(block = 39 / 60): number {
  for (let k = 0; k <= 100; k++) { const p = block - k / 100; if (p < 0) break; if (twoArmPower(p, block).below >= 0.8) return k / 100; }
  return NaN;
}
export function powerLines(routes: Map<string, TaskRoute> = inSampleRoutes(), controls: Ref[] = b1cRows(), run: string[] = drawnTasks(loadBundle()).run): string[] {
  const pos = (t: string) => routes.get(t)?.position ?? pinErr(t + " has no route"), c = { first: run.filter((t) => pos(t) === "only" || pos(t) === "first of two").length, second: run.filter((t) => pos(t) === "second of two").length, none: run.filter((t) => pos(t) === "not named").length };
  const h = HELDOUT.coverage, block = new Map(controls.filter((r) => r.arm === "project-md" && r.outcome === "graded").map((r) => [r.task, loaded(r)]));
  if (block.size !== run.length || run.some((t) => !block.has(t))) pinErr("B1c's graded rows are not B1's " + run.length + " run tasks");
  const k = [...block.values()].filter(Boolean).length;
  const lines = ["in-sample keyless coverage (B1's " + run.length + " run tasks): prove-it named first or alone " + c.first + ", second of two " + c.second + ", not named " + c.none + "; the most loads the hook can reach without an unnamed load is " + (c.first + c.second),
    "held-out keyless coverage (" + HELDOUT.tasks + " tasks): prove-it named alone " + h.only + ", first of two " + h.first + ", second of two " + h.second + ", not named " + h.none,
    "", "odds of clearing the bar (P[loads >= " + B1D.bar + "] on the in-sample " + run.length + ")", "follow rate f\tnamed at f, unnamed 0\tunnamed at 0.05\tsecond of two at f/2\texpected loads (first column)"];
  for (const f of [1, 0.99, 59 / 60, 58 / 60, 0.95, 0.933, 0.9, 0.85, 0.8]) lines.push((100 * f).toFixed(1) + "%\t" + clearOdds(c, f).toFixed(3) + "\t" + clearOdds(c, f, 0.05).toFixed(3) + "\t" + clearOdds(c, f, 0, 0.5).toFixed(3) + "\t" + ((c.first + c.second) * f).toFixed(1));
  lines.push("", "paired against B1c's published project-md rows (" + k + " of " + block.size + " loaded), coverage model (named at f, unnamed 0)", "follow rate f\ttrue difference\tP(hook shown above)\tP(hook shown below)");
  for (const f of [1, 58 / 60, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6]) { const r = pairedPower(block, (t) => (pos(t) === "not named" ? 0 : f)); lines.push((100 * f).toFixed(1) + "%\t" + pts(r.mean) + "\t" + r.above.toFixed(3) + "\t" + r.below.toFixed(3)); }
  let up = NaN, dn = NaN;
  for (let i = Math.round(1000 * k / block.size); i <= 1000; i++) if (pairedPower(block, () => i / 1000).above >= 0.8) { up = i / 1000; break; }
  for (let i = Math.round(1000 * k / block.size); i >= 0; i--) if (pairedPower(block, () => i / 1000).below >= 0.8) { dn = i / 1000; break; }
  lines.push("uniform model (every task at the same true rate): 80% power to show the hook above B1c's rows at " + (100 * up).toFixed(1) + "% (" + pts(up - k / block.size) + " points), below at " + (100 * dn).toFixed(1) + "% (" + pts(dn - k / block.size) + " points)");
  const mdd = hoMdd(k / block.size);
  lines.push("", "held-out, two arms on the same " + HELDOUT.tasks + " tasks, each task loading independently at its arm's rate", "held-out MDD: with the block at " + pct(k, block.size) + ", the hook's shortfall detected with 80% power is " + (100 * mdd).toFixed(0) + " points (the frozen MDD is " + (100 * B1D.hoMdd).toFixed(0) + ")",
    "hook rate\tP(hook shown below block)\tP(hook - block at or below -" + (100 * B1D.hoMdd).toFixed(0) + ")\tP(hook shown above block)");
  for (const p of [0.97, 0.9, 0.8, 0.65, 0.5, 0.39, 0.3]) { const o = twoArmPower(p, k / block.size); lines.push((100 * p).toFixed(0) + "%\t" + o.below.toFixed(3) + "\t" + o.le.toFixed(3) + "\t" + o.above.toFixed(3)); }
  lines.push("", "noescape against the hook (bands at -" + (100 * B1D.margin).toFixed(0) + " points), the hook at 80%", "noescape rate\tmatches\tmiddle\tclearly loses");
  for (const p of [0.9, 0.8, 0.75, 0.7, 0.65, 0.6, 0.5]) { const o = twoArmPower(p, 0.8); lines.push((100 * p).toFixed(0) + "%\t" + o.matches.toFixed(3) + "\t" + o.middle.toFixed(3) + "\t" + o["clearly loses"].toFixed(3)); }
  return lines;
}

// ---- Keyless scripted sessions in the real Claude Code image against the stub model (fake-model.ts), as B1b's and B1c's
// are: what the gstack-main arm delivers on a prompt the hook names prove-it alone on, two skills on and nothing on; that
// the prove-it preamble runs against gstack's real scripts; that a command gstack's destructive guard asks about still runs
// unattended; that the readers read real Claude Code output both ways; and what the noescape arm's first request holds.
const TASK = "add() in calc.py returns the difference of its arguments. Make it return their sum.";
export const B1D_PROMPTS = { plain: TASK, fix: "Fix this bug: " + TASK, two: "Fix this bug and make the tests pass: " + TASK } as const;
export type B1dCase = { name: string; arm: B1dArm; mode: "stop" | "load" | "setup" | "verify" | "guard"; prompt: keyof typeof B1D_PROMPTS };
export const B1D_CASES: B1dCase[] = [
  { name: "main-one", arm: B1D_ARM, mode: "load", prompt: "fix" },
  { name: "main-setup", arm: B1D_ARM, mode: "setup", prompt: "fix" },
  { name: "main-two", arm: B1D_ARM, mode: "verify", prompt: "two" },
  { name: "main-none", arm: B1D_ARM, mode: "stop", prompt: "plain" },
  { name: "main-guard", arm: B1D_ARM, mode: "guard", prompt: "plain" },
  { name: "noescape-stop", arm: NOESCAPE.arm, mode: "stop", prompt: "plain" },
  { name: "project-md-stop", arm: "project-md", mode: "stop", prompt: "plain" },
  { name: "none-stop", arm: "none", mode: "stop", prompt: "plain" },
];
/** The skill listing's size as the first request holds it: characters, entries, entries that are a bare name with no
 *  description, and whether prove-it's entry carries its whole description. */
export function listingFacts(listing: string | null) {
  const entries = (listing ?? "").split("\n").filter((l) => l.startsWith("- ")), desc = /^description: "(.*)"$/m.exec(readFileSync(join(REPO, ARM_SOURCES, PROVE_IT.source), "utf8"))?.[1] ?? "";
  const mine = entries.find((l) => l === "- " + SKILL || l.startsWith("- " + SKILL + ":"));
  return { chars: (listing ?? "").length, entries: entries.length, bare: entries.filter((l) => !l.includes(": ")).length, prove_it: mine === undefined ? "absent" : mine === "- " + SKILL + ": " + desc ? "full" : mine === "- " + SKILL ? "bare name" : "cut" };
}
export const GUARD_COMMAND = "cd /testbed && git reset --hard";
export type B1dCaptured = { sdk: string; listing: string | null; user: string[]; hook_context: string[]; loaded: string | null; hook_log: string | null; guard: string | null; arm_info: { stripped?: string[]; checks_trust?: string } | null; probe: Record<string, string> | null };
export function loadB1dCaptured(dir: string): B1dCaptured {
  const j = JSON.parse(existsSync(join(dir, "capture.json")) ? readFileSync(join(dir, "capture.json"), "utf8") : "{}");
  return { sdk: existsSync(join(dir, "sdk-messages.jsonl")) ? readFileSync(join(dir, "sdk-messages.jsonl"), "utf8") : "", listing: j.listing ?? null, user: j.user ?? [], hook_context: j.hook_context ?? [], loaded: j.loaded ?? null, hook_log: j.hook_log ?? null, guard: j.guard ?? null, arm_info: j.arm_info ?? null, probe: j.probe ?? null };
}
/** Each scripted tool call's result text and error flag, by its index in the stub's script. */
export function scriptResults(recs: Rec[]): Map<number, { text: string; error: boolean }> {
  const out = new Map<number, { text: string; error: boolean }>();
  for (const r of recs) for (const b of blocksOf(r)) { const m = /^toolu_b1_(\d+)$/.exec(String(b?.tool_use_id ?? "")); if (r.type === "UserMessage" && m) out.set(Number(m[1]), { text: resultText(b), error: !!b.is_error }); }
  return out;
}
const SKILL_BODY = () => readFileSync(join(REPO, ARM_SOURCES, PROVE_IT.source), "utf8").replace(/^---\n[\s\S]*?\n---\n\n?/, "");
/** Every assertion on one B1d session; empty means the arm delivered what the prereg says. */
export function b1dCaseProblems(c: B1dCase, cap: B1dCaptured): string[] {
  const p: string[] = [], want = (what: string, ok: boolean) => { if (!ok) p.push(c.name + ": " + what); };
  const recs = parseLog(cap.sdk);
  if (!recs.length || cap.listing === null || !cap.user.length) return [c.name + ": no session"];
  const first = cap.user.join("\n"), steps = readFileSync(join(REPO, ARM_SOURCES, "steps.md"), "utf8"), names = [...cap.listing.matchAll(/^- ([\w:-]+)(?::|$)/gm)].map((m) => m[1]!);
  want("the prompt is typed", !first.includes("<command-name>/"));
  want("the step text reached the first request", !first.includes(steps) && !cap.hook_context.some((h) => h.includes(steps)));
  const l = loadsOf(recs), v = verifyLoadOf(recs), res = scriptResults(recs);
  if (c.arm === "none") {
    want("the listing names " + names.join(", "), JSON.stringify([...names].sort()) === JSON.stringify([...CLAUDE_LISTED].sort()));
    want("a hook line or a routing block reached the session", !cap.hook_context.length && !first.includes("## Skill routing"));
    want("loadsOf reads a load in a none session", !l.loaded && whyNot({ arm: "none", outcome: "graded", load: l, verify: v, named: null, route_mark: null, placed: null }) === null);
    return p;
  }
  if (c.arm === NOESCAPE.arm || c.arm === "project-md") {
    const block = c.arm === NOESCAPE.arm ? noescapeBlock() : readFileSync(join(REPO, ARM_SOURCES, PLACEMENT.blockSource), "utf8"), pr = cap.probe ?? {};
    want("the listing names " + names.join(", "), JSON.stringify([...names].sort()) === JSON.stringify([SKILL, ...CLAUDE_LISTED].sort()));
    want("the first request does not hold the arm's block as the project's CLAUDE.md", first.includes(PLACEMENT.label + "\n\n" + block.trimEnd()));
    want(c.arm === NOESCAPE.arm ? "the first request holds the escape clause" : "the first request lacks the escape clause", first.includes(NOESCAPE.from) === (c.arm === "project-md"));
    want("a hook line reached the session", !cap.hook_context.length);
    want("the arm info has no placement line", (cap.arm_info?.checks_trust ?? "").startsWith(PLACEMENT.placed));
    want("the project CLAUDE.md is not the arm's block byte for byte", pr.claude_md_sha256 === sha256(block));
    want("the last commit is not gstack's routing commit on the snapshot", pr.subject === PLACEMENT.message && pr.commits === "2");
    want("loadsOf reads a load in a session that made none", !l.loaded && whyNot({ arm: c.arm, outcome: "graded", load: l, verify: v, named: null, route_mark: null, placed: true }) === "never named");
    return p;
  }
  for (const s of [SKILL, "verify", "qa", "review", "_gstack-command", ...CLAUDE_LISTED]) want("the listing does not name " + s, names.includes(s));
  for (const s of GSTACK_ARM.userOnly) want("the listing names the user-only " + s, !names.includes(s));
  want("the listing names " + names.length + " skills, not gstack's " + GSTACK_ARM.listed + " beside Claude Code's own", names.length === GSTACK_ARM.listed + CLAUDE_LISTED.length);
  const facts = listingFacts(cap.listing);
  want("the listing cuts " + facts.bare + " entries to a bare name", facts.bare === 0);
  want("prove-it's entry is " + facts.prove_it, facts.prove_it === "full");
  const named = namedOf(cap.hook_log), line = cap.hook_context.join("\n");
  if (c.prompt === "fix") {
    want("the first request does not carry one hook line naming /" + SKILL + " alone", cap.hook_context.length === 1 && line.startsWith(ROUTE_MARK) && line.includes("this request fits /" + SKILL + ". Run /" + SKILL + " with the Skill tool before you start"));
    want("the hook's log does not say routed to " + SKILL + " alone", JSON.stringify(named) === JSON.stringify([SKILL]));
  } else if (c.prompt === "two") {
    want("the first request does not carry the two-name line", cap.hook_context.length === 1 && line.includes("this request fits /verify or /" + SKILL + ". Run the one that fits better with the Skill tool before you start (/verify if both fit)"));
    want("the hook's log does not name verify, then " + SKILL, JSON.stringify(named) === JSON.stringify(["verify", SKILL]) && positionOf(named!) === "second of two");
  } else {
    want("a hook line reached a session the hook names nothing on", !cap.hook_context.length && !first.includes(ROUTE_MARK));
    want("the hook's log names a skill", JSON.stringify(named) === "[]");
  }
  const row = { arm: B1D_ARM as B1dArm, outcome: "graded" as const, load: l, verify: v, named, route_mark: cap.hook_context.length ? true as const : false as const, placed: null };
  if (c.mode === "load") {
    want("the Skill load is not the base line and the prove-it body", cap.loaded === BASE(SKILL) + SKILL_BODY());
    want("loadsOf does not read a Skill load", l.loaded && l.via === "Skill" && l.at_call === 1);
  } else if (c.mode === "verify") {
    want("verifyLoadOf does not read the /verify load", v.loaded && v.via === "Skill" && !l.loaded);
    want("the reason is not 'loaded /verify instead'", whyNot(row) === "loaded /verify instead");
  } else if (c.mode === "setup") {
    const start = res.get(0);
    want("gstack-skill-start failed or printed no SKILL_START_PROTO: 1", !!start && !start.error && /^SKILL_START_PROTO: 1$/m.test(start.text));
    want("gstack-learnings-log or gstack-skill-end failed", [1, 2].every((i) => res.has(i) && !res.get(i)!.error));
  } else if (c.mode === "guard") {
    want("gstack's destructive guard does not ask about " + JSON.stringify(GUARD_COMMAND), /"permissionDecision"\s*:\s*"ask"/.test(cap.guard ?? ""));
    const reset = res.get(1);
    want("the reset did not run unattended", !!reset && !reset.error && /HEAD is now at/.test(reset.text));
    want("the reset left the edit in place", (res.get(2)?.text ?? "").trim() === "0");
  } else want("the readers read a load in a session that made none", !l.loaded && !v.loaded && whyNot(row) === (named?.includes(SKILL) ? "never named" : "hook did not name prove-it"));
  return p;
}
const docker = (args: string[], input?: string, timeout = 600_000) => spawnSync("docker", args, { input, encoding: "utf8", timeout, maxBuffer: 64 << 20 });
const RESET = ["set -e", "mkdir -p /testbed", "cd /testbed", "printf 'def add(a, b):\\n    return a - b\\n' > calc.py", "git init -q && git add -A && git -c user.name=b1 -c user.email=b1@example.invalid commit -qm snapshot"].join("\n");
const PROBE = ["cd /testbed", 'echo "claude_md_sha256=$(sha256sum CLAUDE.md 2>/dev/null | cut -c1-64)"', 'echo "subject=$(git log -1 --format=%s)"', 'echo "commits=$(git rev-list --count HEAD)"', 'echo "capy=$(find / -xdev -maxdepth 3 -type d -name .capy 2>/dev/null | wc -l)"'].join("\n");
export async function runB1dSessions(out: string) {
  mkdirSync(out, { recursive: true });
  const py = sdkPython(), reqLog = join(out, "requests.jsonl"), bodyLog = join(out, "bodies.jsonl");
  rmSync(reqLog, { force: true }); rmSync(bodyLog, { force: true });
  const fake = Bun.spawn(["bun", join(import.meta.dir, "fake-model.ts"), "0", reqLog, bodyLog], { stdout: "pipe", stderr: "inherit" });
  const head = new TextDecoder().decode((await fake.stdout.getReader().read()).value ?? new Uint8Array());
  const port = /127\.0\.0\.1:(\d+)/.exec(head)?.[1], problems: string[] = [], ran: { c: B1dCase; extra: Record<string, unknown> }[] = [];
  try {
    if (!port) pinErr("the stub model did not start: " + head.slice(0, 200));
    for (const c of B1D_CASES) {
      const name = "b1d-sessions-" + c.name + "-" + process.pid, dir = join(out, c.name), trial = join(dir, "trial");
      rmSync(dir, { recursive: true, force: true }); mkdirSync(trial, { recursive: true });
      const up = docker(["run", "-d", "--name", name, "--network", "host", "--cap-drop", "NET_RAW", "--cap-drop", "NET_ADMIN", SESSION_IMAGE, "sleep", "infinity"]);
      if (up.status !== 0) { problems.push(c.name + ": container did not start: " + up.stderr.trim().slice(-200)); continue; }
      try {
        if (docker(["exec", "-i", name, "sh", "-s"], RESET).status !== 0) { problems.push(c.name + ": reset failed"); continue; }
        const main = c.arm === B1D_ARM, tar = join(ARMS_DIR(), c.arm + ".tar");
        const spec = { case: c.name, arm: c.arm, tar, strip: true, told: "", container: name, base_url: "http://127.0.0.1:" + port, instruction: "[b1-session " + c.name + "] [b1-script " + c.mode + "] " + B1D_PROMPTS[c.prompt], out: trial, ...(B1D_ARMS[c.arm].spec.includes(":checks_trust=true") ? { checks_trust: true } : {}) };
        const r = spawnSync(py, [join(REPO, "lanes/harness-mechanics/sessions-driver.py"), JSON.stringify(spec)], { encoding: "utf8", timeout: 900_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PYTHONPATH: join(REPO, "quick/laneb/runner/agent") } });
        writeFileSync(join(dir, "driver.log"), (r.stdout ?? "") + (r.stderr ?? ""));
        if (r.status !== 0) { problems.push(c.name + ": driver exited " + r.status + " (" + join(dir, "driver.log") + ")"); continue; }
        const last = (r.stdout ?? "").trim().split("\n").at(-1) ?? "{}";
        const probe = Object.fromEntries((docker(["exec", "-i", name, "sh", "-s"], PROBE).stdout ?? "").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
        if (probe.capy !== "0") problems.push(c.name + ": the container holds a .capy folder");
        const log = main ? docker(["exec", name, "sh", "-c", "cat /root/.gstack/hooks/skill-route.log 2>/dev/null | sed 's/session=[^ ]*/session=<id>/; s/also_source=[^ ]*/also_source=<path>/'"]).stdout ?? "" : null;
        const guard = c.mode === "guard" ? docker(["exec", "-i", name, "sh", "-c", "cd /testbed && /root/.claude/skills/gstack/hosts/claude/hooks/destructive-guard-hook"], JSON.stringify({ session_id: "b1d-guard", tool_name: "Bash", tool_input: { command: GUARD_COMMAND } })).stdout ?? "" : null;
        let armInfoLine: unknown = null;
        try { armInfoLine = JSON.parse(last).arm_info ?? null; } catch { armInfoLine = null; }
        ran.push({ c, extra: { hook_log: log, guard, probe, arm_info: armInfoLine } });
      } finally { docker(["rm", "-f", name]); }
    }
    await Bun.sleep(300);
    const bodies = (existsSync(bodyLog) ? readFileSync(bodyLog, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const texts = (m: any): string[] => (typeof m?.content === "string" ? [m.content] : (m?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text));
    for (const { c, extra } of ran) {
      const mine = bodies.filter((b) => b.session === c.name), dest = join(out, c.name, "capture");
      mkdirSync(dest, { recursive: true });
      cpSync(join(out, c.name, "trial", "evaluator", "sdk-messages.jsonl"), join(dest, "sdk-messages.jsonl"));
      const sys = mine[0] ? texts(mine[0].messages.find((m: any) => m.role === "system")).join("") : "", at = sys.indexOf(LISTING);
      const hook = sys.split(ROUTE_CONTEXT.slice(0, -ROUTE_MARK.length)).slice(1).map((s: string) => s.split("\n")[0]!);
      let loadedText: string | null = null;
      for (const b of mine) { const i = b.messages.findIndex((m: any) => m.role === "user" && Array.isArray(m.content) && m.content.some((x: any) => x.type === "tool_result" && /^Launching skill: /.test(String(x.content)))); if (i >= 0) { loadedText = texts(b.messages[i]).join("\n"); break; } }
      const listing = at < 0 ? null : sys.slice(at, sys.indexOf("\n\n", at + LISTING.length) + 1);
      const cap = { listing, listing_facts: listingFacts(listing), user: mine[0] ? texts(mine[0].messages.find((m: any) => m.role === "user")) : [], hook_context: hook, loaded: loadedText, ...extra, requests: mine.length };
      writeFileSync(join(dest, "capture.json"), JSON.stringify(cap, null, 2) + "\n");
      problems.push(...b1dCaseProblems(c, loadB1dCaptured(dest)));
    }
  } finally { fake.kill(); }
  writeFileSync(join(out, "sessions.json"), JSON.stringify({ cases: B1D_CASES.map((c) => c.name), problems }, null, 2) + "\n");
  return problems;
}

// ---- CLI.
const USAGE = "usage: b1d arms build [--out <dir>] [--manifests] | arms check [--out <dir>] | routes --export <swe-rebench export> [--tree <dir>] [--out <tsv>] [--check] [--sealed <tsv>] | sessions run --out <dir> [--cut <dir>] | plan | power | reuse [--head <commit>] | approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who> | done --ledger <jsonl> --item <item> | guard <work> | prepare <work> --item <item> | host-up|attach|recover|host-down <work> | launch|relaunch|rerun <work> --part <part> | table <config.json> <out.jsonl> | report <table.jsonl> --item <b1d-smoke|b1d-in|b1d-ho> [--in <in-sample table.jsonl>] [--routes <sealed held-out route table>] [--out <dir>]";
const LAUNCHER = ["prepare", "host-up", "launch", "attach", "relaunch", "rerun", "recover", "host-down"], GUARDED = ["host-up", "launch", "relaunch"];
function guardWork(work: string, relaunching?: string) {
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  if (!isB1dItem(plan.item)) return usage("b1d launch guard: " + work + " plans " + plan.item + ", not a B1d item");
  for (const [what, check] of [["B1's none arm", reuseCheck], ["B1c's arm and rows", reuseB1c]] as const) for (const head of [plan.git_head, "HEAD"]) {
    const r = check(head);
    for (const l of r.lines) if (!l.startsWith("SAME ")) console.log(l);
    if (!r.same) throw new Error("E_B1_LAUNCH " + plan.item + ": at " + head + " the harness differs from the run " + what + " came from (" + r.lines.filter((l) => l.startsWith("DIFFERENT ")).join("; ") + "); take it to the Captain before launching");
  }
  const dirty = harnessDirty();
  if (dirty.length) throw new Error("E_B1_LAUNCH " + plan.item + ": the checkout holds uncommitted changes to harness paths (" + dirty.join("; ") + "); take it to the Captain before launching");
  const dir = process.env.B1D_LEDGERS ?? "", crewPath = process.env.B1D_CREW ?? "", own = process.env.LEDGER ?? "";
  if (!dir || !crewPath || !existsSync(crewPath)) usage("b1d launch guard: set B1D_LEDGERS to the folder of item ledgers (<item>.jsonl) and B1D_CREW to the crew file");
  const ledgers: Partial<Record<B1dItem, Row[]>> = {};
  for (const i of B1D_ITEMS) if (existsSync(join(dir, i + ".jsonl"))) ledgers[i] = readRows(join(dir, i + ".jsonl"));
  const mirror = join(work, "host/ledger.jsonl");
  ledgers[plan.item as B1dItem] = own && existsSync(own) ? readRows(own) : existsSync(mirror) ? readRows(mirror) : ledgers[plan.item as B1dItem] ?? [];
  const crew = JSON.parse(readFileSync(crewPath, "utf8"));
  if (typeof crew?.as_of !== "string" || typeof crew.usd !== "number" || !(crew.usd >= 0)) usage("b1d launch guard: the crew file needs as_of and usd, a number of at least 0");
  const prepared = (plan.parts as PartPlan[]).flatMap((p) => [p.name + "-a2", p.name + "-relaunch"]).map((n) => join(work, n, "l1-part.json")).filter((x) => existsSync(x)).map((x) => JSON.parse(readFileSync(x, "utf8")) as PartPlan);
  const parts = [...plan.parts, ...prepared], finished = parts.map((p) => p.name).filter((n) => n !== relaunching && existsSync(join(work, n + ".result.json")));
  const g = b1dGuard(plan.item, ledgers, { [plan.item]: { parts, finished } }, crew.usd);
  for (const l of g.lines) console.log(l);
  if (!g.ok) throw new Error("E_B1_LAUNCH " + plan.item + ": " + g.why.join("; ") + "; take it to the Captain before launching");
}
/** The public route table's kinds: B1's 60 run tasks and the calibration tasks of B1's screened list outside B1's 62 tasks'
 *  repositories, sorted; the smoke is the first of those the hook names prove-it alone on and the first it names nothing on. */
export function calibrationTasks(): string[] {
  const b = loadBundle(), t = drawnTasks(b), repo = new Map<string, string>((JSON.parse(readFileSync(join(REPO, "quick/laneb/tasks/swerebench-r3a4.json"), "utf8")).tasks as { task_id: string; repo: string }[]).map((x) => [x.task_id, x.repo.toLowerCase()]));
  const used = new Set([...t.run, ...t.smoke].map((x) => repo.get(x)));
  return b.text("hm-screened.txt").split("\n").filter(Boolean).map((l) => l.split(" ")).filter(([k, x]) => k === "calibration" && !used.has(repo.get(x!))).map(([, x]) => x!).sort();
}
export function smokeOf(rows: string[][]): string[] {
  const cal = rows.filter((r) => r[0] === "calibration");
  return [cal.find((r) => r[7] === "only")?.[1], cal.find((r) => r[5] === "-")?.[1]].filter((x): x is string => !!x);
}
export async function b1dMain(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv, opt = (k: string) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === "arms") {
    const sub = rest[0], out = resolve(opt("out") ?? ARMS_DIR());
    if (sub === "build") {
      mkdirSync(out, { recursive: true });
      const small = smallBuild(out);
      for (const [a, tar] of Object.entries(small)) console.log(a + " tar_sha256=" + sha256(readFileSync(tar)) + " -> " + tar);
      if (rest.includes("--manifests")) {
        mkdirSync(manifestDir(), { recursive: true });
        for (const [a, src] of Object.entries(COPIED_MANIFESTS)) copyFileSync(join(REPO, "quick/laneb", src), join(manifestDir(), a + ".json"));
        for (const [a, m] of [[NOESCAPE.arm, noescapeManifestOf(out)], [B1D_ARM, mainManifestOf(out)]] as const) {
          writeFileSync(join(manifestDir(), a + ".json"), JSON.stringify({ ...m.summary, inventory_sha256: sha256(m.list) }, null, 2) + "\n");
          writeFileSync(join(out, a + ".files.tsv"), m.list);
          console.log(a + " manifest: files=" + m.summary.tree.files + " tar_sha256=" + m.summary.tar.sha256);
        }
      }
      return 0;
    }
    if (sub === "check") { const r = armsCheck(out); for (const l of r.lines) console.log(l); console.log("B1D ARMS " + (r.pass ? "PASS" : "FAIL")); return r.pass ? 0 : 1; }
    return usage(USAGE);
  }
  if (cmd === "routes") {
    const ex = opt("export") ?? usage(USAGE), tree = resolve(opt("tree") ?? join(ARMS_DIR(), "trees", B1D_ARM)), t = drawnTasks(loadBundle());
    const P = (kind: string, list: string[]) => list.map((task) => ({ kind, task, prompt: promptOf(readFileSync(join(ex, task, "instruction.md"), "utf8")) }));
    const rows = await routeTable(tree, [...P("run", t.run), ...P("calibration", calibrationTasks())]), text = routeTsv(rows);
    if (opt("out")) writeFileSync(opt("out")!, text);
    const probs: string[] = [];
    if (smokeOf(rows).join() !== B1D_SMOKE.join()) probs.push("the smoke rule picks " + smokeOf(rows).join(", ") + ", not " + B1D_SMOKE.join(", "));
    if (rest.includes("--check") && text !== readFileSync(routeFile(), "utf8")) probs.push("the route table differs from " + routeFile());
    for (const k of ["run", "calibration"]) console.log(k + " " + JSON.stringify(routeCounts(rows.filter((r) => r[0] === k))));
    if (process.env[HELDOUT.env]) {
      const ho = await routeTable(tree, P("heldout", heldoutTasks())), n = routeCounts(ho);
      if (opt("sealed")) writeFileSync(opt("sealed")!, routeTsv(ho));
      console.log("heldout " + JSON.stringify(n));
      if (!isHeldoutCoverage(n)) probs.push("the held-out coverage is not the committed " + JSON.stringify(HELDOUT.coverage));
    }
    for (const p of probs) console.error("E_B1_PIN " + p);
    return probs.length ? 1 : 0;
  }
  if (cmd === "sessions" && rest[0] === "run") {
    const out = opt("out") ?? usage(USAGE), problems = await runB1dSessions(resolve(out)), cut = opt("cut");
    if (cut) for (const c of B1D_CASES) { rmSync(join(cut, c.name), { recursive: true, force: true }); if (existsSync(join(out, c.name, "capture"))) cpSync(join(out, c.name, "capture"), join(cut, c.name), { recursive: true }); }
    for (const c of B1D_CASES) { const f = join(out, c.name, "capture", "capture.json"); if (existsSync(f)) console.log(c.name + " listing " + JSON.stringify(JSON.parse(readFileSync(f, "utf8")).listing_facts)); }
    for (const p of problems) console.error("E_B1_PIN " + p);
    console.log("B1D SESSIONS " + (problems.length ? "FAIL " + problems.length : "PASS") + " " + B1D_CASES.length + " cases");
    return problems.length ? 1 : 0;
  }
  if (cmd === "plan") {
    for (const i of B1D_ITEMS) {
      const c = b1dCap(i);
      console.log(i + ": " + c.parts.map((p) => p.name + " (" + partProjection(p).sessions + ")").join(", ") + "; " + c.sessions + " sessions; expected $" + c.expected.toFixed(2) + ", open-session reserve $" + c.parallel.toFixed(2) + ", VM $" + c.vm.toFixed(2) + ", formula cap $" + c.cap + ", recorded cap $" + B1D_CAPS_USD[i]);
    }
    console.log("all-in stop $" + B1D.stopUsd);
    return 0;
  }
  if (cmd === "power") { for (const l of powerLines()) console.log(l); return 0; }
  if (cmd === "reuse") {
    const head = opt("head") ?? git(REPO, ["rev-parse", "HEAD"]).stdout.trim(), a = reuseCheck(head), b = reuseB1c(head);
    for (const l of [...a.lines, ...b.lines]) console.log(l);
    return a.same && b.same ? 0 : 1;
  }
  if (cmd === "approve" || cmd === "done") {
    const ledger = opt("ledger"), it = opt("item") ?? "";
    if (!ledger || !isB1dItem(it)) return usage(USAGE);
    if (cmd === "done") { b1dDone(resolve(ledger), it); console.log(it + " marked done on " + ledger); return 0; }
    const u = opt("usd") ?? "";
    if (!/^\d+(\.\d+)?$/.test(u)) return usage(USAGE);
    b1dApprove(resolve(ledger), it, Number(u), opt("approved-by") ?? "");
    console.log("approved " + it + " at $" + u + " on " + ledger);
    return 0;
  }
  if (cmd === "guard") { guardWork(resolve(rest[0] ?? usage(USAGE))); return 0; }
  if (cmd && LAUNCHER.includes(cmd)) {
    if (GUARDED.includes(cmd)) { if (!rest[0] || (cmd === "relaunch" && !opt("part"))) return usage(USAGE); guardWork(resolve(rest[0]), cmd === "relaunch" ? opt("part") : undefined); }
    l1Main(argv, B1D_PROFILE);
    return 0;
  }
  if (cmd === "table") {
    const [cfg, outPath] = rest;
    if (!cfg || !outPath) return usage(USAGE);
    const rows = buildB1dTable(JSON.parse(readFileSync(cfg, "utf8")));
    writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    console.log("wrote " + rows.length + " rows to " + outPath);
    return 0;
  }
  if (cmd === "report") {
    const it = opt("item") ?? "", read = (f: string) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as B1dRow);
    if (!rest[0] || rest[0].startsWith("--") || !isB1dItem(it)) return usage(USAGE);
    let inRows: B1dRow[] = [], hoRoutes = new Map<string, TaskRoute>();
    if (it === "b1d-ho") {
      inRows = read(opt("in") ?? usage("b1d report --item b1d-ho needs --in <in-sample table.jsonl>"));
      const inBad = checkB1dRows(inRows, drawnTasks(loadBundle()).run, [B1D_ARM]);
      if (inBad.length) { for (const b of inBad) console.error("E_USAGE b1d report --in: " + b); return 2; }
      const sealed = opt("routes") ?? usage("b1d report --item b1d-ho needs --routes <the sealed held-out route table>"), ho = readRouteTsv(readFileSync(sealed, "utf8")).filter((r) => r[0] === "heldout");
      if (!isHeldoutCoverage(routeCounts(ho))) { console.error("E_USAGE b1d report --routes: " + sealed + "'s held-out coverage is not the committed " + JSON.stringify(HELDOUT.coverage)); return 2; }
      hoRoutes = routesByTask(ho);
    }
    const rows = read(rest[0]), tasks = it === "b1d-smoke" ? [...B1D_SMOKE] : it === "b1d-in" ? drawnTasks(loadBundle()).run : heldoutTasks(), arms = it === "b1d-in" ? [B1D_ARM] : [...B1D_ARM_NAMES];
    const bad = checkB1dRows(rows, tasks, arms);
    if (bad.length) { for (const b of bad) console.error("E_USAGE b1d report: " + b); return 2; }
    let lines: string[];
    if (it === "b1d-smoke") lines = ["== B1d pilot: the two smoke tasks, four arms", ...B1D_ARM_NAMES.map((a) => statLine(b1dStats(rows, a, tasks.length))), ...splitLines(rows), ...pilotCheck(rows, committedRouteRows()).lines];
    else if (it === "b1d-in") lines = inReport(rows, inSampleRoutes()).lines;
    else {
      if (tasks.some((t) => !hoRoutes.has(t)) || hoRoutes.size !== tasks.length) return usage("b1d report: " + opt("routes") + " is not the held-out route table");
      lines = hoReport(rows, inReading(b1dStats(inRows, B1D_ARM, B1.tasks)), hoRoutes, tasks).lines;
    }
    for (const l of lines) console.log(l);
    const out = opt("out");
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, it + "-report.txt"), lines.join("\n") + "\n"); writeFileSync(join(out, it + "-reasons.tsv"), reasonsTsv(rows)); }
    return 0;
  }
  return usage(USAGE);
}
