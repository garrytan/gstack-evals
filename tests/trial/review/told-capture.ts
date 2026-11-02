// Captures what review-units resolves for each arm configuration through the real command (main in
// src/trial/review/cli.ts), so told-identity.test.ts can compare it byte for byte with what main resolved at 176fdc7
// (fixtures/told-identity-176fdc7.json) and check R56-1's ship-panel arm. Each session's prompt is listed once, by its
// sha256, under prompts. It runs as its own process,
// `bun test ./tests/trial/review/told-capture.ts` with CAPTURE_OUT naming the JSON file it writes, because it replaces
// three Docker steps for the whole process: the image pin check, the unit tree build and dockerRig. dockerRig becomes a
// keyless rig that records its call (the arm specs and each arm's install target) and runs every session with the real
// Claude Code driver and the pinned Agent SDK against the stub CLI (tests/adapters/fixtures/stub-cli.cjs). Argument checks,
// arm resolution, the unit repo build and runReviewUnits are the real code. The file name has no .test. suffix, so the
// suite never loads it with its module mocks.
import { mock, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { hostDriver, type HostDriverOptions } from "../../../src/adapters/host.ts";
import { REPO_ROOT } from "../../../src/cli.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import * as runHost from "../../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import * as image from "../../../src/trial/image.ts";
import * as runModule from "../../../src/trial/review/run.ts";
import * as unitModule from "../../../src/trial/review/unit.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import type { ArmSpec } from "../../../src/types.ts";
import { harness } from "../../adapters/harness.ts";
import { collect } from "../../cli/helpers.ts";
import { sourceRepo } from "./helpers.ts";

const STUB = join(REPO_ROOT, "tests", "adapters", "fixtures", "stub-cli.cjs");
const S1 = join(REPO_ROOT, "wiki", "plans", "2026-10-31-geva-76-stacks-round-1-prereg");
const R2 = join(REPO_ROOT, "wiki", "plans", "2026-11-02-geva-122-r2-amendment");
const MAP = join(REPO_ROOT, "src", "trial", "review", "reader-maps", "gstack-77fe28c39796.json");
const SHIP_PANEL_PREFIX = join(REPO_ROOT, "tests", "trial", "review", "fixtures", "told-ship-panel.txt");
const GSTACK_S1 = "garrytan/gstack@53522b1bbc60b3dc820842371f80ebc9db7911ec";
const PSTACK = "cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c:harness/pstack/claude-code";
const TSTACK = "t3dotgg/tstack@1085050f3baed1ac724caa4a8166145fb2ac88af";
const GSTACK_R2 = "garrytan/gstack@77fe28c39796cf5573e3d0836b83b2ee436a8f12";
const GSTACK_CC = "garrytan/gstack@142757b107edeffff7c78453490c4d2786996fa7";
const GSTACK_SHIP = "garrytan/gstack@5209e9262d8068a75b29be562fbc1de82ba8b487";
const FINDINGS = "Review done.\n\n```json\n" + JSON.stringify([{ file: "src/a.ts", line: 1, severity: "P1", claim: "The exported value changes for every caller.", evidence: "src/a.ts:1" }]) + "\n```\n";

/** Each configuration's arm flags, as the run that froze it passed them (the plan post named beside each). */
export const CONFIGS: Record<string, string[]> = {
  // Stacks round 1 (#95, wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg), step 5's arms, models and flags.
  "stacks-r1": ["--arms", "none", "gstack=" + GSTACK_S1, "pstack=" + PSTACK, "tstack=" + TSTACK, "--models", "claude-opus-5-5", "particle-ai/particle-1", "--severity-map", join(S1, "severity-map.json"), "--allowance", "15"],
  // R2 (wiki/plans/2026-11-02-geva-122-r2-amendment), the none arm's command.
  "r2-none": ["--arms", "none", "--models", "claude-opus-5-5", "--system-prompt", "none=claude-code-preset", "--max-turns", "200", "--allowance", "40", "--cap-stops", "--reader-map", MAP],
  // R2, the gstack-full arm's command with its frozen told prefix.
  "r2-full": ["--arms", "gstack-full=" + GSTACK_R2, "--models", "claude-opus-5-5", "--system-prompt", "gstack-full=claude-code-preset", "--told-prefix", "gstack-full=" + join(R2, "told-gstack-full.txt"), "--max-turns", "200", "--allowance", "40", "--cap-stops", "--reader-map", MAP],
  // Ceremony cut on stacks-r1 (wiki/plans/2026-11-01-geva-108-ceremony-cut-prereg), the review pilot's arms and flags.
  "ceremony-cut": ["--arms", "none", "control=" + GSTACK_CC, "variant=" + GSTACK_CC, "control-sdk=" + GSTACK_CC, "--render", "control=interactive", "variant=unattended", "control-sdk=interactive", "--system-prompt", "none=claude-code-preset", "control=claude-code-preset", "variant=claude-code-preset", "--models", "claude-opus-5-5", "--session-kind", "unattended", "--allowance", "15", "--severity-map", join(S1, "severity-map.json")],
  // R56-1: gstack's /ship review panel, told through its own command, beside no gstack, on R2's settings.
  "ship-panel": ["--arms", "none", "ship-panel=" + GSTACK_SHIP, "--told-prefix", "ship-panel=" + SHIP_PANEL_PREFIX, "--system-prompt", "none=claude-code-preset", "ship-panel=claude-code-preset", "--models", "claude-opus-5-5", "--max-turns", "200", "--allowance", "40", "--cap-stops"],
};

interface Captured {
  rig?: { host: string; models: string[]; item: string; arms: ArmSpec[]; skill: string | null; skills: Record<string, string> | null; voice: boolean | null };
  run?: Record<string, unknown>;
  drivers: Record<string, unknown>[];
}
let captured: Captured = { drivers: [] };
let stubDir = "";
let proxyUrl = "";

const realRunReviewUnits = runModule.runReviewUnits;
const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/** The harness's local sandbox, with the stub as the CLI; each session records its argv and messages to its own file. */
function stubSandbox(arm: string, model: string): Sandbox {
  return {
    isolation: "process",
    workPath: (work: string) => work,
    fixturesPath: (fixtures: string) => fixtures,
    homePath: (dir: string) => join(dir, "home"),
    step(_role: string, command: string, _task: string, o: { work: string; env: Record<string, string>; timeoutMs: number }) {
      const r = spawnSync("sh", ["-c", command], { cwd: o.work, env: o.env, timeout: o.timeoutMs, encoding: "utf8" });
      return { exitCode: r.status ?? 1, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    agent(task: string, o: { work: string; env: Record<string, string> }) {
      mkdirSync(o.env.HOME!, { recursive: true });
      const cell = { STUB_MODE: "agents", STUB_AGENTS: "[]", STUB_FINAL: FINDINGS, STUB_RECORD: join(stubDir, [arm, model.replaceAll("/", "_"), task].join("__") + ".ndjson") };
      return {
        exec: (command: string, timeoutMs: number) => {
          const r = spawnSync("sh", ["-c", command], { cwd: o.work, env: o.env, timeout: timeoutMs, encoding: "utf8" });
          return { exitCode: r.status ?? 1, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
        },
        spawn: (argv: string[], extra: Record<string, string> = {}) => (argv[0] === "claude" ? spawn(process.execPath, [STUB, ...argv.slice(1)], { cwd: o.work, env: { ...o.env, PATH: process.env.PATH ?? "", ...extra, ...cell }, stdio: ["pipe", "pipe", "pipe"] }) : spawn(argv[0]!, argv.slice(1), { cwd: o.work, env: { ...o.env, PATH: process.env.PATH ?? "", ...extra }, stdio: ["pipe", "pipe", "pipe"] })),
        stop() {},
      };
    },
  } as unknown as Sandbox;
}

mock.module("../../../src/trial/image.ts", () => ({ ...image, checkImagePin: () => ({ ok: true, pin: { tag: "gstack-evals-trial:capture", digest: "sha256:capture" } }) }));
mock.module("../../../src/trial/review/unit.ts", () => ({
  ...unitModule,
  buildUnitTree: (o: { repo: { dir: string }; dest: string }) => {
    cpSync(o.repo.dir, o.dest, { recursive: true, verbatimSymlinks: true });
    return { problems: [], tree_sha256: "capture-fixture-tree", install: null, test: null, retained: null };
  },
}));
mock.module("../../../src/skill-eval/cli/run-host.ts", () => ({
  ...runHost,
  dockerRig: (call: { host: string; models: string[]; item: string; arms: { arms: ArmSpec[] } }, o: { skill: string | null; skills?: Record<string, string>; voice?: boolean }): HostRig => {
    captured.rig = { host: call.host, models: call.models, item: call.item, arms: call.arms.arms, skill: o.skill, skills: o.skills ?? null, voice: o.voice ?? null };
    const h = harness(() => [{ type: "text", text: "ok" }]);
    proxyUrl = h.baseUrl;
    const arms = Object.fromEntries(call.arms.arms.map((a) => {
      const target = o.skills?.[a.name] ?? null;
      const skill = target ? { roots: [".claude/skills/" + target], skillMd: ".claude/skills/" + target + "/SKILL.md", dir: null, file: null } : null;
      const provenance = a.kind === "stack" ? { kind: "stack", stack: { repo: a.stack.repo, sha: a.stack.sha, ...(a.stack.path ? { path: a.stack.path } : {}), source: "local-git" } } : { kind: a.kind };
      return [a.name, { tree_sha256: "capture-arm-" + a.name, skill, gstack: null, plugins: [], provenance }];
    }));
    return {
      baseUrl: h.baseUrl, network: null, imageDigest: null,
      bind: async (request) => h.proxy.bind(request),
      finalize: (m) => h.proxy.finalize(m),
      arms: arms as unknown as HostRig["arms"],
      sandbox: (arm: string, _calibration: boolean, model?: string) => stubSandbox(arm, model ?? ""),
      judgeSandbox: () => stubSandbox("judge", ""),
      egress: () => ({ open: false, detail: "capture rig" }),
      driver: (d: HostDriverOptions) => {
        captured.drivers.push({ ...d, proxy: undefined, freeform: undefined });
        return hostDriver(d);
      },
      close: async () => {
        h.proxy.stop();
        return { committed: 0, unknown: 0, lease_id: null };
      },
      recovery: null,
    };
  },
}));
mock.module("../../../src/trial/review/run.ts", () => ({
  ...runModule,
  runReviewUnits: (input: Record<string, unknown> & { readers?: { sha256: string }; severityMap?: unknown }, rig: HostRig, log: (line: string) => void) => {
    const { units: _u, out: _o, runId: _r, env: _e, journal: _j, reuse: _re, keyBase: _k, policy: _p, readers, severityMap, suite: _s, ...rest } = input;
    captured.run = { ...rest, readers_sha256: readers?.sha256 ?? null, severity_map_sha256: severityMap === undefined ? null : sha256(JSON.stringify(severityMap)) };
    return realRunReviewUnits(input as never, rig, log);
  },
}));

/** One configuration through main, normalized so no path, run id, slot or token is left. */
export async function captureOne(name: string, args: readonly string[]): Promise<Record<string, unknown>> {
  captured = { drivers: [] };
  const root = mkdtempSync(join(REPO_ROOT, ".review-units-capture-"));
  stubDir = join(root, "stub");
  mkdirSync(stubDir, { recursive: true });
  const s = sourceRepo();
  const unit = { id: "garrytan/gstack#7@" + s.head.slice(0, 12), repo: "garrytan/gstack", pr: 7, head: s.head, base: s.base, cluster: "garrytan/gstack#7", group: null, blockers: [{ id: "b1", paths: ["src/a.ts"], file: "src/a.ts", line: 1, severity: "blocking", claim: "a changes", kind: "regression" }] };
  const suite = JSON.parse(readFileSync(join(REPO_ROOT, "lanes", "review-noloss", "suites", "gsta167-14pr.json"), "utf8"));
  writeFileSync(join(root, "suite.json"), JSON.stringify({ ...suite, id: "capture", units: [{ ...unit, blockers: [{ ...suite.units[0].blockers[0], paths: ["src/a.ts"], file: "src/a.ts", line: 1 }] }], ineligible: [], excluded: [], frozen_bars: [] }));
  const out = join(root, "out");
  const { main } = await import("../../../src/trial/review/cli.ts");
  const argv = ["--suite", join(root, "suite.json"), "--units", "all", "--out", out, "--source", "garrytan/gstack=" + s.root, "--test", "garrytan/gstack=true", "--test", "garrytan/gbrain=true", "--item", "capture", "--spend-cap", "1000", "--parallel", "1", "--date", "2026-11-02", "--ledger", join(root, "ledger.sqlite"), "--record", join(root, "record"), ...args];
  const io = collect();
  if (process.env.CAPTURE_DEBUG) {
    const [o, e] = [io.out, io.err];
    io.out = (t: string) => (process.stderr.write("OUT " + t + "\n"), o(t));
    io.err = (t: string) => (process.stderr.write("ERR " + t + "\n"), e(t));
  }
  try {
    const code = await main(argv, io, { XDG_STATE_HOME: join(root, "state") });
    const text = io.text();
    const clean = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null).replaceAll(root, "<root>").replaceAll(s.root, "<source>").replaceAll(REPO_ROOT, "<repo>").replaceAll(proxyUrl || "\u0000", "<proxy>").replaceAll(s.head, "<head>").replaceAll(s.head.slice(0, 12), "<head12>").replaceAll(s.head.slice(0, 8), "<head8>").replaceAll(s.base, "<base>"));
    const journal = (() => {
      try {
        return readFileSync(join(out, "cells.ndjson"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    })();
    const records = (() => {
      try {
        return readdirSync(stubDir).sort();
      } catch {
        return [];
      }
    })();
    const sessions = captured.drivers.map((d) => {
      const dir = relative(join(out, "runs"), String(d.out)).split("/");
      const [model, arm, task] = [dir[0]!.replaceAll("_", "/"), dir[1]!, dir[2]!];
      const file = records.find((f) => f === [arm, model.replaceAll("/", "_"), task].join("__") + ".ndjson");
      const lines = file ? readFileSync(join(stubDir, file), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
      const user = lines.find((l) => l.type === "user");
      const content = user?.message?.content;
      const prompt = typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join("") : null;
      const entry = journal.find((e) => e.cell.arm === arm && e.cell.model === model);
      const { verifier: _v, policy: _p, image_digest: _i, recipe: _rc, host_version: _h, adapter_sha256: _a, isolation: _is, ...key } = entry?.key?.parts ?? {};
      return {
        arm, model,
        driver: { ...d, out: undefined, skill: d.skill ? { ...(d.skill as Record<string, unknown>) } : null },
        prompt_sha256: prompt === null ? null : sha256(prompt),
        prompt,
        termination: entry?.record?.termination ?? null,
        turns: entry?.record?.turns?.length ?? null,
        parse: entry?.parse?.kind ?? null,
        key,
      };
    }).sort((a, b) => (a.arm + " " + a.model).localeCompare(b.arm + " " + b.model));
    const told = Object.fromEntries((() => {
      try {
        return readdirSync(join(out, "arms")).sort().map((id) => [id, JSON.parse(readFileSync(join(out, "arms", id, "arm.json"), "utf8")).told]);
      } catch {
        return [];
      }
    })());
    return clean({ config: name, args, exit: code, out: text.out.split("\n"), errors: text.err.split("\n").filter((l) => /^E_/.test(l)), rig: captured.rig ?? null, run: captured.run ?? null, sessions, told }) as Record<string, unknown>;
  } finally {
    removeTree(root);
    removeTree(s.root);
  }
}

test("capture", async () => {
  const names = process.env.CAPTURE_CONFIGS ? process.env.CAPTURE_CONFIGS.split(",") : Object.keys(CONFIGS);
  const prompts: Record<string, string> = {};
  const configs: Record<string, unknown> = {};
  for (const name of names) {
    const one = await captureOne(name, CONFIGS[name]!);
    for (const s of one.sessions as { prompt_sha256: string | null; prompt?: string | null }[]) {
      if (s.prompt_sha256 && s.prompt) prompts[s.prompt_sha256] = s.prompt;
      delete s.prompt;
    }
    configs[name] = one;
  }
  const json = JSON.stringify({ prompts, configs }, null, 2) + "\n";
  if (process.env.CAPTURE_OUT) writeFileSync(process.env.CAPTURE_OUT, json);
  else process.stdout.write(json);
}, 600_000);
