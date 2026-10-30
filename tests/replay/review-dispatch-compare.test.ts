import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";

// Runs gstack's own scripts/review-dispatch-compare.ts on the tokens export. With GSTACK_CHECKOUT unset it fetches gstack
// at a pinned commit through a sparse partial clone (about 14 MB); set GSTACK_CHECKOUT to a checkout to run offline.

/** gstack v1.91.325.0. */
const GSTACK_SHA = "dcd62c389d732502272fe940c75c4126b3e7ce7a";
const SCRIPT = "scripts/review-dispatch-compare.ts";
const SPARSE = ["/" + SCRIPT, "/lib/", "/review/", "/ship/sections/", "/test/fixtures/review-depth/"];
const FETCH_TIMEOUT_MS = 120_000;

interface ShipRow {
  fixture: string;
  scenario: string;
  legacy_tokens: number;
  new_tokens: number;
}

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "review-dispatch-compare-"));
  roots.push(dir);
  return dir;
}

function fetchGstack(): string {
  const dir = scratch();
  const steps = [
    ["init", "-q"],
    ["remote", "add", "origin", "https://github.com/garrytan/gstack.git"],
    ["-c", "credential.helper=", "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", GSTACK_SHA],
    ["sparse-checkout", "set", "--no-cone", ...SPARSE],
    ["-c", "credential.helper=", "checkout", "-q", "FETCH_HEAD"],
  ];
  for (const args of steps) {
    const r = Bun.spawnSync(["git", ...args], { cwd: dir, timeout: FETCH_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    if (r.exitCode !== 0) {
      const why = r.exitCode === null ? "timed out after " + FETCH_TIMEOUT_MS / 1000 + "s" : r.stderr.toString().trim();
      throw new Error("could not fetch gstack " + GSTACK_SHA + " (git " + args.join(" ") + ": " + why + "); set GSTACK_CHECKOUT to a gstack checkout that has " + SCRIPT + " to run this test without the network");
    }
  }
  return dir;
}

let checkout = "";
beforeAll(() => {
  checkout = process.env.GSTACK_CHECKOUT || fetchGstack();
  if (!existsSync(join(checkout, SCRIPT))) throw new Error((process.env.GSTACK_CHECKOUT ? "GSTACK_CHECKOUT " : "the fetched gstack ") + checkout + " has no " + SCRIPT);
}, FETCH_TIMEOUT_MS * 3);

function exportTokens(): string {
  const r = Bun.spawnSync([join(REPO_ROOT, "bin", "gstack-evals"), "tokens", "export", "--model", "claude-opus-5-5", "--stat", "median", "--for", "review-dispatch-compare"]);
  expect(r.exitCode).toBe(0);
  return r.stdout.toString();
}

function compare(tokens: string): { tokens_source: string; ship: ShipRow[] } {
  const file = join(scratch(), "tokens.json");
  writeFileSync(file, tokens);
  const r = Bun.spawnSync([process.execPath, join(checkout, SCRIPT), "--tokens", file, "--json"], { cwd: checkout });
  if (r.exitCode !== 0) throw new Error(SCRIPT + " exited " + r.exitCode + ": " + r.stderr.toString());
  const result = JSON.parse(r.stdout.toString());
  expect(result.tokens_source).toBe(file);
  return result;
}

describe("gstack's review-dispatch-compare reads the export", () => {
  test("the script runs on the export and uses exactly the measured specialist numbers", () => {
    const exported = exportTokens();
    expect(exported).toBe('{"specialist":{"full":6929,"light":5446}}\n');
    const measured = JSON.parse(exported).specialist;
    const run = (full: number, light: number) => compare(JSON.stringify({ specialist: { full, light } })).ship;
    const at = run(measured.full, measured.light);
    const fullUp = run(measured.full + 1000, measured.light);
    const lightUp = run(measured.full, measured.light + 1);
    const zero = run(0, 0);
    expect(at.length).toBeGreaterThan(0);
    let fullDispatches = 0;
    at.forEach((row, i) => {
      const legacyFull = (fullUp[i]!.legacy_tokens - row.legacy_tokens) / 1000;
      const newFull = (fullUp[i]!.new_tokens - row.new_tokens) / 1000;
      const newLight = lightUp[i]!.new_tokens - row.new_tokens;
      expect(Number.isInteger(legacyFull) && Number.isInteger(newFull)).toBe(true);
      expect(lightUp[i]!.legacy_tokens).toBe(row.legacy_tokens);
      expect(row.legacy_tokens - zero[i]!.legacy_tokens).toBe(legacyFull * measured.full);
      expect(row.new_tokens - zero[i]!.new_tokens).toBe(newFull * measured.full + newLight * measured.light);
      fullDispatches += legacyFull;
    });
    expect(fullDispatches).toBeGreaterThan(0);
  }, 60_000);
});
