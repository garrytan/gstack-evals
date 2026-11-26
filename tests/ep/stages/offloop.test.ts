// Copyright (c) 2026 Garry Tan. MIT License.
// The build stage's driver keeps answering while a session image builds or a build is graded (dated pre-run fix,
// 2026-11-17). The driver serves sessions from the stage's own event loop, so a blocking spawn there held every session's
// open and close past real_agent's timeout. The launcher builds every unit's session image before the driver serves,
// and the planted grader runs each read in a child process the stage awaits.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armName, buildRegistry } from "../../../lanes/eng-build/build-stage.ts";
import { buildLauncher } from "../../../lanes/eng-build/launch.ts";
import { claudePin } from "../../../lanes/eng-build/session-image.ts";
import { EB_SCHEMA } from "../../../lanes/eng-build/unit.ts";
import { plantedGrader } from "../../../lanes/eng-planted/construct/grade.ts";
import { EP_PROGRAM, EP_RUN, EP_SKILL } from "../../../lanes/eng-planted/stages/local.ts";
import type { PlantedUnit } from "../../../lanes/eng-planted/types.ts";
import { serveStages } from "../../../lanes/outcome-skills/driver/stage.ts";
import { recordProgram } from "../../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { plantedUnits } from "./fixture.ts";

const D = 1_000_000;
const quotes = [{ words: "keyless test on a temporary ledger", by: "ep driver test", source: "tests/ep/stages/offloop.test.ts" }];
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "ep-offloop-"));
  dirs.push(d);
  return d;
};

function ledger(dir: string) {
  const record = join(dir, "record");
  recordProgram(record, { program: EP_PROGRAM, cap_micros: 1_000 * D, skill_cap_micros: 1_000 * D, skills: [EP_SKILL], credit_rate_micros: D, quotes });
  recordApproval(record, { action: "init", item: "ep-authoring", cap_micros: 100 * D, quotes, admission: "warn", program: EP_PROGRAM, skills: [EP_SKILL] });
  return { record, ledger: join(dir, "ledger.sqlite") };
}
const serve = { machine: "m1", fetch: async () => new Response("{}"), env: { ANTHROPIC_API_KEY: "test-not-a-key" }, requireAdmission: () => null, log: () => {} };

/** Polls the driver's /status until stopped; returns when each answer came. A blocked event loop shows as a gap. */
function poll(control: string, get: typeof fetch = fetch) {
  let on = true;
  const at: number[] = [];
  const loop = (async () => {
    while (on) {
      await get(control + "/status", { signal: AbortSignal.timeout(10_000) }).then((r) => r.json(), () => null);
      at.push(performance.now());
      await Bun.sleep(50);
    }
  })();
  return {
    stop: async () => {
      on = false;
      await loop;
      return at;
    },
  };
}
const widest = (at: number[]) => Math.max(0, ...at.slice(1).map((t, i) => t - at[i]!));

describe("the build stage's driver", () => {
  // Value: protects=every build session's open and close; fails_when=grading a finished build runs on the stage's event
  // loop, so the driver answers no session until the grading containers end and real_agent's open or close times out, or
  // two reads grade at once, which the in-process grader never did.
  test("answers while a build is graded, one read at a time", async () => {
    const W = temp();
    const l = ledger(W);
    const local = LocalLedger.open(l.ledger);
    const served = await serveStages({ record: l.record, local, run_id: EP_RUN, envelope_host: "m1", stages: [{ item: "ep-authoring", arm: "eb-build:none", skills: [EP_SKILL] }], host: "127.0.0.1", dir: join(W, "driver"), registry: buildRegistry(), ...serve });
    try {
      const blocked = poll(served.control);
      await Bun.sleep(200);
      spawnSync("sleep", ["2"]);
      await Bun.sleep(200);
      expect(widest(await blocked.stop())).toBeGreaterThan(1500);
      const child = join(W, "slow-grade.ts");
      writeFileSync(child, [
        'import { spawnSync } from "node:child_process";',
        'import { readFileSync, writeFileSync } from "node:fs";',
        "const [read, result] = process.argv.slice(2);",
        'const r = JSON.parse(readFileSync(read!, "utf8"));',
        'spawnSync("sleep", ["2"]);',
        'writeFileSync(result!, JSON.stringify({ value: r.read === "grade" ? { planted: [{ id: r.unit.planted[0], runs: ["pass", "pass", "pass"] }], functional: [] } : { catch: true, drop: null } }));',
        "",
      ].join("\n"));
      const tree = join(W, "tree");
      mkdirSync(tree);
      writeFileSync(join(tree, "final.patch"), "");
      const unit = { id: "u000", planted: ["p1"], functional: [] } as unknown as PlantedUnit;
      const grader = plantedGrader({ work: join(W, "work"), child: [process.execPath, child] });
      const graded = poll(served.control);
      const t0 = performance.now();
      const [g, c] = await Promise.all([grader.grade(unit, join(W, "unit"), tree), grader.catchOf(unit, join(W, "unit"), tree)]);
      const took = performance.now() - t0;
      const at = await graded.stop();
      expect(g).toEqual({ planted: [{ id: "p1", runs: ["pass", "pass", "pass"] }], functional: [] });
      expect(c).toEqual({ catch: true, drop: null });
      expect(took).toBeGreaterThan(3900);
      expect(at.length).toBeGreaterThan(20);
      expect(widest(at)).toBeLessThan(1000);
    } finally {
      await served.stop();
      local.close();
    }
  }, 30_000);

  // Value: protects=every build session's open and close; fails_when=a session builds its unit's session image on the
  // stage's event loop while the driver serves, so the driver answers no session until the image is built.
  test("answers while a session starts, because every session image was built before it served", async () => {
    const W = temp();
    const l = ledger(W);
    const fx = plantedUnits(W, 1);
    const id = fx.ids[0]!;
    const unit = "sha256:" + "ab".repeat(32);
    writeFileSync(join(fx.units, id, "eb.json"), JSON.stringify({ schema: EB_SCHEMA, image: { id: unit } }));
    writeFileSync(join(fx.units, id, "task.json"), "{}");
    mkdirSync(join(W, "plans"));
    writeFileSync(join(W, "plans", id + ".md"), "# Plan\n");
    const calls = join(W, "docker");
    mkdirSync(calls);
    const docker = join(W, "docker.sh");
    writeFileSync(docker, [
      "#!/bin/sh",
      'd="$FAKE_DOCKER"',
      'echo "$(date +%s%3N) $1" >> "$d/calls"',
      'for a; do last=$a; done',
      'case "$1" in',
      "  image)",
      '    case "$4" in',
      '      "{{json .RootFS.Layers}}") if [ "$last" = "$FAKE_UNIT" ]; then echo \'["sha256:aa"]\'; else echo \'["sha256:aa","sha256:bb"]\'; fi ;;',
      '      "{{json .RepoTags}}") echo \'[]\' ;;',
      '      "{{.Id}}") echo sha256:5e55 ;;',
      '      *) [ -e "$d/built" ] ;;',
      "    esac ;;",
      "  tag|rmi) ;;",
      '  build) sleep 2; touch "$d/built"; echo "$(date +%s%3N) built $(cat "$FAKE_DRIVER/sessions.jsonl" 2>/dev/null | grep -c \'"event":"launch"\')" >> "$d/calls" ;;',
      "  run)",
      '    while [ $# -gt 0 ] && [ "$1" != --entrypoint ]; do shift; done',
      '    case "$2" in',
      '      claude) echo "$FAKE_CLAUDE (Claude Code)" ;;',
      "      cat) ;;",
      "      sh) echo 0 ;;",
      "      *) exit 1 ;;",
      "    esac ;;",
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"));
    chmodSync(docker, 0o755);
    const harbor = join(W, "harbor.sh");
    writeFileSync(harbor, "#!/bin/sh\nexit 1\n");
    chmodSync(harbor, 0o755);
    const driver = join(W, "driver");
    Object.assign(process.env, { FAKE_DOCKER: calls, FAKE_UNIT: unit, FAKE_CLAUDE: claudePin().version, FAKE_DRIVER: driver });
    const launch = buildLauncher({ arm: "none", units: new Map([[id, { dir: join(fx.units, id) }]]), repos: fx.repos, plans: join(W, "plans"), bundles: null, out: join(W, "out"), host: "127.0.0.1", envelopeHost: "m1", sidecar: "http://127.0.0.1:9", forbidden: [], planned: 1, docker, harbor, runId: EP_RUN, skill: EP_SKILL, serve: { ...serve, dir: driver } });
    const held = await launch({ item: "ep-authoring", capUsd: 50, record: l.record, ledger: l.ledger });
    const real = globalThis.fetch;
    let polled: ReturnType<typeof poll> | null = null;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!polled && url.endsWith("/status")) polled = poll(url.slice(0, -"/status".length), real);
      return real(input, init);
    }) as typeof fetch;
    const start = performance.now();
    let at: number[] = [];
    try {
      await held.backend({ cell: id + "_hinted_-_1", unit: { id }, arm: "none", armName: armName("none"), prompt: "Implement the plan.", attempt: 1 }).catch(() => null);
      await Bun.sleep(300);
      at = await (polled as ReturnType<typeof poll> | null)!.stop();
    } finally {
      globalThis.fetch = real;
      await held.close().catch(() => null);
    }
    const log = readFileSync(join(calls, "calls"), "utf8").split("\n").filter(Boolean).map((x) => ({ what: x.split(" ")[1], launches: x.split(" ")[2] }));
    expect(readFileSync(join(driver, "sessions.jsonl"), "utf8").split("\n").filter((x) => x && JSON.parse(x).event === "launch")).toHaveLength(1);
    expect(log.filter((c) => c.what === "build")).toHaveLength(1);
    expect(log.filter((c) => c.what === "built")).toEqual([{ what: "built", launches: "0" }]);
    expect(at.length).toBeGreaterThan(2);
    expect(widest([start, ...at])).toBeLessThan(1000);
  }, 30_000);
});
