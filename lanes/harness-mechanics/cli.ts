// Copyright (c) 2026 Garry Tan. MIT License.
// bun lanes/harness-mechanics/cli.ts <command>: the harness mechanics eval (lanes/harness-mechanics/README.md).
// prepare, host-up, launch, attach, relaunch, recover and host-down run on L1's host and part machinery under this lane's
// profile (plans.ts HM_PROFILE), with L1's exit codes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { l1Main } from "../../quick/laneb/l1/l1.ts";
import { admission, report, type HmRowIn, type ReportConfig } from "./analyze.ts";
import { dryrun } from "./dryrun.ts";
import { harborEnvRecord } from "./arms.ts";
import { CLOSING, REPO } from "./pins.ts";
import { HM_PROFILE } from "./plans.ts";
import { patternsCommand } from "./score.ts";
import { approve, isItem, launchGuard, markDone, type HmCrew, type Item } from "./money.ts";
import { readRows } from "../../quick/laneb/runner/ledger.ts";
import { screenCommand, screenVm } from "./screen.ts";
import { buildHmTable } from "./table.ts";

const USAGE = "E_USAGE usage: hm dryrun --out <dir> | prepare <work> --item <item> | host-up|attach|recover|host-down <work> | launch|relaunch <work> --part <part> | approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who> | done --ledger <jsonl> --item <item> | guard <work> | screen --out <dir> | screen-vm start|finish <work> | table <config.json> <out.jsonl> | patterns <job dir>... | admission <stage1 table.jsonl> [--out <dir>] | report <table.jsonl> <config.json> <out dir>";
const readTable = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as HmRowIn);
// HM_SIMS cuts power.py's Monte Carlo for keyless tests; the report runs power.py's own 2,000 without it.
const sims = () => (process.env.HM_SIMS ? Number(process.env.HM_SIMS) : undefined);

// The launch guard's inputs: the work dir's plan and finished parts, the item's own ledger (LEDGER, or the host mirror
// l1.ts keeps while the ledger is on the host), every other item's ledger as HM_LEDGERS/<item>.jsonl, and HM_CREW.
function guard(work: string) {
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  const dir = process.env.HM_LEDGERS ?? "", crewPath = process.env.HM_CREW ?? "", own = process.env.LEDGER ?? "";
  if (!dir || !crewPath || !existsSync(crewPath)) throw new Error("E_USAGE hm launch guard: set HM_LEDGERS to the folder of item ledgers (<item>.jsonl) and HM_CREW to the crew file");
  const ledgers: Partial<Record<Item, any[]>> = {};
  for (const f of Object.keys(HM_PROFILE.items).concat(["stage2-replay", "vms"])) if (isItem(f) && existsSync(join(dir, f + ".jsonl"))) ledgers[f] = readRows(join(dir, f + ".jsonl"));
  const mirror = join(work, "host/ledger.jsonl");
  ledgers[plan.item as Item] = own && existsSync(own) ? readRows(own) : existsSync(mirror) ? readRows(mirror) : ledgers[plan.item as Item] ?? [];
  const finished = plan.parts.map((p: any) => p.name).filter((n: string) => existsSync(join(work, n + ".result.json")));
  const g = launchGuard(plan.item, ledgers, JSON.parse(readFileSync(crewPath, "utf8")) as HmCrew, plan.parts, finished);
  for (const l of g.lines) console.log(l);
  if (!g.ok) throw new Error("E_HM_LAUNCH " + plan.item + ": " + g.why.join("; ") + "; take it to the Captain before launching");
}
const GUARDED = ["host-up", "launch", "relaunch"];
const LAUNCHER = ["prepare", "host-up", "launch", "attach", "relaunch", "recover", "host-down"];

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const opt = (k: string) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (cmd === "dryrun") {
      const r = dryrun(resolve(opt("out") ?? (() => { throw new Error(USAGE); })()));
      for (const l of r.lines) console.log(l);
      return r.pass ? 0 : 1;
    }
    if (cmd === "approve" || cmd === "done") {
      const ledger = opt("ledger"), item = opt("item") ?? "";
      if (!ledger) throw new Error(USAGE);
      if (cmd === "done") { if (!isItem(item)) throw new Error(USAGE); markDone(resolve(ledger), item); console.log(item + " marked done on " + ledger); return 0; }
      const usd = opt("usd") ?? "";
      if (!/^\d+(\.\d+)?$/.test(usd)) throw new Error(USAGE);
      approve(resolve(ledger), item, Number(usd), opt("approved-by") ?? "");
      console.log("approved " + item + " at $" + usd + " on " + ledger);
      return 0;
    }
    if (cmd === "guard") { if (!rest[0]) throw new Error(USAGE); guard(resolve(rest[0])); return 0; }
    if (cmd === "screen") { const out = opt("out"); if (!out) throw new Error(USAGE); for (const l of screenCommand(resolve(out), () => {}).lines) console.log(l); return 0; }
    if (cmd === "screen-vm") { if (!rest[0] || !rest[1]) throw new Error(USAGE); return screenVm(rest[0], resolve(rest[1])); }
    if (cmd && LAUNCHER.includes(cmd)) {
      if (GUARDED.includes(cmd)) { if (!rest[0]) throw new Error(USAGE); guard(resolve(rest[0])); }
      l1Main(argv, HM_PROFILE);
      if (cmd === "prepare") {
        const work = resolve(rest[0]!), plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
        const sessions = plan.parts.reduce((a: number, x: any) => a + x.rects.reduce((b: number, r: any) => b + r.tasks.length * r.arms.length * r.attempts, 0), 0);
        const tasks = (a: string) => new Set(plan.parts.flatMap((x: any) => x.rects.filter((r: any) => r.arms.includes(a)).flatMap((r: any) => r.tasks)));
        const plain = tasks("plain-2");
        writeFileSync(join(work, "hm.json"), JSON.stringify({ item: plan.item, sessions, picker_calls: [...tasks("none")].filter((x) => plain.has(x)).length, closing_line: CLOSING, screened_sha256: plan.inputs.screened, harbor_env: harborEnvRecord(readFileSync(join(REPO, "quick/laneb/runner/vm-run.sh"), "utf8")) }, null, 2) + "\n");
      }
      return 0;
    }
    if (cmd === "table") {
      const [cfg, out] = rest;
      if (!cfg || !out) throw new Error(USAGE);
      const rows = buildHmTable(JSON.parse(readFileSync(cfg, "utf8")));
      writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
      console.log("wrote " + rows.length + " rows to " + out);
      return 0;
    }
    if (cmd === "patterns") {
      for (const l of patternsCommand(rest)) console.log(l);
      return 0;
    }
    if (cmd === "admission") {
      if (!rest[0] || rest[0].startsWith("--")) throw new Error(USAGE);
      const a = admission(readTable(rest[0]), { sims: sims() });
      for (const l of a.lines) console.log(l);
      const out = opt("out");
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, "admission.json"), JSON.stringify(a, null, 2) + "\n");
        writeFileSync(join(out, "admission.md"), a.lines.join("\n") + "\n");
      }
      return 0;
    }
    if (cmd === "report") {
      const [table, cfgPath, out] = rest;
      if (!table || !cfgPath || !out || [table, cfgPath, out].some((x) => x.startsWith("--"))) throw new Error(USAGE);
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as ReportConfig;
      if (!cfg.stage1 && cfg.stage1_table) cfg.stage1 = admission(readTable(resolve(dirname(cfgPath), cfg.stage1_table)), { sims: sims() });
      for (const l of report(readTable(table), cfg, { out: resolve(out), sims: sims() }).lines) console.log(l);
      return 0;
    }
    throw new Error(USAGE);
  } catch (e) {
    const m = (e as Error).message;
    console.error(m.startsWith("E_") ? m : "E_INTERNAL " + m);
    return m.startsWith("E_HM_LAUNCH") ? 3 : m.startsWith("E_") ? 2 : 1;
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
