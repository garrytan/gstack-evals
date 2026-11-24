import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { main } from "../../../src/trial/review/cli.ts";
import { RM_CELLS, RM_CODEX_DIR, RM_CODEX_VERSION, RM_GSTACK, rmArgs, rmCellOf } from "../../../src/trial/review/rm-cells.ts";
import { blockAfter, cellCheck, cellRunLoop, toyRepo, TOY_LINES } from "../../../src/trial/review/rm-check.ts";
import { collect } from "../../cli/helpers.ts";

const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const work = () => mkdtempSync(join(REPO_ROOT, ".rm-check-test-"));
const run = async (argv: string[]) => {
  const io = collect();
  const code = await main(argv, io, {});
  return { code, ...io.text() };
};

// Value: protects=the toy unit the rig check reviews is a branch of exactly TOY_LINES added lines over main with origin/main at main, so gstack's diff-size block reads 200 and both Codex passes are due; and blockAfter lifts the pinned adversarial.md blocks with the base and prompt filled in or refuses; fails_when=the toy diff drifts from 200 lines, origin/main is missing, or a block keeps a placeholder; why_new=GEVA-590 item 3 (keyless rig check); seam=toyRepo and blockAfter; no_claim=the pinned adversarial.md text, which the opt-in check reads
describe("the rig check's toy unit and blocks (keyless)", () => {
  test("toyRepo adds 200 lines over main", () => {
    const dir = work();
    try {
      const toy = toyRepo(join(dir, "toy"));
      const numstat = spawnSync("git", ["-C", join(dir, "toy"), "diff", "--numstat", "origin/main...HEAD"], { encoding: "utf8" }).stdout.trim();
      expect(numstat).toBe(TOY_LINES + "\t0\tsrc/feature.ts");
      expect(spawnSync("git", ["-C", join(dir, "toy"), "rev-parse", "origin/main"], { encoding: "utf8" }).stdout.trim()).toBe(toy.base);
      expect(toy.head).not.toBe(toy.base);
    } finally {
      removeTree(dir);
    }
  });

  test("blockAfter fills <base> and the prompt file, and refuses a missing marker or prompt", () => {
    const md = "### Codex adversarial challenge\n\ntext\n\n```bash\ncodex exec \"$(cat '<prepared-prompt-file>')\" --base <base>\n```\n\n**Detect diff size:**\n\n```bash\ngit diff <base> --stat\n```\n";
    expect(blockAfter(md, "**Detect diff size:**", { base: "main" })).toBe("git diff main --stat\n");
    expect(blockAfter(md, "### Codex adversarial challenge", { base: "main", prompt: "/h/p's.txt" })).toBe("codex exec \"$(cat '/h/p'\\''s.txt')\" --base main\n");
    expect(() => blockAfter(md, "### Codex adversarial challenge", { base: "main" })).toThrow(/^E_CELL_CHECK: .*needs a prompt file/);
    expect(() => blockAfter(md, "### Nowhere", { base: "main" })).toThrow(/^E_CELL_CHECK: .*has no/);
  });
});

// Value: protects=review-units' own run loop gives each of the five prereg cells its model, voice, voice CLI, sandbox switch, rollout copy and slot allowlist, and a session key no other cell has; fails_when=two cells share a key, the none cell gets a voice, a voice cell loses its CLI or no-sandbox switch, or the slot does not admit the voice; why_new=GEVA-590 items 1 and 3; seam=cellRunLoop over runReviewUnits with a recording driver; no_claim=the Claude Code and Codex sessions, which the opt-in check runs
describe("the five cells through the run loop (keyless)", () => {
  test("each cell gets its options and its own session key", async () => {
    const dir = work();
    try {
      const toy = { dir: join(dir, "toy"), ...toyRepo(join(dir, "toy")) };
      const got = await cellRunLoop({ gstack: join(dir, "no-gstack"), codexDir: "/nowhere", codexVersion: null, work: dir, policy }, toy);
      expect([...got.keys()].sort()).toEqual(RM_CELLS.map((c) => c.arm + " " + c.model).sort());
      expect(new Set([...got.values()].map((r) => r.key)).size).toBe(RM_CELLS.length);
      for (const cell of RM_CELLS) {
        const r = got.get(cell.arm + " " + cell.model)!;
        expect(r.options.model).toBe(cell.model);
        expect(r.models).toEqual(["anthropic:" + cell.model, ...(cell.voice ? ["openai:" + cell.voice] : [])]);
        if (cell.voice === null) {
          expect(r.options.codex ?? null).toBeNull();
          continue;
        }
        expect(r.options.codex).toEqual({ provider: "openai", model: cell.voice, binDir: RM_CODEX_DIR });
        expect([r.options.codexNoSandbox, r.options.codexRollouts]).toEqual([true, true]);
        expect(r.gstack_config).toMatchObject({ codex_reviews: "enabled" });
      }
      expect(rmCellOf("gstack-astra", "claude-fable-5-2")!.id).toBe("FA");
      expect(rmCellOf("none", "claude-fable-5-2")).toBeNull();
    } finally {
      removeTree(dir);
    }
  }, 120_000);
});

// Value: protects=review-units refuses the new flags where they cannot apply and its dry run shows the five-cell plan from rmArgs, writing nothing; and cell-check refuses missing flags with E_USAGE; fails_when=--arm-voice is taken on the none arm or for a model with no Codex route, a relative --voice-cli is taken, the dry run hides the voices, or cell-check starts without --gstack and --out; why_new=GEVA-590 items 1 and 3; seam=main and cellCheckMain; no_claim=a run, which spends
describe("the review-units flags for the five cells (keyless)", () => {
  test("refusals, the dry run and cell-check usage", async () => {
    const dir = work();
    const out = join(dir, "out");
    try {
      const base = ["--suite", "gsta167-14pr", "--units", "3593", "--out", out, "--source", "garrytan/gstack=/nowhere"];
      const ref = RM_GSTACK.repo + "@" + RM_GSTACK.sha;
      const cells = ["--arms", "none", "gstack-sol=" + ref, "--models", "claude-opus-5-5", "--dry-run"];
      expect((await run([...base, ...cells, "--arm-voice", "none=gpt-6.2-sol"])).err).toMatch(/^E_USAGE .*--arm-voice names arm none, which is not a gstack stack arm/);
      expect((await run([...base, ...cells, "--arm-voice", "gstack-sol=claude-opus-5-5"])).err).toMatch(/^E_USAGE .*which has no Codex route in the policy/);
      expect((await run([...base, ...cells, "--voice-cli", "opt/codex/bin"])).err).toMatch(/^E_USAGE .*--voice-cli takes an absolute directory/);
      const dry = await run([...base, ...rmArgs(), "--dry-run"]);
      expect(dry.err).toBe("");
      expect(dry.code).toBe(0);
      expect(dry.out).toContain("voices: gstack-sol gpt-6.2-sol, gstack-astra gpt-6.2-astra; every voice runs " + RM_CODEX_DIR + "/codex with GSTACK_CODEX_NO_SANDBOX=1");
      expect(existsSync(out)).toBe(false);
      const usage = await run(["cell-check"]);
      expect([usage.code, usage.err.split("\n")[0]]).toEqual([2, "E_USAGE review-units cell-check: needs --gstack <dir> and --out <dir>"]);
      expect((await run(["cell-check", "--gstack", "/a", "--gstack", "/b"])).err).toMatch(/^E_USAGE .*unknown or repeated argument "--gstack"/);
      const wrong = await run(["cell-check", "--gstack", dir, "--out", join(dir, "check")]);
      expect([wrong.code, wrong.err]).toEqual([2, expect.stringMatching(/^E_CELL_CHECK: --gstack .* not the pin /)]);
    } finally {
      removeTree(dir);
    }
  });
});

const GSTACK_SOURCE = process.env.GSTACK_EVALS_GSTACK_SOURCE ?? "";
const CODEX_DIR = process.env.GSTACK_EVALS_CODEX_DIR ?? "";
const full = GSTACK_SOURCE && CODEX_DIR && existsSync(join(CODEX_DIR, "codex")) ? test : test.skip;

// Value: protects=the whole rig check on this machine: a real Claude Code CLI session per cell against stub APIs, gstack's probe and both Codex passes through the real Codex CLI, with every check passing; fails_when=any cell's check fails; why_new=GEVA-590 item 3; seam=cellCheck; no_claim=the trial image, the metering proxy and any model, none of which this runs. Opt in with GSTACK_EVALS_GSTACK_SOURCE (a set-up gstack checkout at the pin) and GSTACK_EVALS_CODEX_DIR (a dir holding codex; GSTACK_EVALS_CODEX_VERSION pins its version, default any)
describe("the full rig check (opt-in, keyless)", () => {
  full("every cell passes every check", async () => {
    const dir = work();
    try {
      const r = await cellCheck({ gstack: GSTACK_SOURCE, codexDir: CODEX_DIR, codexVersion: process.env.GSTACK_EVALS_CODEX_VERSION === RM_CODEX_VERSION ? RM_CODEX_VERSION : null, work: dir });
      const failed = r.cells.flatMap((c) => c.checks.filter((k) => !k.ok).map((k) => c.cell.id + " " + k.name + ": " + k.detail));
      expect(failed).toEqual([]);
      expect(r.ok).toBe(true);
    } finally {
      removeTree(dir);
    }
  }, 1_800_000);
});
