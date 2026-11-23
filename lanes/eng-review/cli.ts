// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals er: the plan-eng-review intentions eval's commands (prereg 2026-11-08-geva-405) that the eng-review build
// read (prereg 2026-11-11-geva-522) ports: unit authoring, set draws, the eng phase render and the exposure detectors.
// Each subcommand lives in its module's run(argv, io). The review sessions themselves run through review-units --plan
// eng-review (src/trial/review).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor, isReasonCode, type ReasonCode } from "../../src/errors/codes.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Run = (argv: string[], io: Io) => Promise<number> | number;

export const SUBCOMMANDS: Record<string, { module: string; summary: string }> = {
  frame: { module: "author/frame.ts", summary: "free GitHub frame search per type, with and without copyleft, and the supply recount (no model call)" },
  mine: { module: "author/mine.ts", summary: "free mining of one clone: candidate changes, SZZ and revert reads with blame ranges, T and C candidates (no model call)" },
  author: { module: "author/run.ts", summary: "author units under custody on an authoring item: plan rewrites, keys, audits, foreseeable ratings and the mentioned flag" },
  classify: { module: "author/classify.ts", summary: "the frozen project-type rule: Opus and Sol classify, Gemini settles a split" },
  sets: { module: "author/sets.ts", summary: "draw the calibration, comparison and reserve sets in seeded order, quotas first" },
  parse: { module: "parse.ts", summary: "the eng-plan parser, the one lenient parse and the normalizer, over a reply file" },
  render: { module: "render.ts", summary: "render the eng phase arm's opening for one unit from gstack's snapshot tool at the pinned commit" },
  exposure: { module: "exposure.ts", summary: "the pre-cut, eng phase and candidate procedure detectors over a session's transcript and sink" },
};

const lines = (code: ReasonCode, message: string) => [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].flatMap((t) => t.split(/\r\n|\r|\n/)).map((l) => code + " " + l).join("\n");

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(["gstack-evals er <command>", "", ...Object.entries(SUBCOMMANDS).map(([k, v]) => "  " + k.padEnd(10) + v.summary)].join("\n"));
    return sub ? 0 : 2;
  }
  const entry = SUBCOMMANDS[sub];
  if (!entry) {
    io.err(lines("E_USAGE", "er: unknown command " + JSON.stringify(sub)));
    return 2;
  }
  const path = join(import.meta.dir, entry.module);
  if (!existsSync(path)) {
    io.err(lines("E_USAGE", "er " + sub + ": not built yet (" + entry.module + ")"));
    return 2;
  }
  const mod = (await import(path)) as { run?: Run };
  if (typeof mod.run !== "function") {
    io.err(lines("E_USAGE", "er " + sub + ": " + entry.module + " exports no run(argv, io)"));
    return 2;
  }
  try {
    return await mod.run(rest, io);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = typeof err.code === "string" && isReasonCode(err.code) ? err.code : "E_INTERNAL";
    io.err(lines(code as ReasonCode, "er " + sub + ": " + String(err.message ?? e).replace(new RegExp("^" + code + " "), "")));
    return CODES[code as ReasonCode].exit ?? 1;
  }
}
if (import.meta.main) process.exit(await main(process.argv.slice(2)));
