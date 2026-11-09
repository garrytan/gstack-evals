// The review run loop's mount layout: the devex lens mounts the work dir at /work, and every other lens keeps
// /work/<task id>. A fake docker on PATH logs each call's argv, so the -v and -w arguments of setup, the agent
// container and its exec and spawn calls are read as docker would get them, and runTrial's own mount comes from the
// agent container it starts.
import { afterAll, describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CEO_LENS } from "../../../src/trial/review/ceo-outcome.ts";
import { buildDxTree, DX_LENS, DX_MOUNTS, DX_WORK_ROOT, dxMountProblems } from "../../../src/trial/review/devex.ts";
import { PV_LENS } from "../../../src/trial/review/product-value.ts";
import { reviewSandbox, workMount } from "../../../src/trial/review/run.ts";
import { dockerSandbox, processSandbox, type Sandbox } from "../../../src/trial/sandbox.ts";
import { runTrial, type AgentOutcome } from "../../../src/trial/trial.ts";

const TMP = mkdtempSync(join(tmpdir(), "review-mounts-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const TASK = "repo-12-abcdef01";
let n = 0;

function fakeDocker(): { bin: string; calls: () => string[][] } {
  const dir = join(TMP, "docker-" + ++n);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "argv.log");
  writeFileSync(log, "");
  const bin = join(dir, "docker");
  writeFileSync(bin, "#!/bin/sh\nprintf '%s\\037' \"$@\" >> '" + log + "'\nprintf '\\n' >> '" + log + "'\n");
  chmodSync(bin, 0o755);
  return { bin, calls: () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => l.split("\x1f").slice(0, -1)) };
}

const after = (argv: string[], flag: string) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]!] : []));
const closed = (child: ChildProcess) => new Promise<void>((done) => child.on("close", () => done()));

async function drive(sb: Sandbox, work: string) {
  mkdirSync(work, { recursive: true });
  const fixtures = join(TMP, "fixtures");
  mkdirSync(fixtures, { recursive: true });
  sb.step("setup", "true", TASK, { work, fixtures, env: {}, timeoutMs: 10_000 });
  const session = sb.agent(TASK, { work, env: {} });
  session.exec("true", 10_000);
  await closed(session.spawn(["true"]));
  session.stop();
}

function mountsOf(calls: string[][]) {
  return {
    setup: calls.find((c) => c[0] === "run" && !c.includes("-d"))!,
    agent: calls.find((c) => c[0] === "run" && c.includes("-d"))!,
    exec: calls.find((c) => c[0] === "exec" && !c.includes("-i"))!,
    spawn: calls.find((c) => c[0] === "exec" && c.includes("-i"))!,
  };
}

const outcome: AgentOutcome = { turns: [], termination: { kind: "timeout" }, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: null, loaded_bytes: null };

async function trialMount(lens: string | null, seed?: string): Promise<{ v: string[]; w: string[]; work: string }> {
  const docker = fakeDocker();
  const dir = join(TMP, "trial-" + ++n);
  const tasksDir = join(TMP, "tasks-" + n);
  mkdirSync(tasksDir, { recursive: true });
  await runTrial({ cell: { model: "m", arm: "none", round: 1, trial: 0 }, task: { id: TASK, prompt: "p" }, tasksDir, sandbox: reviewSandbox(dockerSandbox({ trialImage: "trial:t", armImage: "arm:a", docker: docker.bin }), lens), agent: { run: async () => outcome }, dir, timeoutS: 30, ...(seed ? { seed } : {}) });
  const start = docker.calls().find((c) => c[0] === "run" && c.includes("-d"))!;
  return { v: after(start, "-v"), w: after(start, "-w"), work: join(dir, "work", TASK) };
}

describe("the review run loop's mount layout", () => {
  for (const [name, lens] of [["code units (no --plan)", null], ["the plan lens ceo", "ceo"], ["ceo-outcome", CEO_LENS], ["product-value", PV_LENS]] as const) {
    // Value: protects=every lens before devex keeps its mounts byte for byte; fails_when=the layout moves any other lens off /work/<task id>; why_new=the devex lens's layout; seam=reviewSandbox, workMount, dockerSandbox, runTrial; no_claim=a real container
    test(name + " mounts the work dir at /work/<task id> for setup, the agent, exec, spawn and runTrial", async () => {
      const today = "/work/" + TASK;
      expect(workMount(lens, TASK)).toBe(today);
      const base = dockerSandbox({ trialImage: "trial:t", armImage: "arm:a", docker: fakeDocker().bin });
      expect(reviewSandbox(base, lens)).toBe(base);
      const docker = fakeDocker();
      const work = join(TMP, "work-" + ++n, TASK);
      const sb = reviewSandbox(dockerSandbox({ trialImage: "trial:t", armImage: "arm:a", docker: docker.bin }), lens);
      expect(sb.workPath(work, TASK)).toBe(today);
      await drive(sb, work);
      const m = mountsOf(docker.calls());
      expect(after(m.setup, "-v")).toEqual([work + ":" + today, join(TMP, "fixtures") + ":/fixtures:ro"]);
      expect(after(m.setup, "-w")).toEqual([today]);
      expect(after(m.agent, "-v")).toEqual([work + ":" + today]);
      expect(after(m.agent, "-w")).toEqual([today]);
      expect(after(m.exec, "-w")).toEqual([today]);
      expect(after(m.spawn, "-w")).toEqual([today]);
      const t = await trialMount(lens);
      expect(t.v).toEqual([t.work + ":" + today]);
      expect(t.w).toEqual([today]);
    });
  }

  // Value: protects=section 5's devex mount: the tree's plan.md and repo/ appear at /work/plan.md and /work/repo with cwd /work, and key.json and alias.json never enter it; fails_when=devex keeps /work/<task id>, cwd is elsewhere, or the tree holds a key; why_new=the devex lens's layout; seam=reviewSandbox, workMount, buildDxTree, runTrial; no_claim=the devex session loop, which is not wired
  test("devex mounts the work dir at /work with cwd /work, so the tree reads as /work/plan.md and /work/repo", async () => {
    const units = join(TMP, "units");
    mkdirSync(join(units, "u1", "repo", "src"), { recursive: true });
    writeFileSync(join(units, "u1", "unit.json"), JSON.stringify({ id: "u1" }));
    writeFileSync(join(units, "u1", "plan.md"), "Add an init command.\n");
    writeFileSync(join(units, "u1", "key.json"), "{}");
    writeFileSync(join(units, "u1", "alias.json"), "{}");
    writeFileSync(join(units, "u1", "repo", "src", "cli.ts"), "export {};\n");
    const tree = buildDxTree(units, "u1", "none", join(TMP, "dx-tree"));
    expect(tree.files).toEqual(["plan.md", "repo/src/cli.ts"]);
    expect(tree.problems).toEqual([]);
    expect(workMount(DX_LENS, TASK)).toBe(DX_WORK_ROOT);
    expect(DX_WORK_ROOT).toBe("/work");
    const docker = fakeDocker();
    const work = join(TMP, "work-" + ++n, TASK);
    const sb = reviewSandbox(dockerSandbox({ trialImage: "trial:t", armImage: "arm:a", docker: docker.bin }), DX_LENS);
    expect(sb.workPath(work, TASK)).toBe("/work");
    await drive(sb, work);
    const m = mountsOf(docker.calls());
    expect(after(m.setup, "-v")).toEqual([work + ":/work", join(TMP, "fixtures") + ":/fixtures:ro"]);
    expect(after(m.setup, "-w")).toEqual(["/work"]);
    expect(after(m.agent, "-v")).toEqual([work + ":/work"]);
    expect(after(m.agent, "-w")).toEqual(["/work"]);
    expect(after(m.exec, "-w")).toEqual(["/work"]);
    expect(after(m.spawn, "-w")).toEqual(["/work"]);
    const t = await trialMount(DX_LENS, join(TMP, "dx-tree"));
    expect(t.v).toEqual([t.work + ":/work"]);
    expect(t.w).toEqual(["/work"]);
    const seen = tree.files.map((f) => "/work/" + f);
    expect(seen).toContain(DX_MOUNTS.plan);
    expect(seen.every((p) => p === DX_MOUNTS.plan || p.startsWith(DX_MOUNTS.repo + "/"))).toBe(true);
    expect(seen.some((p) => /\/(key|alias)\.json$/.test(p))).toBe(false);
    expect(dxMountProblems(tree.files)).toEqual([]);
  });

  // Value: protects=process isolation never runs devex at a wrong path; fails_when=it hands back a sandbox that mounts the host path; why_new=the devex lens's layout; seam=reviewSandbox, processSandbox; no_claim=bubblewrap
  test("process isolation refuses the devex layout, and keeps every other lens as it is", () => {
    const sb = processSandbox({ bwrap: "true" });
    expect(() => reviewSandbox(sb, DX_LENS)).toThrow(/^E_USAGE: .*\/work/);
    expect(reviewSandbox(sb, CEO_LENS)).toBe(sb);
  });
});
