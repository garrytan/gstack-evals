// Copyright (c) 2026 Garry Tan. MIT License.
// bun lanes/harness-mechanics/cli.ts <command>: the harness mechanics eval (lanes/harness-mechanics/README.md).
// prepare, host-up, launch, attach, relaunch, recover and host-down run on L1's host and part machinery under this lane's
// profile (plans.ts HM_PROFILE), with L1's exit codes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { l1Main } from "../../quick/laneb/l1/l1.ts";
import { admission, report, type HmRowIn, type ReportConfig } from "./analyze.ts";
import { dryrun } from "./dryrun.ts";
import { CLOSING } from "./pins.ts";
import { HM_PROFILE } from "./plans.ts";
import { patternsCommand } from "./score.ts";
import { buildHmTable } from "./table.ts";

const USAGE = "E_USAGE usage: hm dryrun --out <dir> | prepare <work> --item <item> | host-up|attach|recover|host-down <work> | launch|relaunch <work> --part <part> | table <config.json> <out.jsonl> | patterns <job dir>... | admission <stage1 table.jsonl> [--out <dir>] | report <table.jsonl> <config.json> <out dir>";
const readTable = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as HmRowIn);
// HM_SIMS cuts power.py's Monte Carlo for keyless tests; the report runs power.py's own 2,000 without it.
const sims = () => (process.env.HM_SIMS ? Number(process.env.HM_SIMS) : undefined);
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
    if (cmd && LAUNCHER.includes(cmd)) {
      l1Main(argv, HM_PROFILE);
      if (cmd === "prepare") {
        const work = resolve(rest[0]!), plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
        const sessions = plan.parts.reduce((a: number, x: any) => a + x.rects.reduce((b: number, r: any) => b + r.tasks.length * r.arms.length * r.attempts, 0), 0);
        const tasks = (a: string) => new Set(plan.parts.flatMap((x: any) => x.rects.filter((r: any) => r.arms.includes(a)).flatMap((r: any) => r.tasks)));
        const plain = tasks("plain-2");
        writeFileSync(join(work, "hm.json"), JSON.stringify({ item: plan.item, sessions, picker_calls: [...tasks("none")].filter((x) => plain.has(x)).length, closing_line: CLOSING, screened_sha256: plan.inputs.screened }, null, 2) + "\n");
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
    return m.startsWith("E_") ? 2 : 1;
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
