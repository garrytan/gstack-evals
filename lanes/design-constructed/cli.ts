// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dc: the design plan review eval on constructed units (prereg 2026-11-14). Every error line on stderr
// starts with its reason code. Each area replaces its own rows' run when it lands; until then a row exits 2 with
// E_USAGE "not built yet".
import { CODES, docAnchor, type ReasonCode } from "../../src/errors/codes.ts";
import { AREAS, dryRun, type Area } from "./dryrun.ts";
import { DcError, fail } from "./errors.ts";
import { filecheckCommand, frameCommand } from "./frame/command.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

type Args = { flags: Map<string, string>; bools: Set<string>; rest: string[] };
type Run = (args: Args, io: Io) => Promise<number> | number;

function parse(argv: string[], bools: string[]): Args {
  const flags = new Map<string, string>();
  const on = new Set<string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) rest.push(a);
    else if (bools.includes(a)) on.add(a);
    else {
      const v = argv[++i];
      if (v === undefined) fail("E_USAGE", a + " needs a value");
      flags.set(a, v!);
    }
  }
  return { flags, bools: on, rest };
}

const notBuilt = (area: Area): Run => () => fail("E_USAGE", "not built yet (the " + area + " area owns it)");

const dryrun: Run = async (a, io) => {
  const only = a.flags.get("--area");
  if (only !== undefined && !(AREAS as readonly string[]).includes(only)) fail("E_USAGE", "--area is one of " + AREAS.join(", "));
  const r = await dryRun(only ? [only as Area] : AREAS);
  for (const line of r.lines) io.out(line);
  return r.ok ? 0 : 2;
};

export const SUBCOMMANDS: Record<string, { area: Area | "lane"; run: Run; bools: string[]; usage: string; summary: string }> = {
  frame: { area: "frame", run: frameCommand, bools: [], usage: "--out <sealed dir outside the repo>", summary: "the one dated frame search, its entry filters and the frame order (keyless)" },
  filecheck: { area: "frame", run: filecheckCommand, bools: [], usage: "--repo <dir>", summary: "the keyless file check on each candidate's safe clone" },
  recipes: { area: "frame", run: notBuilt("frame"), bools: [], usage: "", summary: "recipe sessions and qualification (paid: dc-base-apps)" },
  author: { area: "author", run: notBuilt("author"), bools: [], usage: "", summary: "authoring steps 1 to 7, the fix round, rewrites, 2x versions and twins (paid: dc-authoring-1 to -3)" },
  gatecheck: { area: "author", run: notBuilt("author"), bools: [], usage: "", summary: "the eight planted units through every model-judged gate (paid: dc-gate-check)" },
  scope: { area: "run", run: notBuilt("run"), bools: [], usage: "", summary: "the keyless UI scope read on every plan.md" },
  sessions: { area: "run", run: notBuilt("run"), bools: [], usage: "", summary: "review sessions for one stage, arm and model (paid: dc-stage1-*, dc-stage2-*)" },
  probe: { area: "score", run: notBuilt("score"), bools: [], usage: "", summary: "the live judge probe, one call down every judge route (paid: dc-judges)" },
  labels: { area: "score", run: notBuilt("score"), bools: [], usage: "", summary: "label packets, the judge check and the stage 2 re-check (paid: dc-judges)" },
  score: { area: "score", run: notBuilt("score"), bools: [], usage: "", summary: "A, G, D and every secondary from final labels" },
  read: { area: "read", run: notBuilt("read"), bools: [], usage: "", summary: "the twin check, the tier chain, the smoke rules, contrasts and verdicts" },
  power: { area: "read", run: notBuilt("read"), bools: [], usage: "", summary: "the admission read on design.json through power.py" },
  items: { area: "money", run: notBuilt("money"), bools: [], usage: "", summary: "the 17 ledger items, their caps and admission rules" },
  stage3: { area: "stage3", run: notBuilt("stage3"), bools: [], usage: "", summary: "stage 3 authoring, oracle builds, builds and measures (paid: dc-stage3-*)" },
  dryrun: { area: "lane", run: dryrun, bools: [], usage: "[--area " + AREAS.join("|") + "]", summary: "the keyless dry run: one PASS or FAIL line per case" },
};

const lines = (code: ReasonCode, message: string) => [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].flatMap((t) => t.split(/\r\n|\r|\n/)).map((l) => code + " " + l).join("\n");

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(["gstack-evals dc <command>", "", ...Object.entries(SUBCOMMANDS).map(([k, v]) => "  " + k.padEnd(10) + v.summary + (v.usage ? "\n" + " ".repeat(12) + v.usage : ""))].join("\n"));
    return sub ? 0 : 2;
  }
  const entry = SUBCOMMANDS[sub];
  if (!entry) {
    io.err(lines("E_USAGE", "gstack-evals dc: unknown command " + JSON.stringify(sub) + "; gstack-evals dc --help lists them"));
    return 2;
  }
  try {
    return await entry.run(parse(rest, entry.bools), io);
  } catch (e) {
    if (!(e instanceof DcError)) throw e;
    io.err(lines(e.code, "gstack-evals dc " + sub + ": " + e.message));
    return CODES[e.code].exit ?? 2;
  }
}
