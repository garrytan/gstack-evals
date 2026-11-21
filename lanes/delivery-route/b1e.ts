// Copyright (c) 2026 Garry Tan. MIT License.
// B1e, B1d on gstack's matcher fix (lanes/delivery-route/README.md, "B1e"; prereg B1E_BUNDLE): B1d's gstack-main arm built
// from gstack main at the commit that fixed its bug-report matcher. On Opus 5.5, unattended, with B1's plain prompt, does
// gstack's own prompt-routing hook get B1's prove-it skill loaded in at least 39 of B1's 60 run tasks (in-sample: gstack
// tests its matcher on those prompts), and in at least 39 of a fresh draw of 60 tasks no B1 lane has run? The readers, the
// load detector and the session rows are B1d's (b1d.ts); this file holds the plan, profile and caps, the route table on the
// fresh draw, the reports and the decision.
//
//   bun lanes/delivery-route/cli.ts b1e <command> (USAGE below)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hostTtlHours, itemCheck, L1, l1Main, plannedCells, prefixOf, seeded, type ItemDef, type PartPlan, type Profile, type Rect } from "../../quick/laneb/l1/l1.ts";
import { fromMicros, Ledger, readRows, toMicros } from "../../quick/laneb/runner/ledger.ts";
import { b1References, paired, reuseCheck } from "./b1b.ts";
import { armProblems, b1cRows, b1dStats, buildB1dTable, calibrationTasks, checkB1dRows, clearOdds, harnessDirty, mainManifestOf, pairedPower, pairLine, partProjection, pilotCheck, readRouteTsv, reasonsTsv, reuseB1c, rigPromptOf, routeCounts, routesByTask, routeTable, routeTsv, smokeOf, splitLines, statLine, strataLines, type B1dRow, type Stat, type TaskRoute } from "./b1d.ts";
import { B1D_ARM } from "./b1d-pins.ts";
import { B1D_RUN, B1E, B1E_ARMS, B1E_BUNDLE, B1E_CAPS_USD, B1E_ITEMS, B1E_SMOKE, B1E_SPECS, COVERAGE, FRESH, GSTACK_ARM, isB1eItem, type B1eArm, type B1eItem } from "./b1e-pins.ts";
import { infraRerun, needsRerun } from "./money.ts";
import { B1, drawnTasks, frontMatterDigests, loadBundle, MODELS, REPO, sha256, TASK_SETUP } from "./pins.ts";
import { pulledInputs } from "./table.ts";

const pinErr = (m: string): never => { throw new Error("E_B1_PIN " + m); };
const usage = (m: string): never => { throw new Error("E_USAGE " + m); };
export const ARMS_DIR = () => process.env.B1E_ARMS_DIR ?? join(process.env.HOME ?? "", ".capy/work/b1e/arms");
export const manifestDir = () => join(REPO, "quick/laneb", B1E.armManifests);
const bundleFile = (f: string) => {
  const text = readFileSync(join(REPO, B1E_BUNDLE, f), "utf8"), want = frontMatterDigests(readFileSync(join(REPO, B1E_BUNDLE, "README.md"), "utf8")).get(f);
  if (sha256(text) !== want) pinErr(B1E_BUNDLE + "/" + f + " hashes to " + sha256(text) + ", not its front matter's " + want);
  return text;
};
const listSha = (xs: string[]) => sha256(xs.join("\n") + "\n");

/** The fresh draw, from the committed list, refused unless it is the draw whose digests are pinned. */
export function freshTasks(text = bundleFile("fresh-list.txt")): string[] {
  const list = text.split("\n").filter(Boolean);
  if (list.length !== FRESH.tasks || listSha(list) !== FRESH.drawSha256 || listSha([...list].sort()) !== FRESH.sortedSha256) pinErr("fresh-list.txt is not the committed draw (draw-order sha256 " + FRESH.drawSha256 + ")");
  return list;
}
export const routeRows = () => readRouteTsv(bundleFile("route-table.tsv"));
const kindRoutes = (kind: string) => routesByTask(routeRows().filter((r) => r[0] === kind));
const coverageOf = (rows: string[][]) => { const n = routeCounts(rows); return { only: n.only, first: n["first of two"], second: n["second of two"], none: n["not named"] }; };

// ---- Plan, profile and caps.
const item = (capUsd: number): ItemDef => ({ capUsd, taskSet: "swerebench-r3a4", cells: MODELS.opus.cells, allowanceUsd: MODELS.opus.allowanceUsd, model: MODELS.opus.id });
/** b1e-smoke: the pilot, both smoke tasks on both arms, one part. b1e-in: B1's 60 run tasks in draw order, gstack-main, 20 a
 *  part. b1e-fresh: the fresh 60 in draw order, both arms, 20 tasks a part with both arms of a task in its part. Each part's
 *  cells run in the order L1's seeded() gives with B1's seed. */
export function b1ePlan(name: string, run: string[] = drawnTasks(loadBundle()).run, fresh: string[] = freshTasks()): { parts: PartPlan[]; sessions: number } {
  const part = (p: string, rects: Rect[]): PartPlan => ({ name: p, prefix: prefixOf(name, p), rects: seeded(rects, B1.seed) });
  const split = (tasks: string[], arms: string[]) => Array.from({ length: Math.ceil(tasks.length / B1E.partTasks) }, (_, i) => part(name + "-" + (i + 1), [{ tasks: tasks.slice(i * B1E.partTasks, (i + 1) * B1E.partTasks), arms, attempts: 1 }]));
  let parts: PartPlan[];
  if (name === "b1e-smoke") parts = [part("smoke-opus", [{ tasks: [...B1E_SMOKE], arms: [...B1E_ARMS], attempts: 1 }])];
  else if (name === "b1e-in") parts = split(run, [B1D_ARM]);
  else if (name === "b1e-fresh") parts = split(fresh, [...B1E_ARMS]);
  else return usage("unknown item " + name + "; one of " + B1E_ITEMS.join(", "));
  return { parts, sessions: parts.flatMap((p) => [...plannedCells(p).values()]).reduce((a, b) => a + b, 0) };
}
/** The crew's cap rule: ceil10(1.35 x expected model spend + the open-session reserve + VM share). */
export function b1eCap(name: B1eItem) {
  const parts = b1ePlan(name).parts, proj = parts.map(partProjection), expected = fromMicros(proj.reduce((x, p) => x + p.model, 0));
  const parallel = Math.min(B1.concurrent, Math.max(0, ...proj.map((p) => p.sessions))) * MODELS.opus.allowanceUsd;
  const vm = fromMicros(proj.reduce((x, p) => x + p.vm, 0)) + hostTtlHours(parts.length) * L1.host.usdPerHour;
  return { parts, sessions: proj.reduce((x, p) => x + p.sessions, 0), expected, parallel, vm, cap: Math.ceil((1.35 * expected + parallel + vm) / 10) * 10 };
}
export const B1E_PROFILE: Profile = {
  items: Object.fromEntries(B1E_ITEMS.map((i) => [i, item(B1E_CAPS_USD[i])])),
  armSpecs: { ...B1E_SPECS },
  tars: [...B1E_ARMS],
  armManifests: B1E.armManifests,
  hostRoot: B1E.hostRoot,
  ledgerPort: B1E.ledgerPort,
  seed: B1.seed,
  concurrent: B1.concurrent,
  taskSetup: TASK_SETUP,
  attempt2: { skip: () => null, owed: (runs) => { const rows = runs.flatMap((r) => { const c = pulledInputs(r.dir, r.part); return c.jobs.length ? buildB1dTable(c) : []; }); return { owed: rows.filter(needsRerun).map((r) => ({ task: r.task, arm: r.arm, reason: r.reason })), rects: infraRerun(rows).rects }; } },
  parts: (name, _frozen, inputs) => {
    for (const [f, d] of loadBundle().digests) inputs[f] = d;
    for (const [f, d] of frontMatterDigests(readFileSync(join(REPO, B1E_BUNDLE, "README.md"), "utf8"))) inputs["b1e/" + f] = d;
    return b1ePlan(name).parts;
  },
};
export function b1eApprove(path: string, name: string, capUsd: number, by: string) {
  if (!isB1eItem(name)) return usage("b1e approve: unknown item " + name + "; one of " + B1E_ITEMS.join(", "));
  if (!by.trim()) usage("b1e approve: --approved-by names who recorded the cap");
  if (toMicros(capUsd) !== toMicros(B1E_CAPS_USD[name])) usage("refused: " + name + "'s recorded cap is $" + B1E_CAPS_USD[name] + ", not $" + capUsd);
  if (readRows(path).length) usage("refused: " + path + " already holds rows; an item's ledger starts with its approval row");
  new Ledger(path, name).approve(capUsd, { approved_by: by, source: "B1e matcher fix prereg: the cap recorded for " + name });
  itemCheck(readRows(path), name, B1E_CAPS_USD[name]);
}
export const B1E_FILES = ["lanes/delivery-route/b1e-pins.ts", "lanes/delivery-route/b1e.ts", "quick/laneb/arms/manifests/b1e"];
/** Before host-up, launch or relaunch: B1's none arm and B1c's rows are reused as in-sample controls, so the harness must be
 *  theirs at the run's commit and at the checkout's head, and the checkout must hold no uncommitted harness change. */
function launchCheck(work: string) {
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  if (!isB1eItem(plan.item)) return usage("b1e launch: " + work + " plans " + plan.item + ", not a B1e item");
  for (const [what, check] of [["B1's none arm", reuseCheck], ["B1c's rows", reuseB1c]] as const) for (const head of [plan.git_head, "HEAD"]) {
    const r = check(head);
    if (!r.same) throw new Error("E_B1_LAUNCH " + plan.item + ": at " + head + " the harness differs from the run " + what + " came from (" + r.lines.filter((l) => l.startsWith("DIFFERENT ")).join("; ") + "); take it to the Captain before launching");
  }
  const dirty = [...harnessDirty(), ...harnessDirty(REPO, B1E_FILES)];
  if (dirty.length) throw new Error("E_B1_LAUNCH " + plan.item + ": the checkout holds uncommitted changes to harness paths (" + dirty.join("; ") + "); take it to the Captain before launching");
}

/** Rows whose part is not one of the item's planned parts (an attempt 2 part is its part plus -a2), so another run's table is refused. */
export function partProblems(rows: B1dRow[], item: B1eItem): string[] {
  const names = new Set(b1ePlan(item).parts.map((p) => p.name));
  return rows.filter((r) => !names.has(String(r.part).replace(/-a2$/, ""))).map((r) => r.trial + " came from part " + r.part + ", not a part of " + item);
}
// ---- Readings and the decision.
const loaded = (r: any) => !!r.load?.loaded, followed = (r: any) => !!r.detect?.followed;
export type BarReading = { key: "incomplete" | "clears" | "short"; text: string };
/** Garry's bar on one set: INCOMPLETE first, then the point count of loads against 39, whatever the number graded. */
export function barReading(s: Stat, set: string): BarReading {
  if (s.incomplete) return { key: "incomplete", text: set + " INCOMPLETE: " + s.gaps + " of " + s.planned + " ungraded, " + s.cap_stops + " cap stops" };
  return { key: s.loaded >= B1E.bar ? "clears" : "short", text: set + ": the hook loaded prove-it in " + s.loaded + " of " + s.graded + (s.loaded >= B1E.bar ? ", at or above " : ", under ") + "the bar of " + B1E.bar };
}
/** The decision the two readings give together (README section 1). */
export function decision(inR: BarReading, fr: BarReading): { key: string; text: string } {
  if (inR.key === "incomplete") return { key: "none", text: "no decision: the in-sample run is INCOMPLETE; the block stays until the Captain decides" };
  if (inR.key === "short") return { key: "stays", text: "the block stays, and the matcher finding goes to gstack's maintainers with both numbers" };
  if (fr.key === "clears") return { key: "cut", text: "the CLAUDE.md routing block is cut: the hook clears the bar in-sample and on the fresh draw" };
  if (fr.key === "short") return { key: "owner", text: "not cut on its own: the hook clears the bar in-sample but not on the fresh draw; the cut goes to gstack's owner with both numbers" };
  return { key: "owner", text: "not cut on its own: the hook clears the bar in-sample but the fresh draw is INCOMPLETE; it goes to gstack's owner with both readings" };
}
/** The R48 verdict for the CLAUDE.md routing block, from the decision (README section 1). */
export const R48: Record<string, string> = {
  none: "no verdict (INCOMPLETE)",
  stays: "KEEP for the CLAUDE.md routing block; FIX-METHOD for the hook's matcher",
  cut: "CUT-CANDIDATE for the CLAUDE.md routing block: the default hook reaches the block's count without it, in-sample and on fresh tasks",
  owner: "CUT-CANDIDATE for the CLAUDE.md routing block in-sample only; the fresh draw does not confirm it, so gstack's owner decides",
};
/** B1d's published in-sample gstack-main rows, checked against its results bundle's front matter. */
export function b1dInRows(): B1dRow[] {
  const dir = join(REPO, B1D_RUN.results), want = frontMatterDigests(readFileSync(join(dir, "README.md"), "utf8")).get("in-sessions.jsonl"), text = readFileSync(join(dir, "in-sessions.jsonl"), "utf8");
  if (sha256(text) !== want) pinErr(B1D_RUN.results + "/in-sessions.jsonl hashes to " + sha256(text) + ", not its front matter's " + want);
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as B1dRow);
}
const head = (set: string, n: number) => "== " + MODELS.opus.id + ", B1e " + set + ": gstack main " + GSTACK_ARM.sha.slice(0, 12) + " (" + GSTACK_ARM.version + "), hooks on by default, " + n + " tasks";
export function inReport(rows: B1dRow[], routes: Map<string, TaskRoute> = kindRoutes("run"), tasks: string[] = drawnTasks(loadBundle()).run, controls = b1cRows(), b1d: B1dRow[] = b1dInRows(), refs = b1References()) {
  const s = b1dStats(rows, B1D_ARM, tasks.length), reading = barReading(s, "in-sample"), main = rows.filter((r) => r.arm === B1D_ARM);
  const lines = [head("in-sample (B1's run tasks)", tasks.length), statLine(s), "  reading: " + reading.text, ...splitLines(rows),
    pairLine("loaded, gstack-main - B1c project-md (published rows)", paired(main, controls.filter((r) => r.arm === "project-md"), loaded, loaded)),
    pairLine("loaded, gstack-main - B1d gstack-main at 5afef04 (published rows)", paired(main, b1d.filter((r) => r.arm === B1D_ARM), loaded, loaded)),
    pairLine("followed, gstack-main - B1 none (published rows)", paired(main, refs.filter((r) => r.arm === "none"), followed, followed)), ...strataLines(rows, [B1D_ARM], routes, tasks)];
  return { lines, stats: s, reading };
}
export function freshReport(rows: B1dRow[], inR: BarReading, routes: Map<string, TaskRoute> = kindRoutes("fresh"), tasks: string[] = freshTasks()) {
  const st = Object.fromEntries(B1E_ARMS.map((a) => [a, b1dStats(rows, a, tasks.length)])) as Record<string, Stat>, of = (a: string) => rows.filter((r) => r.arm === a);
  const reading = barReading(st[B1D_ARM]!, "fresh draw"), d = decision(inR, reading);
  const cov = coverageOf(routeRows().filter((r) => r[0] === "fresh"));
  const lines = [head("fresh draw", tasks.length), "  keyless coverage (the hook at the pin): prove-it alone " + cov.only + ", first of two " + cov.first + ", second of two " + cov.second + ", not named " + cov.none, ...B1E_ARMS.map((a) => statLine(st[a]!)), "  reading: " + reading.text, ...splitLines(rows),
    pairLine("loaded, gstack-main - none", paired(of(B1D_ARM), of("none"), loaded, loaded)), pairLine("followed, gstack-main - none", paired(of(B1D_ARM), of("none"), followed, followed)), ...strataLines(rows, [...B1E_ARMS], routes, tasks),
    "  in-sample reading: " + inR.text, "  decision: " + d.text, "  R48 for the CLAUDE.md routing block: " + R48[d.key]];
  return { lines, stats: st, reading, decision: d };
}

// ---- Power: the odds of clearing the bar on each set, and the paired MDD against the in-sample controls.
const pts = (x: number) => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
export function powerLines(): string[] {
  const rows = routeRows(), run = drawnTasks(loadBundle()).run, inR = kindRoutes("run"), c = { in: coverageOf(rows.filter((r) => r[0] === "run")), fresh: coverageOf(rows.filter((r) => r[0] === "fresh")) };
  const odds = (k: { only: number; first: number; second: number; none: number }, f: number, u = 0) => clearOdds({ first: k.only + k.first, second: k.second, none: k.none }, f, u);
  const lines = ["keyless coverage at " + GSTACK_ARM.sha.slice(0, 12) + ": in-sample " + JSON.stringify(c.in) + ", fresh " + JSON.stringify(c.fresh), "", "odds of clearing the bar (P[loads >= " + B1E.bar + "]), named at f, unnamed at 0 (and at 0.05)", "follow rate f\tin-sample\tfresh\tin-sample, unnamed 0.05\tfresh, unnamed 0.05"];
  for (const f of [1, 0.95, 29 / 33, 0.85, 0.8, 0.765, 0.75, 0.7]) lines.push((100 * f).toFixed(1) + "%\t" + odds(c.in, f).toFixed(3) + "\t" + odds(c.fresh, f).toFixed(3) + "\t" + odds(c.in, f, 0.05).toFixed(3) + "\t" + odds(c.fresh, f, 0.05).toFixed(3));
  for (const [name, refs] of [["B1c project-md", b1cRows().filter((r) => r.arm === "project-md")], ["B1d gstack-main", b1dInRows().filter((r) => r.arm === B1D_ARM)]] as const) {
    const ctl = new Map(refs.filter((r) => r.outcome === "graded").map((r) => [r.task, loaded(r)]));
    if (ctl.size !== run.length || run.some((t) => !ctl.has(t))) pinErr(name + "'s graded rows are not B1's " + run.length + " run tasks");
    const k = [...ctl.values()].filter(Boolean).length, base = Math.round((1000 * k) / ctl.size);
    lines.push("", "paired against " + name + "'s published rows (" + k + " of " + ctl.size + " loaded), coverage model", "follow rate f\ttrue difference\tP(hook shown above)\tP(hook shown below)");
    for (const f of [1, 0.95, 29 / 33, 0.8, 0.7]) { const r = pairedPower(ctl, (t) => (inR.get(t)?.position === "not named" ? 0 : f)); lines.push((100 * f).toFixed(1) + "%\t" + pts(r.mean) + "\t" + r.above.toFixed(3) + "\t" + r.below.toFixed(3)); }
    let up = NaN, dn = NaN;
    for (let i = base; i <= 1000; i++) if (pairedPower(ctl, () => i / 1000).above >= 0.8) { up = i / 1000; break; }
    for (let i = base; i >= 0; i--) if (pairedPower(ctl, () => i / 1000).below >= 0.8) { dn = i / 1000; break; }
    lines.push("uniform model: 80% power to show the hook above at " + (100 * up).toFixed(1) + "% (" + pts(up - k / ctl.size) + " points), below at " + (100 * dn).toFixed(1) + "% (" + pts(dn - k / ctl.size) + " points)");
  }
  return lines;
}

const USAGE = "usage: b1e arms manifest|check [--out <dir>] | routes --export <swe-rebench export> [--tree <dir>] [--out <tsv>] [--check] | plan | power | reuse [--head <commit>] | approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who> | prepare <work> --item <item> | host-up|attach|recover|host-down <work> | launch|relaunch|rerun <work> --part <part> | table <config.json> <out.jsonl> | report <table.jsonl> --item <b1e-smoke|b1e-in|b1e-fresh> [--in <in-sample table.jsonl>] [--out <dir>]";
const LAUNCHER = ["prepare", "host-up", "launch", "attach", "relaunch", "rerun", "recover", "host-down"], CHECKED = ["host-up", "launch", "relaunch"];
export async function b1eMain(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv, opt = (k: string) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  const read = (f: string) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as B1dRow);
  if (cmd === "arms") {
    const out = resolve(opt("out") ?? ARMS_DIR()), tree = join(out, "trees", B1D_ARM);
    if (rest[0] === "manifest") {
      mkdirSync(manifestDir(), { recursive: true });
      copyFileSync(join(REPO, "quick/laneb/arms/manifests/b1/none.json"), join(manifestDir(), "none.json"));
      const m = mainManifestOf(out, GSTACK_ARM, B1E_SPECS[B1D_ARM]);
      writeFileSync(join(manifestDir(), B1D_ARM + ".json"), JSON.stringify({ ...m.summary, inventory_sha256: sha256(m.list) }, null, 2) + "\n");
      writeFileSync(join(out, B1D_ARM + ".files.tsv"), m.list);
      console.log(B1D_ARM + " manifest: files=" + m.summary.tree.files + " tar_sha256=" + m.summary.tar.sha256);
      return 0;
    }
    if (rest[0] === "check") {
      const p = armProblems(tree, GSTACK_ARM), want = JSON.parse(readFileSync(join(manifestDir(), B1D_ARM + ".json"), "utf8")), gz = join(out, B1D_ARM + ".tar.gz");
      if (!existsSync(gz) || sha256(readFileSync(gz)) !== want.tar_gz_sha256) p.push(gz + " is not the manifest's tar_gz_sha256 " + want.tar_gz_sha256);
      if (!readFileSync(join(manifestDir(), "none.json")).equals(readFileSync(join(REPO, "quick/laneb/arms/manifests/b1/none.json")))) p.push("none.json is not B1's manifest byte for byte");
      for (const x of p) console.log("PROBLEM " + x);
      console.log("B1E ARMS " + (p.length ? "FAIL" : "PASS") + ": gstack " + GSTACK_ARM.sha.slice(0, 12) + ", tar.gz " + want.tar_gz_sha256);
      return p.length ? 1 : 0;
    }
    return usage(USAGE);
  }
  if (cmd === "routes") {
    const ex = opt("export") ?? usage(USAGE), tree = resolve(opt("tree") ?? join(ARMS_DIR(), "trees", B1D_ARM));
    const P = (kind: string, list: string[]) => list.map((task) => ({ kind, task, prompt: rigPromptOf(readFileSync(join(ex, task, "instruction.md"), "utf8")) }));
    const rows = await routeTable(tree, [...P("run", drawnTasks(loadBundle()).run), ...P("calibration", calibrationTasks()), ...P("fresh", freshTasks(opt("fresh") ? readFileSync(opt("fresh")!, "utf8") : undefined))]), text = routeTsv(rows), probs: string[] = [];
    if (opt("out")) writeFileSync(opt("out")!, text);
    for (const k of ["run", "calibration", "fresh"]) console.log(k + " " + JSON.stringify(routeCounts(rows.filter((r) => r[0] === k))));
    if (smokeOf(rows).join() !== B1E_SMOKE.join()) probs.push("the smoke rule picks " + smokeOf(rows).join(", ") + ", not " + B1E_SMOKE.join(", "));
    for (const k of ["run", "fresh"] as const) if (JSON.stringify(coverageOf(rows.filter((r) => r[0] === k))) !== JSON.stringify(COVERAGE[k])) probs.push(k + " coverage is not the committed " + JSON.stringify(COVERAGE[k]));
    if (rest.includes("--check") && text !== bundleFile("route-table.tsv")) probs.push("the route table differs from the committed one");
    for (const p of probs) console.error("E_B1_PIN " + p);
    return probs.length ? 1 : 0;
  }
  if (cmd === "plan") {
    for (const i of B1E_ITEMS) { const c = b1eCap(i); console.log(i + ": " + c.parts.map((p) => p.name + " (" + partProjection(p).sessions + ")").join(", ") + "; " + c.sessions + " sessions; expected $" + c.expected.toFixed(2) + ", open-session reserve $" + c.parallel.toFixed(2) + ", VM $" + c.vm.toFixed(2) + ", formula cap $" + c.cap + ", recorded cap $" + B1E_CAPS_USD[i]); }
    return 0;
  }
  if (cmd === "power") { for (const l of powerLines()) console.log(l); return 0; }
  if (cmd === "reuse") {
    const h = opt("head") ?? "HEAD", a = reuseCheck(h), b = reuseB1c(h);
    for (const l of [...a.lines, ...b.lines]) console.log(l);
    return a.same && b.same ? 0 : 1;
  }
  if (cmd === "approve") {
    const ledger = opt("ledger"), it = opt("item") ?? "", u = opt("usd") ?? "";
    if (!ledger || !/^\d+(\.\d+)?$/.test(u)) return usage(USAGE);
    b1eApprove(resolve(ledger), it, Number(u), opt("approved-by") ?? "");
    console.log("approved " + it + " at $" + u + " on " + ledger);
    return 0;
  }
  if (cmd && LAUNCHER.includes(cmd)) {
    if (CHECKED.includes(cmd)) launchCheck(resolve(rest[0] ?? usage(USAGE)));
    l1Main(argv, B1E_PROFILE);
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
    const it = opt("item") ?? "";
    if (!rest[0] || rest[0].startsWith("--") || !isB1eItem(it)) return usage(USAGE);
    const rows = read(rest[0]), tasks = it === "b1e-smoke" ? [...B1E_SMOKE] : it === "b1e-in" ? drawnTasks(loadBundle()).run : freshTasks(), arms: B1eArm[] = it === "b1e-in" ? [B1D_ARM] : [...B1E_ARMS];
    const bad = [...checkB1dRows(rows, tasks, arms), ...partProblems(rows, it)];
    if (bad.length) { for (const b of bad) console.error("E_USAGE b1e report: " + b); return 2; }
    let lines: string[];
    if (it === "b1e-smoke") lines = ["== B1e pilot: the two smoke tasks, both arms", ...B1E_ARMS.map((a) => statLine(b1dStats(rows, a, tasks.length))), ...splitLines(rows), ...pilotCheck(rows, routeRows(), tasks, B1E_ARMS).lines];
    else if (it === "b1e-in") lines = inReport(rows).lines;
    else {
      const inRows = read(opt("in") ?? usage("b1e report --item b1e-fresh needs --in <in-sample table.jsonl>")), inBad = [...checkB1dRows(inRows, drawnTasks(loadBundle()).run, [B1D_ARM]), ...partProblems(inRows, "b1e-in")];
      if (inBad.length) { for (const b of inBad) console.error("E_USAGE b1e report --in: " + b); return 2; }
      lines = freshReport(rows, barReading(b1dStats(inRows, B1D_ARM, B1.tasks), "in-sample")).lines;
    }
    for (const l of lines) console.log(l);
    const out = opt("out");
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, it + "-report.txt"), lines.join("\n") + "\n"); writeFileSync(join(out, it + "-reasons.tsv"), reasonsTsv(rows)); }
    return 0;
  }
  return usage(USAGE);
}
