// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless checker fixtures (prereg section 6; the Captain's D1 condition): before any paid build, a placeholder app
// scores 0 with "does nothing useful" set, and a reference app scores every task done. Both run through the real
// browser container, the start contract, the node volume, Playwright's MCP server, the verdict parser and the score.
// A scripted checker (fixtures/check.mjs, in a sidecar on the same internal network) stands in for the checker agent.
// runRealFixtures is the paid smoke's step: both fixture apps through the check stage's own session (the Sol checker on
// the browser tools), on day1-smoke, with the stage's retry rules and the same bar; it writes fixtures-real.json, the
// receipt read checks before any category 2 reading counts.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";
import type { LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import { nodeVolume, startApp, stopApp } from "./app.ts";
import { BROWSER_IMAGE, LIMITS, MODELS } from "./frozen.ts";
import { attemptOutcome, endLoop, launchSession, micros, settle } from "./sessions.ts";
import { copySamples, loadUnit, type Unit } from "./units.ts";
import { checkPrompt, parseVerdicts, scoreBuild, type VerdictParse } from "./verdict.ts";

export const FIXTURES_RECEIPT = "fixtures-real.json";

export const fixtureUnit = (): Unit => {
  const loaded = loadUnit(join(FIXTURES, "unit"), "fixplants");
  if ("problems" in loaded) throw new Error("E_DAYONE_FIXTURE the fixture unit does not load: " + loaded.problems.join("; "));
  return loaded.unit;
};

export interface RealFixture {
  app: string;
  started: boolean;
  share: number | null;
  nothing_useful: boolean | null;
  pass: boolean;
  why: string;
}

/** Both fixture apps through the real checker's session; a halt or a cap stop ends the run with the fixtures failed. */
export async function runRealFixtures(o: { rig: HostRig; policy: LoadedPolicy; docker: string; runId: string; out: string; volume: string; launch?: typeof launchSession; app?: { start: typeof startApp; stop: typeof stopApp }; log: (l: string) => void }): Promise<{ apps: RealFixture[]; passed: boolean; spent_micros: number }> {
  const u = fixtureUnit();
  const ids = u.list!.tasks.map((t) => t.id);
  const launch = o.launch ?? launchSession;
  const app = o.app ?? { start: startApp, stop: stopApp };
  const apps: RealFixture[] = [];
  let spent = 0;
  for (const f of FIXTURE_APPS) {
    let done: RealFixture | null = null;
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      const sdir = join(o.out, "fixtures-real", f.app, "a" + attempt);
      mkdirSync(sdir, { recursive: true });
      copySamples(u, join(sdir, "samples"));
      const a = await app.start({ docker: o.docker, network: o.rig.network ?? "none", build: join(FIXTURES, f.app), samples: join(sdir, "samples"), scratch: join(sdir, "scratch"), volume: o.volume, label: "fix" + f.app.slice(0, 3) });
      if (!a.started) {
        app.stop(a, o.docker, join(sdir, "browser"));
        if (attempt === 2) done = { app: f.app, started: false, share: null, nothing_useful: null, pass: false, why: a.detail };
        continue;
      }
      const loop = endLoop();
      const read = await launch({ rig: o.rig, policy: o.policy, docker: o.docker, runId: o.runId, arm: "check", cell: "fixplants-" + f.app, rep: 1, attempt, model: MODELS.checker, dir: sdir, seed: null, prompt: checkPrompt(u.list!), minutes: LIMITS.check.minutes, turns: LIMITS.check.turns, allowanceMicros: micros(LIMITS.check.usd), nextUser: loop.nextUser, mcpUrl: a.mcpUrl }).finally(() => app.stop(a, o.docker, join(sdir, "browser")));
      spent += read.micros;
      const outcome = settle(attemptOutcome(read, null), attempt);
      if (outcome.state === "halt" || outcome.state === "cap" || outcome.state === "contaminated" || outcome.state === "missing") {
        done = { app: f.app, started: true, share: null, nothing_useful: null, pass: false, why: outcome.state + ": " + outcome.why };
        if (outcome.state !== "missing") {
          apps.push(done);
          writeFileSync(join(o.out, FIXTURES_RECEIPT), JSON.stringify({ schema: "day-one.fixtures-real.v1", apps, passed: false, spent_micros: spent }, null, 2) + "\n");
          return { apps, passed: false, spent_micros: spent };
        }
        continue;
      }
      if (outcome.state === "retry") continue;
      const parse: VerdictParse = parseVerdicts(loop.last, ids);
      if (parse.kind === "bad" && attempt === 1) continue;
      const s = scoreBuild(u.list!, true, parse.kind === "ok" ? parse : null);
      const pass = parse.kind === "ok" && s.share === f.share && s.nothing_useful === (f.share === 0);
      done = { app: f.app, started: true, share: s.share, nothing_useful: s.nothing_useful, pass, why: parse.kind === "ok" ? parse.tasks.map((t) => t.id + " " + (t.done ? "done" : "not done")).join("; ") : "unparsable: " + parse.reason };
    }
    apps.push(done ?? { app: f.app, started: false, share: null, nothing_useful: null, pass: false, why: "no attempt ended" });
    o.log((apps.at(-1)!.pass ? "PASS " : "FAIL ") + f.app + " with the real checker: " + apps.at(-1)!.why);
  }
  const passed = apps.every((a) => a.pass);
  writeFileSync(join(o.out, FIXTURES_RECEIPT), JSON.stringify({ schema: "day-one.fixtures-real.v1", apps, passed, spent_micros: spent }, null, 2) + "\n");
  return { apps, passed, spent_micros: spent };
}

export const FIXTURES = join(import.meta.dir, "fixtures");
export const FIXTURE_APPS = [{ app: "placeholder", share: 0 }, { app: "reference", share: 1 }] as const;

export async function runFixtures(io: { out: (t: string) => void; err: (t: string) => void }, docker = "docker"): Promise<number> {
  let u: Unit;
  try {
    u = fixtureUnit();
  } catch (e) {
    io.err((e as Error).message);
    return 2;
  }
  const ids = u.list!.tasks.map((t) => t.id);
  const { volume } = nodeVolume(docker);
  const network = "day-one-fix-" + randomBytes(4).toString("hex");
  const scratch = mkdtempSync(join(tmpdir(), "day-one-fix-"));
  const made = spawnSync(docker, ["network", "create", "--internal", network], { encoding: "utf8" });
  if (made.status !== 0) {
    io.err("E_DAYONE_FIXTURE docker network create failed: " + made.stderr.trim());
    return 2;
  }
  let failed = 0;
  try {
    for (const f of FIXTURE_APPS) {
      const samples = join(scratch, "samples-" + f.app);
      copySamples(u, samples);
      const a = await startApp({ docker, network, build: join(FIXTURES, f.app), samples, scratch, volume, label: "fix" + f.app.slice(0, 3) });
      let parse: VerdictParse | null = null;
      try {
        if (a.started) {
          const r = spawnSync(docker, ["run", "--rm", "--network", network, "-v", join(FIXTURES, "check.mjs") + ":/check.mjs:ro", "--entrypoint", "node", BROWSER_IMAGE, "/check.mjs", a.mcpUrl], { encoding: "utf8", timeout: 300_000 });
          parse = parseVerdicts([r.stdout], ids);
          if (parse.kind === "bad") io.out("  checker stderr: " + r.stderr.trim().slice(-400));
        }
      } finally {
        stopApp(a, docker, join(scratch, "kept-" + f.app));
      }
      const s = scoreBuild(u.list!, a.started, parse);
      const ok = a.started && s.share === f.share && s.nothing_useful === (f.share === 0);
      if (!ok) failed++;
      const why = parse?.kind === "ok" ? parse.tasks.map((t) => t.id + " " + (t.done ? "done" : "not done") + " (" + t.why + ")").join("; ") : parse ? "unparsable: " + parse.reason : a.detail;
      io.out((ok ? "PASS " : "FAIL ") + f.app + ": started in " + a.start_s + " s, share " + s.share + ", nothing useful " + s.nothing_useful + "; " + why);
    }
  } finally {
    spawnSync(docker, ["network", "rm", network], { encoding: "utf8" });
    rmSync(scratch, { recursive: true, force: true });
  }
  if (failed) io.err("E_DAYONE_FIXTURE " + failed + " fixture(s) scored wrong");
  return failed ? 2 : 0;
}
