// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dc: the design plan review eval on constructed units (prereg 2026-11-14). Every error line on stderr
// starts with its reason code. Keyless rows run for real; paid rows check their start rules and the ledger admission,
// then build their providers (wire.ts). The real providers exist only on the controller host, where wire/host.ts runs
// each paid row inside the ledger service; anywhere else a paid row refuses with E_DCW_OFF_HOST after its checks.
import { CODES, docAnchor, type ReasonCode } from "../../src/errors/codes.ts";
import { AREAS, dryRun, type Area } from "./dryrun.ts";
import { DcError, fail } from "./errors.ts";
import { filecheckCommand, frameCommand } from "./frame/command.ts";
import { loadVocabulary } from "./author/screen.ts";
import { realSeams } from "./frame/run.ts";
import { pinsCommand } from "./paid/cli.ts";
import { uvPowerRunner } from "./read/seams.ts";
import { BOUND_PROVIDERS } from "./wire.ts";
import { itemsRow, powerRow, readRow, scopeRow, scoreRow } from "./wire/keyless.ts";
import { recipesRow } from "./wire/recipes.ts";
import { clonesRow } from "./wire/clones.ts";
import { authorRow, gatecheckRow } from "./wire/author.ts";
import { labelsRow, probeRow } from "./wire/score.ts";
import { modelProbeRow } from "./wire/modelprobe.ts";
import { exportsRow, stage3InputsRow } from "./wire/exports.ts";
import { hostCommand } from "./wire/host.ts";
import type { HostContext } from "./wire/real.ts";
import { repriceRow } from "./wire/reprice.ts";
import { sessionsRow } from "./wire/sessions.ts";
import { stage3Row } from "./wire/stage3.ts";
import type { Row, RowEnv } from "./wire/start.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

type Args = { flags: Map<string, string>; bools: Set<string>; rest: string[] };
type Run = Row;

/** The real environment: the providers bound for where it runs, the whole keyless dry run, the lane's checkout, uv's power.py. */
export const realEnv = (host: HostContext | null = null): RowEnv => ({
  providers: BOUND_PROVIDERS(host),
  dryRun: async () => (await dryRun()).ok,
  lane: host ? host.lane : realSeams().lane,
  now: () => new Date(),
  power: uvPowerRunner,
  vocabulary: loadVocabulary,
});

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
  clones: { area: "frame", run: clonesRow(), bools: [], usage: "--record <sealed clone record JSON> --out <new sealed folder outside the repo>", summary: "PD-15: re-fetch each kept clone by its commit, check its tree and drop a mismatch, never swapped (keyless)" },
  recipes: { area: "frame", run: recipesRow, bools: [], usage: "--frame <the frame's sealed folder> --out <new sink folder>", summary: "recipe sessions and qualification (paid: dc-base-apps, dc-hosts)" },
  author: { area: "author", run: authorRow, bools: [], usage: "--step pilot|units|2x|twins --item <item> --apps <apps.json> --gstack <dir> --terms <file> --gate <gatecheck sink> [--pilot <sink>] [--from N --to M] [--units <author sink>] --out <new sink>", summary: "authoring steps 1 to 7, the fix round, rewrites, 2x versions and twins (paid: dc-authoring-1 to -3)" },
  gatecheck: { area: "author", run: gatecheckRow, bools: [], usage: "--units <planted.json> --apps <apps.json> --gstack <dir> --terms <file> --out <new sink>", summary: "the eight planted units through every model-judged gate (paid: dc-gate-check)" },
  scope: { area: "run", run: scopeRow, bools: [], usage: "--units <folder of unit folders, each with plan.md>", summary: "the keyless UI scope read on every plan.md" },
  sessions: { area: "run", run: sessionsRow, bools: [], usage: "--stage 1|2 --model opus|sol|particle --cells <cells.json> --units <units.json> --exports <folder> --terms <file> [--rule8 <file>] [--repair <file>] --out <new sink>", summary: "review sessions for one stage, arm and model (paid: dc-stage1-*, dc-stage2-*)" },
  reprice: { area: "read", run: repriceRow, bools: [], usage: "--stage1 <stage1.json> --projection <projection input JSON> --out <new sink>", summary: "before stage 2, each cap stage 1's measured costs pass, written into the ledger as a PD-30 deviation (ledger only, no model call)" },
  probe: { area: "score", run: probeRow, bools: [], usage: "--terms <file> --out <new sink>", summary: "the live judge probe, one call down every judge route (paid: dc-judges)" },
  labels: { area: "score", run: labelsRow, bools: ["--shuffled"], usage: "--pass production|check --in <folder: units.json rows.json> --read base|2x|10x --stage 1|2 --terms <file> [--shuffled] [--production <sink>] [--check <sink>] --out <new sink>", summary: "label packets, the judge check and the stage 2 re-check (paid: dc-judges)" },
  score: { area: "score", run: scoreRow, bools: [], usage: "--in <folder: units.json rows.json packets.json labels.json> --read base|2x|10x --stage 1|2", summary: "A, G, D and every secondary from final labels" },
  read: { area: "read", run: readRow, bools: [], usage: "--stage 1|2 --in <read input JSON>", summary: "the twin check, the tier chain, the smoke rules, contrasts and verdicts" },
  power: { area: "read", run: powerRow, bools: [], usage: "--design <design.json> --out <new folder>", summary: "the admission read on design.json through power.py" },
  items: { area: "money", run: itemsRow, bools: ["--planning"], usage: "[--planning]", summary: "the 17 ledger items, their caps and admission rules; --planning adds the planning projection and the measured inputs the projection rerun and the reprice row take" },
  stage3: { area: "stage3", run: stage3Row, bools: [], usage: "--candidates <stage3.json> --exports <folder> --rows <stage 2 rows.json> --terms <file> --out <new sink>", summary: "stage 3 authoring, oracle builds, builds and measures (paid: dc-stage3-*, dc-hosts)" },
  modelprobe: { area: "paid", run: modelProbeRow, bools: [], usage: "--terms <file> --out <new sink>", summary: "the model probe, one short call per model first after the go (PD-19; paid: dc-gate-check)" },
  pins: { area: "paid", run: (a, io) => pinsCommand(a, io), bools: [], usage: "plan --dir <new dir> | record --dir <dir> --run <id> --commit <sha> [--dated <iso>] --out <file> | terms --pin <pin record> --out <terms.json>", summary: "the keyless probe plan, the run's model pin record (start rule 9) and the --terms file from it" },
  exports: { area: "run", run: (a, io, env) => exportsRow(a, io, env), bools: [], usage: "--in <exports.json> --out <new folder>", summary: "each unit's export folder: repo/, plan.md, context/ and c2.json (keyless)" },
  stage3inputs: { area: "stage3", run: (a, io, env) => stage3InputsRow(a, io, env), bools: [], usage: "--units <units.json> --recipes <recipes.json> --oracles <oracles.json> --routes <routes.json> --out <stage3.json>", summary: "the stage3 row's candidates file (keyless)" },
  host: { area: "wire", run: (a, io, env) => hostCommand(a, io, env), bools: ["--force"], usage: "launch|relaunch|recover|teardown|status --plan <host plan JSON> --record <host record JSON> [--archive <new folder>] [--force]", summary: "the controller host: launch with the plan's stage row, relaunch, recovery from a host loss, teardown and status (paid: dc-hosts)" },
  dryrun: { area: "lane", run: dryrun, bools: [], usage: "[--area " + AREAS.join("|") + "]", summary: "the keyless dry run: one PASS or FAIL line per case" },
};

const lines = (code: ReasonCode, message: string) => [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].flatMap((t) => t.split(/\r\n|\r|\n/)).map((l) => code + " " + l).join("\n");

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }, env: () => RowEnv = () => realEnv()): Promise<number> {
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
    return await entry.run(parse(rest, entry.bools), io, env());
  } catch (e) {
    if (!(e instanceof DcError)) throw e;
    io.err(lines(e.code, "gstack-evals dc " + sub + ": " + e.message));
    return CODES[e.code].exit ?? 2;
  }
}
