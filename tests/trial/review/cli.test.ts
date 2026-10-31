import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { main } from "../../../src/trial/review/cli.ts";
import { collect } from "../../cli/helpers.ts";

const PSTACK = "pstack=cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c:harness/pstack/claude-code";
const GSTACK = "gstack=garrytan/gstack@53522b1bbc60b3dc820842371f80ebc9db7911ec";
const base = (out: string) => ["--suite", "gsta167-14pr", "--units", "3593", "3596", "--models", "claude-opus-5-5", "--out", out, "--source", "garrytan/gstack=/nowhere"];

describe("review-units arguments (keyless)", () => {
  // Value: protects=the command refuses what it cannot do with E_USAGE before building or spending, and --dry-run prints the plan and writes nothing; fails_when=a run starts without a line item, a source or a single told skill, or the dry run writes; why_new=GEVA-70 build step 2 (thin CLI); seam=main; no_claim=the Docker rig, which its own tier covers
  test("refusals and the dry run", async () => {
    const out = join(mkdtempSync(join(REPO_ROOT, ".review-units-cli-")), "out");
    const run = async (argv: string[]) => {
      const io = collect();
      const code = await main(argv, io, {});
      return { code, ...io.text() };
    };
    expect((await run([])).err).toMatch(/^E_USAGE review-units: needs --suite/);
    expect((await run([...base(out), "--arms", "none", "--bogus"])).err).toMatch(/^E_USAGE .*unknown argument/);
    expect((await run(["--suite", "gsta167-14pr", "--units", "3593", "--models", "claude-opus-5-5", "--out", out, "--arms", "none"])).err).toMatch(/^E_USAGE .*no --source for garrytan\/gstack/);
    expect((await run([...base(out), "--arms", "none", "placebo"])).err).toMatch(/^E_USAGE .*--arms takes none/);
    const mixed = await run([...base(out), "--arms", GSTACK, PSTACK, "--dry-run"]);
    expect(mixed.code).toBe(2);
    expect(mixed.err).toMatch(/^E_USAGE .*different told skills \(review, interrogate\).*src\/arms\/install\.ts/);
    expect((await run([...base(out), "--arms", "none", "--models", "gpt-6.1-sol"])).err).toMatch(/no Claude Code route/);
    expect((await run([...base(out), "--arms", "none"])).err).toMatch(/^E_USAGE .*--item.*--spend-cap/);
    const dry = await run([...base(out), "--arms", "none", GSTACK, "--passes", "2", "--dry-run", "--spend-cap", "100"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("sessions 8");
    expect(dry.out).toContain("task gstack-3593-89156431  base branch main");
    expect(dry.out).toContain('gstack (told gstack, "/review")');
    expect(dry.out).toContain("spend cap $100.00");
    expect(existsSync(out)).toBe(false);
    removeTree(join(out, ".."));
  });
});
