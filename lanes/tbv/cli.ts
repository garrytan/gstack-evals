// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals tbv: the trust-but-verify eval's commands (prereg 2026-11-05-geva-313 as amendment 1 changes it). Each
// subcommand lives in its module's run(argv, io); the scorer's subcommands are rule.ts's.
import { join } from "node:path";
import { CODES, docAnchor, type ReasonCode } from "../../src/errors/codes.ts";
import { TbvError } from "./errors.ts";
import type { Io } from "./types.ts";

type Run = (argv: string[], io: Io) => Promise<number> | number;
const RULE = ["words", "endstate", "admit", "headroom", "projection", "allin", "caps", "compare", "handoff", "leak"];
export const SUBCOMMANDS: Record<string, { module: string; summary: string }> = {
  ...Object.fromEntries(RULE.map((c) => [c, { module: "rule.ts", summary: "the scorer's " + c + " rule (tbv-rule.ts, with the build fixes and amendment 1)" }])),
  shape: { module: "shape.ts", summary: "capture the request shape from the pinned Claude Code against a stub provider" },
  splice: { module: "splice.ts", summary: "capture a family's splice set at a pin" },
  "assemble-a": { module: "history/source-a.ts", summary: "assemble source A histories from R3 run bundles" },
  "rebuild-a": { module: "history/rebuild.ts", summary: "rebuild source A task directories outside the held tier from the pinned export, kept only at their recorded digest" },
  "mine-b": { module: "history/source-b.ts", summary: "fetch this repo's closed and merged pull requests" },
  "assemble-b": { module: "history/source-b.ts", summary: "assemble source B histories from mined pull requests" },
  extract: { module: "extract.ts", summary: "list fact candidates, lists and the stratum of a history" },
  "held-step": { module: "held.ts", summary: "run a held-out step confined (only a tmpfs work dir writable, network off), then seal its files" },
  "held-unseal": { module: "held.ts", summary: "unseal held records into a tmpfs work dir, confined" },
  keys: { module: "keys.ts", summary: "write and audit keys on tbv-author's lease" },
  drive: { module: "drive.ts", summary: "run an item's readings through the metering proxy on its lease" },
  packets: { module: "packet.ts", summary: "build blind judge packets and controls" },
  judge: { module: "judge.ts", summary: "run the judges over a packet batch" },
  readings: { module: "readings.ts", summary: "join records and judge replies into the readings file" },
  check: { module: "check.ts", summary: "the handoff check and the leak check over real inputs" },
  dryrun: { module: "dryrun.ts", summary: "the keyless dry run" },
};

const lines = (code: ReasonCode, message: string) => [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].flatMap((t) => t.split(/\r\n|\r|\n/)).map((l) => code + " " + l).join("\n");

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(["gstack-evals tbv <command>", "", ...Object.entries(SUBCOMMANDS).map(([k, v]) => "  " + k.padEnd(11) + v.summary)].join("\n"));
    return sub ? 0 : 2;
  }
  const entry = SUBCOMMANDS[sub];
  if (!entry) {
    io.err(lines("E_USAGE", "gstack-evals tbv: unknown command " + JSON.stringify(sub) + "; gstack-evals tbv --help lists them"));
    return 2;
  }
  try {
    const mod = (await import(join(import.meta.dir, entry.module))) as { run?: Run };
    if (typeof mod.run !== "function") throw new TbvError("E_TBV_NOT_BUILT", "gstack-evals tbv " + sub + " is not built yet (" + entry.module + ")");
    return await mod.run(entry.module === "rule.ts" ? [sub, ...rest] : argv, io);
  } catch (e) {
    if (!(e instanceof TbvError)) throw e;
    io.err(lines(e.code, "gstack-evals tbv " + sub + ": " + e.message));
    return 2;
  }
}
