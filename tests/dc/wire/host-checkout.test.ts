// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host's checkout, built the way the launch builds it: this checkout's HEAD as the bundle the launcher
// ships (money/controller-host.ts repoBundle), checked out into a folder standing in for /var/lib/dc/repo with the
// host's own lines (repoCheckout) and checked against the commit and its tree (checkoutProblem). The real keyless
// gstack-evals dc dryrun, the one realEnv runs inside the host's ledger service for start rule 5, then runs from that
// checkout. A bare git archive of the same commit, which the launch shipped before, fails it. No key, no network, no VM.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AREAS, REGISTRY } from "../../../lanes/design-constructed/dryrun.ts";
import { checkoutProblem, checkoutRead, layout, repoBundle, repoCheckout, repoTree, type Layout } from "../../../lanes/design-constructed/money/controller-host.ts";
import { hostRowCases, laneHead } from "../../../lanes/design-constructed/wire/dryrun-host.ts";
import { REPO_ROOT } from "../../../lanes/design-constructed/wire/fakes.ts";

const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "UBICLOUD_API_KEY"];
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A host root on disk with an empty repo folder, as prepareController makes it. */
function hostRoot(): Layout {
  const root = mkdtempSync(join(tmpdir(), "dc-checkout-"));
  dirs.push(root);
  const l = layout("dc-checkout-test", root);
  mkdirSync(l.repo);
  return l;
}

/** The launch's own check of the checkout: null when it is a git repository at the commit and its tree. */
function check(l: Layout, commit: string): string | null {
  const read = Bun.spawnSync(["bash", "-c", checkoutRead(l)], { stdout: "pipe", stderr: "pipe" });
  return checkoutProblem(read.exitCode === 0 ? new TextDecoder().decode(read.stdout) : null, commit, repoTree(REPO_ROOT, commit));
}

/** gstack-evals dc dryrun from repo, with no key in its environment and a tmpfs folder as its working folder, as the host runs it. */
function dryrunFrom(repo: string, args: string[] = []): { code: number; lines: string[] } {
  symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of KEYS) delete env[k];
  const cwd = mkdtempSync("/dev/shm/dc-checkout-work-");
  dirs.push(cwd);
  const r = Bun.spawnSync([process.execPath, "--no-env-file", join(repo, "bin", "gstack-evals"), "dc", "dryrun", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, lines: (new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr)).split("\n") };
}

describe("the controller host's checkout", () => {
  // Value: protects=start rule 5 on the controller host; fails_when=the launch ships a checkout that is not a git repository at the commit, so the host's own dry run fails W-host-row at git rev-parse HEAD:src/adapters and every row refuses with E_DCW_START_RULE; why_new=the live host refused every row while tests/dc/wire/launch.test.ts faked the dry run; seam=repoBundle, repoCheckout and checkoutProblem, then the real dc dryrun from the checkout; no_claim=the real host's apt, bun install, Docker and Ubicloud
  test("the launch's bundle checks out as a git repository at the commit, and the real keyless dry run passes every case from it, W-host-row included", () => {
    const commit = laneHead();
    const l = hostRoot();
    writeFileSync(join(l.root, "repo.bundle"), repoBundle(REPO_ROOT, commit));
    const out = Bun.spawnSync(["bash", "-c", repoCheckout(l, commit).join("\n")], { stdout: "pipe", stderr: "pipe" });
    expect(new TextDecoder().decode(out.stderr)).toBe("");
    expect(out.exitCode).toBe(0);
    expect(check(l, commit)).toBeNull();
    const r = dryrunFrom(l.repo);
    const want = AREAS.reduce((n, a) => n + REGISTRY[a]().length, 0);
    expect(r.lines.filter((x) => x.startsWith("FAIL "))).toEqual([]);
    expect(r.lines).toContain("dry run: " + want + " pass, 0 fail");
    expect(r.lines.filter((x) => x.startsWith("PASS W-host-row ")).length).toBe(hostRowCases().length);
    expect(r.code).toBe(0);
  }, 900_000);

  test("the same commit as a bare git archive, as the launch shipped it before, fails the launch's check and W-host-row's dry run at git", () => {
    const commit = laneHead();
    const l = hostRoot();
    const tar = Bun.spawnSync(["git", "-C", REPO_ROOT, "archive", "--format=tar", commit], { stdout: "pipe" });
    expect(Bun.spawnSync(["tar", "-x", "-C", l.repo, "-f", "-"], { stdin: tar.stdout }).exitCode).toBe(0);
    expect(check(l, commit)).toBe("is not a git repository whose HEAD and tree resolve");
    const r = dryrunFrom(l.repo, ["--area", "wire"]);
    const failed = r.lines.filter((x) => x.startsWith("FAIL W-host-row "));
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.join("\n")).toContain("git");
    expect(r.code).not.toBe(0);
  }, 900_000);
});
