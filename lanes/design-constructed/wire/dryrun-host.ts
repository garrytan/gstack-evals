// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host row's dry-run cases (gstack-evals dc host): the launch refused before any key read when a start
// rule fails; the host's provisioning importing the gstack pin by tree hash and loading the trial image through a
// stand-in docker binary, and a launch whose image digest differs from the sessions section refused with every VM
// deleted; and the row driven end to end on stage3/fake.ts's simulated Ubicloud with every SSH command run on this
// machine: launch with the plan's stage row, the row's lines in stage.log, a relaunch, a host loss and its recovery, and
// the teardown's archive with the approval record written back. No key, no network, no VM.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recipeHash, recipeInputs } from "../../../src/rig/recipe.ts";
import { controllerProvision, gstackPack, layout, type ControllerPlan } from "../money/controller-host.ts";
import { makeRecord } from "../money/dryrun-fixture.ts";
import { WALCTL_PY } from "../money/offhost.ts";
import { fakeBackend, fakeWorld, type FakeWorld } from "../stage3/fake.ts";
import { runProcess } from "../stage3/ubicloud-real.ts";
import type { DryRunCase } from "../types.ts";
import { BOUND_PROVIDERS } from "../wire.ts";
import { REPO_ROOT } from "./fakes.ts";
import { hostRow, type HostPlanFile, type HostSeams } from "./host.ts";
import type { RowEnv } from "./start.ts";

const LANE = join(REPO_ROOT, "lanes", "design-constructed");
export const FAKE_KEYS = { ANTHROPIC_API_KEY: "test-not-a-key-anthropic", OPENAI_API_KEY: "test-not-a-key-openai", OPENROUTER_API_KEY: "test-not-a-key-openrouter", UBICLOUD_API_KEY: "test-not-a-key-ubicloud", UBI_OWNER: "dry-owner" };
const all = (...checks: (string | null)[]): string | null => checks.find((x) => x !== null) ?? null;

async function withTemp(fn: (dir: string) => Promise<string | null>): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "dc-hostrow-"));
  try {
    return await fn(dir);
  } finally {
    for (const pid of pidsIn(dir)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

const pidsIn = (dir: string): number[] => {
  const f = join(dir, "host", "state", "controller.pid");
  return existsSync(f) ? [Number(readFileSync(f, "utf8"))] : [];
};

/** Every SSH command runs on this machine. */
export const localWorld = (): FakeWorld =>
  fakeWorld({
    ssh: async (_vm, command, input) => {
      const r = await runProcess(["bash", "-c", command], { input, timeoutMs: 60_000 });
      return { exit: r.exit, stdout: new TextDecoder().decode(r.stdout), stderr: r.stderr, raw: r.stdout };
    },
  });

/** An env that records each name read from it, so a test can show no key was read. */
export function watchedEnv(vars: Record<string, string>): { env: Record<string, string | undefined>; read: Set<string> } {
  const read = new Set<string>();
  const env = new Proxy(vars as Record<string, string | undefined>, { get: (t, k) => (typeof k === "string" && read.add(k), t[k as string]) });
  return { env, read };
}

export const rowEnv = (o: { dirty?: boolean; dryRun?: boolean } = {}): RowEnv => ({
  providers: BOUND_PROVIDERS(null),
  dryRun: async () => o.dryRun ?? true,
  lane: () => ({ commit: "0".repeat(40), dirty: o.dirty ?? false, root: REPO_ROOT }),
  now: () => new Date("2026-11-20T00:00:00Z"),
  power: () => ({ code: 0, stdout: "", stderr: "" }),
  vocabulary: () => new Set(),
});

/** A host plan on dir: a work folder with its wiring file, an approval record and the stage row. */
export function hostFixture(dir: string, stage: string[] = ["items"]): { planPath: string; recordPath: string; plan: HostPlanFile } {
  const work = join(dir, "work-in");
  mkdirSync(join(work, "inputs"), { recursive: true });
  writeFileSync(join(work, "wiring.json"), JSON.stringify({ retry: { attempts: 3, elapsed_ms: 900_000 }, pinRecord: "inputs/pins.json", cacheDir: "cache", scanMs: 10_000, sessions: null, vm: null }) + "\n");
  writeFileSync(join(work, "inputs", "note.txt"), "an input the row reads\n");
  mkdirSync(join(dir, "approval"), { recursive: true });
  const record = makeRecord(join(dir, "approval"));
  const plan: HostPlanFile = { runId: "dc-dryrun-hostrow", longestStageHours: 24, ttlHours: 30, priceMicrosPerHour: { controller: 60_000, wal: 20_000 }, bunVersion: "1.4.4", mirrors: false, ubicloud: { project: "dry", location: "dry", size: "standard-2", image: "dry", keyPath: join(dir, "key"), knownHosts: join(dir, "known") }, work, wiring: "wiring.json", record, stage };
  const planPath = join(dir, "host-plan.json");
  writeFileSync(planPath, JSON.stringify(plan) + "\n");
  return { planPath, recordPath: join(dir, "host-record.json"), plan };
}

/** The row's seams for a launch on this machine: the simulated Ubicloud, the checkout's own entry and stage module. */
export function localSeams(dir: string, w: FakeWorld, env: Record<string, string | undefined>, over: (p: ControllerPlan) => ControllerPlan = (p) => p): HostSeams {
  const walRoot = join(dir, "walhost");
  mkdirSync(walRoot, { recursive: true });
  writeFileSync(join(walRoot, "walctl.py"), WALCTL_PY);
  const b = fakeBackend(w);
  return {
    env,
    backend: async () => b,
    archive: () => new Uint8Array(Bun.spawnSync(["tar", "-C", walRoot, "-cf", "-", "walctl.py"]).stdout),
    tune: (p) =>
      over({
        ...p,
        root: join(dir, "host"),
        wal: { dir: join(walRoot, "data"), script: join(walRoot, "walctl.py"), owner: null, authorizedKeys: join(walRoot, "authorized_keys") },
        target: () => ({ kind: "local", script: join(walRoot, "walctl.py"), dir: join(walRoot, "data") }),
        provision: controllerProvision({ bunVersion: "1.4.4", mirrors: false, system: false, bun: process.execPath, imageEntry: join(LANE, "money", "host-image.ts"), docker: join(dir, "docker") }),
        bun: process.execPath,
        entry: join(LANE, "money", "host-main.ts"),
        stage: p.stage ? { ...p.stage, module: join(LANE, "wire", "host.ts") } : null,
        tickMs: 200,
        drainMs: 100,
        upWaitMs: 20_000,
      }),
  };
}

export async function host(verb: string, f: { planPath: string; recordPath: string }, s: HostSeams, env: RowEnv = rowEnv(), extra: Record<string, string> = {}, bools: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  let code: number;
  try {
    code = await hostRow(s)({ rest: [verb], flags: new Map(Object.entries({ "--plan": f.planPath, "--record": f.recordPath, ...extra })), bools: new Set(bools) }, { out: (t) => out.push(t), err: (t) => err.push(t) }, env);
  } catch (e) {
    code = -1;
    err.push(((e as { code?: string }).code ?? "") + " " + (e as Error).message);
  }
  return { code, out, err };
}

async function until(f: () => boolean, ms = 20_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(100)) if (f()) return true;
  return f();
}

/** A stand-in docker binary: docker load names one image id, inspect reports it with this checkout's recipe label. */
export function fakeDocker(dir: string, id: string): string {
  const path = join(dir, "docker");
  const recipe = recipeHash(recipeInputs(REPO_ROOT));
  writeFileSync(path, ["#!/bin/sh", 'case "$1" in', '  load) echo "Loaded image ID: ' + id + '";;', '  image) echo "' + id + " " + recipe + '";;', "  tag) exit 0;;", "  *) exit 9;;", "esac", ""].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

/** A local repository whose one commit stands in for the gstack pin. */
function pinRepo(dir: string): { repo: string; commit: string } {
  const repo = join(dir, "pin-src");
  mkdirSync(join(repo, "bin"), { recursive: true });
  writeFileSync(join(repo, "setup"), "#!/bin/sh\necho installed\n");
  chmodSync(join(repo, "setup"), 0o755);
  writeFileSync(join(repo, "bin", "tool"), "tool\n");
  const g = (args: string[]) => Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@invalid" } });
  g(["init", "-q"]);
  g(["add", "."]);
  g(["commit", "-qm", "pin"]);
  return { repo, commit: new TextDecoder().decode(g(["rev-parse", "HEAD"]).stdout).trim() };
}

export function hostRowCases(): DryRunCase[] {
  return [
    {
      rule: "W-host-row",
      name: "the host launch refuses on a dirty checkout or a failing dry run before any key read, and makes no VM",
      check: () =>
        withTemp(async (dir) => {
          const f = hostFixture(dir);
          const out: string[] = [];
          for (const env of [rowEnv({ dirty: true }), rowEnv({ dryRun: false })]) {
            const w = localWorld();
            const watched = watchedEnv(FAKE_KEYS);
            const r = await host("launch", f, localSeams(dir, w, watched.env), env);
            const keys = [...watched.read].filter((k) => k.endsWith("_KEY"));
            if (!r.err.join(" ").includes("E_DCW_START_RULE")) out.push("no start rule refusal: " + r.err.join(" "));
            if (keys.length) out.push("read " + keys.join(", ") + " before the start rules passed");
            if (w.vms.length) out.push("made " + w.vms.length + " VM(s)");
          }
          return out.length ? out.join("; ") : null;
        }),
    },
    {
      rule: "W-host-row",
      name: "provisioning imports the gstack pin checked by tree hash and loads the trial image; a digest other than the sessions section's refuses the launch and deletes both VMs",
      check: () =>
        withTemp(async (dir) => {
          const pin = pinRepo(dir);
          const pack = gstackPack(pin.repo, pin.commit);
          const id = "sha256:" + "ab".repeat(32);
          fakeDocker(dir, id);
          const f = hostFixture(dir);
          writeFileSync(join(dir, "image.tar"), "a saved image\n");
          const runs: Array<[string, string | null]> = [[id, null], ["sha256:" + "cd".repeat(32), "E_DCH_IMAGE_DIGEST"]];
          const out: string[] = [];
          for (const [expect, refusal] of runs) {
            const w = localWorld();
            rmSync(join(dir, "host"), { recursive: true, force: true });
            rmSync(f.recordPath, { force: true });
            const s = localSeams(dir, w, FAKE_KEYS, (p) => ({ ...p, stage: null, gstack: pack, image: { tar: new Uint8Array(readFileSync(join(dir, "image.tar"))), expectDigest: expect } }));
            const r = await host("launch", f, s);
            for (const pid of pidsIn(dir)) process.kill(pid, "SIGKILL");
            const l = layout("dc-dryrun-hostrow", join(dir, "host"));
            if (refusal) {
              if (!r.err.join(" ").includes(refusal)) out.push("a digest mismatch was not refused: " + r.err.join(" "));
              if (!w.vms.every((v) => w.deleted.includes(v.id))) out.push("the refused launch left a VM");
              continue;
            }
            if (r.code !== 0) {
              out.push("the launch failed: " + r.err.join(" ") + " " + (existsSync(l.state + "/provision.log") ? readFileSync(l.state + "/provision.log", "utf8").slice(-400) : ""));
              continue;
            }
            const tree = Bun.spawnSync(["git", "-C", l.gstack, "rev-parse", pin.commit + "^{tree}"], { stdout: "pipe" });
            if (new TextDecoder().decode(tree.stdout).trim() !== pack.tree) out.push("the host's gstack source doesn't hold the pin's tree");
            const rec = JSON.parse(readFileSync(f.recordPath, "utf8"));
            if (rec.image !== id) out.push("the host record holds image " + rec.image);
            if (!r.out.join(" ").includes(id)) out.push("the launch line doesn't name the image");
          }
          return out.length ? out.join("; ") : null;
        }),
    },
    {
      rule: "W-host-row",
      name: "the host row end to end on the simulated Ubicloud: launch runs the stage row, relaunch, a host loss and its recovery, then teardown archives the work and writes the record back",
      check: () =>
        withTemp(async (dir) => {
          const w = localWorld();
          const f = hostFixture(dir);
          const s = localSeams(dir, w, FAKE_KEYS);
          const l = layout("dc-dryrun-hostrow", join(dir, "host"));
          const stageDone = () => existsSync(join(l.state, "stage.json"));
          const launched = await host("launch", f, s);
          if (launched.code !== 0) return "launch: " + launched.err.join(" ");
          if (!(await until(stageDone))) return "the stage row never finished";
          const stage = JSON.parse(readFileSync(join(l.state, "stage.json"), "utf8"));
          if (!stage.done) return "the stage row failed: " + stage.error;
          const log = readFileSync(join(l.state, "stage.log"), "utf8");
          const first = all(log.includes("dc-authoring-1") ? null : "stage.log lacks the items row's lines", existsSync(join(l.work, "inputs", "note.txt")) ? null : "the inputs did not reach the host's work folder");
          if (first) return first;
          process.kill(pidsIn(dir)[0]!, "SIGTERM");
          if (!(await until(() => !existsSync(l.pid)))) return "the service did not stop";
          const again = await host("relaunch", f, s);
          if (again.code !== 0 || !again.out.join(" ").includes("same-host")) return "relaunch: " + again.out.concat(again.err).join(" ");
          await until(() => existsSync(l.pid));
          const rec = JSON.parse(readFileSync(f.recordPath, "utf8"));
          process.kill(pidsIn(dir)[0]!, "SIGKILL");
          rmSync(join(dir, "host"), { recursive: true, force: true });
          w.deleted.push(rec.controller.vm);
          const back = await host("recover", f, s);
          if (back.code !== 0 || !back.out.join(" ").includes("restored")) return "recover: " + back.out.concat(back.err).join(" ");
          const lost = await host("status", f, s);
          if (!lost.out.join(" ").includes("runs")) return "status after recovery: " + lost.out.join(" ");
          const archive = join(dir, "archive");
          const down = await host("teardown", f, s, rowEnv(), { "--archive": archive });
          if (down.code !== 0) return "teardown: " + down.out.concat(down.err).join(" ");
          const recordBack = readdirSync(dir).filter((n) => n.startsWith("approval")).length;
          const grep = await runProcess(["grep", "-rl", "test-not-a-key", dir]);
          return all(
            w.vms.every((v) => w.deleted.includes(v.id)) ? null : "a VM was left",
            existsSync(join(archive, "wal-lines.ndjson")) ? null : "no off-host lines in the archive",
            existsSync(join(archive, "work", "inputs", "note.txt")) ? null : "the archive lacks the host's work folder",
            down.out.some((x) => x.startsWith("record: ")) && readdirSync(join(dir, "approval")).some((n) => n.includes(".before-teardown-")) ? null : "the approval record was not written back: " + down.out.join(" | ") + " " + recordBack,
            new TextDecoder().decode(grep.stdout).trim() === "" ? null : "a key reached a file: " + new TextDecoder().decode(grep.stdout),
          );
        }),
    },
  ];
}
