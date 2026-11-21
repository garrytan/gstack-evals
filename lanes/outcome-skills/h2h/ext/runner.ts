// Copyright (c) 2026 Garry Tan. MIT License.
// An extension stage's session runner behind gstack-evals h2h x-run (plan sections 5, 7 and 14). It plans one part's stage
// from a units file (ext/plan.ts planExtStage, seeded from prereg.json's order_seed), writes plan.json, then runs each
// planned session in order through ext/session.ts runExtSession on the running outcome driver, scores it (score/score.ts),
// and writes its tests-added record (ext/tests.ts). Each session's dir holds session.json, score.json and tests.json, so
// x-analyze and x-look read the stage's out dir as --sessions, --scores and --tests. A session dir that already holds
// session.json is kept and read back (a relaunch picks up where the stage stopped); one that exists without it refuses,
// for the Captain to rule on. Before each session the arm's home is checked against its pin and scanned for the unit's
// answer key (a confirmed hit refuses, E_H2HX_RUN). A cap stop, a finalize halt, a refused arm, a drifted home or a part P
// route refusal ends the stage at once. Where things are comes from the environment, as for rerun:
//   H2H_CONTROL    the running outcome driver's control URL (it holds the keys; the runner never reads one)
//   H2H_PROXY      the metering proxy of the driver stage that serves the part's item
//   H2H_UNITS      the prepared sm-unit dirs, one per unit id, each with its tree volume
//   H2HX_S_HOMES   part S: the installed Codex homes, one dir per s-* arm (ext/codex-arms.ts)
//   H2H_HOMES      part P: the base install layer's homes, with H2H_PINS (arms-pins.json; the post bundle's by default)
//   H2HX_L_HOMES   part L: ext/homes.ts's homes, one dir per home arm, each with its install record
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSessionImage, type SessionImage } from "../../statemachines/image.ts";
import { treeVolume } from "../../statemachines/oracle.ts";
import { runName } from "../../statemachines/testrun.ts";
import { readUnit } from "../../statemachines/unit.ts";
import { containHome } from "../arms/contain.ts";
import { ARMS_PINS_PATH } from "../arms/pins.ts";
import { h2hFail } from "../prereg.ts";
import { scoreSession, type ScoredSession } from "../score/score.ts";
import { readInstalls } from "../sessions/exposure.ts";
import type { H2hUnitInput } from "../sessions/run.ts";
import { buildRuntimeVolume } from "../sessions/runtimes.ts";
import type { H2hArm, H2hScore, H2hSession, H2hUnit, Stage } from "../types.ts";
import type { ExtTests } from "./analysis.ts";
import { containCodexHome } from "./codex-arms.ts";
import { planExtStage, type ExtPlan, type ExtPlanned } from "./plan.ts";
import { readExtPrereg, type ExtPrereg, type Part } from "./prereg.ts";
import { buildExtRuntimeVolume } from "./runtimes.ts";
import { checkExtHome, extHome, runExtSession, type ExtHome, type ExtSessionInput, type ExtSessionRecord } from "./session.ts";
import { extTests } from "./tests.ts";

type Env = Record<string, string | undefined>;
/** The environment each part's runner needs. */
export const EXT_ENV: Record<Part, string[]> = { S: ["H2H_CONTROL", "H2H_PROXY", "H2H_UNITS", "H2HX_S_HOMES"], P: ["H2H_CONTROL", "H2H_PROXY", "H2H_UNITS", "H2H_HOMES"], L: ["H2H_CONTROL", "H2H_PROXY", "H2H_UNITS", "H2HX_L_HOMES"] };

/** What the runner calls; tests replace them. */
export interface ExtRunnerDeps {
  unit(id: string, unit: H2hUnit): { dir: string; input: H2hUnitInput };
  runtime(part: Part): Promise<{ volume: string }>;
  contain(home: ExtHome, unitDir: string, input: H2hUnitInput): string | null;
  session(i: ExtSessionInput): Promise<{ record: ExtSessionRecord; file: string }>;
  score(record: ExtSessionRecord, dir: string, unitDir: string): ScoredSession;
  tests(record: ExtSessionRecord, score: H2hScore, dir: string, unitDir: string): ExtTests | null;
}

/** The real dependencies: sm-unit dirs under H2H_UNITS with one session image per unit, the part's runtime volume, the
 *  home containment scan, the session, the scorer and the tests-added builder. */
export function realDeps(env: Env): ExtRunnerDeps {
  const images = new Map<string, SessionImage>();
  const runtimes = new Map<string, { volume: string }>();
  return {
    unit(id, unit) {
      const dir = join(env.H2H_UNITS!, id);
      const u = readUnit(dir);
      const image = images.get(id) ?? buildSessionImage(u, { volume: treeVolume(id), stage: "first" });
      images.set(id, image);
      return { dir, input: { unit, statement: readFileSync(join(dir, "issue.md"), "utf8"), image, repo_dir: u.repo_dir, work_dir: u.work_dir } };
    },
    async runtime(part) {
      const key = part === "S" ? "S" : "PL";
      const r = runtimes.get(key) ?? (part === "S" ? await buildExtRuntimeVolume() : await buildRuntimeVolume());
      runtimes.set(key, r);
      return r;
    },
    contain(home, unitDir, input) {
      if (!home.dir) return null;
      const where = { kind: "docker" as const, image: input.image.tag, volume: input.image.volume, repoDir: input.repo_dir, name: runName("h2hx-contain") };
      const c = home.part === "S" ? containCodexHome({ arm: home.arm as Parameters<typeof containCodexHome>[0]["arm"], home: home.dir, unitDir, where }) : containHome({ arm: (home.base_arm ?? home.pin) as H2hArm, home: home.dir, unitDir, where });
      return c.ok ? null : c.confirmed + " confirmed answer-key hit(s) in arm " + home.arm + "'s home: " + c.hits.filter((h) => h.idiom === null).slice(0, 3).map((h) => h.needle + " " + h.path).join("; ");
    },
    session: (i) => runExtSession(i),
    score: (record, dir, unitDir) => scoreSession(record as unknown as H2hSession, dir, unitDir),
    tests: (record, score, dir, unitDir) => extTests(record, score, dir, unitDir),
  };
}

export interface ExtStageOptions { part: Part; stage: Stage; units: H2hUnit[]; out: string; env?: Env; allowance?: number; deps?: ExtRunnerDeps; x?: ExtPrereg; log?: (line: string) => void }
export interface ExtStageResult { plan: ExtPlan; ran: number; kept: number; records: { session: ExtSessionRecord; score: H2hScore; tests: ExtTests | null }[] }

const sessionDir = (out: string, s: ExtPlanned) => join(out, String(s.index).padStart(4, "0") + "-" + s.unit.replace(/[^A-Za-z0-9._-]/g, "_") + "-" + s.arm);

/** Plans the part's stage over the stage's units and runs, scores and records each session in plan order. */
export async function runExtStage(o: ExtStageOptions): Promise<ExtStageResult> {
  const x = o.x ?? readExtPrereg();
  const env = o.env ?? process.env;
  const log = o.log ?? ((l: string) => console.log(l));
  const units = o.units.filter((u) => u.stage === o.stage);
  if (!units.length) h2hFail("E_H2HX_INPUT", "the units file holds no " + o.stage + " unit");
  const plan = planExtStage(o.part, units, o.stage, x);
  mkdirSync(o.out, { recursive: true });
  const planFile = join(o.out, "plan.json");
  if (existsSync(planFile)) {
    const had = JSON.parse(readFileSync(planFile, "utf8")) as ExtPlan;
    if (JSON.stringify(had) !== JSON.stringify(plan)) h2hFail("E_H2HX_RUN", planFile + " holds another plan than this part, stage and units file give; a relaunch runs the same plan");
  } else writeFileSync(planFile, JSON.stringify(plan, null, 1) + "\n", { flag: "wx" });
  const deps = o.deps ?? realDeps(env);
  const byId = new Map(units.map((u) => [u.id, u]));
  const installs = o.part === "P" ? readInstalls(env.H2H_PINS ?? ARMS_PINS_PATH) : undefined;
  const result: ExtStageResult = { plan, ran: 0, kept: 0, records: [] };
  for (const s of plan.sessions) {
    const dir = sessionDir(o.out, s);
    const { dir: unitDir, input } = deps.unit(s.unit, byId.get(s.unit)!);
    let record: ExtSessionRecord;
    if (existsSync(join(dir, "session.json"))) {
      record = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as ExtSessionRecord;
      if (record.unit !== s.unit || record.arm !== s.arm || record.index !== s.index || record.stage !== s.stage) h2hFail("E_H2HX_RUN", dir + "/session.json is not planned session " + s.index + " (" + s.unit + " " + s.arm + ")");
      result.kept++;
    } else {
      if (existsSync(dir)) h2hFail("E_H2HX_RUN", dir + " exists with no session.json: an earlier launch stopped inside this session; the Captain rules on it before the stage goes on");
      const home = extHome(s.arm, { sHomes: env.H2HX_S_HOMES, homes: env.H2H_HOMES, installs, lHomes: env.H2HX_L_HOMES }, x);
      checkExtHome(home);
      const hit = deps.contain(home, unitDir, input);
      if (hit) h2hFail("E_H2HX_RUN", "unit " + s.unit + ": " + hit + "; the unit drops for every arm by the frozen rule, and no session of it runs");
      ({ record } = await deps.session({ session: s, unit: input, home, control: env.H2H_CONTROL!, proxy: env.H2H_PROXY!, out: dir, runtime: await deps.runtime(o.part), allowance: o.allowance, installs }));
      result.ran++;
    }
    const scored = deps.score(record, dir, unitDir);
    for (const w of scored.warnings) log(w);
    writeFileSync(join(dir, "score.json"), JSON.stringify(scored.score, null, 1) + "\n");
    const tests = deps.tests(record, scored.score, dir, unitDir);
    if (tests) writeFileSync(join(dir, "tests.json"), JSON.stringify(tests, null, 1) + "\n");
    result.records.push({ session: record, score: scored.score, tests });
    log(s.index + " " + s.unit + " " + s.arm + ": " + record.end + (record.gap ? " gap " + record.gap : "") + ", verified " + scored.score.verified + (tests ? ", tests added " + tests.added : "") + "; " + dir);
  }
  return result;
}

/** The checks before anything opens: the part's environment, Docker, Harbor and the driver, and each unit's sm-unit dir
 *  and tree volume. Returns the first problem, or null. */
export async function extPreflight(part: Part, units: readonly H2hUnit[], env: Env = process.env): Promise<string | null> {
  const unset = EXT_ENV[part].filter((k) => !env[k]);
  if (unset.length) return unset.join(", ") + " not set; part " + part + "'s runner reads the driver, the homes and the unit dirs from them";
  if (part === "P" && !existsSync(env.H2H_PINS ?? ARMS_PINS_PATH)) return "H2H_PINS " + (env.H2H_PINS ?? ARMS_PINS_PATH) + " does not exist";
  const d = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 30_000 });
  if (d.status !== 0) return "docker does not answer: " + (d.stderr ?? "").trim().slice(-200);
  if (spawnSync("harbor", ["--version"], { encoding: "utf8", timeout: 60_000 }).status !== 0) return "harbor is not on PATH";
  const status = await fetch(env.H2H_CONTROL! + "/status", { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? null : "answered " + r.status), (e: Error) => e.message);
  if (status) return "the driver at H2H_CONTROL " + env.H2H_CONTROL + " " + status;
  for (const u of units) {
    const dir = join(env.H2H_UNITS!, u.id);
    if (!existsSync(join(dir, "unit.json"))) return "unit " + u.id + " has no sm-unit dir at " + dir;
    if (spawnSync("docker", ["volume", "inspect", treeVolume(u.id)], { encoding: "utf8" }).status !== 0) return "unit " + u.id + " has no tree volume " + treeVolume(u.id) + "; run the SM oracle on it first";
  }
  return null;
}
