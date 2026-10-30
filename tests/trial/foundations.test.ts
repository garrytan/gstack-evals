import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheStale, dirTreeSha256, envValuesHash, newProgress, recordSession, SESSION_KEY_PARTS, sessionKey, staleParts, writeProgress, type SessionKeyInput } from "../../src/trial/cache.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import { copyToSink, receiptsSink, volatilePathProblem } from "../../src/trial/durable.ts";
import { ONBOARDING_MARKERS, seedStateRoot } from "../../src/trial/state-root.ts";

const roots: string[] = [];
const scratch = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gse-" + name + "-"));
  roots.push(dir);
  return dir;
};
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const input = (): SessionKeyInput => ({
  arm_tree: "a".repeat(64), task: { id: "add", prompt: "p", check: "true" }, sidecar_entry: null, fixture_tree: "f".repeat(64), verifier: "v", image_digest: "sha256:" + "1".repeat(64),
  recipe: "r".repeat(64), model: "claude-opus-5-5", host_version: "2.1.0", adapter_sha256: "d".repeat(64), isolation: "docker", timeout_s: 600, env_values: envValuesHash([], {}), judge_model: null, policy: "p".repeat(64),
});

describe("session cache key", () => {
  // Value: protects=a resumed session runs only when every key part matches, and a mismatch names its parts; fails_when=a changed image, model, task or recipe reuses a cached session, or the stop does not say what changed; why_new=new; seam=sessionKey, staleParts, cacheStale; no_claim=the resume loop, which U10 builds
  test("every part changes the key and is named when it differs; key order does not", () => {
    const key = sessionKey(input());
    expect(sessionKey({ ...input(), task: { check: "true", prompt: "p", id: "add" } }).sha256).toBe(key.sha256);
    for (const part of SESSION_KEY_PARTS) {
      const changed = sessionKey({ ...input(), [part]: part === "timeout_s" ? 601 : "changed" });
      expect(changed.sha256).not.toBe(key.sha256);
      expect(staleParts(key, changed)).toEqual([part]);
    }
    const stop = cacheStale("claude-opus-5-5/after/add/1-0", ["image_digest", "model"]);
    expect(stop.code).toBe("E_CACHE_STALE");
    expect(stop.message).toBe("claude-opus-5-5/after/add/1-0: the cached session's key no longer matches; changed: image_digest, model");
    expect(stop.fix).toContain("--repair");
  });

  test("the env part hashes declared names and values only, and stores no value", () => {
    expect(envValuesHash(["A"], { A: "1", B: "2" })).toBe(envValuesHash(["A"], { A: "1" }));
    expect(envValuesHash(["A"], { A: "1" })).not.toBe(envValuesHash(["A"], { A: "2" }));
    expect(envValuesHash(["A"], { A: "secret-value" })).not.toContain("secret-value");
  });

  test("a tree hash sees content, the executable bit, symlinks and empty directories", () => {
    const dir = scratch("tree");
    writeFileSync(join(dir, "a.sh"), "echo a\n");
    const first = dirTreeSha256(dir);
    chmodSync(join(dir, "a.sh"), 0o755);
    const exec = dirTreeSha256(dir);
    expect(exec).not.toBe(first);
    mkdirSync(join(dir, "empty"));
    const withDir = dirTreeSha256(dir);
    expect(withDir).not.toBe(exec);
    symlinkSync("a.sh", join(dir, "link"));
    expect(dirTreeSha256(dir)).not.toBe(withDir);
  });

  test("a space in a symlink's name or target cannot make two trees hash alike", () => {
    const trees = [["a", "b c"], ["a b", "c"]].map(([link, target]) => {
      const dir = scratch("space");
      writeFileSync(join(dir, "b c"), "1");
      writeFileSync(join(dir, "c"), "2");
      symlinkSync(target!, join(dir, link!));
      return dirTreeSha256(dir);
    });
    expect(trees[0]).not.toBe(trees[1]);
  });
});

describe("progress.json", () => {
  test("is rewritten whole after each session, with counts and an ETA at the run's parallelism", () => {
    const out = scratch("progress");
    let p = newProgress("run-1", 4, new Date("2026-10-29T00:00:00Z"));
    p = { ...p, running: ["m/before/add/1-0"] };
    p = recordSession(p, "m/before/add/1-0", "pass", 30, 2, new Date("2026-10-29T00:00:30Z"));
    p = recordSession(p, "m/after/add/1-0", "timeout", 40, 2);
    expect(p).toMatchObject({ done: 2, passed: 1, timeouts: 1, running: [], eta_s: 40, last: { cell: "m/after/add/1-0", outcome: "timeout" } });
    const path = writeProgress(out, p);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(p);
    expect(spawnSync("ls", ["-A", out], { encoding: "utf8" }).stdout.trim()).toBe("progress.json");
  });
});

describe("receipts and journals outlive the machine", () => {
  // Value: protects=a run never keeps its proxy journal or receipts where a reboot, wake or VM deletion drops them; fails_when=a path under the temp dir or on tmpfs is accepted, or an ephemeral VM runs with nowhere to copy its receipts; why_new=U3 handoff and Captain brief item 8; seam=volatilePathProblem, receiptsSink; no_claim=that the sink itself is durable
  test("temp dirs and tmpfs mounts are refused; a disk path is not", () => {
    expect(volatilePathProblem(join(tmpdir(), "gstack-evals", "journal.ndjson"))).toContain("does not outlive the machine");
    expect(volatilePathProblem("/dev/shm/x")).toContain("does not outlive the machine");
    expect(volatilePathProblem("/srv/state/run/journal", [{ point: "/srv/state", type: "tmpfs" }], "/nonexistent-tmp")).toBe("/srv/state/run/journal is on a tmpfs mount at /srv/state, which does not outlive the machine");
    expect(volatilePathProblem("/srv/state/run/journal", [{ point: "/", type: "ext4" }, { point: "/srv", type: "xfs" }], "/nonexistent-tmp")).toBeNull();
    expect(volatilePathProblem(join(tmpdir(), "..receipts", "journal"))).toContain("does not outlive the machine");
    expect(volatilePathProblem("/srv/state/..run/journal", [{ point: "/", type: "ext4" }, { point: "/srv/state", type: "tmpfs" }], "/nonexistent-tmp")).toContain("is on a tmpfs mount at /srv/state");
  });

  test("an ephemeral VM must name a receipts sink, and the copy keeps paths under out", () => {
    expect(receiptsSink({})).toEqual({ sink: null });
    expect("problem" in receiptsSink({ GSTACK_EVALS_EPHEMERAL: "1" })).toBe(true);
    const out = scratch("out");
    const sink = scratch("sink");
    mkdirSync(join(out, "receipts"), { recursive: true });
    writeFileSync(join(out, "receipts", "r.json"), "{}");
    writeFileSync(join(out, "journal.ndjson"), "{}\n");
    expect(receiptsSink({ GSTACK_EVALS_EPHEMERAL: "1", GSTACK_EVALS_RECEIPTS: sink })).toEqual({ sink });
    expect(copyToSink(out, [join(out, "receipts"), join(out, "journal.ndjson"), join(out, "missing")], sink)).toEqual([join(sink, "receipts"), join(sink, "journal.ndjson")]);
    expect(readFileSync(join(sink, "receipts", "r.json"), "utf8")).toBe("{}");
    const elsewhere = scratch("proxy");
    writeFileSync(join(elsewhere, "journal.ndjson"), "{}\n");
    const empty = scratch("sink2");
    expect(() => copyToSink(out, [join(out, "journal.ndjson"), join(elsewhere, "journal.ndjson")], empty)).toThrow("these files are outside the run's out dir " + out + ", so they have no place under the receipts sink: " + join(elsewhere, "journal.ndjson"));
    expect(readdirSync(empty)).toEqual([]);
  });
});

describe("cleanup", () => {
  test("removes a tree whose directories lost their permissions", () => {
    const root = scratch("clean");
    const tree = join(root, "work");
    mkdirSync(join(tree, "locked", "deep"), { recursive: true });
    writeFileSync(join(tree, "locked", "deep", "f"), "x");
    chmodSync(join(tree, "locked"), 0o000);
    expect(removeTree(tree)).toBeNull();
    expect(existsSync(tree)).toBe(false);
  });

  // Value: protects=cleanup never throws over files it cannot remove; fails_when=a root-owned leftover throws out of a trial or a vacuity control; why_new=U5 handoff, Captain brief item 7; seam=removeTree; no_claim=the root container path, which the Docker tier covers
  test("reports what it could not remove instead of throwing", () => {
    const root = scratch("clean");
    mkdirSync(join(root, "stuck"));
    const problem = removeTree(join(root, "stuck"), { remove: () => { throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }); } });
    expect(problem).toBe("could not remove " + join(root, "stuck") + ": EACCES: permission denied");
  });
});

describe("state root", () => {
  // Value: protects=each work dir gets an onboarded .gstack-home that both variables name, without changing the fixture's git tree; fails_when=a marker is missing, telemetry stays on, the routing offer is not declined, a learning is clobbered, or the markers show up in git status; why_new=new; seam=seedStateRoot; no_claim=which markers newer gstack versions add
  test("seeds markers and config after /learn's setup, keeps the fixture's files and stays git-excluded", () => {
    const work = scratch("learn");
    const seed = join(import.meta.dir, "../contract/fixtures/gstack/learn/seed.sh");
    expect(spawnSync("sh", [seed, "full"], { cwd: work, encoding: "utf8" }).status).toBe(0);
    const env = seedStateRoot(work, "/work/learn-full", "core");
    expect(env).toEqual({ GSTACK_STATE_ROOT: "/work/learn-full/.gstack-home", GSTACK_HOME: "/work/learn-full/.gstack-home" });
    for (const marker of ONBOARDING_MARKERS) expect(existsSync(join(work, ".gstack-home", marker))).toBe(true);
    const config = readFileSync(join(work, ".gstack-home", "config.yaml"), "utf8");
    expect(config).toContain("telemetry: off\nupdate_check: false\n");
    expect(config).toContain("proactive: core\n");
    expect(config).toContain("routing_declined: true\n");
    expect(spawnSync("git", ["status", "--porcelain"], { cwd: work, encoding: "utf8" }).stdout).toBe("");
    const slug = spawnSync("ls", [join(work, ".gstack-home", "projects")], { encoding: "utf8" }).stdout.trim().split("\n")[0]!;
    expect(readFileSync(join(work, ".gstack-home", "projects", slug, "learnings.jsonl"), "utf8").split("\n").filter(Boolean)).toHaveLength(7);
    writeFileSync(join(work, ".gstack-home", "config.yaml"), "telemetry: community\n");
    seedStateRoot(work, "/work/learn-full", "off");
    const again = readFileSync(join(work, ".gstack-home", "config.yaml"), "utf8").split("\n");
    expect(again.filter((l) => l.startsWith("telemetry:")).at(-1)).toBe("telemetry: off");
    expect(again.filter((l) => l.startsWith("proactive:")).at(-1)).toBe("proactive: off");
  });
});
