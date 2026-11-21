// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 4 and 12: the session runner behind gstack-evals cso rerun, after h2h's rerunner. Each unit runs as one
// real session through run.ts on a slot of the running outcome driver. rerun's flags are frozen, so where things are comes
// from the environment:
//   CSO_CONTROL  the running driver's control URL (it holds the key; the runner never reads one)
//   CSO_PROXY    the metering proxy of the driver stage that serves the item
//   CSO_WORK     cso units' work dir: trees/<unit>, units/<unit>.json and arms/<arm>.json
//   CSO_HOME     the arm's installed home (cso and untold; none runs with no home)
//   CSO_STAGE    the stage the records name (stage0, stage1, repilot or stage2; stage2 by default)
//   CSO_OUT      where session dirs go; CSO_WORK/sessions by default
//   CSO_READOUT_KEY  the readout key's path (stage1 and repilot, whose session dirs are sealed to it)
// Harbor runs from PATH (the venv that holds claude-agent-sdk). Sol's Codex runner is a stub until the Captain's go.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionImage } from "../statemachines/image.ts";
import type { CsoArmRecord } from "./arms.ts";
import type { CsoRunner } from "./cli.ts";
import { readKey, sealedStage } from "./analysis/readout.ts";
import { csoFail } from "./prereg.ts";
import { buildCsoImage, runCsoSession } from "./run.ts";
import type { CsoArm, CsoModel, CsoStage, UnitRecord } from "./types.ts";

const STAGES: readonly CsoStage[] = ["stage0", "stage1", "repilot", "stage2"];
const need = (env: Record<string, string | undefined>, k: string): string => env[k] || csoFail("E_CSO_RERUN_PRECONDITION", k + " is not set; gstack-evals cso rerun reads the driver, work dir and home from CSO_CONTROL, CSO_PROXY, CSO_WORK and CSO_HOME");
const readJson = <T>(f: string, what: string): T => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : csoFail("E_CSO_RERUN_PRECONDITION", what + " " + f + " does not exist; run cso units first"));

/** The runner rerun drives; env defaults to the process environment. */
export function csoRunner(env: Record<string, string | undefined> = process.env): CsoRunner {
  const images = new Map<string, SessionImage>();
  let index = 0;
  const armRecord = (work: string, arm: CsoArm): CsoArmRecord => {
    const f = join(work, "arms", arm + ".json");
    return readJson<CsoArmRecord>(arm === "untold" && !existsSync(f) ? join(work, "arms", "cso.json") : f, "arm record");
  };
  return {
    preflight({ arm, model }) {
      if (model === "sol") csoFail("E_CSO_RERUN_PRECONDITION", "Sol runs in Codex, whose runner is a stub until the Captain's go");
      for (const k of ["CSO_CONTROL", "CSO_PROXY", "CSO_WORK", ...(arm === "none" ? [] : ["CSO_HOME"])]) need(env, k);
      const stage = (env.CSO_STAGE ?? "stage2") as CsoStage;
      if (!STAGES.includes(stage)) csoFail("E_CSO_RERUN_PRECONDITION", "CSO_STAGE " + JSON.stringify(stage) + " is not one of " + STAGES.join(", "));
      if (sealedStage(stage)) readKey(need(env, "CSO_READOUT_KEY"));
      armRecord(need(env, "CSO_WORK"), arm);
    },
    async run({ arm, model, unit, allowance_usd, cap_left_usd }) {
      const work = need(env, "CSO_WORK");
      const rec = readJson<UnitRecord>(join(work, "units", unit + ".json"), "unit record");
      const tree = join(work, "trees", unit);
      const image = images.get(unit) ?? buildCsoImage(rec, tree);
      images.set(unit, image);
      const stage = (env.CSO_STAGE ?? "stage2") as CsoStage;
      const n = index++;
      const out = join(env.CSO_OUT ?? join(work, "sessions"), stage, unit, arm + "-" + model + "-" + n);
      const home = { dir: arm === "none" ? null : need(env, "CSO_HOME"), home_tree_sha256: armRecord(work, arm).home_tree_sha256 };
      const { record } = await runCsoSession({ unit: rec, tree, image, arm, model: model as CsoModel, stage, index: n, home, control: need(env, "CSO_CONTROL"), proxy: need(env, "CSO_PROXY"), out, allowance: allowance_usd, capLeftUsd: cap_left_usd, seal: sealedStage(stage) ? readKey(need(env, "CSO_READOUT_KEY")) : null });
      return { cost_usd: record.cost_usd };
    },
  };
}
