import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODELS } from "../../lanes/day-one/frozen.ts";
import { DAYONE_RUN } from "../../lanes/day-one/ledger.ts";
import { attemptOutcome, launchSession, RAM_FULL_CHECK } from "../../lanes/day-one/sessions.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";

const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;

/** A rig that binds slots and meters nothing; the sessions below never start a container. */
const stubRig = (): HostRig => {
  let n = 0;
  return {
    baseUrl: "http://proxy",
    network: "none",
    imageDigest: null,
    bind: async () => ({ slot: "s" + ++n, token: "t" + n, meter_id: "m" + n }) as never,
    finalize: async () => ({ micros: 0, requests: 0, refused: 0 }) as never,
    arms: {},
    sandbox: () => ({ homePath: () => "/home/agent", workPath: () => "/work/app", agent: () => { throw new Error("no container starts here"); } }) as never,
    judgeSandbox: () => ({}) as never,
    egress: () => ({ open: false, detail: "" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
  };
};

/** One session whose transcript holds the given tool calls, through launchSession with a stub driver and trial. */
async function session(dir: string, arm: string, calls: { name: string; input: Record<string, string> }[]) {
  const d = join(dir, arm);
  mkdirSync(d, { recursive: true });
  const transcript = calls.map((c, i) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "c" + i, name: c.name, input: c.input }] } }) + "\n").join("");
  const trial = async () => {
    mkdirSync(join(d, "host"), { recursive: true });
    writeFileSync(join(d, "host", "transcript.ndjson"), transcript);
    mkdirSync(join(d, "out"), { recursive: true });
    return { record: { termination: { kind: "completed" } } };
  };
  return launchSession(
    { rig: stubRig(), policy, docker: "docker", runId: DAYONE_RUN, arm, cell: "u-r1-" + arm, rep: 1, attempt: 1, model: arm === "check" ? MODELS.checker : MODELS.planner, dir: d, seed: null, prompt: "p", minutes: 1, turns: 1, allowanceMicros: 1e6, nextUser: async () => ({ end: true }) },
    { driver: (() => ({ env: {} })) as never, trial: trial as never },
  );
}

describe("the gstack-read check (prereg section 8)", () => {
  test("marks N, D and R planning sessions, and never a build or check session that only names gstack while it reads an /autoplan plan", async () => {
    const dir = mkdtempSync(join(tmpdir(), "day-one-reads-"));
    try {
      const calls: { name: string; input: Record<string, string> }[] = [
        { name: "Read", input: { file_path: "/work/app/plan.md" } },
        { name: "Bash", input: { command: "grep -n 'gstack-autoplan' plan.md" } },
      ];
      for (const arm of ["n", "d", "r"]) {
        const read = await session(dir, arm, calls);
        expect(read.gstack_reads).toEqual(["Bash grep -n 'gstack-autoplan' plan.md"]);
        expect(attemptOutcome(read, null).state).toBe("contaminated");
      }
      for (const arm of ["build", "check"]) {
        const read = await session(dir, arm, calls);
        expect(read.gstack_reads).toEqual([]);
        expect(attemptOutcome(read, null).state).not.toBe("contaminated");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the voice bearer check (prereg section 7)", () => {
  test("compares the container's OPENAI_API_KEY with the voice slot's bearer without any form of the bearer in an exec argument", async () => {
    const dir = mkdtempSync(join(tmpdir(), "day-one-bearer-"));
    try {
      const docker = join(dir, "docker");
      writeFileSync(docker, "#!/bin/sh\necho '[]'\n");
      chmodSync(docker, 0o755);
      const run = async (name: string, inContainer: (voiceToken: string) => string) => {
        const tokens: string[] = [];
        const execs: { command: string; input: string | undefined }[] = [];
        let n = 0;
        const session = {
          exec: (command: string, _timeoutMs: number, input?: string) => {
            execs.push({ command, input });
            if (command === RAM_FULL_CHECK) return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
            if (command.startsWith("hostname;")) return { exitCode: 0, timedOut: false, stdout: "c1\n---gse-probe---\nOPENAI_API_KEY\nANTHROPIC_AUTH_TOKEN\n---gse-probe---\n000 exit=7", stderr: "" };
            const r = spawnSync("sh", ["-c", command], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", OPENAI_API_KEY: inContainer(tokens[1]!) }, input: input ?? "", encoding: "utf8" });
            return { exitCode: r.status, timedOut: false, stdout: r.stdout, stderr: r.stderr };
          },
          spawn: () => {
            throw new Error("no process starts here");
          },
          stop: () => {},
        };
        const rig = {
          ...stubRig(),
          bind: async () => {
            const token = "slot-" + ++n + "-" + randomBytes(16).toString("hex");
            tokens.push(token);
            return { slot: "s" + n, token, meter_id: "m" + n };
          },
          arms: { a: { skill: null } },
          sandbox: () => ({ homePath: () => "/home/agent", workPath: () => "/work/app", agent: () => session }),
        } as unknown as HostRig;
        const d = join(dir, name);
        mkdirSync(d, { recursive: true });
        const trial = async (spec: { sandbox: { agent: (t: string, o: unknown) => { stop: () => void } } }) => {
          spec.sandbox.agent("app", { work: d, env: {} }).stop();
          mkdirSync(join(d, "out"), { recursive: true });
          return { record: { termination: { kind: "completed" } } };
        };
        const read = await launchSession(
          { rig, policy, docker, runId: DAYONE_RUN, arm: "a", cell: "u-r1-a", rep: 1, attempt: 1, model: MODELS.planner, dir: d, seed: null, prompt: "p", minutes: 1, turns: 1, allowanceMicros: 1e6, nextUser: async () => ({ end: true }), gstack: { skill: "autoplan", voiceModel: MODELS.voice, voiceMicros: 1e6 } },
          { driver: (() => ({ env: {} })) as never, trial: trial as never },
        );
        return { read, execs, voice: tokens[1]! };
      };
      const forms = (t: string) => [t, Buffer.from(t).toString("base64"), Buffer.from(t).toString("hex"), ...["sha256", "sha1", "md5", "sha512"].map((h) => createHash(h).update(t).digest("hex")), ...Array.from({ length: t.length - 11 }, (_, i) => t.slice(i, i + 12))];
      const same = await run("same", (voice) => voice);
      const other = await run("other", () => "slot-9-" + "0".repeat(32));
      expect(same.read.contained).toEqual([]);
      expect(other.read.contained).toEqual(["OPENAI_API_KEY is not the voice slot's bearer"]);
      for (const r of [same, other]) {
        expect(r.execs.length).toBeGreaterThan(0);
        for (const e of r.execs) for (const form of forms(r.voice)) expect(e.command).not.toContain(form);
        expect(r.execs.some((e) => e.input?.trim() === r.voice)).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

