// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's session runner behind gstack-evals h2h rerun (plan section 12). Each unit runs as one real session: the SM
// harness's first-stage session image on the unit's tree volume, the arm's installed home checked against arms-pins.json
// and scanned for the unit's answer key, run.ts's Harbor session on a slot of the running driver, then part C's score of
// the tree it left. rerun's flags are frozen, so where things are comes from the environment:
//   H2H_CONTROL     the running outcome driver's control URL (it holds the key; the runner never reads one)
//   H2H_PROXY       the metering proxy of the driver stage that serves the rerun's item
//   H2H_HOMES       part A's installed homes, one dir per arm (gstack-evals h2h install)
//   H2H_UNITS       the prepared sm-unit dirs, one per unit id (the SM harness's prep and oracle)
//   H2H_PINS        arms-pins.json; the post bundle's by default
//   H2H_RERUN_ITEM  the item that stage serves; plan.ts itemOf's stage 2 item for the arm by default
// Harbor runs from PATH (the venv that holds claude-agent-sdk). preflight checks the arm's home against its pin before
// anything else that touches Docker or the driver, and runH2hSession checks it again before each session's slot opens.
// Records are stage2 sessions, indexed in the order run, and each unit's session image is built once per runner.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSessionImage, type SessionImage } from "../../statemachines/image.ts";
import { treeVolume } from "../../statemachines/oracle.ts";
import { runName } from "../../statemachines/testrun.ts";
import { readUnit } from "../../statemachines/unit.ts";
import { containHome } from "../arms/contain.ts";
import { ARMS_PINS_PATH } from "../arms/pins.ts";
import { H2hError } from "../prereg.ts";
import type { RerunOutcome, RerunRunner, RerunSession } from "../rerun.ts";
import { scoreSession } from "../score/score.ts";
import type { H2hArm, H2hUnit } from "../types.ts";
import { readInstalls } from "./exposure.ts";
import { armHome, checkArmHome } from "./home.ts";
import { itemOf } from "./plan.ts";
import { runH2hSession } from "./run.ts";
import { buildRuntimeVolume } from "./runtimes.ts";

const ENV = ["H2H_CONTROL", "H2H_PROXY", "H2H_HOMES", "H2H_UNITS"] as const;

/** The runner rerun drives; env defaults to the process environment. */
export function sessionRunner(env: Record<string, string | undefined> = process.env): RerunRunner {
  const pins = env.H2H_PINS ?? ARMS_PINS_PATH;
  let index = 0;
  let runtime: { volume: string } | null = null;
  const images = new Map<string, SessionImage>();
  const unitDir = (id: string) => join(env.H2H_UNITS!, id);
  return {
    async preflight(arm: H2hArm, units: readonly H2hUnit[]): Promise<string | null> {
      const unset = ENV.filter((k) => !env[k]);
      if (unset.length) return unset.join(", ") + " not set; the real path reads the driver, the homes and the unit dirs from them";
      if (!existsSync(pins)) return "H2H_PINS " + pins + " does not exist";
      try {
        checkArmHome(armHome(arm, { installs: readInstalls(pins), homes: env.H2H_HOMES }));
      } catch (e) {
        return (e as Error).message;
      }
      const d = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 30_000 });
      if (d.status !== 0) return "docker does not answer: " + (d.stderr ?? "").trim().slice(-200);
      if (spawnSync("harbor", ["--version"], { encoding: "utf8", timeout: 60_000 }).status !== 0) return "harbor is not on PATH";
      const status = await fetch(env.H2H_CONTROL! + "/status", { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? null : "answered " + r.status), (e: Error) => e.message);
      if (status) return "the driver at H2H_CONTROL " + env.H2H_CONTROL + " " + status;
      try {
        for (const u of units) {
          const dir = unitDir(u.id);
          if (!existsSync(join(dir, "unit.json"))) return "unit " + u.id + " has no sm-unit dir at " + dir;
          readUnit(dir);
          if (spawnSync("docker", ["volume", "inspect", treeVolume(u.id)], { encoding: "utf8" }).status !== 0) return "unit " + u.id + " has no tree volume " + treeVolume(u.id) + "; run the SM oracle on it first";
        }
      } catch (e) {
        return (e as Error).message;
      }
      return null;
    },
    async run(s: RerunSession): Promise<RerunOutcome> {
      try {
        const list = readInstalls(pins);
        const dir = unitDir(s.unit.id);
        const u = readUnit(dir);
        const image = images.get(u.id) ?? buildSessionImage(u, { volume: treeVolume(u.id), stage: "first" });
        images.set(u.id, image);
        const home = armHome(s.arm, { installs: list, homes: env.H2H_HOMES });
        if (home.dir) {
          const c = containHome({ arm: s.arm, home: home.dir, unitDir: dir, where: { kind: "docker", image: image.tag, volume: image.volume, repoDir: u.repo_dir, name: runName("h2h-rerun-contain") } });
          if (!c.ok) return { kind: "containment", detail: c.confirmed + " confirmed answer-key hit(s) in arm " + s.arm + "'s home: " + c.hits.filter((h) => h.idiom === null).slice(0, 3).map((h) => h.needle + " " + h.path).join("; ") };
        }
        runtime ??= await buildRuntimeVolume();
        const session = { unit: u.id, kind: s.unit.kind, entry: s.unit.entry, stage: "stage2" as const, index: index++, arm: s.arm, item: env.H2H_RERUN_ITEM ?? itemOf("stage2", s.arm) };
        const unit = { unit: s.unit, statement: readFileSync(join(dir, "issue.md"), "utf8"), image, repo_dir: u.repo_dir, work_dir: u.work_dir };
        const { record, file } = await runH2hSession({ session, unit, home, installs: list, control: env.H2H_CONTROL!, proxy: env.H2H_PROXY!, out: s.out, allowance: s.allowance_usd, runtime });
        const scored = scoreSession(record, s.out, dir);
        writeFileSync(join(s.out, "score.json"), JSON.stringify(scored.score, null, 1) + "\n");
        for (const w of scored.warnings) console.error(w);
        console.log(s.arm + " " + u.id + ": " + record.end + (record.gap ? " gap " + record.gap : "") + ", verified " + scored.score.verified + "; " + file);
        return { kind: "session", session: record, score: scored.score };
      } catch (e) {
        const code = e instanceof H2hError ? e.code : "";
        if (code === "CAP_STOP") return { kind: "cap_stop", detail: (e as Error).message };
        if (code === "E_H2H_SESSION_ARM" || code === "E_H2H_HOME_DRIFT") return { kind: "refused", detail: (e as Error).message };
        throw e;
      }
    },
  };
}
