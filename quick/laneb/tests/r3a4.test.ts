import { describe, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armSpec, jobConfig, PROCEDURE_LINES } from "../runner/grid.ts";
import { Ledger, readRows, toMicros } from "../runner/ledger.ts";
import { loadRebenchPool, loadSwebvTasks, materializeRebench, materializeSwebv, R3A4_POOL_FILE, R3A4_POOL_SHA256, treeDigest, type RebenchTask } from "../runner/materialize.ts";
import { A4, allowanceStops, bindCheck, itemCheck, OPUS, poolIds, projectionCheck, R3_ARMS, R3A, R3A4, r3a4Draw, SOL } from "../r3/screen.ts";
import type { R3Trial } from "../r3/exposure.ts";

// R3 amendment 4's build (plan section 8 item 7), keyless.
const here = import.meta.dir;
const laneb = join(here, "..");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const runtime = { runtimeStages: "# stages\n", runtimeCopy: "# copy\n", network: "allowlist" as const };
const proxyConfig = JSON.parse(readFileSync(join(laneb, "config/proxy.json"), "utf8"));
const opus4 = R3A4["r3a4-opus"]!, sol4 = R3A4["r3a4-sol"]!;
const listing = (ids: string[]) => sha([...ids].sort().map((i) => i + "\n").join(""));

// A drop list as r3/drop-list.py writes it, for the given pool ids.
function dropFile(dropped: string[], pool = poolIds()) {
  const kept = pool.filter((id) => !dropped.includes(id));
  const fail = { result: "fail", kind: "reference fails" }, pass = { result: "pass", kind: "pass" };
  const doc = { pool_file_sha256: R3A4_POOL_SHA256, pool_size: pool.length, dropped: dropped.map((task, i) => ({ task, reason: "reference fails", pass1: i % 2 ? pass : fail, pass2: fail })), dropped_ids_sha256: listing(dropped), kept_size: kept.length, kept_ids_sha256: listing(kept) };
  const path = join(tmp("r3a4-drops-"), "r3a4-drop-list.json");
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
  return { path, sha256: sha(readFileSync(path)) };
}

// A SWE-rebench shaped task (no real task text): its own resources and timeouts, three tests/ files and a FROM by tag.
function rebenchFixture() {
  const root = tmp("r3a4-src-"), id = "demo__demo-7", d = join(root, id);
  for (const s of ["environment", "tests", "solution"]) mkdirSync(join(d, s), { recursive: true });
  writeFileSync(join(d, "task.toml"), '[task]\nname = "swe-rebench/demo__demo-7"\n\n[metadata]\ndifficulty = "medium"\n\n[verifier]\ntimeout_sec = 3000\n\n[agent]\ntimeout_sec = 6000\n\n[environment]\nbuild_timeout_sec = 1800.0\ncpus = 2\nmemory = \'8G\'\nstorage = \'16G\'\n');
  writeFileSync(join(d, "environment/Dockerfile"), 'FROM swerebench/sweb.eval.x86_64.demo_1776_demo-7:latest\n\nENV _JAVA_OPTIONS=""\nRUN mkdir -p /logs\n');
  writeFileSync(join(d, "instruction.md"), "Fix the demo.\n");
  writeFileSync(join(d, "solution/solve.sh"), "#!/bin/bash\ntrue\n");
  writeFileSync(join(d, "tests/test.sh"), "#!/bin/bash\nset -euo pipefail\npython3 /tests/parser.py\n");
  writeFileSync(join(d, "tests/config.json"), '{"instance_id": "demo__demo-7"}\n');
  writeFileSync(join(d, "tests/parser.py"), "print('ok')\n");
  const task: RebenchTask = { task_id: id, created: "2026-01", repo: "demo/demo", hub_ref: "", digest: "sha256:" + treeDigest(d), digest_files: 7, image: "swerebench/sweb.eval.x86_64.demo_1776_demo-7:latest", image_digest: "sha256:" + "a".repeat(64) };
  return { root, d, task };
}

describe("the SWE-rebench pool", () => {
  test("the committed pool is 354 tasks created 2025-10 or later, pinned by sha256, with ids, digests and image digests only", () => {
    expect(sha(readFileSync(join(laneb, R3A4_POOL_FILE)))).toBe(R3A4_POOL_SHA256);
    const doc = JSON.parse(readFileSync(join(laneb, R3A4_POOL_FILE), "utf8"));
    const tasks = loadRebenchPool(join(laneb, R3A4_POOL_FILE), R3A4_POOL_SHA256);
    expect(doc.counts).toEqual({ package: 860, window: 361, excluded_memory: 7, pool: 354 });
    expect(doc.dataset.version).toBe("sha256:ebe7444e313a0d8db94fa541139826eaebe2b0abcd4900c6f73e750494910dca");
    expect(tasks).toHaveLength(354);
    expect(tasks.map((t) => t.task_id)).toEqual([...new Set(tasks.map((t) => t.task_id))].sort());
    for (const t of tasks) {
      expect(Object.keys(t).sort()).toEqual(["created", "digest", "digest_files", "hub_ref", "image", "image_digest", "image_media_type", "repo", "task_id"]);
      expect(t.created >= "2025-10").toBe(true);
      expect(t.digest).toBe(t.hub_ref);
      expect(t.image_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(() => loadRebenchPool(join(laneb, "tasks/swebv-r3.json"), R3A4_POOL_SHA256)).toThrow("is not the pinned");
  });
});

describe("the SWE-rebench verifier conversion", () => {
  test("one task materializes offline from a fixture: every tests/ file copied and COPYed, its own resources and timeouts, FROM pinned by digest", () => {
    const { root, d, task } = rebenchFixture();
    const out = join(tmp("r3a4-mat-"), task.task_id);
    const m = materializeRebench(root, task, out, runtime);
    const pinned = "swerebench/sweb.eval.x86_64.demo_1776_demo-7@sha256:" + "a".repeat(64);
    expect(m.image).toBe(pinned);
    for (const f of readdirSync(join(d, "tests"))) expect(existsSync(join(out, "tests", f))).toBe(true);
    expect(readFileSync(join(out, "tests/parser.py"), "utf8")).toBe(readFileSync(join(d, "tests/parser.py"), "utf8"));
    const verifier = readFileSync(join(out, "tests/Dockerfile"), "utf8");
    expect(verifier).toBe(["FROM " + pinned, "WORKDIR /testbed", 'ENV _JAVA_OPTIONS=""', "RUN mkdir -p /logs", "RUN mkdir -p /logs /tests", "COPY test.sh config.json parser.py /tests/", "RUN chmod +x /tests/test.sh", ""].join("\n"));
    expect(readFileSync(join(out, "environment/Dockerfile"), "utf8")).toStartWith("# stages\n\nFROM " + pinned + "\n");
    const toml = readFileSync(join(out, "task.toml"), "utf8");
    expect(toml).toContain("cpus = 2\nmemory = '8G'\nstorage = '16G'");
    expect(toml).toContain('[agent]\ntimeout_sec = 6000.0\nnetwork_mode = "allowlist"');
    expect(toml).toContain('[verifier]\ntimeout_sec = 3000.0\nenvironment_mode = "separate"');
    expect(toml).toContain('laneb_source = "swe-rebench leaderboard Hub package, converted to a separate verifier"');
  });

  test("a task that differs from its digest, or whose FROM is not the pool's image, is refused before it is materialized", () => {
    const { root, d, task } = rebenchFixture();
    writeFileSync(join(d, "tests/parser.py"), "print('changed')\n");
    expect(() => materializeRebench(root, task, join(root, "out"), runtime)).toThrow("differs from swerebench-r3a4.json");
    expect(existsSync(join(root, "out"))).toBe(false);
    const f = rebenchFixture();
    expect(() => materializeRebench(f.root, { ...f.task, image: "swerebench/other:latest" }, join(f.root, "out"), runtime)).toThrow("not swerebench-r3a4.json's");
  });

  test("Verified's conversion keeps its bytes: test.sh and config.json, the uv install and the 4G and 10G defaults", () => {
    const fixtures = join(here, "fixtures/swebv");
    const fx = JSON.parse(readFileSync(join(fixtures, "digests.json"), "utf8"));
    const [task] = loadSwebvTasks(join(fixtures, "band.txt"), join(fixtures, "digests.json"), fx.band_sha256);
    const out = join(tmp("r3a4-swebv-"), task!.task_id);
    materializeSwebv(fixtures, task!, out, runtime);
    expect(readFileSync(join(out, "tests/Dockerfile"), "utf8")).toBe(["FROM python:3.12-slim", "WORKDIR /testbed", "RUN curl -LsSf https://astral.sh/uv/0.7.13/install.sh | sh", "RUN mkdir -p /logs /tests", "COPY test.sh config.json /tests/", "RUN chmod +x /tests/test.sh", ""].join("\n"));
    const toml = readFileSync(join(out, "task.toml"), "utf8");
    expect(toml).toContain("cpus = 1\nmemory = '4G'\nstorage = '10G'");
    expect(toml).toContain('laneb_source = "harbor-datasets swebench-verified, converted to a separate verifier"');
    expect(readdirSync(join(out, "tests")).sort()).toEqual(["Dockerfile", "config.json", "test.sh"]);
  });
});

describe("the draw", () => {
  test("200 screen tasks and 10 pilot tasks are a pure function of the pool, the drop list and the seeds", () => {
    const pool = poolIds(), gone = pool.slice(0, 20);
    const f = dropFile(gone);
    const a = r3a4Draw(f.path, f.sha256), b = r3a4Draw(f.path, f.sha256);
    expect(a).toEqual(b);
    expect(a.screen).toHaveLength(200);
    expect(new Set(a.screen).size).toBe(200);
    expect(a.screen.some((id) => gone.includes(id))).toBe(false);
    expect(a.pilot).toHaveLength(10);
    expect(a.pilot.every((id) => a.screen.includes(id))).toBe(true);
    expect([...a.parts["screen-a"]!, ...a.parts["screen-b"]!]).toEqual(a.screen);
    expect(a.parts["screen-a"]).toHaveLength(100);
    const other = dropFile(pool.slice(20, 40));
    expect(r3a4Draw(other.path, other.sha256).screen).not.toEqual(a.screen);
  });

  test("a drop list with the wrong sha256, a task outside the pool, or more than a quarter of the pool dropped is refused", () => {
    const pool = poolIds();
    const f = dropFile(pool.slice(0, 3));
    expect(() => r3a4Draw(f.path, "0".repeat(64))).toThrow("is not the run record's");
    expect(() => r3a4Draw(f.path, "")).toThrow("E_USAGE");
    const stray = dropFile(["nobody__nothing-1"]);
    expect(() => r3a4Draw(stray.path, stray.sha256)).toThrow("is not a pool task");
    const many = dropFile(pool.slice(0, 89));
    expect(() => r3a4Draw(many.path, many.sha256)).toThrow("more than a quarter");
    const most = dropFile(pool.slice(0, 88));
    expect(r3a4Draw(most.path, most.sha256).screen).toHaveLength(200);
  });
});

describe("the told prompt with the procedure line", () => {
  const line = "Work through /investigate's phases in order, and finish with its DEBUG REPORT.";
  test("told and placebo get the line after a blank line, and the none prompt is the told prompt minus the slash command and the line, byte for byte", () => {
    const py = ["import json, sys", "sys.path.insert(0, sys.argv[1])", "from prompt_builder import PROCEDURE_LINES, build_prompt", "w = open(sys.argv[2]).read()",
      "print(json.dumps({'lines': PROCEDURE_LINES, 'none': build_prompt(w, 'Fix it.', False, ''), 'told': build_prompt(w, 'Fix it.', True, 'investigate', procedure_line='investigate-phases')}))"].join("\n");
    const r = Bun.spawnSync(["python3", "-c", py, join(laneb, "runner/agent"), join(laneb, "runner/prompt-wrapper.md")]);
    expect(r.stderr.toString()).toBe("");
    const out = JSON.parse(r.stdout.toString());
    expect(out.lines).toEqual(PROCEDURE_LINES);
    expect(PROCEDURE_LINES["investigate-phases"]).toBe(line);
    const told: string = out.told, none: string = out.none;
    expect(told).toBe("/investigate " + none + "\n" + line + "\n");
    expect(none.endsWith("</task>\n")).toBe(true);
    expect(told.slice("/investigate ".length, told.length - ("\n" + line + "\n").length)).toBe(none);
    expect(sha(line)).toBe(createHash("sha256").update(PROCEDURE_LINES["investigate-phases"]).digest("hex"));
  });

  test("the new told and placebo arms carry the line to the agent; none, the old arms and a line without told do not", () => {
    const cells = JSON.parse(readFileSync(join(laneb, "config", A4.cells), "utf8"));
    const job = jobConfig({ job_name: "j", tasks_dir: "/t", tasks: ["x"], attempts: 1, n_concurrent: Number(A4.concurrent), agent_dir: "/a", runner_dir: "/r", base_url: "http://g:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2,
      models: [cells.models.find((m: any) => m.id === OPUS)], arms: [R3_ARMS.none, R3_ARMS.toldLine, R3_ARMS.placeboLine, R3_ARMS.gstack].map((a) => ({ ...armSpec(a), tar: "t", sha256: "s" })) });
    expect(job.n_concurrent_trials).toBe(6);
    expect(job.agents.map((a) => [a.kwargs.arm, (a.kwargs as any).told_skill ?? null, (a.kwargs as any).procedure_line ?? null, a.kwargs.session_cap_usd])).toEqual([
      ["none", null, null, 12], ["gstack", "investigate", "investigate-phases", 12], ["placebo", "investigate", "investigate-phases", 12], ["gstack", "investigate", null, 12],
    ]);
    expect(() => armSpec("none:procedure_line=investigate-phases")).toThrow("needs told");
    expect(() => armSpec("gstack:told=investigate:procedure_line=other")).toThrow("E_USAGE");
    expect(cells.models.map((m: any) => [m.id, m.session_cap_usd])).toEqual([["claude-opus-5-5", 12], ["particle-1", 3], ["gpt-6.1-sol", 12]]);
  });

  test("every new arm, under the real pinned Agent SDK, sends its prompt with CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 and the preset", () => {
    const pin = readFileSync(join(laneb, "runner/vm-bootstrap.sh"), "utf8").match(/^SDK_PIN=(\S+)$/m)![1];
    const python = join(tmpdir(), "laneb-claude-agent-sdk-" + pin, "bin/python");
    if (!existsSync(python) || Bun.spawnSync([python, "-c", 'import claude_agent_sdk as s; assert s.__version__ == "' + pin + '"']).exitCode !== 0) {
      const install = Bun.spawnSync(["sh", "-c", 'python3 -m venv --clear "$1" && "$1/bin/pip" install -q "claude-agent-sdk==$2"', "sh", join(tmpdir(), "laneb-claude-agent-sdk-" + pin), pin]);
      expect(install.exitCode).toBe(0);
    }
    const cells = JSON.parse(readFileSync(join(laneb, "config", A4.cells), "utf8"));
    const cellArms: [string, string[]][] = [[OPUS, [R3_ARMS.none, R3_ARMS.toldLine]], [SOL, [R3_ARMS.none, R3_ARMS.toldLine]], ["particle-1", [R3_ARMS.none, R3_ARMS.toldLine, R3_ARMS.placeboLine]]];
    const kwargs = cellArms.flatMap(([model, arms]) => jobConfig({ job_name: "r3a4", tasks_dir: "/run/tasks", tasks: ["x"], attempts: 1, n_concurrent: 6, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://g:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2, repo_dir: "/testbed",
      models: [cells.models.find((m: any) => m.id === model)], arms: arms.map((a) => ({ ...armSpec(a), tar: "/run/arms/x.tar", sha256: "x" })) }).agents.map((a) => a.kwargs));
    const agents = join(tmp("r3a4-agents-"), "agents.json");
    writeFileSync(agents, JSON.stringify(kwargs));
    const r = Bun.spawnSync([python, join(here, "agent_r3_sdk_test.py")], { env: { ...process.env, PYTHONPATH: [join(laneb, "runner/agent"), here].join(":"), R3_AGENTS: agents } });
    const out = r.stdout.toString() + r.stderr.toString();
    if (r.exitCode !== 0) console.log(out);
    expect(out).not.toContain("FAIL");
    expect(out.match(/^pass arm /gm)).toHaveLength(7);
  }, 600_000);
});

describe("the new items", () => {
  const approve = (path: string, item: string, cap: number) => new Ledger(path, item).approve(cap, { words: "test", by: "test" });
  test("r3a4-opus binds only at $550 and r3a4-sol only at $700, each on its own ledger port, and the old items are unchanged", () => {
    for (const [m, cap] of [[opus4, 550], [sol4, 700]] as const) {
      for (const wrong of [cap - 1, cap + 1, 150, 140]) {
        const p = join(tmp("r3a4-cap-"), m.item + ".jsonl");
        approve(p, m.item, wrong);
        expect(() => itemCheck(p, m)).toThrow(`not amendment 4's $${cap}`);
      }
      const p = join(tmp("r3a4-cap-"), m.item + ".jsonl");
      approve(p, m.item, cap);
      expect(() => itemCheck(p, m)).not.toThrow();
    }
    expect([opus4.ledgerPort, sol4.ledgerPort, R3A[OPUS]!.ledgerPort, R3A[SOL]!.ledgerPort]).toEqual(["9913", "9914", "9911", "9912"]);
    expect([R3A[OPUS]!.item, R3A[OPUS]!.capUsd, R3A[SOL]!.item, R3A[SOL]!.capUsd]).toEqual(["r3a-screen", 150, "r3a-sol", 140]);
    expect(opus4.parts.map((p) => [p.name, p.arm])).toEqual([["screen-a", R3_ARMS.none], ["screen-b", R3_ARMS.none], ["pilot", R3_ARMS.toldLine]]);
  });

  test("r3a4-sol needs its own route check: a pass recorded for r3a-sol is refused on it", () => {
    const p = join(tmp("r3a4-route-"), "r3a4-sol.jsonl");
    approve(p, "r3a4-sol", 700);
    expect(() => bindCheck(p, sol4, [join(laneb, "config/proxy.json")])).toThrow("has not passed its route check on r3a4-sol");
    writeFileSync(p + ".route.json", JSON.stringify({ item: "r3a-sol", model: SOL, verdict: "pass", reason: "a1", incomplete: null, proxy_config_sha256: sha(readFileSync(join(laneb, "config/proxy.json"))) }));
    expect(() => bindCheck(p, sol4, [join(laneb, "config/proxy.json")])).toThrow("is for gpt-6.1-sol on r3a-sol, not gpt-6.1-sol on r3a4-sol");
    expect(sol4.routePrefix).toBe("r3a4-sol-route/");
  });
});

type T = { task: string; model?: string; arm?: string; told?: string; line?: boolean; reward?: number | null; spent?: number; budget?: boolean; shown?: boolean };
function writeTrial(jobs: string, sessions: string, t: T, i: number) {
  const name = t.task.slice(0, 20) + "__" + i, d = join(jobs, "job", name), model = t.model ?? OPUS;
  mkdirSync(join(d, "evaluator"), { recursive: true });
  writeFileSync(join(d, "config.json"), JSON.stringify({ task: { path: "/vm/run/tasks/" + t.task }, agent: { name: "laneb-claude-code", kwargs: { arm: t.arm ?? "none", upstream_model: model, ...(t.told ? { told_skill: t.told, procedure_line: "investigate-phases" } : {}) } } }));
  writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, verifier_result: { rewards: { reward: t.reward ?? 0 } }, exception_info: null }));
  writeFileSync(join(d, "evaluator/sdk-messages.jsonl"), JSON.stringify({ type: "AssistantMessage", content: [{ text: t.shown ? "Phase 1\nDEBUG REPORT" : "Fixed it." }] }) + "\n");
  writeFileSync(sessions, JSON.stringify({ id: "s" + i, trial: name + "__env", model, spent_micros: toMicros(t.spent ?? 1), ok_responses: 3, requests: 4, refused: t.budget ? 1 : 0, refused_budget: t.budget ? 1 : 0, opened_at: "2026-11-04T00:00:00Z", closed_at: "2026-11-04T01:00:00Z", cmd_expanded: !!t.told, cmd_names: t.told ? ["investigate"] : [] }) + "\n", { flag: "a" });
}
// A prepared and pulled amendment 4 work dir: fails none trials failed across screen-a and screen-b, exposed pilot trials shown.
function work4(m = opus4, o: { fails?: number; exposed?: number; skipB?: boolean } = {}) {
  const w = tmp("r3a4-work-"), ledger = join(w, m.item + ".jsonl");
  new Ledger(ledger, m.item).approve(m.capUsd, { words: "test", by: "test" });
  const f = dropFile(poolIds().slice(0, 12));
  const d = r3a4Draw(f.path, f.sha256);
  writeFileSync(join(w, "plan.json"), JSON.stringify({ item: m.item, pool_sha256: R3A4_POOL_SHA256, drops_sha256: f.sha256, part_tasks: d.parts }));
  let k = 0;
  for (const part of m.parts) {
    if (o.skipB && part.name === "screen-b") { writeFileSync(join(w, "screen-b.projection-stop"), "screen-a: projection $600.00 passes the cap\n"); continue; }
    const dir = join(w, part.name);
    mkdirSync(join(dir, "pulled/out"), { recursive: true });
    writeFileSync(join(dir, "proxy.json"), JSON.stringify(proxyConfig));
    writeFileSync(join(dir, "pulled/out/proxy-sessions.jsonl"), "");
    d.parts[part.name]!.forEach((task, i) => {
      const t: T = part.name === "pilot" ? { task, model: m.id, arm: "gstack", told: "investigate", shown: i < (o.exposed ?? 8), reward: 1, spent: 2 } : { task, model: m.id, reward: k++ < (o.fails ?? 40) ? 0 : 1, budget: part.name === "screen-a" && i < 2 };
      writeTrial(join(dir, "pulled/jobs"), join(dir, "pulled/out/proxy-sessions.jsonl"), t, i);
    });
    writeFileSync(join(w, part.name + ".launch-exit"), "0\n");
  }
  return { w, ledger, drops: f };
}
function analyze4(x: ReturnType<typeof work4>, m = opus4) {
  const r = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "analyze", x.w, "--item", m.item], { env: { ...process.env, LEDGER: x.ledger, DROPS: x.drops.path, DROPS_SHA256: x.drops.sha256 } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString(), record: existsSync(join(x.w, "record.json")) ? JSON.parse(readFileSync(join(x.w, "record.json"), "utf8")) : null };
}

describe("amendment 4's screen", () => {
  test("30 admitted and 7 of 10 exposed pass admission; the record keeps allowance stops per part and arm", () => {
    const a = analyze4(work4(opus4, { fails: 30, exposed: 7 }));
    expect(a.code).toBe(0);
    expect(a.out).toContain("admission: 30 of 200 graded screen tasks unsolved by Opus 5.5 none (0 infra); pilot exposure 7 of 10 graded told trials");
    expect(a.out).toContain("R3b start: 30 tasks");
    expect(a.out).toContain("projection r3b4-opus");
    expect(a.record.allowance_stops).toEqual({ "screen-a": { none: 2 }, "screen-b": { none: 0 }, pilot: { gstack: 0 } });
  });

  test("29 admitted is saturation on SWE-rebench, and 6 of 10 exposed is pilot FIX-METHOD, for each model", () => {
    for (const m of [opus4, sol4]) {
      const x = work4(m, { fails: 29 });
      const s = analyze4(x, m);
      expect(s.code).toBe(5);
      expect(s.out).toContain(`R3 outcome${m.tag}: STOP (saturation). Only 29 screen tasks are unsolved by ${m.label} with no skill, fewer than 30, so told /investigate with the procedure line can't be tested on ${m.label} on SWE-rebench.`);
      const p = analyze4(work4(m, { exposed: 6 }), m);
      expect(p.code).toBe(6);
      expect(p.out).toContain("Told /investigate with the procedure line ran its procedure in 6 of 10 pilot trials, under 7");
    }
  });

  test("a screen-b that the projection stopped makes R3a incomplete and prints no admission count", () => {
    const a = analyze4(work4(opus4, { skipB: true }));
    expect(a.code).toBe(4);
    expect(a.out).toContain("R3 outcome: none (incomplete: screen-b was not launched: screen-a: projection $600.00 passes the cap)");
    expect(a.out).not.toMatch(/admission|admitted/);
    expect(a.record.outcome).toBe("incomplete");
  });

  test("a plan whose draw is not the one DROPS gives is refused", () => {
    const x = work4();
    const other = dropFile(poolIds().slice(0, 13));
    const r = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "analyze", x.w, "--item", "r3a4-opus"], { env: { ...process.env, LEDGER: x.ledger, DROPS: other.path, DROPS_SHA256: other.sha256 } });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("plan.json's draw is not the seed 20261104 and 20261105 draw");
  });

  test("the projection check after screen-a reads cost only: over the cap it stops before screen-b, and it never names an admission count", () => {
    const rows = [{ ts: "", item: "r3a4-opus", kind: "approval" as const, id: "approval", usd_micros: 550e6 },
      ...Array.from({ length: 100 }, (_, i) => ({ ts: "", item: "r3a4-opus", kind: "settle" as const, id: "r3a4-opus-screen-a/s-" + i, usd_micros: toMicros(2.5) })),
      { ts: "", item: "r3a4-opus", kind: "settle" as const, id: "r3a4-opus-screen-a/vm", usd_micros: toMicros(2.4) },
      { ts: "", item: "r3a4-opus", kind: "settle" as const, id: "r3a4-opus-route/x", usd_micros: toMicros(50) }];
    const trials = Array.from({ length: 100 }, () => ({ cost_usd: 2 }) as R3Trial);
    const over = projectionCheck(rows, trials, opus4, 2.4);
    expect(over.record.screen_a_settled_usd).toBeCloseTo(252.4, 6);
    expect(over.record.projection_usd).toBeCloseTo(252.4 * 2 + 10 * 5 + 2 * 2.4 + 72, 6);
    expect(over.over).toBe(true);
    expect(over.line).toContain("passes r3a4-opus's $550 cap; the run stops before screen-b");
    expect(over.line).not.toMatch(/admi|unsolved|fail/);
    const fits = projectionCheck(rows.slice(0, 51), Array.from({ length: 50 }, () => ({ cost_usd: 6 }) as R3Trial), opus4, 2.4);
    expect(fits.record.pilot_session_usd).toBe(12);
    expect(fits.over).toBe(false);
    expect(fits.line).toContain("fits r3a4-opus's $550 cap; screen-b starts");
  });

  test("allowance stops count per part and arm", () => {
    const t = (arm: string, budget_stop: boolean) => ({ arm, budget_stop }) as R3Trial;
    expect(allowanceStops([{ part: opus4.parts[2]!, trials: [t("gstack", true), t("gstack", false), t("none", true)] }])).toEqual({ pilot: { gstack: 1, none: 1 } });
  });
});


// Plan section 5 (F1): a cap raise recorded on the item's ledger resumes screen-b and the pilot on the same item.
describe("resuming screen-b after a recorded cap raise", () => {
  const words = { words: "test raise", by: "test" };
  test("Ledger.raise appends a higher cap that the ledger then enforces; no approval, or a cap at or under the current one, is refused", () => {
    const p = join(tmp("r3a4-raise-"), "r3a4-opus.jsonl");
    const l = new Ledger(p, "r3a4-opus");
    expect(() => l.raise(600, words)).toThrow("no approval row");
    l.approve(550, words);
    expect(() => l.approve(600, words)).toThrow("approval row already present");
    expect(l.reserve("a", toMicros(549))).toEqual({ ok: true, existing: false });
    expect(l.reserve("b", toMicros(2))).toMatchObject({ ok: false, reason: "cap" });
    for (const low of [550, 549]) expect(() => l.raise(low, words)).toThrow("is not above the current cap");
    l.raise(800, words);
    expect(l.status().capMicros).toBe(toMicros(800));
    expect(l.reserve("b", toMicros(2))).toEqual({ ok: true, existing: false });
    expect(() => l.raise(800, words)).toThrow("is not above the current cap");
    expect(readRows(p).filter((r) => r.kind === "approval").map((r) => [r.id, r.usd_micros, r.raised_from_micros ?? null, r.words])).toEqual([["approval", 550e6, null, "test raise"], ["raise-1", 800e6, 550e6, "test raise"]]);
  });

  test("ledger.ts raise appends the raise with its approver; no --approved-by is a usage error and a cap at or under the current one is refused", () => {
    const p = join(tmp("r3a4-raise-"), "r3a4-opus.jsonl");
    new Ledger(p, "r3a4-opus").approve(550, words);
    const cli = (...a: string[]) => Bun.spawnSync([process.execPath, join(laneb, "runner/ledger.ts"), "raise", "--path", p, "--item", "r3a4-opus", ...a]);
    expect(cli("--usd", "800").exitCode).toBe(2);
    const low = cli("--usd", "550", "--approved-by", "GSTA-2");
    expect([low.exitCode, low.stdout.toString().includes("is not above the current cap")]).toEqual([3, true]);
    const ok = cli("--usd", "800", "--approved-by", "GSTA-2", "--detail", "approvals/r3a4-opus-raise.md");
    expect([ok.exitCode, JSON.parse(ok.stdout.toString())]).toEqual([0, { ok: true, cap_usd: 800 }]);
    expect(readRows(p).filter((r) => r.kind === "approval").at(-1)).toMatchObject({ id: "raise-1", usd_micros: 800e6, raised_from_micros: 550e6, approved_by: "GSTA-2", detail: "approvals/r3a4-opus-raise.md" });
    expect(new Ledger(p, "r3a4-opus").status().capMicros).toBe(toMicros(800));
  });

  test("a raise whose item is not the first approval row's item is refused and leaves the file unchanged, through the class and the CLI", () => {
    const p = join(tmp("r3a4-raise-"), "r3a4-opus.jsonl");
    const cli = (item: string) => Bun.spawnSync([process.execPath, join(laneb, "runner/ledger.ts"), "raise", "--path", p, "--item", item, "--usd", "800", "--approved-by", "GSTA-2"]);
    const none = cli("r3a4-opus");
    expect([none.exitCode, none.stdout.toString().includes("no approval row")]).toEqual([3, true]);
    expect(existsSync(p)).toBe(false);
    new Ledger(p, "r3a4-opus").approve(550, words);
    const before = readFileSync(p);
    expect(() => new Ledger(p, "r3a4-oracle").raise(800, words)).toThrow("ledger's approval row is for item r3a4-opus, not r3a4-oracle");
    const wrong = cli("r3a4-oracle");
    expect([wrong.exitCode, wrong.stdout.toString().includes("ledger's approval row is for item r3a4-opus, not r3a4-oracle")]).toEqual([3, true]);
    expect(readFileSync(p).equals(before)).toBe(true);
    expect(new Ledger(p, "r3a4-opus").status().capMicros).toBe(toMicros(550));
    const ok = cli("r3a4-opus");
    expect([ok.exitCode, JSON.parse(ok.stdout.toString())]).toEqual([0, { ok: true, cap_usd: 800 }]);
    const rows = readRows(p);
    expect(rows.length).toBe(2);
    expect(rows[1]).toMatchObject({ item: "r3a4-opus", kind: "approval", id: "raise-1", usd_micros: 800e6, raised_from_micros: 550e6, approved_by: "GSTA-2" });
  });

  test("an item whose ledger holds a raise before its run is refused at prepare and run", () => {
    const p = join(tmp("r3a4-raise-"), "r3a4-opus.jsonl");
    new Ledger(p, "r3a4-opus").approve(550, words);
    new Ledger(p, "r3a4-opus").raise(800, words);
    expect(() => itemCheck(p, opus4)).toThrow("holds a cap raise before its run");
  });

  // A bound item whose run stopped after screen-a: settledEach x 100 settled on screen-a, so the projection is
  // 2 x 100 x settledEach + 10 x $2.50 + 2 x $4 + $72, over the $550 cap.
  function stopped(o: { raise?: number; settledEach?: number } = {}) {
    const x = work4(opus4, { skipB: true });
    rmSync(join(x.w, "pilot"), { recursive: true, force: true });
    rmSync(join(x.w, "pilot.launch-exit"), { force: true });
    for (const part of ["screen-b", "pilot"]) mkdirSync(join(x.w, part), { recursive: true });
    const l = new Ledger(x.ledger, opus4.item);
    for (let i = 0; i < 100; i++) {
      l.reserve("r3a4-opus-screen-a/s-" + i, toMicros(o.settledEach ?? 5.48));
      l.settle("r3a4-opus-screen-a/s-" + i, toMicros(o.settledEach ?? 5.48));
    }
    writeFileSync(x.ledger + ".bound", JSON.stringify({ item: opus4.item, work: x.w, at: "2026-11-04T00:00:00Z" }) + "\n");
    if (o.raise) l.raise(o.raise, words);
    return x;
  }
  const env = (x: ReturnType<typeof work4>) => ({ ...process.env, LEDGER: x.ledger, DROPS: x.drops.path, DROPS_SHA256: x.drops.sha256, VM_USD_PER_HOUR: "1", UBICLOUD_API_KEY: "test-not-a-key", UBI_RUNNER: "/bin/false", UBI_OWNER: "test", LEDGER_PORT: String(20000 + Math.floor(Math.random() * 20000)), ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" });
  const screen = (cmd: string, x: ReturnType<typeof work4>) => {
    const r = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), cmd, x.w, "--item", opus4.item], { env: env(x) });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };
  const launched = (x: ReturnType<typeof work4>) => readRows(x.ledger).filter((r) => r.id.startsWith("r3a4-opus-screen-b/") || r.id.startsWith("r3a4-opus-pilot/"));

  test("with no raise recorded, resume refuses and launches nothing", () => {
    const x = stopped();
    const r = screen("resume", x);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no cap raise is recorded on");
    expect(existsSync(join(x.w, "screen-b.launch-exit"))).toBe(false);
    expect(existsSync(join(x.w, "screen-b.projection-stop"))).toBe(true);
    expect(launched(x)).toEqual([]);
  });

  test("with a raise recorded, resume relaunches screen-b on the same item at the raised cap, once", () => {
    const x = stopped({ raise: 1300 });
    const r = screen("resume", x);
    expect(r.out).toContain("screen-a: projection $1201.00");
    expect(r.out).toContain("fits r3a4-opus's $1300 cap; screen-b starts");
    expect(readFileSync(join(x.w, "screen-b.launch-exit"), "utf8").trim()).toBe("1");
    // $548 is settled, so screen-b's $4 VM block fits only the raised cap.
    expect(launched(x).map((row) => [row.id, row.kind])).toEqual([["r3a4-opus-screen-b/vm", "reserve"], ["r3a4-opus-screen-b/vm", "settle"]]);
    expect(existsSync(join(x.w, "pilot.launch-exit"))).toBe(false);
    expect(existsSync(join(x.w, "screen-b.projection-stop"))).toBe(false);
    expect(JSON.parse(readFileSync(join(x.w, "cap-raise.json"), "utf8"))).toMatchObject({ raise: { id: "raise-1", usd_micros: 1300e6, raised_from_micros: 550e6 }, projection: { cap_usd: 1300, over: false } });
    const again = screen("resume", x);
    expect(again.code).toBe(1);
    expect(again.err).toContain("has no screen-b.projection-stop");
    expect(screen("run", x).err).toContain("r3a4-opus is already bound to a run");
    expect(launched(x)).toHaveLength(2);
    const a = screen("analyze", x);
    expect(a.code).toBe(4);
    expect(a.out).toContain("incomplete: screen-b's launch exited 1");
    expect(JSON.parse(readFileSync(join(x.w, "record.json"), "utf8")).cap_raise.raise.id).toBe("raise-1");
  });

  test("a launch that stops before screen-b starts puts the projection stop back, so resume can run again", () => {
    const x = stopped({ raise: 1300 });
    // A bash first on PATH whose first port check finds the port free and every later one finds it taken.
    const bin = tmp("r3a4-bash-");
    writeFileSync(join(bin, "bash"), '#!/bin/bash\nif [ "$1" = -c ] && [[ "$2" == *"/dev/tcp/"* ]]; then\n  n=$(( $(cat "$0.calls" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$0.calls"\n  [ "$n" -ge 2 ]; exit\nfi\nexec /bin/bash "$@"\n');
    chmodSync(join(bin, "bash"), 0o755);
    const r = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "resume", x.w, "--item", opus4.item], { env: { ...env(x), PATH: bin + ":" + process.env.PATH } });
    expect(r.stdout.toString()).toContain("screen-b: something already answers on 127.0.0.1:");
    expect(readFileSync(join(bin, "bash.calls"), "utf8").trim()).toBe("2");
    expect(existsSync(join(x.w, "screen-b.launch-exit"))).toBe(false);
    expect(existsSync(join(x.w, "screen-b.projection-stop"))).toBe(true);
    expect(existsSync(join(x.w, "screen-b.projection-stop.raised"))).toBe(false);
    expect(launched(x)).toEqual([]);
    screen("resume", x);
    expect(readFileSync(join(x.w, "screen-b.launch-exit"), "utf8").trim()).toBe("1");
    expect(existsSync(join(x.w, "screen-b.projection-stop"))).toBe(false);
  });

  test("a raise the projection still passes is refused, and so is a resume from another work dir", () => {
    const x = stopped({ raise: 1200 });
    const r = screen("resume", x);
    expect(r.code).toBe(1);
    expect(r.err).toContain("still passes r3a4-opus's raised $1200 cap");
    expect(existsSync(join(x.w, "screen-b.projection-stop"))).toBe(true);
    expect(launched(x)).toEqual([]);
    const y = stopped({ raise: 1300 });
    writeFileSync(y.ledger + ".bound", JSON.stringify({ item: opus4.item, work: "/elsewhere", at: "2026-11-04T00:00:00Z" }) + "\n");
    const other = screen("resume", y);
    expect(other.code).toBe(1);
    expect(other.err).toContain("is bound to the run in /elsewhere");
    expect(launched(y)).toEqual([]);
  });
});

