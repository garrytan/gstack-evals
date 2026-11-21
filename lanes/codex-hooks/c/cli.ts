// Copyright (c) 2026 Garry Tan. MIT License.
// bun lanes/codex-hooks/cli.ts c <command>: part C of the Codex hooks eval, the /review contract on against off and the
// effort arm (lanes/codex-hooks/README.md).
//
//   plan [--phase pilot|main]                     the steps in order, with each item's units
//   codex-arms --item <item>                      the codex-arms file review-units gets for the item
//   approve --record <dir> --item <item> --cap <usd> --by <who> --words <their words> [--admission required|warn]
//   guard --record <dir> --item <item> --root <dir>
//   done --record <dir> --item <item>
//   run --phase pilot|main --root <dir> --record <dir> --ledger <file> --source <owner/repo>=<clone>... [--upstream <url>]
//   rerun --root <dir> --item <item>              moves sessions that owe their one rerun aside; run the phase again after
//   readout --root <dir> [--item <item>]          writes <root>/<item>/readout/ and prints each summary
//   states --root <dir> --phase pilot|main --out <file>   the states file the analysis commands read (records.ts)
//   dry-run                                       one ledger lease per item on a temporary ledger, and the schedule's counts
//
//   analysis <command>                            the judging and analysis commands in analysis/cli.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../pins.ts";
import { codexArmsText, isItem, ITEM_NAMES, ITEMS, itemUnits, SUITE, suiteUnits, type ItemName } from "./pins.ts";
import { approve, dryRun, guard, markDone, plannedSessions, schedule } from "./plan.ts";
import { writeReadout, type UnitRef } from "./readout.ts";
import { phaseRecords } from "./records.ts";
import { execGstackEvals, moveForRerun, runPhase } from "./run.ts";

const USAGE = "E_USAGE usage: codex-hooks c plan|codex-arms|approve|guard|done|run|rerun|readout|states|dry-run|analysis [flags] (lanes/codex-hooks/c/cli.ts)";
const ANALYSIS = join(import.meta.dir, "analysis", "cli.ts");

function flags(argv: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]!;
    if (!f.startsWith("--") || i + 1 >= argv.length) throw new Error("E_USAGE codex-hooks c: " + f + " needs a value");
    m.set(f, [...(m.get(f) ?? []), argv[++i]!]);
  }
  return m;
}

const suiteRefs = (): UnitRef[] => {
  suiteUnits();
  return (JSON.parse(readFileSync(join(REPO, SUITE.path), "utf8")).units as UnitRef[]).map((u) => ({ id: u.id, repo: u.repo, pr: u.pr, head: u.head }));
};

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === undefined || cmd === "--help") {
      console.log(USAGE.replace("E_USAGE usage: ", ""));
      return cmd === undefined ? 2 : 0;
    }
    if (cmd === "analysis") {
      const { main: analysis } = (await import(ANALYSIS)) as { main: (argv: string[]) => Promise<number> };
      return analysis(rest);
    }
    const known = ["plan", "codex-arms", "approve", "guard", "done", "run", "rerun", "readout", "states", "dry-run"];
    if (!known.includes(cmd)) {
      console.error(USAGE);
      return 2;
    }
    const f = flags(rest);
    const one = (k: string, required = true): string => {
      const v = f.get(k);
      if ((!v || !v.length) && required) throw new Error("E_USAGE codex-hooks c " + cmd + ": needs " + k);
      if (v && v.length > 1) throw new Error("E_USAGE codex-hooks c " + cmd + ": " + k + " given twice");
      return v?.[0] ?? "";
    };
    const item = (): ItemName => {
      const i = one("--item");
      if (!isItem(i)) throw new Error("E_USAGE codex-hooks c: --item is one of " + ITEM_NAMES.join(", ") + ", not " + i);
      return i;
    };
    const phase = (required = true) => {
      const p = one("--phase", required) || null;
      if (p !== null && p !== "pilot" && p !== "main") throw new Error("E_USAGE codex-hooks c: --phase is pilot or main");
      return p as "pilot" | "main" | null;
    };
    if (cmd === "plan") {
      const ids = suiteUnits();
      for (const p of [phase(false) ?? "pilot", ...(phase(false) ? [] : ["main" as const])]) {
        const steps = schedule(p, ids);
        console.log(p + ": " + steps.length + " steps; sessions " + JSON.stringify(plannedSessions(steps)));
        for (const s of steps) console.log("  " + s.item + " " + s.unit);
      }
      return 0;
    }
    if (cmd === "codex-arms") {
      process.stdout.write(codexArmsText(ITEMS[item()].arms));
      return 0;
    }
    if (cmd === "approve") {
      const a = one("--admission", false) || "required";
      if (a !== "required" && a !== "warn") throw new Error("E_USAGE codex-hooks c approve: --admission is required or warn");
      const i = item();
      approve(one("--record"), i, Number(one("--cap")), one("--by"), one("--words"), a);
      console.log("approved " + i + " at $" + ITEMS[i].cap_usd);
      return 0;
    }
    if (cmd === "guard") {
      const i = item();
      const cells = join(one("--root"), i, "cells.ndjson");
      const have = existsSync(cells) ? readFileSync(cells, "utf8").split("\n").filter((l) => l.trim()).length : 0;
      const g = guard(one("--record"), i, Math.max(0, ITEMS[i].sessions - have));
      console.log(g.line);
      for (const w of g.why) console.log("  " + w);
      return g.ok ? 0 : 2;
    }
    if (cmd === "done") {
      console.log("marked done: " + markDone(one("--record"), item()));
      return 0;
    }
    if (cmd === "run") {
      const sources = Object.fromEntries((f.get("--source") ?? []).map((s) => {
        const at = s.indexOf("=");
        if (at <= 0) throw new Error("E_USAGE codex-hooks c run: --source takes <owner/repo>=<clone>");
        return [s.slice(0, at), s.slice(at + 1)];
      }));
      for (const repo of ["garrytan/gstack", "garrytan/gbrain"]) if (!sources[repo]) throw new Error("E_USAGE codex-hooks c run: needs --source " + repo + "=<clone>");
      const r = await runPhase({ root: one("--root"), phase: phase()!, record: one("--record"), ledger: one("--ledger"), sources, upstream: one("--upstream", false) || null, ids: suiteUnits(), exec: execGstackEvals, log: (l) => console.log(l) });
      for (const [i, why] of Object.entries(r.stopped)) console.log("stopped " + i + ": " + why);
      return r.ok ? 0 : 1;
    }
    const refs = suiteRefs();
    const unitsOf = (i: ItemName) => {
      const ids = new Set(itemUnits(i, refs.map((u) => u.id)));
      return refs.filter((u) => ids.has(u.id));
    };
    if (cmd === "rerun") {
      const i = item();
      const moved = moveForRerun(one("--root"), i, unitsOf(i));
      console.log(moved.length ? "moved for their one rerun:\n" + moved.map((m) => "  " + m).join("\n") : "no session owes a rerun");
      return 0;
    }
    if (cmd === "readout") {
      const root = one("--root");
      const items = f.has("--item") ? [item()] : ITEM_NAMES.filter((i) => existsSync(join(root, i, "cells.ndjson")));
      for (const i of items) console.log(JSON.stringify(writeReadout(root, i, unitsOf(i)), null, 2));
      return 0;
    }
    if (cmd === "states") {
      const p = phaseRecords(one("--root"), phase()!, unitsOf);
      writeFileSync(one("--out"), p.text);
      for (const i of p.items) console.log(i.item + ": " + i.sessions + " sessions, " + i.lines + " lines, " + i.not_run + " planned cells not run");
      for (const i of p.skipped) console.log(i + ": not run yet (no cells.ndjson), so its sessions are missing");
      return 0;
    }
    const d = dryRun(suiteUnits());
    for (const l of d.lines) console.log(l);
    return d.ok ? 0 : 1;
  } catch (e) {
    const m = (e as Error).message;
    console.error(/^E_[A-Z_]+/.test(m) ? m : "E_USAGE codex-hooks c: " + m);
    return 2;
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
