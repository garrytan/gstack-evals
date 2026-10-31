import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import { buildTrialImage, stateRoot } from "../../../src/trial/image.ts";
import { sourceRepo } from "./helpers.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { main } from "../../../src/trial/review/cli.ts";
import { collect } from "../../cli/helpers.ts";

const PSTACK = "pstack=cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c:harness/pstack/claude-code";
const GSTACK = "gstack=garrytan/gstack@53522b1bbc60b3dc820842371f80ebc9db7911ec";
const base = (out: string) => ["--suite", "gsta167-14pr", "--units", "3593", "3596", "--models", "claude-opus-5-5", "--out", out, "--source", "garrytan/gstack=/nowhere"];

describe("review-units arguments (keyless)", () => {
  // Value: protects=the command refuses what it cannot do with E_USAGE before building or spending, and --dry-run prints the plan and writes nothing; fails_when=a run starts without a line item or a source, arms with different told skills are refused, or the dry run writes; why_new=GEVA-70 build step 2 (thin CLI); seam=main; no_claim=the Docker rig, which its own tier covers
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
    expect(mixed.code).toBe(0);
    expect(mixed.out).toContain("/review");
    expect(mixed.out).toContain("/pstack:interrogate");
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

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("review-units startup (Docker tier, GSTACK_EVALS_DOCKER=1)", () => {
  // Value: protects=a run on a fresh --out prepares its unit (repo, tree and offline check in containers), writes the rig's fixtures and reaches the ledger lease, which refuses an item with no approval before any spend, under the ledger's own reason code, and --resume on that out dir keeps the run id in <out>/run.json; fails_when=startup dies on a missing directory (E_INTERNAL ENOENT), anything before the lease fails, a ledger refusal prints as E_INTERNAL, or --resume mints a new run id; why_new=Capy review of #93 (a fresh run threw ENOENT writing <out>/fixtures/tasks.json; after the main merge, a resume minted a new run id, so the item's binding and the crashed run's install holds named another run); seam=main's non-dry path through unit preparation into dockerRig; no_claim=a session, which needs an approved line item
  test("a fresh run reaches the lease", async () => {
    const built = buildTrialImage({ state: stateRoot() });
    if (!built.ok) throw new Error(built.message);
    const s = sourceRepo();
    const root = mkdtempSync(join(REPO_ROOT, ".review-units-start-"));
    const suite = JSON.parse(readFileSync(join(REPO_ROOT, "lanes", "review-noloss", "suites", "gsta167-14pr.json"), "utf8"));
    const unit = { id: "garrytan/gstack#7@" + s.head.slice(0, 12), repo: "garrytan/gstack", pr: 7, head: s.head, base: s.base, cluster: "garrytan/gstack#7", group: null, blockers: [{ ...suite.units[0].blockers[0], paths: ["src/a.ts"], file: "src/a.ts", line: 1 }] };
    writeFileSync(join(root, "suite.json"), JSON.stringify({ ...suite, id: "synthetic-start", units: [unit], ineligible: [], excluded: [], frozen_bars: [] }));
    const out = join(root, "out");
    const io = collect();
    const env = process.env.XDG_STATE_HOME ? { XDG_STATE_HOME: process.env.XDG_STATE_HOME } : {};
    const argv = ["--suite", join(root, "suite.json"), "--units", "all", "--arms", "none", "--models", "claude-opus-5-5", "--out", out, "--source", "garrytan/gstack=" + s.root, "--install", "garrytan/gstack=true", "--test", "garrytan/gstack=true", "--item", "review-units-start", "--spend-cap", "1", "--ledger", join(root, "ledger.sqlite"), "--record", join(root, "record")];
    const code = await main(argv, io, env);
    const { err } = io.text();
    try {
      expect(err).not.toContain("ENOENT");
      expect(err).not.toMatch(/E_INTERNAL|E_UNIT_/);
      expect(existsSync(join(out, "fixtures", "tasks.json"))).toBe(true);
      expect(existsSync(join(out, "units", "gstack-7-" + s.head.slice(0, 8), "unit.json"))).toBe(true);
      expect(code).toBe(2);
      expect(err).toMatch(/^E_LEDGER_MISSING review-units: no approved cap is on record for line item review-units-start/);
      const runId = (JSON.parse(readFileSync(join(out, "run.json"), "utf8")) as { run_id: string }).run_id;
      const again = collect();
      expect(await main([...argv, "--resume"], again, env)).toBe(2);
      expect(again.text().err).toMatch(/^E_LEDGER_MISSING review-units: /);
      expect((JSON.parse(readFileSync(join(out, "run.json"), "utf8")) as { run_id: string }).run_id).toBe(runId);
    } finally {
      removeTree(root);
    }
  }, 600_000);
});
