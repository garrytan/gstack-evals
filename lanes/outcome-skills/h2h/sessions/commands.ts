// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's commands for the head-to-head CLI (h2h/cli.ts loads them). Each takes its argv after the command name and
// returns an exit code; a refusal prints one line on stderr that starts with its reason code.
//   session-plan --units <units.json> --stage <stage0|stage1|stage2> --out <plan.json>
//   session-run --plan <plan.json> --index <n> --unit <unit-input.json> --control <url> --proxy <url> --out <dir>
//       (--homes <dir> --pins <arms-pins.json> | --home <dir>) [--allowance <usd>] [--gsd-onboard] [--browser-wrapper <file>]
//   dryrun [dryrun.ts flags]
//   exposure --arm <arm> --entry <bug|feature> --transcript <file> [--transcript <file>] [--files <list.txt>]
//   audit --transcript <file> [--transcript <file>] --pins <arms-pins.json> [--arm <arm>]
//   runtimes [--cache <dir>]   builds the runtime volume, or reuses it while its manifest holds the pins
import { readFileSync } from "node:fs";
import { H2hError, h2hFail } from "../prereg.ts";
import { ALL_ARMS, type Entry, type H2hArm, type H2hUnit, type Stage } from "../types.ts";
import { main as dryrun } from "./dryrun.ts";
import { exposure, readAudit, readEvents, readInstalls } from "./exposure.ts";
import { armHome } from "./home.ts";
import { planStage, readPlan, writePlan } from "./plan.ts";
import { runH2hSession, type H2hUnitInput } from "./run.ts";
import { buildRuntimeVolume } from "./runtimes.ts";

const flag = (argv: string[], k: string): string | undefined => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const flags = (argv: string[], k: string): string[] => argv.flatMap((a, i) => (a === k && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
const need = (argv: string[], k: string, usage: string): string => flag(argv, k) ?? h2hFail("E_USAGE", "missing " + k + "; usage: " + usage);
const arm = (v: string): H2hArm => ((ALL_ARMS as readonly string[]).includes(v) ? (v as H2hArm) : h2hFail("E_USAGE", v + " is not an h2h arm; arms are " + ALL_ARMS.join(", ")));
const entry = (v: string): Entry => (v === "bug" || v === "feature" ? v : h2hFail("E_USAGE", "entry is bug or feature, not " + v));
const json = (file: string): any => JSON.parse(readFileSync(file, "utf8"));

const guard = (f: (argv: string[]) => Promise<number> | number) => async (argv: string[]): Promise<number> => {
  try {
    return await f(argv);
  } catch (e) {
    if (!(e instanceof H2hError)) throw e;
    console.error(e.message);
    return e.code === "E_USAGE" ? 2 : 1;
  }
};

export const commands: Record<string, (argv: string[]) => Promise<number>> = {
  "session-plan": guard((argv) => {
    const u = "session-plan --units <units.json> --stage <stage> --out <plan.json>";
    const units = json(need(argv, "--units", u)) as H2hUnit[] | { units: H2hUnit[] };
    const plan = planStage(Array.isArray(units) ? units : units.units, need(argv, "--stage", u) as Stage);
    writePlan(need(argv, "--out", u), plan);
    console.log(plan.sessions.length + " sessions planned for " + plan.stage);
    return 0;
  }),
  "session-run": guard(async (argv) => {
    const u = "session-run --plan <plan.json> --index <n> --unit <unit-input.json> --control <url> --proxy <url> --out <dir> (--homes <dir> --pins <file> | --home <dir>)";
    const plan = readPlan(need(argv, "--plan", u));
    const index = Number(need(argv, "--index", u));
    const session = plan.sessions.find((s) => s.index === index) ?? h2hFail("E_H2H_SESSION_INPUT", "the plan has no session " + index);
    const unit = json(need(argv, "--unit", u)) as H2hUnitInput;
    if (unit.unit?.id !== session.unit) h2hFail("E_H2H_SESSION_INPUT", "the unit input is " + unit.unit?.id + ", not planned session " + index + "'s unit " + session.unit);
    const pins = flag(argv, "--pins");
    const installs = pins ? readInstalls(pins) : undefined;
    const home = flag(argv, "--home") !== undefined ? armHome(session.arm, { dir: flag(argv, "--home")! }) : armHome(session.arm, { installs, homes: flag(argv, "--homes") });
    const allowance = flag(argv, "--allowance");
    const { record, file } = await runH2hSession({ session, unit, home, installs, control: need(argv, "--control", u), proxy: need(argv, "--proxy", u), out: need(argv, "--out", u), allowance: allowance === undefined ? undefined : Number(allowance), gsdOnboard: argv.includes("--gsd-onboard"), browserWrapper: flag(argv, "--browser-wrapper") });
    console.log(record.end + (record.gap ? " gap " + record.gap : "") + " " + file);
    return 0;
  }),
  dryrun: guard((argv) => dryrun(argv)),
  exposure: guard((argv) => {
    const u = "exposure --arm <arm> --entry <bug|feature> --transcript <file> [--files <list.txt>]";
    const files = flags(argv, "--transcript");
    if (!files.length) h2hFail("E_USAGE", "missing --transcript; usage: " + u);
    const list = flag(argv, "--files");
    console.log(JSON.stringify(exposure(arm(need(argv, "--arm", u)), entry(need(argv, "--entry", u)), readEvents(files), { files: list ? readFileSync(list, "utf8").split("\n").filter(Boolean) : [] })));
    return 0;
  }),
  audit: guard((argv) => {
    const u = "audit --transcript <file> --pins <arms-pins.json> [--arm <arm>]";
    const files = flags(argv, "--transcript");
    if (!files.length) h2hFail("E_USAGE", "missing --transcript; usage: " + u);
    const a = flag(argv, "--arm");
    console.log(JSON.stringify(readAudit(readEvents(files), readInstalls(need(argv, "--pins", u)), a === undefined ? undefined : arm(a))));
    return 0;
  }),
  runtimes: guard(async (argv) => {
    const cache = flag(argv, "--cache");
    const v = await buildRuntimeVolume(cache === undefined ? {} : { cache });
    console.log(v.volume + (v.reused ? " reused" : " built") + ": " + Object.entries(v.versions).map(([k, x]) => k + " " + x).join(", "));
    return 0;
  }),
};
