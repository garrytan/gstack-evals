// Copyright (c) 2026 Garry Tan. MIT License.
// B1f, description rewrites against the hook (lanes/delivery-route/README.md, "B1f"; prereg B1F_BUNDLE): gstack at its stable
// tag, installed by its own setup, with B1's prove-it skill beside it. Does rewriting prove-it's description, with gstack's
// prompt-routing hook off, get Opus 5.5 to follow the skill's steps at least as often as the hook does, without loading it on
// tasks it doesn't fit? Four gstack arms (hook; own, long and required with the hook off) and B1's no-gstack arm run side by
// side on 81 bug-fix tasks, and the four gstack arms on 27 feature requests. This file holds the arms' manifests and checks,
// the keyless route table, the plan, caps and launch guard, the session rows, the report with its decision readings, the
// power table and the keyless scripted sessions.
//
//   bun lanes/delivery-route/cli.ts b1f <command> (USAGE below)
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hostTtlHours, itemCheck, L1, l1Main, plannedCells, prefixOf, seeded, type ItemDef, type PartPlan, type Profile } from "../../quick/laneb/l1/l1.ts";
import { parseLog, runProbes, type Rec } from "../../quick/laneb/l1/probes.ts";
import { readSessionRows, sessionsByTrial } from "../../quick/laneb/analysis/analyze.ts";
import { appendRow, fromMicros, Ledger, readRows, toMicros, type Row } from "../../quick/laneb/runner/ledger.ts";
import { ROUTE_CONTEXT, ROUTE_MARK } from "../../quick/laneb/runner/proxy.ts";
import { manifest } from "../../quick/laneb/arms/tree.ts";
import { sdkPython, SESSION_IMAGE } from "../harness-mechanics/sessions.ts";
import { maxGaps, newcombe, wilson } from "./analyze.ts";
import { build as b1Build, TAR_ARGS, wrappers } from "./arms.ts";
import { loadsOf, paired, reuseCheck, type Load } from "./b1b.ts";
import { B1D_PROMPTS, band, namedOf, rigPromptOf, routeCounts, routeTable, routeTsv, readRouteTsv, scriptResults, settingsHooks, type Band } from "./b1d.ts";
import { B1D, PROVE_IT } from "./b1d-pins.ts";
import { B1F, B1F_ARM_NAMES, B1F_ARMS, B1F_BUNDLE, B1F_CAPS_USD, B1F_ITEMS, B1F_PILOT, DESCRIPTIONS, EXT_ARMS, GSTACK_ARMS, GSTACK_STABLE, isB1fArm, isB1fItem, RESERVE, SUPPLY, TASK_SETS, type B1fArm, type B1fItem, type GstackArm } from "./b1f-pins.ts";
import { blockUsd, infraRerun, needsRerun } from "./money.ts";
import { B1_RUN } from "./b1b-pins.ts";
import { AGENT_SKILLS, ARM_SOURCES, B1, frontMatterDigests, MODELS, REPO, sha256, SKILL, TASK_SETUP, VM_HOURS_PER_SESSION } from "./pins.ts";
import { b1Row, pulledInputs, type B1Row, type B1TableConfig } from "./table.ts";
import { BASE, CLAUDE_LISTED, LISTING } from "./sessions.ts";

const pinErr = (m: string): never => { throw new Error("E_B1_PIN " + m); };
const usage = (m: string): never => { throw new Error("E_USAGE " + m); };
const git = (dir: string, args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
export const ARMS_DIR = () => process.env[B1F.armsDirEnv] ?? join(process.env.HOME ?? "", ".capy/work/b1f/arms");
export const manifestDir = () => join(REPO, "quick/laneb", B1F.armManifests);
const gstackFile = (tree: string, f: string) => join(tree, ".claude/skills/gstack", f);
const tarVersion = () => spawnSync("tar", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0] ?? "";
const isGstackArm = (a: string): a is GstackArm => (GSTACK_ARMS as readonly string[]).includes(a);

// ---- The arm files: prove-it's SKILL.md per arm. long and required are B1's gstack-shaped file with only its description line
// rewritten, frozen byte for byte.
export const skillFile = (a: GstackArm) => join(REPO, ARM_SOURCES, B1F_ARMS[a].skill);
export const descriptionOf = (text: string) => /^description: "(.*)"$/m.exec(text)?.[1] ?? null;
export function skillProblems(): string[] {
  const p: string[] = [], own = readFileSync(skillFile("own"), "utf8");
  for (const a of ["own", "long", "required"] as const) {
    const text = readFileSync(skillFile(a), "utf8"), d = descriptionOf(text);
    if (sha256(text) !== DESCRIPTIONS[a].sha256) p.push(B1F_ARMS[a].skill + " hashes to " + sha256(text) + ", not " + DESCRIPTIONS[a].sha256);
    if (d === null || d.length !== DESCRIPTIONS[a].chars) p.push(B1F_ARMS[a].skill + "'s description is " + (d?.length ?? "missing") + " characters, not " + DESCRIPTIONS[a].chars);
    if (d !== null && text !== own.replace('description: "' + descriptionOf(own) + '"', 'description: "' + d + '"')) p.push(B1F_ARMS[a].skill + " differs from " + B1F_ARMS.own.skill + " outside its description line");
  }
  return p;
}

// ---- The trees. b1f-build.sh builds them (gstack's setup is not byte for byte from one build to the next, so the hook tar is
// kept and checked against its manifest, never rebuilt); this checks what each tree must hold.
const MARKERS = [".activated", ".completeness-intro-seen", ".feature-prompted-model-overlay", ".first-loop-tip-shown", ".proactive-prompted", ".telemetry-prompted"];
export const switchesOf = (a: GstackArm) => ({ skill_routing: B1F_ARMS[a].routing, skill_contracts: "on", telemetry: "off" });
export function treeProblems(tree: string, a: GstackArm): string[] {
  const p: string[] = [], skill = join(tree, PROVE_IT.path);
  if (!existsSync(skill) || !readFileSync(skill).equals(readFileSync(skillFile(a))) || (statSync(skill).mode & 0o777) !== PROVE_IT.mode) p.push(PROVE_IT.path + " is not " + B1F_ARMS[a].skill + " at mode 644");
  for (const [f, blob] of Object.entries(GSTACK_STABLE.blobs)) {
    const got = existsSync(gstackFile(tree, f)) ? spawnSync("git", ["hash-object", gstackFile(tree, f)], { encoding: "utf8" }).stdout.trim() : "missing";
    if (got !== blob) p.push(".claude/skills/gstack/" + f + " is blob " + got + ", not " + blob);
  }
  const head = spawnSync("git", ["--git-dir", gstackFile(tree, ".git"), "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  if (head !== GSTACK_STABLE.sha) p.push("the gstack checkout is at " + (head || "nothing") + ", not " + GSTACK_STABLE.sha);
  const want = GSTACK_STABLE.hooks.map((h) => [...h]).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  if (!existsSync(join(tree, ".claude/settings.json"))) p.push("no .claude/settings.json");
  else if (JSON.stringify(settingsHooks(tree)) !== JSON.stringify(want)) p.push("settings.json registers " + JSON.stringify(settingsHooks(tree)) + ", not " + JSON.stringify(want));
  const cfg = existsSync(join(tree, ".gstack/config.yaml")) ? readFileSync(join(tree, ".gstack/config.yaml"), "utf8") : "";
  for (const l of ["update_check: false", "routing_declined: true"]) if (!new RegExp("^" + l + "$", "m").test(cfg)) p.push(".gstack/config.yaml does not set " + l);
  const switches = cfg.split("\n").filter((l) => /^(skill_routing|skill_contracts|telemetry):/.test(l));
  const wantSwitches = B1F_ARMS[a].routing === "off" ? ["skill_routing: off"] : [];
  if (JSON.stringify(switches) !== JSON.stringify(wantSwitches)) p.push(".gstack/config.yaml sets " + JSON.stringify(switches) + ", not " + JSON.stringify(wantSwitches));
  for (const m of MARKERS) if (!existsSync(join(tree, ".gstack", m))) p.push("the seeded user's marker .gstack/" + m + " is missing");
  return p;
}
const configOf = (out: string, a: GstackArm) => Object.fromEntries(readFileSync(join(out, a + ".gstack-config.tsv"), "utf8").trim().split("\n").map((l) => l.split("\t")));
export function armManifestOf(out: string, a: GstackArm) {
  const tree = join(out, "trees", a), w = wrappers(), fetch = JSON.parse(readFileSync(join(out, "fetch-pin.json"), "utf8"));
  if (fetch.sha !== GSTACK_STABLE.sha || fetch.head !== GSTACK_STABLE.sha) pinErr("fetch-pin.json is not the pin " + GSTACK_STABLE.sha);
  const config = configOf(out, a);
  if (JSON.stringify(config) !== JSON.stringify(switchesOf(a))) pinErr(a + ": gstack-config reads " + JSON.stringify(config) + " in the built tree, not " + JSON.stringify(switchesOf(a)));
  const files = Object.keys(GSTACK_STABLE.blobs).map((f) => ({ path: ".claude/skills/gstack/" + f, sha256: sha256(readFileSync(gstackFile(tree, f))) }));
  const skill = readFileSync(join(tree, PROVE_IT.path), "utf8");
  const meta = {
    claude_code: "2.1.312", typed: false, spec: B1F_ARMS[a].spec, tar_gz_sha256: sha256(readFileSync(join(out, a + ".tar.gz"))),
    gstack: { repo: GSTACK_STABLE.repo, tag: GSTACK_STABLE.tag, sha: GSTACK_STABLE.sha, version: GSTACK_STABLE.version, setup: GSTACK_STABLE.setup, git_archive_sha256: fetch.git_archive_sha256, fetch: fetch.method },
    update_check: "false", routing_declined: "true", onboarding_markers: MARKERS.map((m) => ".gstack/" + m).join(" "), gstack_config: config, loadout_lock_sha256: sha256(readFileSync(join(out, "hook.loadout.lock.json"))),
    steps: { sha256: w.steps_sha256, bytes: w.steps_bytes, source: AGENT_SKILLS.repo + " " + AGENT_SKILLS.sha + " " + AGENT_SKILLS.steps.file + " lines " + AGENT_SKILLS.steps.from + "-" + AGENT_SKILLS.steps.to },
    carrier: { path: PROVE_IT.path, source: B1F_ARMS[a].skill, sha256: sha256(skill), description_chars: descriptionOf(skill)?.length ?? null },
    route: { files },
    derived: a === "hook" ? null : a === "own" ? "the hook tree after gstack-config set skill_routing off" : "the own tree with " + PROVE_IT.path + " replaced by " + B1F_ARMS[a].skill,
    tar_command: "tar " + TAR_ARGS.join(" ") + " -cf <arm>.tar .claude .gstack (" + tarVersion() + ", in quick/laneb/arms/Dockerfile's builder image)",
  };
  return manifest(a, tree, join(out, a + ".tar"), meta);
}
/** The files two arm inventories (manifest lists) disagree on. */
export function inventoryDiff(a: string, b: string): string[] {
  const rows = (t: string) => new Map(t.split("\n").filter(Boolean).map((l) => [l.split("\t").at(-1)!, l]));
  const x = rows(a), y = rows(b);
  return [...new Set([...x.keys(), ...y.keys()])].filter((k) => x.get(k) !== y.get(k)).sort();
}
export const DERIVED_DIFF: Record<Exclude<GstackArm, "hook">, [GstackArm, string[]]> = { own: ["hook", [".gstack/config.yaml"]], long: ["own", [PROVE_IT.path]], required: ["own", [PROVE_IT.path]] };
/** none's tar rebuilt byte for byte and its manifest B1's; every gstack arm's tar.gz unpacking to its manifest's tar, its tree's
 *  own checks and its switches; each derived arm's inventory differing from its parent's at only the planned files; and the
 *  rewrite files one line from B1's. */
export function armsCheck(out = ARMS_DIR()): { pass: boolean; lines: string[] } {
  const lines: string[] = [], problems: string[] = [...skillProblems()], m = (a: string) => join(manifestDir(), a + ".json");
  if (!problems.length) lines.push("rewrites: " + ["long", "required"].map((a) => B1F_ARMS[a as GstackArm].skill).join(" and ") + " are " + B1F_ARMS.own.skill + " with only the description line rewritten");
  const b1none = join(REPO, "quick/laneb/arms/manifests/b1/none.json");
  if (!existsSync(m("none")) || !readFileSync(m("none")).equals(readFileSync(b1none))) problems.push(B1F.armManifests + "/none.json is not arms/manifests/b1/none.json byte for byte");
  else {
    const scratch = mkdtempSync(join(tmpdir(), "b1f-none-"));
    try { const got = sha256(readFileSync(b1Build(scratch).none)), want = JSON.parse(readFileSync(m("none"), "utf8")).tar.sha256; if (got !== want) problems.push("none: the rebuilt tar is " + got + ", not " + want); else lines.push("none: manifest is B1's byte for byte, tar " + got + " rebuilt byte for byte"); } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  const lists: Partial<Record<GstackArm, string>> = {};
  for (const a of GSTACK_ARMS) {
    if (!existsSync(m(a))) { problems.push("no manifest " + m(a)); continue; }
    const want = JSON.parse(readFileSync(m(a), "utf8")), gz = join(out, a + ".tar.gz");
    if (want.spec !== B1F_ARMS[a].spec) problems.push(a + ": the manifest's spec is not " + B1F_ARMS[a].spec);
    if (JSON.stringify(want.gstack_config) !== JSON.stringify(switchesOf(a))) problems.push(a + ": the manifest's switches are not " + JSON.stringify(switchesOf(a)));
    const got = existsSync(gz) ? spawnSync("sh", ["-c", 'gzip -dc "$1" | sha256sum', "sh", gz], { encoding: "utf8" }).stdout.split(" ")[0] : "missing";
    if (got !== want.tar?.sha256) problems.push(a + ": " + gz + " unpacks to sha256 " + got + ", not the manifest's " + want.tar?.sha256);
    else if (sha256(readFileSync(gz)) !== want.tar_gz_sha256) problems.push(a + ": the tar.gz is not the manifest's tar_gz_sha256");
    else lines.push(a + ": tar.gz " + want.tar_gz_sha256 + " unpacks to the manifest's tar " + want.tar.sha256);
    const tree = join(out, "trees", a);
    if (!existsSync(tree)) { problems.push(a + ": no tree at " + tree); continue; }
    const p = treeProblems(tree, a);
    problems.push(...p.map((x) => a + ": " + x));
    if (!p.length) lines.push(a + ": the tree holds " + B1F_ARMS[a].skill + " as prove-it, gstack " + GSTACK_STABLE.sha.slice(0, 12) + "'s files at their blobs, " + GSTACK_STABLE.hooks.length + " hook registrations, the seeded user and switches " + JSON.stringify(switchesOf(a)));
    const files = join(out, a + ".files.tsv");
    if (existsSync(files) && sha256(readFileSync(files)) === want.inventory_sha256) lists[a] = readFileSync(files, "utf8");
    else problems.push(a + ": " + files + " is missing or not the manifest's inventory");
  }
  for (const [a, [parent, planned]] of Object.entries(DERIVED_DIFF)) {
    const x = lists[a as GstackArm], y = lists[parent];
    if (x === undefined || y === undefined) continue;
    const d = inventoryDiff(y, x);
    if (JSON.stringify(d) !== JSON.stringify(planned)) problems.push(a + ": differs from " + parent + " at " + JSON.stringify(d) + ", not only " + JSON.stringify(planned));
    else lines.push(a + ": differs from " + parent + " only at " + planned.join(", "));
  }
  for (const p of problems) lines.push("PROBLEM " + p);
  return { pass: !problems.length, lines };
}

// ---- The task sets, read from the bundle and checked against the pins and the bundle's front matter.
export type TaskSet = "primary" | "nonfit";
export function taskList(set: TaskSet | "extension", repo = REPO): string[] {
  const s = TASK_SETS[set], text = readFileSync(join(repo, B1F_BUNDLE, s.file), "utf8"), list = text.split("\n").filter(Boolean);
  const fm = frontMatterDigests(readFileSync(join(repo, B1F_BUNDLE, "README.md"), "utf8")).get(s.file);
  if (list.length !== s.tasks || sha256(text) !== s.sortedSha256 || fm !== s.sortedSha256 || list.join() !== [...list].sort().join()) pinErr(B1F_BUNDLE + "/" + s.file + " is not the frozen " + set + " set (" + s.tasks + " tasks, sorted sha256 " + s.sortedSha256 + ")");
  return list;
}
function bundleLines(file: string, want: string, n: number, repo = REPO): string[] {
  const text = readFileSync(join(repo, B1F_BUNDLE, file), "utf8"), list = text.split("\n").filter(Boolean);
  if (list.length !== n || sha256(text) !== want || frontMatterDigests(readFileSync(join(repo, B1F_BUNDLE, "README.md"), "utf8")).get(file) !== want) pinErr(B1F_BUNDLE + "/" + file + " is not the frozen list (" + n + " lines, sha256 " + want + ")");
  return list;
}
/** The reserve, in the order that replaces an extension task the pilot can't supply. */
export const reserveList = (repo = REPO) => bundleLines(RESERVE.file, RESERVE.sha256, RESERVE.tasks, repo);
/** The pilot's supply sample: each task on one arm, from the extension or the non-fit set. */
export function supplyCells(repo = REPO): { task: string; arm: GstackArm; set: TaskSet }[] {
  const ext = new Set(taskList("extension", repo)), nonfit = new Set(taskList("nonfit", repo));
  return bundleLines(SUPPLY.file, SUPPLY.sha256, SUPPLY.cells, repo).map((l) => {
    const [task, arm, set] = l.split("\t") as [string, GstackArm, TaskSet];
    if (!(set === "nonfit" ? nonfit : ext).has(task) || !(GSTACK_ARMS as readonly string[]).includes(arm)) pinErr(SUPPLY.file + ": " + l + " is not a frozen task on a gstack arm");
    return { task, arm, set };
  });
}
const setOf = (task: string, nonfit: Set<string>): TaskSet => (nonfit.has(task) ? "nonfit" : "primary");

// ---- The keyless route table: gstack's matcher and its real hook, from the hook arm's tree (b1d.ts routeTable), on each
// prompt as the rig sends it.
export const routeFile = () => join(REPO, B1F_BUNDLE, "route-table.tsv");
export async function b1fRoutes(exportDir: string, tree: string) {
  const P = (kind: string, list: readonly string[]) => list.map((task) => ({ kind, task, prompt: rigPromptOf(readFileSync(join(exportDir, task, "instruction.md"), "utf8")) }));
  return routeTable(tree, [...P("primary", taskList("primary")), ...P("extension", taskList("extension")), ...P("nonfit", taskList("nonfit")), ...P("pilot", B1F_PILOT)]);
}
export function committedRoutes(): string[][] {
  const text = readFileSync(routeFile(), "utf8"), want = frontMatterDigests(readFileSync(join(REPO, B1F_BUNDLE, "README.md"), "utf8")).get("route-table.tsv");
  if (sha256(text) !== want) pinErr(B1F_BUNDLE + "/route-table.tsv hashes to " + sha256(text) + ", not its front matter's " + want);
  return readRouteTsv(text);
}

// ---- Plan, profile and money.
const item = (capUsd: number): ItemDef => ({ capUsd, taskSet: "swerebench-r3a4", cells: MODELS.opus.cells, allowanceUsd: MODELS.opus.allowanceUsd, model: MODELS.opus.id });
export const B1F_ITEM_DEFS = Object.fromEntries(B1F_ITEMS.map((i) => [i, item(B1F_CAPS_USD[i])])) as Record<B1fItem, ItemDef>;
/** b1f-pilot: one part, the pilot task on the four gstack arms and each supply task on its one arm. b1f-main: the primary set
 *  in sorted order, B1F.partTasks tasks a part with all five arms of each task in its part; then the extension the same way
 *  with the hook and the two rewrites; then the non-fit set in one part with the four gstack arms. Each part's cells run in
 *  the order L1's seeded() gives with B1's seed. */
export function b1fPlan(name: string, primary = taskList("primary"), nonfit = taskList("nonfit"), extension = taskList("extension")): { parts: PartPlan[]; sessions: number } {
  const part = (p: string, rects: { tasks: string[]; arms: string[]; attempts: number }[]): PartPlan => ({ name: p, prefix: prefixOf(name, p), rects: seeded(rects, B1.seed) });
  const chunks = (prefix: string, tasks: string[], arms: readonly string[]) => Array.from({ length: Math.ceil(tasks.length / B1F.partTasks) }, (_, i) => part(prefix + (i + 1), [{ tasks: tasks.slice(i * B1F.partTasks, (i + 1) * B1F.partTasks), arms: [...arms], attempts: 1 }]));
  let parts: PartPlan[];
  if (name === "b1f-pilot") parts = [part("pilot-opus", [{ tasks: [...B1F_PILOT], arms: [...GSTACK_ARMS], attempts: 1 }, ...supplyCells().map((c) => ({ tasks: [c.task], arms: [c.arm], attempts: 1 }))])];
  else if (name === "b1f-main") parts = [...chunks("b1f-primary-", primary, B1F_ARM_NAMES), ...chunks("b1f-extension-", extension, EXT_ARMS), part("b1f-nonfit", [{ tasks: nonfit, arms: [...GSTACK_ARMS], attempts: 1 }])];
  else return usage("unknown item " + name + "; one of " + B1F_ITEMS.join(", "));
  return { parts, sessions: parts.flatMap((p) => [...plannedCells(p).values()]).reduce((a, b) => a + b, 0) };
}
export const B1F_PROFILE: Profile = {
  items: B1F_ITEM_DEFS,
  armSpecs: Object.fromEntries(B1F_ARM_NAMES.map((a) => [a, B1F_ARMS[a].spec])),
  tars: [...B1F_ARM_NAMES],
  armManifests: B1F.armManifests,
  hostRoot: B1F.hostRoot,
  ledgerPort: B1F.ledgerPort,
  seed: B1.seed,
  concurrent: B1.concurrent,
  taskSetup: TASK_SETUP,
  attempt2: {
    skip: () => null,
    owed: (runs) => {
      const nonfit = new Set(taskList("nonfit")), rows = runs.flatMap((r) => { const c = pulledInputs(r.dir, r.part); return c.jobs.length ? buildB1fTable(c) : []; });
      const owe = rows.filter((r) => needsRerun(r as unknown as B1Row) && !(nonfit.has(r.task) && r.responded));
      return { owed: owe.map((r) => ({ task: r.task, arm: r.arm, reason: r.reason })), rects: infraRerun(owe as unknown as B1Row[]).rects };
    },
  },
  parts: (name, _frozen, inputs) => {
    for (const [f, d] of frontMatterDigests(readFileSync(join(REPO, B1F_BUNDLE, "README.md"), "utf8"))) inputs["b1f/" + f] = d;
    return b1fPlan(name).parts;
  },
};
const sessionsOf = (p: PartPlan) => [...plannedCells(p).values()].reduce((a, b) => a + b, 0);
export function partProjection(p: PartPlan) {
  let model = 0;
  for (const [cell, n] of plannedCells(p)) { const arm = cell.split("\t")[1]!; model += toMicros(n * (isB1fArm(arm) ? B1F_ARMS[arm].rateUsd : usage("a planned cell has arm " + arm))); }
  const sessions = sessionsOf(p);
  return { sessions, model, vm: toMicros(Math.max(1, Math.ceil((sessions * VM_HOURS_PER_SESSION) / Number(L1.vm.reserveHours))) * blockUsd) };
}
const parallelUsd = (parts: PartPlan[]) => Math.min(B1.concurrent, Math.max(0, ...parts.map(sessionsOf))) * MODELS.opus.allowanceUsd;
/** The crew's cap rule: ceil10(1.35 x expected model spend + the open-session reserve + VM share). */
export function b1fCap(name: B1fItem) {
  const parts = b1fPlan(name).parts, proj = parts.map(partProjection);
  const expected = fromMicros(proj.reduce((x, p) => x + p.model, 0));
  const vm = fromMicros(proj.reduce((x, p) => x + p.vm, 0)) + hostTtlHours(parts.length) * L1.host.usdPerHour;
  return { parts, sessions: proj.reduce((x, p) => x + p.sessions, 0), expected, parallel: parallelUsd(parts), vm, cap: Math.ceil((1.35 * expected + parallelUsd(parts) + vm) / 10) * 10 };
}
export function b1fApprove(path: string, name: string, capUsd: number, by: string) {
  if (!isB1fItem(name)) return usage("b1f approve: unknown item " + name + "; one of " + B1F_ITEMS.join(", "));
  if (!by.trim()) usage("b1f approve: --approved-by names who recorded the cap");
  if (toMicros(capUsd) !== toMicros(B1F_CAPS_USD[name])) usage("refused: " + name + "'s recorded cap is $" + B1F_CAPS_USD[name] + ", not $" + capUsd);
  if (readRows(path).length) usage("refused: " + path + " already holds rows; an item's ledger starts with its approval row");
  new Ledger(path, name).approve(capUsd, { approved_by: by, source: "B1f description rewrite prereg: the cap recorded for " + name });
  itemCheck(readRows(path), name, B1F_CAPS_USD[name]);
}
const VM_ID = /(^|\/)vm(-\d+)?$|^host-\d+$/;
export function b1fTotals(rows: Row[], name: B1fItem) {
  const t = { cap: toMicros(B1F_CAPS_USD[name]), settled: 0, open: 0, openIds: [] as string[], done: rows.some((r) => r.kind === "note" && r.id === "done"), vmSettled: 0, vmOpen: 0, hostOpen: false };
  if (!rows.length) return t;
  const approval = rows.find((r) => r.kind === "approval");
  if (!approval || approval.item !== name || approval.usd_micros !== t.cap) usage("refused: the ledger for " + name + " does not open with its approval row at $" + B1F_CAPS_USD[name]);
  const reserved = new Map<string, number>(), settled = new Map<string, number>();
  for (const r of rows) { if (r.kind === "reserve") reserved.set(r.id, r.usd_micros); if (r.kind === "settle") settled.set(r.id, r.usd_micros); }
  for (const [id, v] of settled) { t.settled += v; if (VM_ID.test(id)) t.vmSettled += v; }
  for (const [id, v] of reserved) { if (settled.has(id)) continue; t.open += v; t.openIds.push(id); if (VM_ID.test(id)) t.vmOpen += v; if (/^host-\d+$/.test(id)) t.hostOpen = true; }
  return t;
}
export function b1fDone(path: string, name: B1fItem) {
  const t = b1fTotals(readRows(path), name);
  if (t.done) usage("refused: " + name + " is marked done already");
  if (t.openIds.length) usage("refused: " + name + " still holds " + t.openIds.length + " open reservations; settle them first");
  appendRow(path, { ts: new Date().toISOString(), item: name, kind: "note", id: "done", usd_micros: 0 });
}
/** The launch guard (B1d's rule): the item's spend so far plus its unfinished parts at planned spend, the open-session reserve
 *  and the VM share, against its cap; every item plus B1f's share of this lane's counter, against the all-in stop. b1f-main
 *  never launches before b1f-pilot is marked done. A relaunch is never refused on money: an overshoot prints OVERSHOOT for
 *  the Captain and the relaunch salvages first. */
export function b1fGuard(name: B1fItem, ledgers: Partial<Record<B1fItem, Row[]>>, plans: Partial<Record<B1fItem, { parts: PartPlan[]; finished: string[] }>>, crewUsd: number, relaunching?: string) {
  const why: string[] = [];
  const all = B1F_ITEMS.map((i) => {
    const t = b1fTotals(ledgers[i] ?? [], i), plan = plans[i] ?? { parts: b1fPlan(i).parts, finished: [] };
    const left = i === name && relaunching ? [] : plan.parts.filter((p) => !plan.finished.includes(p.name)), proj = left.map(partProjection);
    const model = t.settled - t.vmSettled + t.open - t.vmOpen + proj.reduce((x, p) => x + p.model, 0) + toMicros(parallelUsd(left));
    const host = !t.hostOpen && left.length ? toMicros(hostTtlHours(left.length) * L1.host.usdPerHour) : 0;
    const total = model + t.vmSettled + t.vmOpen + host + proj.reduce((x, p) => x + p.vm, 0);
    return { item: i, ...t, total, left: left.length, counted: t.done ? t.settled : Math.max(t.settled + t.open, total) };
  });
  const own = all.find((x) => x.item === name)!, usd = (m: number) => "$" + fromMicros(m).toFixed(2);
  if (own.done) why.push(name + " is marked done; a done item never launches again");
  if (name === "b1f-main" && !relaunching && !all.find((x) => x.item === "b1f-pilot")!.done) why.push("b1f-pilot is not marked done; the counted run waits for the pilot and its report");
  const money: string[] = [], sum = all.reduce((x, i) => x + i.counted, 0) + toMicros(crewUsd), stop = toMicros(B1F.stopUsd);
  if (own.total > own.cap) money.push(name + "'s projection " + usd(own.total) + " passes its cap " + usd(own.cap));
  if (sum > stop) money.push("all-in " + usd(sum) + " passes the " + usd(stop) + " stop");
  if (!relaunching) why.push(...money);
  const over = !why.length && money.length ? ["  relaunch of " + relaunching + " runs anyway, salvage first; report to the Captain at once: " + money.join("; ")] : [];
  const lines = ["B1F_LAUNCH " + (why.length ? "REFUSE" : over.length ? "OVERSHOOT" : "PASS") + " " + name + ": all-in " + usd(sum) + " of " + usd(stop) + "; " + name + " " + usd(own.total) + " of cap " + usd(own.cap) + " (" + own.left + " parts to run)", ...over, ...all.map((i) => "  " + i.item + (i.done ? " done" : "") + ": settled " + usd(i.settled) + ", open " + usd(i.open) + ", counted " + usd(i.counted)), "  crew " + usd(toMicros(crewUsd))];
  return { ok: !why.length, why, lines };
}
export const B1F_FILES = ["lanes/delivery-route/arms/b1f", "lanes/delivery-route/b1f-pins.ts", "lanes/delivery-route/b1f.ts", "lanes/delivery-route/b1f-build.sh", "quick/laneb/arms/manifests/b1f", "quick/laneb/arms/Dockerfile", B1F_BUNDLE];
export function harnessDirty(repo = REPO): string[] {
  const r = git(repo, ["status", "--porcelain", "--", ...new Set([...B1_RUN.harness, ...B1F_FILES])]);
  if (r.status !== 0) pinErr("git status failed in " + repo + ": " + (r.stderr ?? "").trim());
  return r.stdout.split("\n").filter(Boolean);
}

// ---- Session rows.
export type B1fRow = Omit<B1Row, "arm"> & { arm: B1fArm; set: TaskSet; responded: boolean; load: Load; named: string[] | null; routed_events: number | null; route_mark: boolean | null; tar_sha256: string | null; first_call: boolean };
/** A session counts (is graded for its set): on the primary set, B1's graded; on the non-fit set, any session a model response
 *  reached, whatever its verifier did, since loads are the only measure there. */
export const counts = (r: Pick<B1fRow, "set" | "outcome" | "responded">) => r.outcome === "graded" || (r.set === "nonfit" && r.responded);
function armEvent(dir: string): string | null {
  const f = join(dir, "evaluator", "usersim-events.jsonl");
  for (const l of existsSync(f) ? readFileSync(f, "utf8").split("\n") : []) { try { const e = JSON.parse(l); if (e?.event === "arm") return typeof e.tar_sha256 === "string" ? e.tar_sha256 : null; } catch { continue; } }
  return null;
}
export function b1fRow(dir: string, ctx: Parameters<typeof b1Row>[1], nonfit: Set<string>): B1fRow | null {
  const row = b1Row(dir, { ...ctx, arms: B1F_ARM_NAMES });
  if (!row || !isB1fArm(row.arm)) return null;
  const msgs = join(dir, "evaluator", "sdk-messages.jsonl"), recs = existsSync(msgs) ? parseLog(readFileSync(msgs, "utf8")) : [], load = loadsOf(recs);
  const last: any = ctx.sessions.get(row.trial)?.at(-1), logFile = join(dir, "evaluator", "gstack-hooks", "hooks", "skill-route.log");
  const log = isGstackArm(row.arm) && existsSync(logFile) ? readFileSync(logFile, "utf8") : null;
  const p = runProbes(recs, { gstackRoots: [], investigatePrefix: null, home: ctx.home }), responded = row.outcome !== "cap_stop" && (last ? (last.ok_responses ?? 0) > 0 : p.model_text);
  const audit_hits = isGstackArm(row.arm) ? p.audit_hits.filter((h) => !["/.claude/skills", "/.gstack"].some((o) => h.includes(ctx.home + o + "/") || h.endsWith(ctx.home + o))) : row.audit_hits;
  return { ...row, arm: row.arm, set: setOf(row.task, nonfit), responded, audit_hits, load, named: namedOf(log), routed_events: log === null ? null : log.split("\n").filter((l) => /\bevent=routed\b/.test(l)).length, route_mark: isGstackArm(row.arm) ? (last ? (last.route_mark_before_output ?? false) : null) : null, tar_sha256: armEvent(dir), first_call: load.loaded && load.at_call === 1 };
}
export function buildB1fTable(cfg: B1TableConfig): B1fRow[] {
  const sessions = sessionsByTrial(readSessionRows(cfg.sessions)), nonfit = new Set(taskList("nonfit")), out: B1fRow[] = [];
  for (const job of cfg.jobs) for (const name of readdirSync(job.dir).sort()) {
    const d = join(job.dir, name);
    if (!statSync(d).isDirectory()) continue;
    const row = b1fRow(d, { part: job.part ?? null, sessions, home: cfg.home ?? "/root" }, nonfit);
    if (row) out.push(row);
  }
  return out;
}
export function checkB1fRows(rows: B1fRow[], plan: { task: string; arm: string }[]): string[] {
  const bad: string[] = [], seen = new Set<string>(), want = new Set(plan.map((c) => c.arm + "\t" + c.task));
  for (const r of rows) {
    if (!want.has(r.arm + "\t" + r.task)) bad.push(r.trial + " is " + r.arm + " on " + r.task + ", not a planned cell");
    if (r.model !== MODELS.opus.id) bad.push(r.trial + " ran " + r.model + ", not " + MODELS.opus.id);
    if (!counts(r)) continue;
    if (seen.has(r.arm + "\t" + r.task)) bad.push("two counted rows for " + r.arm + " " + r.task);
    seen.add(r.arm + "\t" + r.task);
  }
  return bad;
}

// ---- Stats, readings and the report.
const loaded = (r: B1fRow) => r.load.loaded, followed = (r: B1fRow) => !!r.detect?.followed;
export type Stat = { arm: B1fArm; set: TaskSet; planned: number; graded: number; gaps: number; cap_stops: number; incomplete: boolean; followed: number; followed_ci: [number, number] | null; loaded: number; loaded_ci: [number, number] | null; first_call: number; passes: number; cost_usd: number; safety_stops: number; audit_sessions: number };
export function b1fStats(rows: B1fRow[], arm: B1fArm, set: TaskSet, planned: number): Stat {
  const all = rows.filter((r) => r.arm === arm && r.set === set), g = all.filter(counts), f = g.filter(followed).length, k = g.filter(loaded).length, gaps = planned - g.length;
  return {
    arm, set, planned, graded: g.length, gaps, cap_stops: all.filter((r) => r.outcome === "cap_stop").length, incomplete: all.some((r) => r.outcome === "cap_stop") || gaps > maxGaps(planned),
    followed: f, followed_ci: g.length ? wilson(f, g.length) : null, loaded: k, loaded_ci: g.length ? wilson(k, g.length) : null, first_call: g.filter((r) => r.first_call).length,
    passes: g.filter((r) => r.pass).length, cost_usd: all.reduce((x, r) => x + (r.cost_usd ?? 0), 0), safety_stops: all.filter((r) => r.safety_stop).length, audit_sessions: all.filter((r) => r.audit_hits.length).length,
  };
}
const counted = (rows: B1fRow[]) => rows.map((r) => ({ ...r, outcome: counts(r) ? "graded" : r.outcome }));
/** Arm a minus arm b on one set, paired by task, with Newcombe's 95% interval. */
export const pairedOn = (rows: B1fRow[], set: TaskSet, a: B1fArm, b: B1fArm, pick: (r: B1fRow) => boolean) => { const c = counted(rows.filter((r) => r.set === set)); return paired(c.filter((r) => r.arm === a), c.filter((r) => r.arm === b), pick as any, pick as any); };
export type Verdict = "incomplete" | "over-loads" | "rewrite" | "fix-method" | "loads less";
export const VERDICTS: Record<Verdict, string> = {
  incomplete: "no decision: an arm the reading needs is INCOMPLETE; the Captain decides what happens next",
  "over-loads": "over-loads on tasks it doesn't fit: no blanket rewrite in this style",
  rewrite: "matches or beats the hook on steps followed and stays under the over-loading bound: rewrite gstack's descriptions in this style",
  "fix-method": "loads within the margin of the hook but its steps are followed less: no rewrite; FIX-METHOD on prove-it's body",
  "loads less": "loads prove-it less often than the hook: no rewrite; the hook stays gstack's route",
};
/** One rewrite's verdict (README section 1), in order: INCOMPLETE; over-loading; followed against the hook; loads against the hook. */
export function verdictOf(x: { incomplete: boolean; nonfitLoaded: number; nonfitGraded: number; followed: { lo: number }; loads: { lo: number } }): Verdict {
  if (x.incomplete) return "incomplete";
  if (x.nonfitLoaded >= B1F.overload * x.nonfitGraded - 1e-9) return "over-loads";
  if (band(x.followed as { lo: number; hi: number }) === "matches") return "rewrite";
  return band(x.loads as { lo: number; hi: number }) === "matches" ? "fix-method" : "loads less";
}
export const SOL_LINE = "The evidence is Opus 5.5 in Claude Code only: any rewrite gstack ships needs a quick look with GPT-6.2 Sol in Codex first, because a REQUIRED wording could over-load there too.";
const pct = (x: number, n: number) => (n ? ((100 * x) / n).toFixed(1) + "%" : "n/a");
const ci = (c: [number, number] | null) => (c ? " [" + (100 * c[0]).toFixed(1) + ", " + (100 * c[1]).toFixed(1) + "]" : "");
const pts = (x: number) => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
const pairLine = (name: string, x: ReturnType<typeof paired>, b?: Band) => "  " + name + ": " + pts(x.diff) + " points [" + pts(x.lo) + ", " + pts(x.hi) + "] on " + x.pairs + " paired tasks (" + x.a_only + " vs " + x.b_only + " discordant)" + (b ? ": " + b : "");
const statLine = (s: Stat) => "  " + s.arm + ": followed " + s.followed + "/" + s.graded + " " + pct(s.followed, s.graded) + ci(s.followed_ci) + "; loaded " + s.loaded + "/" + s.graded + " " + pct(s.loaded, s.graded) + ci(s.loaded_ci) + ", " + s.first_call + " at the first call" + (s.incomplete ? " INCOMPLETE" : "") + "; gaps " + s.gaps + ", cap stops " + s.cap_stops + ", safety stops " + s.safety_stops + ", audit " + s.audit_sessions + ", passes " + s.passes + " (descriptive), cost $" + s.cost_usd.toFixed(2);
export function mainReport(rows: B1fRow[], primary: string[], nonfit: string[], extension: string[]) {
  const ext = (a: B1fArm) => (EXT_ARMS as readonly string[]).includes(a), first = new Set(primary), firstRows = rows.filter((r) => first.has(r.task));
  const P = Object.fromEntries(B1F_ARM_NAMES.map((a) => [a, b1fStats(rows, a, "primary", primary.length + (ext(a) ? extension.length : 0))])) as Record<B1fArm, Stat>;
  const N = Object.fromEntries(GSTACK_ARMS.map((a) => [a, b1fStats(rows, a, "nonfit", nonfit.length)])) as Record<GstackArm, Stat>;
  const lines = ["== B1f primary: " + (primary.length + extension.length) + " bug-fix tasks, " + primary.length + " on all five arms and " + extension.length + " more on " + EXT_ARMS.join(", ") + "; own and none are descriptive", ...B1F_ARM_NAMES.map((a) => statLine(P[a]))];
  const verdicts: Partial<Record<GstackArm, Verdict>> = {};
  for (const a of ["own", "long", "required"] as const) {
    const f = pairedOn(rows, "primary", a, "hook", followed), l = pairedOn(rows, "primary", a, "hook", loaded), tag = a === "own" ? " (descriptive)" : "";
    lines.push(pairLine("followed, " + a + " - hook" + tag, f, band(f)), pairLine("loaded, " + a + " - hook" + tag, l, band(l)), pairLine("followed, " + a + " - none (descriptive)", pairedOn(rows, "primary", a, "none", followed)));
    if (a !== "own") lines.push(pairLine("followed, " + a + " - hook, the first " + primary.length + " tasks only (descriptive)", pairedOn(firstRows, "primary", a, "hook", followed)));
    if (a !== "own") verdicts[a] = verdictOf({ incomplete: P[a].incomplete || P.hook.incomplete || N[a].incomplete, nonfitLoaded: N[a].loaded, nonfitGraded: N[a].graded, followed: f, loads: l });
  }
  lines.push(pairLine("followed, hook - none (descriptive)", pairedOn(rows, "primary", "hook", "none", followed)));
  const k = rows.filter((r) => r.set === "primary" && r.arm !== "none" && counts(r) && loaded(r));
  lines.push("  followed among sessions that loaded: " + GSTACK_ARMS.map((a) => a + " " + k.filter((r) => r.arm === a && followed(r)).length + "/" + k.filter((r) => r.arm === a).length).join(", "));
  lines.push("", "== B1f non-fit: " + nonfit.length + " feature requests, four gstack arms (loads anywhere; the bound is " + (100 * B1F.overload).toFixed(1) + "% of counted sessions)", ...GSTACK_ARMS.map((a) => statLine(N[a]) + (N[a].incomplete ? "" : "; " + (N[a].loaded >= B1F.overload * N[a].graded - 1e-9 ? "AT OR OVER" : "under") + " the bound")));
  for (const a of ["own", "long", "required"] as const) lines.push(pairLine("non-fit loaded, " + a + " - hook (descriptive)", pairedOn(rows, "nonfit", a, "hook", loaded)));
  lines.push("", "== Decision, per rewrite (margin -" + (100 * B1F.margin).toFixed(0) + " points on followed)");
  for (const a of ["long", "required"] as const) lines.push("  " + a + ": " + verdicts[a] + ": " + VERDICTS[verdicts[a]!]);
  const yes = (["long", "required"] as const).filter((a) => verdicts[a] === "rewrite");
  lines.push("  advice: " + (yes.length ? "rewrite gstack's descriptions in the style of " + yes.join(" and ") + (yes.includes("required") ? "; whether gstack ships a REQUIRED wording is a product call for gstack's owner, sent with this result" : "") : "no rewrite"), "  " + SOL_LINE);
  return { lines, P, N, verdicts };
}
export type PilotCell = { task: string; arm: GstackArm; supply: boolean };
export const pilotCells = (repo = REPO): PilotCell[] => [...B1F_PILOT.flatMap((task) => GSTACK_ARMS.map((arm) => ({ task, arm, supply: false }))), ...supplyCells(repo).map((c) => ({ task: c.task, arm: c.arm, supply: true }))];
/** R111 on the pilot's own outputs. Each gstack arm: no audit hit in any of its sessions, its pilot-task session graded, and
 *  every session it counts with its tar the manifest's and its route as planned (hook: the hook named what the route table says and, where it named a
 *  skill, the line reached the request; the others: no routed event and no line). A supply task with no counted session
 *  (graded on the primary set, a model response on the non-fit set) is a supply failure: the arm still passes and the task
 *  goes to the reserve rule. Across the arms, at least one load the detector reads at this pin. */
export function pilotCheck(rows: B1fRow[], routeRows: string[][], tarSha: Record<GstackArm, string>, cells: PilotCell[] = pilotCells()): { lines: string[]; failed: string[]; supply: string[] } {
  const lines: string[] = [], failed: string[] = [], supply: string[] = [];
  for (const arm of GSTACK_ARMS) {
    const why: string[] = [];
    for (const c of cells.filter((x) => x.arm === arm)) {
      const t = c.task, all = rows.filter((r) => r.arm === arm && r.task === t), g = all.filter(counts), hits = all.reduce((n, r) => n + r.audit_hits.length, 0);
      if (hits) why.push(t + " has " + hits + " audit hits");
      if (g.length !== 1) { if (c.supply && !g.length) supply.push(t + " on " + arm); else why.push(t + " has " + g.length + " counted rows"); continue; }
      const r = g[0]!, route = routeRows.find((x) => x[1] === t), want = route ? (route[5] === "-" ? [] : route[5]!.split(",")) : null;
      if (r.tar_sha256 !== tarSha[arm]) why.push(t + ": the session's arm tar is " + r.tar_sha256 + ", not " + tarSha[arm]);
      if (arm === "hook") {
        if (want === null || JSON.stringify(r.named) !== JSON.stringify(want)) why.push(t + ": the hook named " + (r.named === null ? "nothing (no hook log)" : "[" + r.named.join(",") + "]") + ", the route table " + (want === null ? "has no row" : "[" + want.join(",") + "]"));
        if (want?.length && r.route_mark !== true) why.push(t + ": the hook's line did not reach the request");
      } else if (r.routed_events !== 0 && r.routed_events !== null || r.route_mark !== false) why.push(t + ": routing is not off (" + r.routed_events + " routed events, line delivered " + r.route_mark + ")");
    }
    if (why.length) failed.push(arm);
    lines.push("  pilot " + (why.length ? "FAIL " + arm + ": " + why.join("; ") : "PASS " + arm));
  }
  for (const s of supply) lines.push("  pilot SUPPLY FAIL " + s + ": no counted session; the reserve rule applies (README section 3)");
  lines.push("  pilot supply: " + (cells.filter((c) => c.supply).length - supply.length) + " of " + cells.filter((c) => c.supply).length + " supply tasks counted");
  const loads = rows.filter((r) => counts(r) && r.load.loaded);
  lines.push("  pilot loads read: " + loads.length + " (" + loads.map((r) => r.arm + " via " + r.load.via + " at call " + r.load.at_call).join(", ") + ")");
  if (!loads.length) { failed.push("loads"); lines.push("  pilot FAIL loads: no pilot session loaded prove-it, so the pilot does not show the detector reading a load at this pin"); }
  return { lines, failed, supply };
}
export const reasonsTsv = (rows: B1fRow[]) => ["set\tarm\ttask\ttrial\toutcome\treason\tloaded\tfollowed\tnamed\tfirst_text", ...[...rows].sort((a, b) => (a.set + a.arm + a.task).localeCompare(b.set + b.arm + b.task)).map((r) => [r.set, r.arm, r.task, r.trial, counts(r) ? "counted" : r.outcome, r.reason, r.load.loaded, !!r.detect?.followed, r.named === null ? "-" : r.named.join(","), r.load.first_text.replace(/[\t\n]/g, " ")].join("\t"))].join("\n") + "\n";

// ---- Power and the smallest detectable difference, exact, on n paired tasks. Two models: each arm following independently
// at its own rate (phi 0), and the within-task agreement B1d's published held-out rows show between its hook arm and a
// CLAUDE.md arm on steps followed (phi from b1dPhi, the lower of the two such pairs).
export function pairPower(pa: number, pb: number, n: number, phi = 0) {
  const s = Math.sqrt(pa * (1 - pa) * pb * (1 - pb)), q11 = pa * pb + phi * s, q = [q11, pa - q11, pb - q11, 1 - pa - pb + q11], lf = [0];
  if (q.some((x) => x < -1e-12)) return null;
  for (let i = 1; i <= n; i++) lf[i] = lf[i - 1]! + Math.log(i);
  const o = { above: 0, below: 0, matches: 0, middle: 0, "clearly loses": 0 };
  for (let a = 0; a <= n; a++) for (let b = 0; a + b <= n; b++) for (let c = 0; a + b + c <= n; c++) {
    const d = n - a - b - c, k = [a, b, c, d], lp = lf[n]! - k.reduce((x, y) => x + lf[y]!, 0) + k.reduce((x, y, i) => x + (y ? y * Math.log(Math.max(q[i]!, 1e-300)) : 0), 0), pr = Math.exp(lp);
    if (pr < 1e-15) continue;
    const r = newcombe(a, b, c, d);
    if (r.lo > 0) o.above += pr;
    if (r.hi < 0) o.below += pr;
    o[band(r)] += pr;
  }
  return o;
}
export const B1D_RESULTS = { dir: "wiki/board/2026-11-19-capy-b1d-hook-default-results", hook: "gstack-main", others: ["project-md", "project-md-noescape"] } as const;
/** phi for steps followed between B1d's hook arm and each CLAUDE.md arm on its held-out tasks, from its published rows. */
export function b1dPhi(): { arm: string; phi: number; both: number; a_only: number; b_only: number; neither: number }[] {
  const text = readFileSync(join(REPO, B1D_RESULTS.dir, "ho-sessions.jsonl"), "utf8"), want = frontMatterDigests(readFileSync(join(REPO, B1D_RESULTS.dir, "README.md"), "utf8")).get("ho-sessions.jsonl");
  if (sha256(text) !== want) pinErr(B1D_RESULTS.dir + "/ho-sessions.jsonl hashes to " + sha256(text) + ", not its front matter's " + want);
  const rows = text.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.outcome === "graded"), f = (r: any) => !!r?.detect?.followed;
  const by = (arm: string) => new Map(rows.filter((r) => r.arm === arm).map((r) => [r.task, r]));
  const hook = by(B1D_RESULTS.hook);
  return B1D_RESULTS.others.map((arm) => {
    const other = by(arm), t = [...hook.keys()].filter((x) => other.has(x)), c = { both: 0, a_only: 0, b_only: 0, neither: 0 };
    for (const x of t) { const a = f(hook.get(x)), b = f(other.get(x)); if (a && b) c.both++; else if (a) c.a_only++; else if (b) c.b_only++; else c.neither++; }
    const n = t.length, pa = (c.both + c.a_only) / n, pb = (c.both + c.b_only) / n;
    return { arm, phi: (c.both / n - pa * pb) / Math.sqrt(pa * (1 - pa) * pb * (1 - pb)), ...c };
  });
}
export function mdd(base: number, n: number, dir: "below" | "above", phi = 0): number {
  for (let k = 0; k <= 100; k++) { const p = dir === "below" ? base - k / 100 : base + k / 100; if (p < 0 || p > 1) break; const o = pairPower(p, base, n, phi); if (o && o[dir] >= 0.8) return k / 100; }
  return NaN;
}
const binomTail = (n: number, p: number, k: number) => { let s = 0, c = 1; for (let i = 0; i <= n; i++) { if (i >= k) s += c * p ** i * (1 - p) ** (n - i); c = (c * (n - i)) / (i + 1); } return s; };
export function powerLines(n: number = TASK_SETS.primary.tasks + TASK_SETS.extension.tasks, n0: number = TASK_SETS.primary.tasks, m: number = TASK_SETS.nonfit.tasks): string[] {
  if (B1F.margin !== B1D.margin) pinErr("b1d.ts band() reads B1d's margin, which is not B1f's");
  const ph = b1dPhi(), phi = Math.min(...ph.map((x) => x.phi));
  const mddTable = (k: number) => [0.2, 0.3, 0.4, 0.5, 0.6].map((b) => (100 * b).toFixed(0) + "%\t" + [mdd(b, k, "below"), mdd(b, k, "above"), mdd(b, k, "below", phi), mdd(b, k, "above", phi)].map((x) => (100 * x).toFixed(0) + " points").join("\t"));
  const head = "hook's true rate\tbelow, phi 0\tabove, phi 0\tbelow, phi " + phi.toFixed(2) + "\tabove, phi " + phi.toFixed(2);
  const lines = ["decision comparisons (long and required against the hook): " + n + " tasks, paired by task; followed and loads move in steps of " + (100 / n).toFixed(2) + " points", "descriptive comparisons (own against the hook, every arm against none): " + n0 + " tasks, steps of " + (100 / n0).toFixed(2) + " points", "", "within-task agreement on steps followed in B1d's published held-out rows (hook arm against each CLAUDE.md arm):", ...ph.map((x) => "  " + B1D_RESULTS.hook + " vs " + x.arm + ": both " + x.both + ", hook only " + x.a_only + ", other only " + x.b_only + ", neither " + x.neither + "; phi " + x.phi.toFixed(3)), "planning phi: " + phi.toFixed(3) + " (the lower); phi 0 is the independent model", "", "MDD at n=" + n + ", the decision comparisons (80% power, the 95% interval wholly on one side of 0)", head, ...mddTable(n)];
  lines.push("", "odds the rewrite reads \"matches\" (lower end above -" + (100 * B1F.margin).toFixed(0) + " points) at n=" + n + ", by true rates", "hook\trewrite\tmatches, phi 0\tmatches, phi " + phi.toFixed(2) + "\tclearly loses, phi " + phi.toFixed(2));
  for (const [h, r] of [[0.3, 0.3], [0.3, 0.25], [0.3, 0.2], [0.3, 0.35], [0.4, 0.4], [0.4, 0.35], [0.4, 0.3], [0.5, 0.5], [0.5, 0.45], [0.5, 0.4]] as [number, number][]) { const a = pairPower(r, h, n)!, c = pairPower(r, h, n, phi)!; lines.push((100 * h).toFixed(0) + "%\t" + (100 * r).toFixed(0) + "%\t" + a.matches.toFixed(3) + "\t" + c.matches.toFixed(3) + "\t" + c["clearly loses"].toFixed(3)); }
  lines.push("", "MDD at n=" + n0 + ", the descriptive comparisons", head, ...mddTable(n0));
  const k = Math.ceil(B1F.overload * m - 1e-9);
  lines.push("", "non-fit: " + m + " tasks; a rewrite over-loads at " + k + " or more loads of " + m + " counted sessions", "true load rate\tP(over the bound)");
  for (const p of [0.1, 0.2, 0.25, 0.3, 1 / 3, 0.4, 0.5]) lines.push((100 * p).toFixed(1) + "%\t" + binomTail(m, p, k).toFixed(3));
  return lines;
}

// ---- Keyless scripted sessions in the real Claude Code image against the stub model (fake-model.ts), as B1d's are: what each
// arm's first request carries at this pin (the hook line or none, the listing and prove-it's entry in it), that a Skill load
// still reads as a load under gstack's start-step change, that prove-it's preamble runs against gstack's real scripts, and
// each arm's switches as gstack-config reads them in the container.
export type B1fCase = { name: string; arm: B1fArm; mode: "stop" | "load" | "setup"; prompt: keyof typeof B1D_PROMPTS };
export const B1F_CASES: B1fCase[] = [
  { name: "hook-load", arm: "hook", mode: "load", prompt: "fix" },
  { name: "hook-setup", arm: "hook", mode: "setup", prompt: "fix" },
  { name: "own-load", arm: "own", mode: "load", prompt: "fix" },
  { name: "long-load", arm: "long", mode: "load", prompt: "fix" },
  { name: "required-stop", arm: "required", mode: "stop", prompt: "fix" },
  { name: "none-stop", arm: "none", mode: "stop", prompt: "plain" },
];
/** The listing's size, entries, bare-name entries, and prove-it's entry against the arm's description. */
export function listingFacts(listing: string | null, a: B1fArm) {
  const entries = (listing ?? "").split("\n").filter((l) => l.startsWith("- ")), desc = isGstackArm(a) ? descriptionOf(readFileSync(skillFile(a), "utf8")) ?? "" : "";
  const mine = entries.find((l) => l === "- " + SKILL || l.startsWith("- " + SKILL + ":"));
  return { chars: (listing ?? "").length, entries: entries.length, bare: entries.filter((l) => !l.includes(": ")).length, prove_it: mine === undefined ? "absent" : mine === "- " + SKILL + ": " + desc ? "full" : mine === "- " + SKILL ? "bare name" : "cut" };
}
export type B1fCaptured = { sdk: string; listing: string | null; user: string[]; hook_context: string[]; loaded: string | null; hook_log: string | null; probe: Record<string, string> | null };
export function loadB1fCaptured(dir: string): B1fCaptured {
  const j = JSON.parse(existsSync(join(dir, "capture.json")) ? readFileSync(join(dir, "capture.json"), "utf8") : "{}");
  return { sdk: existsSync(join(dir, "sdk-messages.jsonl")) ? readFileSync(join(dir, "sdk-messages.jsonl"), "utf8") : "", listing: j.listing ?? null, user: j.user ?? [], hook_context: j.hook_context ?? [], loaded: j.loaded ?? null, hook_log: j.hook_log ?? null, probe: j.probe ?? null };
}
const SKILL_BODY = () => readFileSync(join(REPO, ARM_SOURCES, PROVE_IT.source), "utf8").replace(/^---\n[\s\S]*?\n---\n\n?/, "");
export function b1fCaseProblems(c: B1fCase, cap: B1fCaptured): string[] {
  const p: string[] = [], want = (what: string, ok: boolean) => { if (!ok) p.push(c.name + ": " + what); };
  const recs = parseLog(cap.sdk);
  if (!recs.length || cap.listing === null || !cap.user.length) return [c.name + ": no session"];
  const first = cap.user.join("\n"), names = [...cap.listing.matchAll(/^- ([\w:-]+)(?::|$)/gm)].map((m) => m[1]!), l = loadsOf(recs), res = scriptResults(recs), pr = cap.probe ?? {};
  want("the prompt is typed", !first.includes("<command-name>/"));
  if (c.arm === "none") {
    want("the listing names " + names.join(", "), JSON.stringify([...names].sort()) === JSON.stringify([...CLAUDE_LISTED].sort()));
    want("a hook line reached the session", !cap.hook_context.length && !first.includes(ROUTE_MARK));
    want("loadsOf reads a load in a none session", !l.loaded);
    return p;
  }
  for (const s of [SKILL, "verify", "qa", "review", ...CLAUDE_LISTED]) want("the listing does not name " + s, names.includes(s));
  for (const s of GSTACK_STABLE.userOnly) want("the listing names the user-only " + s, !names.includes(s));
  want("the listing names " + names.length + " skills, not gstack's " + GSTACK_STABLE.listed + " beside Claude Code's own", names.length === GSTACK_STABLE.listed + CLAUDE_LISTED.length);
  const facts = listingFacts(cap.listing, c.arm);
  want("the listing cuts " + facts.bare + " entries to a bare name", facts.bare === 0);
  want("prove-it's entry is " + facts.prove_it + ", not the arm's description in full", facts.prove_it === "full");
  const sw = switchesOf(c.arm as GstackArm);
  want("gstack-config reads skill_routing " + pr.skill_routing + " and telemetry " + pr.telemetry + " in the container", pr.skill_routing === sw.skill_routing && pr.telemetry === sw.telemetry);
  const named = namedOf(cap.hook_log), line = cap.hook_context.join("\n");
  if (c.arm === "hook") {
    want("the first request does not carry one hook line naming /" + SKILL + " alone", cap.hook_context.length === 1 && line.startsWith(ROUTE_MARK) && line.includes("this request fits /" + SKILL + ". Run /" + SKILL + " with the Skill tool before you start"));
    want("the hook's log does not say routed to " + SKILL + " alone", JSON.stringify(named) === JSON.stringify([SKILL]));
  } else {
    want("a hook line reached a session with routing off", !cap.hook_context.length && !first.includes(ROUTE_MARK));
    want("the hook logged an event with routing off", named === null && !/\bevent=/.test(cap.hook_log ?? ""));
  }
  if (c.mode === "load") {
    want("the Skill load is not the base line and the prove-it body", cap.loaded === BASE(SKILL) + SKILL_BODY());
    want("loadsOf does not read a Skill load at call 1", l.loaded && l.via === "Skill" && l.at_call === 1);
  } else if (c.mode === "setup") {
    const start = res.get(0);
    want("gstack-skill-start failed or printed no SKILL_START_PROTO: 1", !!start && !start.error && /^SKILL_START_PROTO: 1$/m.test(start.text));
    want("gstack-learnings-log or gstack-skill-end failed", [1, 2].every((i) => res.has(i) && !res.get(i)!.error));
  } else want("loadsOf reads a load in a session that made none", !l.loaded);
  return p;
}
const docker = (args: string[], input?: string, timeout = 600_000) => spawnSync("docker", args, { input, encoding: "utf8", timeout, maxBuffer: 64 << 20 });
const RESET = ["set -e", "mkdir -p /testbed", "cd /testbed", "printf 'def add(a, b):\\n    return a - b\\n' > calc.py", "git init -q && git add -A && git -c user.name=b1 -c user.email=b1@example.invalid commit -qm snapshot"].join("\n");
const PROBE = ['echo "capy=$(find / -xdev -maxdepth 3 -type d -name .capy 2>/dev/null | wc -l)"', 'g=/root/.claude/skills/gstack/bin/gstack-config; if [ -x "$g" ]; then echo "skill_routing=$("$g" get skill_routing)"; echo "telemetry=$("$g" get telemetry)"; fi'].join("\n");
export async function runB1fSessions(out: string) {
  mkdirSync(out, { recursive: true });
  const py = sdkPython(), reqLog = join(out, "requests.jsonl"), bodyLog = join(out, "bodies.jsonl");
  rmSync(reqLog, { force: true }); rmSync(bodyLog, { force: true });
  const fake = Bun.spawn(["bun", join(import.meta.dir, "fake-model.ts"), "0", reqLog, bodyLog], { stdout: "pipe", stderr: "inherit" });
  const head = new TextDecoder().decode((await fake.stdout.getReader().read()).value ?? new Uint8Array());
  const port = /127\.0\.0\.1:(\d+)/.exec(head)?.[1], problems: string[] = [], ran: { c: B1fCase; extra: Record<string, unknown> }[] = [];
  try {
    if (!port) pinErr("the stub model did not start: " + head.slice(0, 200));
    for (const c of B1F_CASES) {
      const name = "b1f-sessions-" + c.name + "-" + process.pid, dir = join(out, c.name), trial = join(dir, "trial");
      rmSync(dir, { recursive: true, force: true }); mkdirSync(trial, { recursive: true });
      const up = docker(["run", "-d", "--name", name, "--network", "host", "--cap-drop", "NET_RAW", "--cap-drop", "NET_ADMIN", SESSION_IMAGE, "sleep", "infinity"]);
      if (up.status !== 0) { problems.push(c.name + ": container did not start: " + up.stderr.trim().slice(-200)); continue; }
      try {
        if (docker(["exec", "-i", name, "sh", "-s"], RESET).status !== 0) { problems.push(c.name + ": reset failed"); continue; }
        const tar = c.arm === "none" ? join(out, "none.tar") : join(ARMS_DIR(), c.arm + ".tar");
        if (c.arm === "none" && !existsSync(tar)) { const scratch = mkdtempSync(join(tmpdir(), "b1f-none-")); try { cpSync(b1Build(scratch).none, tar); } finally { rmSync(scratch, { recursive: true, force: true }); } }
        const spec = { case: c.name, arm: c.arm, tar, strip: true, told: "", container: name, base_url: "http://127.0.0.1:" + port, instruction: "[b1-session " + c.name + "] [b1-script " + c.mode + "] " + B1D_PROMPTS[c.prompt], out: trial };
        const r = spawnSync(py, [join(REPO, "lanes/harness-mechanics/sessions-driver.py"), JSON.stringify(spec)], { encoding: "utf8", timeout: 900_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PYTHONPATH: join(REPO, "quick/laneb/runner/agent") } });
        writeFileSync(join(dir, "driver.log"), (r.stdout ?? "") + (r.stderr ?? ""));
        if (r.status !== 0) { problems.push(c.name + ": driver exited " + r.status + " (" + join(dir, "driver.log") + ")"); continue; }
        const probe = Object.fromEntries((docker(["exec", "-i", name, "sh", "-s"], PROBE).stdout ?? "").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
        if (probe.capy !== "0") problems.push(c.name + ": the container holds a .capy folder");
        const log = isGstackArm(c.arm) ? docker(["exec", name, "sh", "-c", "cat /root/.gstack/hooks/skill-route.log 2>/dev/null | sed 's/session=[^ ]*/session=<id>/; s/also_source=[^ ]*/also_source=<path>/'"]).stdout ?? "" : null;
        ran.push({ c, extra: { hook_log: log, probe } });
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
      const cap = { listing, listing_facts: listingFacts(listing, c.arm), user: mine[0] ? texts(mine[0].messages.find((m: any) => m.role === "user")) : [], hook_context: hook, loaded: loadedText, ...extra, requests: mine.length };
      writeFileSync(join(dest, "capture.json"), JSON.stringify(cap, null, 2) + "\n");
      problems.push(...b1fCaseProblems(c, loadB1fCaptured(dest)));
    }
  } finally { fake.kill(); }
  writeFileSync(join(out, "sessions.json"), JSON.stringify({ cases: B1F_CASES.map((c) => c.name), problems }, null, 2) + "\n");
  return problems;
}

// ---- CLI.
const USAGE = "usage: b1f arms manifest [--out <dir>] | arms check [--out <dir>] | routes --export <swe-rebench export> [--out <tsv>] [--check] | sessions run --out <dir> [--cut <dir>] | plan | power | reuse [--head <commit>] | approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who> | done --ledger <jsonl> --item <item> | guard <work> | prepare <work> --item <item> | host-up|attach|recover|host-down <work> | launch|relaunch|rerun <work> --part <part> | table <config.json> <out.jsonl> | report <table.jsonl> --item <b1f-pilot|b1f-main> [--out <dir>]";
const LAUNCHER = ["prepare", "host-up", "launch", "attach", "relaunch", "rerun", "recover", "host-down"], GUARDED = ["host-up", "launch", "relaunch"];
function guardWork(work: string, relaunching?: string) {
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  if (!isB1fItem(plan.item)) return usage("b1f launch guard: " + work + " plans " + plan.item + ", not a B1f item");
  for (const head of [plan.git_head, "HEAD"]) {
    const r = reuseCheck(head);
    for (const l of r.lines) if (!l.startsWith("SAME ")) console.log(l);
    if (!r.same) throw new Error("E_B1_LAUNCH " + plan.item + ": at " + head + " the harness differs from B1's run, whose none arm B1f runs again (" + r.lines.filter((l) => l.startsWith("DIFFERENT ")).join("; ") + "); take it to the Captain before launching");
  }
  const dirty = harnessDirty();
  if (dirty.length) throw new Error("E_B1_LAUNCH " + plan.item + ": the checkout holds uncommitted changes to harness paths (" + dirty.join("; ") + "); take it to the Captain before launching");
  const dir = process.env.B1F_LEDGERS ?? "", crewPath = process.env.B1F_CREW ?? "", own = process.env.LEDGER ?? "";
  if (!dir || !crewPath || !existsSync(crewPath)) usage("b1f launch guard: set B1F_LEDGERS to the folder of item ledgers (<item>.jsonl) and B1F_CREW to the crew file");
  const ledgers: Partial<Record<B1fItem, Row[]>> = {};
  for (const i of B1F_ITEMS) if (existsSync(join(dir, i + ".jsonl"))) ledgers[i] = readRows(join(dir, i + ".jsonl"));
  const mirror = join(work, "host/ledger.jsonl");
  ledgers[plan.item as B1fItem] = own && existsSync(own) ? readRows(own) : existsSync(mirror) ? readRows(mirror) : ledgers[plan.item as B1fItem] ?? [];
  const crew = JSON.parse(readFileSync(crewPath, "utf8"));
  if (typeof crew?.as_of !== "string" || typeof crew.usd !== "number" || !(crew.usd >= 0)) usage("b1f launch guard: the crew file needs as_of and usd, a number of at least 0");
  const prepared = (plan.parts as PartPlan[]).flatMap((p) => [p.name + "-a2", p.name + "-relaunch"]).map((n) => join(work, n, "l1-part.json")).filter((x) => existsSync(x)).map((x) => JSON.parse(readFileSync(x, "utf8")) as PartPlan);
  const parts = [...plan.parts, ...prepared], finished = parts.map((p) => p.name).filter((n) => n !== relaunching && existsSync(join(work, n + ".result.json")));
  const g = b1fGuard(plan.item, ledgers, { [plan.item]: { parts, finished } }, crew.usd, relaunching);
  for (const l of g.lines) console.log(l);
  if (!g.ok) throw new Error("E_B1_LAUNCH " + plan.item + ": " + g.why.join("; ") + "; take it to the Captain before launching");
}
const tarShas = () => Object.fromEntries(GSTACK_ARMS.map((a) => [a, JSON.parse(readFileSync(join(manifestDir(), a + ".json"), "utf8")).tar.sha256])) as Record<GstackArm, string>;
export async function b1fMain(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv, opt = (k: string) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === "arms") {
    const sub = rest[0], out = resolve(opt("out") ?? ARMS_DIR());
    if (sub === "manifest") {
      mkdirSync(manifestDir(), { recursive: true });
      cpSync(join(REPO, "quick/laneb/arms/manifests/b1/none.json"), join(manifestDir(), "none.json"));
      for (const a of GSTACK_ARMS) {
        const m = armManifestOf(out, a);
        writeFileSync(join(manifestDir(), a + ".json"), JSON.stringify({ ...m.summary, inventory_sha256: sha256(m.list) }, null, 2) + "\n");
        writeFileSync(join(out, a + ".files.tsv"), m.list);
        console.log(a + " manifest: files=" + m.summary.tree.files + " tar_sha256=" + m.summary.tar.sha256);
      }
      return 0;
    }
    if (sub === "check") { const r = armsCheck(out); for (const l of r.lines) console.log(l); console.log("B1F ARMS " + (r.pass ? "PASS" : "FAIL")); return r.pass ? 0 : 1; }
    return usage(USAGE);
  }
  if (cmd === "routes") {
    const ex = opt("export") ?? usage(USAGE), rows = await b1fRoutes(ex, join(ARMS_DIR(), "trees", "hook")), text = routeTsv(rows);
    if (opt("out")) writeFileSync(opt("out")!, text);
    for (const k of ["primary", "extension", "nonfit", "pilot"]) console.log(k + " " + JSON.stringify(routeCounts(rows.filter((r) => r[0] === k))));
    const off = await b1fRoutes(ex, join(ARMS_DIR(), "trees", "own")), lines = off.filter((r) => r[8] !== "-").length;
    console.log("own (routing off): the hook printed a line on " + lines + " of " + off.length + " prompts");
    const probs = [...(lines ? ["the hook printed a line with routing off"] : []), ...(rest.includes("--check") && text !== readFileSync(routeFile(), "utf8") ? ["the route table differs from " + routeFile()] : [])];
    for (const p of probs) console.error("E_B1_PIN " + p);
    return probs.length ? 1 : 0;
  }
  if (cmd === "sessions" && rest[0] === "run") {
    const out = opt("out") ?? usage(USAGE), problems = await runB1fSessions(resolve(out)), cut = opt("cut");
    if (cut) for (const c of B1F_CASES) { rmSync(join(cut, c.name), { recursive: true, force: true }); if (existsSync(join(out, c.name, "capture"))) cpSync(join(out, c.name, "capture"), join(cut, c.name), { recursive: true }); }
    for (const c of B1F_CASES) { const f = join(out, c.name, "capture", "capture.json"); if (existsSync(f)) { const j = JSON.parse(readFileSync(f, "utf8")); console.log(c.name + " listing " + JSON.stringify(j.listing_facts) + " probe " + JSON.stringify(j.probe)); } }
    for (const p of problems) console.error("E_B1_PIN " + p);
    console.log("B1F SESSIONS " + (problems.length ? "FAIL " + problems.length : "PASS") + " " + B1F_CASES.length + " cases");
    return problems.length ? 1 : 0;
  }
  if (cmd === "plan") {
    for (const i of B1F_ITEMS) {
      const c = b1fCap(i);
      console.log(i + ": " + c.parts.map((p) => p.name + " (" + partProjection(p).sessions + ")").join(", ") + "; " + c.sessions + " sessions; expected $" + c.expected.toFixed(2) + ", open-session reserve $" + c.parallel.toFixed(2) + ", VM $" + c.vm.toFixed(2) + ", formula cap $" + c.cap + ", recorded cap $" + B1F_CAPS_USD[i]);
    }
    console.log("all-in stop $" + B1F.stopUsd);
    return 0;
  }
  if (cmd === "power") { for (const l of powerLines()) console.log(l); return 0; }
  if (cmd === "reuse") { const r = reuseCheck(opt("head") ?? git(REPO, ["rev-parse", "HEAD"]).stdout.trim()); for (const l of r.lines) console.log(l); return r.same ? 0 : 1; }
  if (cmd === "approve" || cmd === "done") {
    const ledger = opt("ledger"), it = opt("item") ?? "";
    if (!ledger || !isB1fItem(it)) return usage(USAGE);
    if (cmd === "done") { b1fDone(resolve(ledger), it); console.log(it + " marked done on " + ledger); return 0; }
    const u = opt("usd") ?? "";
    if (!/^\d+(\.\d+)?$/.test(u)) return usage(USAGE);
    b1fApprove(resolve(ledger), it, Number(u), opt("approved-by") ?? "");
    console.log("approved " + it + " at $" + u + " on " + ledger);
    return 0;
  }
  if (cmd === "guard") { guardWork(resolve(rest[0] ?? usage(USAGE))); return 0; }
  if (cmd && LAUNCHER.includes(cmd)) {
    if (GUARDED.includes(cmd)) { if (!rest[0] || (cmd === "relaunch" && !opt("part"))) return usage(USAGE); guardWork(resolve(rest[0]), cmd === "relaunch" ? opt("part") : undefined); }
    l1Main(argv, B1F_PROFILE);
    return 0;
  }
  if (cmd === "table") {
    const [cfg, outPath] = rest;
    if (!cfg || !outPath) return usage(USAGE);
    const rows = buildB1fTable(JSON.parse(readFileSync(cfg, "utf8")));
    writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    console.log("wrote " + rows.length + " rows to " + outPath);
    return 0;
  }
  if (cmd === "report") {
    const it = opt("item") ?? "";
    if (!rest[0] || rest[0].startsWith("--") || !isB1fItem(it)) return usage(USAGE);
    const rows = readFileSync(rest[0], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as B1fRow);
    const cells = b1fPlan(it).parts.flatMap((p) => [...plannedCells(p).keys()].map((k) => ({ task: k.split("\t")[0]!, arm: k.split("\t")[1]! })));
    const bad = checkB1fRows(rows, cells);
    if (bad.length) { for (const b of bad) console.error("E_USAGE b1f report: " + b); return 2; }
    const pilotRows = rows.filter((r) => (B1F_PILOT as readonly string[]).includes(r.task));
    const lines = it === "b1f-pilot" ? ["== B1f pilot: " + B1F_PILOT.join(", ") + " on the four gstack arms, and " + SUPPLY.cells + " supply tasks", ...GSTACK_ARMS.map((a) => statLine(b1fStats(pilotRows, a, "primary", B1F_PILOT.length))), ...pilotCheck(rows, committedRoutes(), tarShas()).lines] : mainReport(rows, taskList("primary"), taskList("nonfit"), taskList("extension")).lines;
    for (const l of lines) console.log(l);
    const out = opt("out");
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, it + "-report.txt"), lines.join("\n") + "\n"); writeFileSync(join(out, it + "-reasons.tsv"), reasonsTsv(rows)); }
    return 0;
  }
  return usage(USAGE);
}
