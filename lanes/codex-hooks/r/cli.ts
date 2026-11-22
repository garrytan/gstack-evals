// Copyright (c) 2026 Garry Tan. MIT License.
// bun lanes/codex-hooks/cli.ts r <command>: part R of the Codex hooks eval (lanes/codex-hooks/README.md), routing on against
// off. prepare, host-up, launch, attach, relaunch, rerun, recover and host-down run on L1's host and part machinery under part
// R's profile (plans.ts R_PROFILE), with L1's exit codes; host-up, launch and relaunch pass the launch guard first.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { l1Main, type PartPlan } from "../../../quick/laneb/l1/l1.ts";
import { readRows } from "../../../quick/laneb/runner/ledger.ts";
import { readCrew } from "../allin.ts";
import { cSpends } from "../c/plan.ts";
import { drawnTasks, loadBundle } from "../../delivery-route/pins.ts";
import { buildArms, checkArms } from "./arms.ts";
import { approve, dryRun, launchGuard, markDone, planLines, readLedgers } from "./money.ts";
import { R_PROFILE } from "./plans.ts";
import { isItem, ROUTE_TABLE_SHA256, sha256, type Item } from "./pins.ts";
import { checkPilot, routeTable } from "./routes.ts";
import { reportMain } from "./report.ts";
import { buildRTable } from "./table.ts";

const USAGE = "E_USAGE usage: codex-hooks r routes --home <r-on home> [--export <dir>] [--out <file>] | arms build [--out <dir>] [--register] | arms check <tar dir> | plan | dry-run | approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who> | done --ledger <jsonl> --item <item> | guard <work> | prepare <work> --item <item> | host-up|attach|recover|host-down <work> | launch|relaunch|rerun <work> --part <part> | table <config.json> <out.jsonl> | report <table.jsonl> --item <item> [--hand <tsv>] [--out <md>]";
const LAUNCHER = ["prepare", "host-up", "launch", "attach", "relaunch", "rerun", "recover", "host-down"];
const GUARDED = ["host-up", "launch", "relaunch"];

/** The parts the launch guard projects and those finished, as B1's guard reads them (lanes/delivery-route/cli.ts guardParts). */
export function guardParts(work: string, planned: PartPlan[], relaunching?: string): { parts: PartPlan[]; finished: string[] } {
  const prepared = planned.flatMap((p) => [p.name + "-a2", p.name + "-relaunch"]).map((n) => join(work, n, "l1-part.json")).filter((f) => existsSync(f)).map((f) => JSON.parse(readFileSync(f, "utf8")) as PartPlan);
  const parts = [...planned, ...prepared];
  return { parts, finished: parts.map((p) => p.name).filter((n) => n !== relaunching && existsSync(join(work, n + ".result.json"))) };
}

// The launch guard's inputs: the work dir's plan and parts, the item's own ledger (LEDGER, or the host mirror l1.ts keeps),
// every other item's ledger as R_LEDGERS/<item>.jsonl, R_CREW, the crew file (as_of, and usd from this thread's counter), and
// CH_RECORD, the ledger record of part C's items and the judge item, for the all-in stop (../allin.ts).
function guard(work: string, relaunching?: string) {
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  const dir = process.env.R_LEDGERS ?? "", crewPath = process.env.R_CREW ?? "", record = process.env.CH_RECORD ?? "", own = process.env.LEDGER ?? "";
  if (!dir || !crewPath || !record) throw new Error("E_USAGE codex-hooks r launch guard: set R_LEDGERS to the folder of item ledgers (<item>.jsonl), R_CREW to the crew file and CH_RECORD to part C's ledger record");
  if (!isItem(plan.item)) throw new Error("E_USAGE codex-hooks r launch guard: " + work + " plans " + plan.item + ", not a part R item");
  const ledgers = readLedgers(dir);
  const mirror = join(work, "host/ledger.jsonl");
  ledgers[plan.item as Item] = own && existsSync(own) ? readRows(own) : existsSync(mirror) ? readRows(mirror) : ledgers[plan.item as Item] ?? [];
  const g = launchGuard(plan.item, ledgers, { [plan.item]: guardParts(work, plan.parts, relaunching) }, readCrew(crewPath), cSpends(record));
  for (const l of g.lines) console.log(l);
  if (!g.ok) throw new Error("E_CODEX_R_LAUNCH " + plan.item + ": " + g.why.join("; ") + "; take it to the Captain before launching");
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const opt = (k: string) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (cmd === "routes") {
      const home = opt("home");
      if (!home) throw new Error(USAGE);
      const t = routeTable(resolve(opt("export") ?? join(process.env.HOME ?? "", ".capy/work/ref/rebench-export/swe-rebench-leaderboard")), resolve(home));
      if (opt("out")) writeFileSync(opt("out")!, t.text);
      console.log("route table sha256 " + sha256(t.text) + (sha256(t.text) === ROUTE_TABLE_SHA256 ? " (change 1's)" : " (not change 1's " + ROUTE_TABLE_SHA256 + ")"));
      console.log("positions " + JSON.stringify(t.tally) + "; covered " + t.covered + "; gate " + t.gate + "; candidates " + t.candidates + "; pilot " + t.pilot.join(", "));
      checkPilot(t.pilot);
      return sha256(t.text) === ROUTE_TABLE_SHA256 ? 0 : 1;
    }
    if (cmd === "arms") {
      if (rest[0] === "build") {
        for (const m of buildArms(opt("out") ?? join(process.env.HOME ?? "", ".capy/work/codex-hooks-r/arms"), { register: rest.includes("--register") })) console.log(m.arm + ": tar " + m.tar.sha256 + " (" + m.tar.bytes + " bytes), tree " + m.tree.digest + ", start capture " + m.prompt_input.sha256 + " (" + m.prompt_input.skills + " skills" + (m.prompt_input.prove_it_line ? ", prove-it listed" : "") + ")");
        return 0;
      }
      if (rest[0] === "check" && rest[1]) {
        const bad = checkArms(resolve(rest[1]));
        for (const b of bad) console.error("E_CODEX_R_ARMS " + b);
        if (!bad.length) console.log("arms: ok, every tar matches its committed manifest");
        return bad.length ? 2 : 0;
      }
      throw new Error(USAGE);
    }
    if (cmd === "plan") {
      const p = planLines(drawnTasks(loadBundle()).run);
      for (const l of p.lines) console.log(l);
      if (p.bad.length) throw new Error("E_CODEX_R_MONEY " + p.bad.join("; "));
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
    if (cmd === "guard") { if (!rest[0]) throw new Error(USAGE); guard(resolve(rest[0])); return 0; }
    if (cmd && LAUNCHER.includes(cmd)) {
      if (GUARDED.includes(cmd)) { if (!rest[0] || (cmd === "relaunch" && !opt("part"))) throw new Error(USAGE); guard(resolve(rest[0]), cmd === "relaunch" ? opt("part") : undefined); }
      l1Main(argv, R_PROFILE);
      return 0;
    }
    if (cmd === "table") {
      const [cfg, out] = rest;
      if (!cfg || !out) throw new Error(USAGE);
      const rows = buildRTable(JSON.parse(readFileSync(cfg, "utf8")));
      writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
      console.log("wrote " + rows.length + " rows to " + out);
      return 0;
    }
    if (cmd === "report") {
      const item = opt("item");
      if (!rest[0] || !item) throw new Error(USAGE);
      const md = reportMain(rest[0], item, opt("hand"));
      const out = opt("out");
      if (out) { writeFileSync(out, md); console.log("wrote " + out); } else process.stdout.write(md);
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
