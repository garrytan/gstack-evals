// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dx: the devex eval's commands (prereg 2026-11-09-geva-417). Each subcommand lives in its module's
// run(argv, io); a subcommand whose module is not built yet exits 2 with E_USAGE. The review sessions themselves run
// through review-units --plan devex (src/trial/review).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor, isReasonCode, type ReasonCode } from "../../src/errors/codes.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Run = (argv: string[], io: Io) => Promise<number> | number;

export const SUBCOMMANDS: Record<string, { module: string; summary: string }> = {
  mine: { module: "mine/cli.ts", summary: "the shared frame and miner: repositories, units, filters, release ancestry, windows and the free screen (GitHub only, no model call)" },
  snapshot: { module: "unit/snapshot.ts", summary: "build a unit's aliased base snapshot: instruction files stripped, one commit, no remote" },
  alias: { module: "unit/alias.ts", summary: "the alias map and its mechanical replacement, forward and back" },
  author: { module: "author/cli.ts", summary: "authoring under custody: classifier, plan rewrite, triage, key read, audits, recognition probe" },
  sets: { module: "author/sets.ts", summary: "the calibration, comparison and reserve sets, the miss sample and the supply reading and rules" },
  parse: { module: "run/parse.ts", summary: "the plan-changes parser, the one lenient parse and the normalizer, over a reply file" },
  exposure: { module: "run/exposure.ts", summary: "the plan-devex-review and autoplan exposure detectors over a session's transcript and sink" },
  rows: { module: "run/rows.ts", summary: "one row per planned session, with section 6's failure table applied" },
  packets: { module: "score/packets.ts", summary: "blind label packets with the stock rows, shuffled keys and anchors; judge-check packets" },
  judge: { module: "score/judge.ts", summary: "run the production judges or the judge-check pass over packets, on a judge item" },
  score: { module: "score/score.ts", summary: "A with one-to-one credit and every secondary, from rows, keys and labels" },
  readings: { module: "score/rules.ts", summary: "the frozen readings: admission, smoke, judge and stock checks, contrasts, verdicts and R48" },
  stage3: { module: "stage3/cli.ts", summary: "stage 3: goals, checkers and probes, build arms, docs-only first success and the VM sandbox" },
  leases: { module: "leases.ts", summary: "the frozen runs, their items and lease sizes, and the admission arithmetic" },
  dryrun: { module: "dryrun.ts", summary: "the keyless dry run that drives every frozen rule on both sides (section 15, rule 4)" },
};

const lines = (code: ReasonCode, message: string) => [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].flatMap((t) => t.split(/\r\n|\r|\n/)).map((l) => code + " " + l).join("\n");

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }): Promise<number> {
  const [name, ...rest] = argv;
  if (name === "--help" || name === "-h") {
    io.out(["gstack-evals dx <command>", "", ...Object.entries(SUBCOMMANDS).map(([k, v]) => "  " + k.padEnd(10) + v.summary)].join("\n"));
    return 0;
  }
  const usage = "gstack-evals dx <" + Object.keys(SUBCOMMANDS).join("|") + "> ...";
  const sub = name === undefined ? undefined : SUBCOMMANDS[name];
  if (!sub) {
    io.err(lines("E_USAGE", name === undefined ? "dx needs a subcommand; usage: " + usage : "unknown dx subcommand " + JSON.stringify(name) + "; usage: " + usage));
    return 2;
  }
  const path = join(import.meta.dir, sub.module);
  if (!existsSync(path)) {
    io.err(lines("E_USAGE", "dx " + name + " is not built yet (" + sub.module + ")"));
    return 2;
  }
  try {
    const mod = (await import(path)) as { run?: Run };
    if (typeof mod.run !== "function") throw new Error(sub.module + " exports no run(argv, io)");
    return await mod.run(rest, io);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code && isReasonCode(code)) {
      io.err(lines(code, (e as Error).message.replace(new RegExp("^" + code + " "), "")));
      return CODES[code].exit ?? 2;
    }
    io.err(lines("E_INTERNAL", (e as Error).stack ?? String(e)));
    return 2;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
