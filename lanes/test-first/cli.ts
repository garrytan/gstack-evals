// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals b2 <command>: the B2 test-first eval's run lane (lanes/test-first/README.md). prepare, host-up, launch, attach,
// relaunch, rerun, recover and host-down run on L1's host and part machinery under B2's profile (plans.ts B2_PROFILE), with
// L1's exit codes; host-up, launch and relaunch pass the launch guard first, which needs this thread's counter
// (--counter-usd, --counter-as-of) and reads the item ledgers (B2_LEDGERS), the image check's record (B2_IMAGES) and the
// look's record (B2_LOOK).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { l1Main } from "../../quick/laneb/l1/l1.ts";
import { readRows, type Row } from "../../quick/laneb/runner/ledger.ts";
import { checkRows, look, pilotReport, report, type Stage } from "./analyze.ts";
import { ARMS_DIR, armProblems, buildCodex, buildPlain, check, MANIFESTS, writeManifests, type B2Manifest } from "./arms.ts";
import { runSessions } from "./sessions.ts";
import { buildImages, imagesRecord, readImagesRecord, writeImagesRecord } from "./images.ts";
import { approve, dryRun, guardParts, itemTotals, launchGuard, markDone, planLines, type Order } from "./money.ts";
import { B2, drawnTasks, isItem, ITEM_NAMES, LABELS, MODELS, PILOT_TASKS, sha256, type Item } from "./pins.ts";
import { B2_PROFILE, pilotRows, withCarry } from "./plans.ts";
import { buildB2Table, type B2Row } from "./table.ts";

const USAGE = "E_USAGE usage: b2 arms build|manifests <dir> [--register] | arms check [<dir>] | sessions run --out <dir> [--arms <dir>] [--codex <vendor dir>] [--record] | plan | dry-run | approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who> | done --ledger <jsonl> --item <item> | guard <work> [--part <part>] --counter-usd <dollars> --counter-as-of <time> | prepare <work> --item <item> | host-up|attach|recover|host-down <work> | launch|relaunch|rerun <work> --part <part> (host-up, launch and relaunch also --counter-usd and --counter-as-of) | images --out <dir> [--shard k/n] | images --record <file> <dir>... | table <config.json> <out.jsonl> | look <table.jsonl> --out <record> | report <table.jsonl> [--stage end|look] [--item b2-pilot] [--out <md>]";
const LAUNCHER = ["prepare", "host-up", "launch", "attach", "relaunch", "rerun", "recover", "host-down"];
const GUARDED = ["host-up", "launch", "relaunch"];
const COUNTER_FLAGS = ["--counter-usd", "--counter-as-of"];

/** argv without the counter flags and their values, which L1 does not take. */
export function stripCounter(argv: string[]): { argv: string[]; usd?: string; as_of?: string } {
  const out: string[] = [], got: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) { if (COUNTER_FLAGS.includes(argv[i]!)) { got[argv[i]!] = argv[i + 1] ?? ""; i++; } else out.push(argv[i]!); }
  return { argv: out, usd: got["--counter-usd"], as_of: got["--counter-as-of"] };
}

/** The run's order as the guard reads it: b2-pilot's done mark in its ledger, and the image and look record files. */
export function readOrder(ledgers: Partial<Record<Item, Row[]>>, env: Record<string, string | undefined> = process.env): Order {
  const lookPath = env.B2_LOOK;
  const lk = lookPath && existsSync(lookPath) ? (JSON.parse(readFileSync(lookPath, "utf8")) as { decision: "continue" | "stop"; z: number | null }) : null;
  return { pilotDone: itemTotals(ledgers["b2-pilot"] ?? [], "b2-pilot").done, images: readImagesRecord(env.B2_IMAGES), look: lk ? { decision: lk.decision, z: lk.z ?? 0 } : null };
}

// The launch guard's inputs: the work dir's plan and parts, the item's own ledger (LEDGER, or the host mirror l1.ts keeps),
// every other item's ledger as B2_LEDGERS/<item>.jsonl (b2-pilot's with every later pilot run's b2-pilot.<run>.jsonl carried in,
// pre-run change 3), the order records, and this thread's counter.
function guard(work: string, counter: { usd?: string; as_of?: string }, part: string | null, relaunching?: string) {
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  const dir = process.env.B2_LEDGERS ?? "", own = process.env.LEDGER ?? "";
  if (!dir) throw new Error("E_USAGE b2 launch guard: set B2_LEDGERS to the folder of item ledgers (<item>.jsonl)");
  if (!isItem(plan.item)) throw new Error("E_USAGE b2 launch guard: " + work + " plans " + plan.item + ", not a B2 item");
  const ledgers: Partial<Record<Item, Row[]>> = {};
  for (const i of ITEM_NAMES) if (existsSync(join(dir, i + ".jsonl"))) ledgers[i] = i === "b2-pilot" ? pilotRows(dir) : readRows(join(dir, i + ".jsonl"));
  const mirror = join(work, "host/ledger.jsonl");
  ledgers[plan.item as Item] = own && existsSync(own) ? readRows(own) : existsSync(mirror) ? readRows(mirror) : ledgers[plan.item as Item] ?? [];
  // Pre-run change 2: a re-pilot's guard adds the first pilot run's settled spend (B2_PILOT_CARRY, that run's ledger).
  const carry = process.env.B2_PILOT_CARRY;
  if (carry) {
    if (plan.item !== "b2-pilot") throw new Error("E_USAGE b2 launch guard: B2_PILOT_CARRY is for a b2-pilot re-pilot, not " + plan.item);
    ledgers["b2-pilot"] = withCarry(ledgers["b2-pilot"] ?? [], readRows(carry));
  }
  const usd = counter.usd !== undefined && /^\d+(\.\d+)?$/.test(counter.usd) ? Number(counter.usd) : NaN;
  const g = launchGuard(plan.item, ledgers, { [plan.item]: guardParts(work, plan.parts, relaunching) }, { usd, as_of: counter.as_of ?? "" }, readOrder(ledgers), part);
  for (const l of g.lines) console.log(l);
  if (!g.ok) throw new Error("E_B2_LAUNCH " + plan.item + ": " + g.why.join("; ") + "; take it to the Captain before launching");
}

const readTable = (f: string) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as B2Row);

/** What each committed manifest shows against its arm's checks, for the pilot report. */
export function armTree(label: string): string[] {
  const f = join(MANIFESTS, label + ".json"), inv = join(MANIFESTS, label + ".files.tsv");
  if (!existsSync(f) || !existsSync(inv)) return ["no committed manifest for " + label];
  return armProblems(JSON.parse(readFileSync(f, "utf8")) as B2Manifest, readFileSync(inv, "utf8"));
}

/** The look's inputs: the table's rows on the half's tasks, refused unless every model has a row for every arm on every one of
 *  them (parts 1 to 4 of all three items settled). */
export function lookRows(rows: B2Row[], half: string[] = drawnTasks().half): B2Row[] {
  const want = new Set(half), mine = rows.filter((r) => want.has(r.task));
  const missing: string[] = [];
  for (const m of Object.values(MODELS)) for (const label of LABELS.filter((l) => (m.host === "codex") === l.startsWith("cx-"))) for (const t of half) if (!mine.some((r) => r.label === label && r.task === t && (r.model === m.id || (r.model === null && r.host === m.host)))) missing.push(m.id + " " + label + " " + t);
  if (missing.length) throw new Error("E_B2_LOOK the look needs parts 1 to " + B2.lookParts + " of all three items settled; " + missing.length + " model, arm and task rows are missing (first " + missing[0] + ")");
  return mine;
}

export async function main(argv: string[]): Promise<number> {
  const stripped = stripCounter(argv);
  const [cmd, ...rest] = stripped.argv;
  const opt = (k: string) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (cmd === "arms") {
      const dir = rest[1] ?? "";
      if (rest[0] === "build" && dir) { buildPlain(dir); buildCodex(dir); console.log("built none, line and the four Codex arms into " + dir + "; run build-claude.sh " + dir + " for the Claude gstack arms"); return 0; }
      if (rest[0] === "manifests" && dir) {
        for (const m of writeManifests(dir, { register: rest.includes("--register") })) console.log(m.arm + ": tar " + m.tar.sha256 + " (" + m.tar.bytes + " bytes), " + m.tree.files + " files, inventory " + m.inventory_sha256);
        return 0;
      }
      if (rest[0] === "check") {
        const c = check(rest[1]);
        for (const l of c.lines) (l.startsWith("PROBLEM") ? console.error : console.log)(l.startsWith("PROBLEM") ? "E_B2_ARMS " + l.slice(8) : l);
        if (c.pass) console.log("arms: ok, every tar matches its committed manifest");
        return c.pass ? 0 : 2;
      }
      throw new Error(USAGE);
    }
    if (cmd === "sessions" && rest[0] === "run") {
      const out = opt("out");
      if (!out) throw new Error(USAGE);
      const problems = await runSessions(resolve(out), resolve(opt("arms") ?? ARMS_DIR()), resolve(opt("codex") ?? join(process.env.HOME ?? "", ".capy/work/b2/codex/c")), rest.includes("--record"));
      for (const p of problems) console.error("E_B2_SESSIONS " + p);
      console.log("B2 SESSIONS " + (problems.length ? "FAIL " + problems.length : "PASS") + (rest.includes("--record") && !problems.length ? ", start digests recorded in the manifests" : ""));
      return problems.length ? 1 : 0;
    }
    if (cmd === "plan") {
      const d = drawnTasks(), p = planLines(d.run, d.pilot);
      for (const l of p.lines) console.log(l);
      if (p.bad.length) throw new Error("E_B2_MONEY " + p.bad.join("; "));
      return 0;
    }
    if (cmd === "dry-run") { for (const l of dryRun()) console.log(l); return 0; }
    if (cmd === "approve" || cmd === "done") {
      const ledger = opt("ledger"), item = opt("item") ?? "";
      if (!ledger || !isItem(item)) throw new Error(USAGE);
      if (cmd === "done") { markDone(resolve(ledger), item); console.log(item + " marked done on " + ledger); return 0; }
      const usd = opt("usd") ?? "";
      if (!/^\d+(\.\d+)?$/.test(usd)) throw new Error(USAGE);
      approve(resolve(ledger), item, Number(usd), opt("approved-by") ?? "");
      console.log("approved " + item + " at $" + usd + " on " + ledger);
      return 0;
    }
    if (cmd === "guard") { if (!rest[0]) throw new Error(USAGE); guard(resolve(rest[0]), stripped, opt("part") ?? null); return 0; }
    if (cmd && LAUNCHER.includes(cmd)) {
      if (GUARDED.includes(cmd)) {
        if (!rest[0] || (cmd !== "host-up" && !opt("part"))) throw new Error(USAGE);
        guard(resolve(rest[0]), stripped, opt("part") ?? null, cmd === "relaunch" ? opt("part") : undefined);
      }
      l1Main(stripped.argv, B2_PROFILE);
      return 0;
    }
    if (cmd === "images") {
      const record = opt("record");
      if (record) {
        const dirs = rest.filter((x, i) => x !== "--record" && rest[i - 1] !== "--record");
        if (!dirs.length) throw new Error(USAGE);
        const r = imagesRecord(dirs.map((d) => resolve(d)));
        writeImagesRecord(resolve(record), r);
        console.log("B2_IMAGES " + (r.ok ? "OK" : "NOT OK") + " " + r.passed + "/" + r.tasks + ": " + r.why + "; record " + record);
        return r.ok ? 0 : 1;
      }
      const out = opt("out");
      if (!out) throw new Error(USAGE);
      const shard = opt("shard"), run = drawnTasks().run;
      const [k, n] = shard ? shard.split("/").map(Number) : [1, 1];
      if (!(k! >= 1 && n! >= k!)) throw new Error(USAGE);
      const rows = buildImages(resolve(out), run.filter((_, i) => i % n! === k! - 1));
      return rows.every((r) => r.pass) ? 0 : 1;
    }
    if (cmd === "table") {
      const [cfg, out] = rest;
      if (!cfg || !out) throw new Error(USAGE);
      const rows = buildB2Table(JSON.parse(readFileSync(cfg, "utf8")));
      writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
      console.log("wrote " + rows.length + " rows to " + out);
      return 0;
    }
    if (cmd === "look") {
      const out = opt("out");
      if (!rest[0] || !out) throw new Error(USAGE);
      const rows = lookRows(readTable(rest[0]));
      const bad = checkRows(rows, drawnTasks().half);
      if (bad.length) throw new Error("E_B2_TABLE " + bad.slice(0, 5).join("; "));
      const l = look(rows);
      writeFileSync(out, JSON.stringify({ z: l.z, bound: l.bound, decision: l.decision, rows_sha256: sha256(rows.map((r) => JSON.stringify(r)).join("\n") + "\n") }, null, 2) + "\n");
      console.log(l.line);
      return 0;
    }
    if (cmd === "report") {
      if (!rest[0]) throw new Error(USAGE);
      const rows = readTable(rest[0]), item = opt("item");
      let lines: string[], failed = 0;
      if (item === "b2-pilot") {
        const bad = checkRows(rows, [...PILOT_TASKS]);
        if (bad.length) throw new Error("E_B2_TABLE " + bad.slice(0, 5).join("; "));
        const p = pilotReport(rows, PILOT_TASKS, armTree);
        lines = p.lines; failed = p.failed.length;
      } else {
        if (item) throw new Error(USAGE);
        const stage = (opt("stage") ?? "end") as Stage;
        if (stage !== "end" && stage !== "look") throw new Error(USAGE);
        const d = drawnTasks(), scope = stage === "end" ? d.run : d.half;
        const bad = checkRows(rows, scope);
        if (bad.length) throw new Error("E_B2_TABLE " + bad.slice(0, 5).join("; "));
        lines = report(rows, stage).lines;
      }
      const md = lines.join("\n") + "\n", out = opt("out");
      if (out) { writeFileSync(out, md); console.log("wrote " + out); } else process.stdout.write(md);
      return failed ? 1 : 0;
    }
    throw new Error(USAGE);
  } catch (e) {
    const m = (e as Error).message;
    console.error(m.startsWith("E_") ? m : "E_INTERNAL " + m);
    return m.startsWith("E_") ? 2 : 1;
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
