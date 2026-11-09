// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dx stage3 (prereg 2026-11-09-geva-417, section 12). Keyless subcommands only: checks prints stage 3's
// dry-run lines, prompt prints one build arm's prompt from the stage 2 rows and the alias map, and readout prints the
// paired readout from a builds file. The paid run (Ubicloud VMs, the build and docs-only agents, the Astra probe judge)
// goes through run.ts runStage3 with its backend and agents passed in; no subcommand here creates a VM or calls a model.
import { readFileSync } from "node:fs";
import { DxError } from "../author/funnel.ts";
import { ARM_IDS, type AliasMap, type ArmId, type Row, type UnitMeta } from "../types.ts";
import { armBlock, buildPrompt } from "./build.ts";
import { checks } from "./checks.ts";
import type { BuildMeasures } from "./firstsuccess.ts";
import { printReadout, readout } from "./readout.ts";

const USAGE = ["gstack-evals dx stage3 <command>", "", "  checks                                                    stage 3's dry-run lines", "  prompt --rows <rows.json> --alias <alias.json> --unit <id> --arm <arm>   one build arm's prompt", "  readout --builds <builds.json> --units <units.json>       the paired readout against none"].join("\n");

function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]!, v = argv[i + 1];
    if (!k.startsWith("--") || v === undefined) throw new DxError("E_USAGE", "bad arguments near " + JSON.stringify(k) + "\n" + USAGE);
    out[k.slice(2)] = v;
  }
  return out;
}
const need = (f: Record<string, string>, k: string) => {
  if (!f[k]) throw new DxError("E_USAGE", "--" + k + " is required\n" + USAGE);
  return f[k]!;
};
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

export async function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    io.out(USAGE);
    return cmd === undefined ? 2 : 0;
  }
  if (cmd === "checks") {
    const lines = await checks();
    for (const l of lines) io.out((l.pass ? "PASS " : "FAIL ") + l.rule + (l.pass ? "" : " (" + l.detail + ")"));
    return lines.every((l) => l.pass) ? 0 : 1;
  }
  if (cmd === "prompt") {
    const f = flags(rest);
    const arm = need(f, "arm") as ArmId;
    if (!ARM_IDS.includes(arm)) throw new DxError("E_USAGE", "unknown arm " + JSON.stringify(arm));
    io.out(buildPrompt(armBlock(json<Row[]>(need(f, "rows")), need(f, "unit"), arm, json<AliasMap>(need(f, "alias")))));
    return 0;
  }
  if (cmd === "readout") {
    const f = flags(rest);
    const units = new Map(json<UnitMeta[]>(need(f, "units")).map((u) => [u.id, u.repo_digest]));
    io.out(printReadout(readout(json<BuildMeasures[]>(need(f, "builds")), (u) => units.get(u) ?? u)));
    return 0;
  }
  throw new DxError("E_USAGE", "unknown stage3 command " + JSON.stringify(cmd) + "\n" + USAGE);
}
