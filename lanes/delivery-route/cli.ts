// Copyright (c) 2026 Garry Tan. MIT License.
// bun lanes/delivery-route/cli.ts <command>: the delivery route eval (lanes/delivery-route/README.md). prepare, host-up,
// launch, attach, relaunch, rerun, recover and host-down run on L1's host and part machinery under this lane's profile
// (plans.ts B1_PROFILE), with L1's exit codes; host-up, launch and relaunch pass the launch guard first.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { l1Main } from "../../quick/laneb/l1/l1.ts";
import { readRows, type Row } from "../../quick/laneb/runner/ledger.ts";
import { parseLog } from "../../quick/laneb/l1/probes.ts";
import { checkRows, report } from "./analyze.ts";
import { main as armsMain } from "./arms.ts";
import { detect } from "./detect.ts";
import { approve, capOf, launchGuard, markDone, type Crew } from "./money.ts";
import { B1, CAPS_USD, CLOSING, drawnTasks, isItem, ITEM_NAMES, loadBundle, type Item } from "./pins.ts";
import { B1_PROFILE, itemPlan } from "./plans.ts";
import { main as sessionsMain } from "./sessions.ts";
import { buildB1Table, type B1Row } from "./table.ts";

const USAGE = "E_USAGE usage: b1 arms sources|build|check ... | sessions run --out <dir> [--gstack <checkout>] [--cut <dir>] | plan | approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who> | done --ledger <jsonl> --item <item> | guard <work> | prepare <work> --item <item> | host-up|attach|recover|host-down <work> | launch|relaunch|rerun <work> --part <part> | table <config.json> <out.jsonl> | report <table.jsonl> [--out <dir>] | detect <trial dir>";
const LAUNCHER = ["prepare", "host-up", "launch", "attach", "relaunch", "rerun", "recover", "host-down"];
const GUARDED = ["host-up", "launch", "relaunch"];

// The launch guard's inputs: the work dir's plan and finished parts (a prepared attempt 2 counts as a part), the item's own
// ledger (LEDGER, or the host mirror l1.ts keeps while the ledger is on the host), every other item's ledger as
// B1_LEDGERS/<item>.jsonl, and B1_CREW, the crew file written from this thread's counter.
function guard(work: string) {
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  const dir = process.env.B1_LEDGERS ?? "", crewPath = process.env.B1_CREW ?? "", own = process.env.LEDGER ?? "";
  if (!dir || !crewPath || !existsSync(crewPath)) throw new Error("E_USAGE b1 launch guard: set B1_LEDGERS to the folder of item ledgers (<item>.jsonl) and B1_CREW to the crew file");
  if (!isItem(plan.item)) throw new Error("E_USAGE b1 launch guard: " + work + " plans " + plan.item + ", not a B1 item");
  const ledgers: Partial<Record<Item, Row[]>> = {};
  for (const i of ITEM_NAMES) if (existsSync(join(dir, i + ".jsonl"))) ledgers[i] = readRows(join(dir, i + ".jsonl"));
  const mirror = join(work, "host/ledger.jsonl");
  ledgers[plan.item as Item] = own && existsSync(own) ? readRows(own) : existsSync(mirror) ? readRows(mirror) : ledgers[plan.item as Item] ?? [];
  const parts = [...plan.parts, ...plan.parts.map((p: any) => join(work, p.name + "-a2", "l1-part.json")).filter((f: string) => existsSync(f)).map((f: string) => JSON.parse(readFileSync(f, "utf8")))];
  const finished = parts.map((p: any) => p.name).filter((n: string) => existsSync(join(work, n + ".result.json")));
  const g = launchGuard(plan.item, ledgers, { [plan.item]: { parts, finished } }, JSON.parse(readFileSync(crewPath, "utf8")) as Crew);
  for (const l of g.lines) console.log(l);
  if (!g.ok) throw new Error("E_B1_LAUNCH " + plan.item + ": " + g.why.join("; ") + "; take it to the Captain before launching");
}

/** Each item's plan from the frozen draw, with its cap formula beside its recorded cap; the caps must match. */
function planLines() {
  const run = drawnTasks(loadBundle()).run, lines: string[] = [], bad: string[] = [];
  let sessions = 0;
  for (const i of ITEM_NAMES) {
    const p = itemPlan(i, run), c = capOf(i, p.parts);
    if (i !== "b1-smoke") sessions += p.sessions;
    if (c.cap !== CAPS_USD[i]) bad.push(i + "'s formula gives $" + c.cap + ", not its recorded $" + CAPS_USD[i]);
    lines.push(i + ": " + p.parts.map((x) => x.name + " (" + x.rects.reduce((a, r) => a + r.tasks.length * r.arms.length * r.attempts, 0) + ")").join(", ") + "; " + p.sessions + " sessions; expected $" + c.expected.toFixed(2) + ", parallel $" + c.parallel.toFixed(2) + ", VM $" + c.vm.toFixed(2) + ", cap $" + c.cap + " (recorded $" + CAPS_USD[i] + ")");
  }
  lines.push("counted sessions " + sessions + " (" + B1.tasks + " tasks x 4 arms x 3 models), caps sum $" + ITEM_NAMES.reduce((a, i) => a + CAPS_USD[i], 0) + ", all-in stop $" + B1.stopUsd);
  if (sessions !== B1.tasks * 4 * 3) bad.push("the plan counts " + sessions + " sessions, not " + B1.tasks * 12);
  return { lines, bad };
}

const readTable = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as B1Row);

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const opt = (k: string) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (cmd === "arms") return armsMain(rest);
    if (cmd === "sessions") return await sessionsMain(rest);
    if (cmd === "plan") {
      const p = planLines();
      for (const l of p.lines) console.log(l);
      if (p.bad.length) throw new Error("E_B1_INPUT " + p.bad.join("; "));
      return 0;
    }
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
    if (cmd === "guard") { if (!rest[0]) throw new Error(USAGE); guard(resolve(rest[0])); return 0; }
    if (cmd && LAUNCHER.includes(cmd)) {
      if (GUARDED.includes(cmd)) { if (!rest[0]) throw new Error(USAGE); guard(resolve(rest[0])); }
      l1Main(argv, B1_PROFILE);
      if (cmd === "prepare") {
        const work = resolve(rest[0]!), plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
        const sessions = plan.parts.reduce((a: number, x: any) => a + x.rects.reduce((b: number, r: any) => b + r.tasks.length * r.arms.length * r.attempts, 0), 0);
        writeFileSync(join(work, "b1.json"), JSON.stringify({ item: plan.item, sessions, closing_line: CLOSING, bundle: plan.inputs }, null, 2) + "\n");
      }
      return 0;
    }
    if (cmd === "table") {
      const [cfg, out] = rest;
      if (!cfg || !out) throw new Error(USAGE);
      const rows = buildB1Table(JSON.parse(readFileSync(cfg, "utf8")));
      writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
      console.log("wrote " + rows.length + " rows to " + out);
      return 0;
    }
    if (cmd === "report") {
      if (!rest[0] || rest[0].startsWith("--")) throw new Error(USAGE);
      const rows = readTable(rest[0]), bad = checkRows(rows, drawnTasks(loadBundle()).run);
      if (bad.length) { for (const b of bad) console.error("E_USAGE b1 report: " + b); return 2; }
      const r = report(rows);
      for (const l of r.lines) console.log(l);
      const out = opt("out");
      if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, "report.json"), JSON.stringify(r.models, null, 2) + "\n"); writeFileSync(join(out, "report.md"), r.lines.join("\n") + "\n"); }
      return 0;
    }
    if (cmd === "detect") {
      const d = rest[0];
      if (!d) throw new Error(USAGE);
      const recs = parseLog(readFileSync(join(d, "evaluator", "sdk-messages.jsonl"), "utf8"));
      const patch = join(d, "artifacts", "logs", "artifacts", "model.patch");
      console.log(JSON.stringify(detect(recs, existsSync(patch) ? readFileSync(patch, "utf8") : "")));
      return 0;
    }
    throw new Error(USAGE);
  } catch (e) {
    const m = (e as Error).message;
    console.error(m.startsWith("E_") ? m : "E_INTERNAL " + m);
    return m.startsWith("E_") ? 2 : 1;
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
