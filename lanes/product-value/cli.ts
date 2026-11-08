// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals pv: the product-value eval's commands (prereg 2026-11-08-geva-403). Each subcommand lives in its module's
// run(argv, io). The review sessions themselves run through review-units --plan product-value (src/trial/review).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor, isReasonCode, type ReasonCode } from "../../src/errors/codes.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Run = (argv: string[], io: Io) => Promise<number> | number;

export const SUBCOMMANDS: Record<string, { module: string; summary: string }> = {
  mine: { module: "author/mine.ts", summary: "free GitHub mining: the public frame, candidate records in seeded order, release and window checks (no model call)" },
  author: { module: "author/run.ts", summary: "author public units under custody on an authoring item: keys, inputs, rewrites, audits" },
  transpose: { module: "author/transpose.ts", summary: "author transposed units under custody: summaries, the in-custody check, T1, T2, the Astra check and the recognition probe" },
  classify: { module: "author/classify.ts", summary: "the frozen project-type rule: two classifiers and a third on disagreement" },
  generic: { module: "author/generic.ts", summary: "the generic screen: Astra and Opus label each key item against stock rows 1 and 2" },
  parse: { module: "parse.ts", summary: "the plan-changes parser, the one lenient parse and the normalizer, over a reply file" },
  exposure: { module: "exposure.ts", summary: "the plan-ceo-review and office-hours procedure detectors over a session's transcript and sink" },
  rows: { module: "rows.ts", summary: "one row per planned session from review-units runs: block, normalized list, end state, exposure, spend" },
  oracle: { module: "oracle.ts", summary: "the oracle list per calibration unit from its primary items" },
  packets: { module: "packets.ts", summary: "blind label packets with stock rows, shuffled keys and gold cells; judge-check packets; pairwise packets" },
  judge: { module: "judge.ts", summary: "run the production judges, the judge-check pass or the pairwise judges over packets, on a judge item" },
  score: { module: "score.ts", summary: "A with one-to-one credit and every secondary, from rows, keys and labels" },
  readings: { module: "rules.ts", summary: "the frozen readings: twin check, admission, stock and judge checks, contrasts, verdicts and the reading rule" },
  taste: { module: "taste.ts", summary: "render the owner's 10 blind taste pairs from calibration units" },
  dryrun: { module: "dryrun.ts", summary: "the keyless dry run that drives every frozen rule (section 17, item 4)" },
};

const lines = (code: ReasonCode, message: string) => [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].flatMap((t) => t.split(/\r\n|\r|\n/)).map((l) => code + " " + l).join("\n");

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(["gstack-evals pv <command>", "", ...Object.entries(SUBCOMMANDS).map(([k, v]) => "  " + k.padEnd(10) + v.summary)].join("\n"));
    return sub ? 0 : 2;
  }
  const entry = SUBCOMMANDS[sub];
  if (!entry) {
    io.err(lines("E_USAGE", "gstack-evals pv: no command " + JSON.stringify(sub) + "; run gstack-evals pv --help"));
    return 2;
  }
  const path = join(import.meta.dir, entry.module);
  if (!existsSync(path)) {
    io.err(lines("E_USAGE", "gstack-evals pv " + sub + " is not built yet (it will live at lanes/product-value/" + entry.module + ")"));
    return 2;
  }
  try {
    const mod = (await import(path)) as { run: Run };
    return await mod.run(rest, io);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = typeof err.code === "string" && isReasonCode(err.code) ? err.code : "E_INTERNAL";
    io.err(lines(code, "gstack-evals pv " + sub + ": " + String(err.message ?? e).replace(new RegExp("^" + code + " "), "")));
    return CODES[code].exit ?? 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
