import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
    writeFileSync(out + "-prefix.txt", "/other:review Run the full procedure.");
    expect((await run([...base(out), "--arms", "none", GSTACK, "--told-prefix", "gstack=" + out + "-prefix.txt", "--dry-run"])).err).toMatch(/^E_USAGE .*--told-prefix gstack opens with \/other:review, but the arm's told command opens with \/review/);
    expect((await run([...base(out), "--arms", GSTACK.replace(/^gstack/, "g".repeat(30)), "--dry-run"])).err).toMatch(/^E_USAGE .*arm id "g{30}-opus"/);
    const policy = await Bun.file(new URL("../../../policy/models.json", import.meta.url)).json();
    policy.models["vendor-b/particle-1"] = policy.models["particle-ai/particle-1"];
    await Bun.write(out + "-policy.json", JSON.stringify(policy));
    expect((await run(["--suite", "gsta167-14pr", "--units", "3593", "--models", "particle-ai/particle-1", "vendor-b/particle-1", "--out", out, "--source", "garrytan/gstack=/nowhere", "--arms", "none", "--policy", out + "-policy.json", "--dry-run"])).err).toMatch(/^E_USAGE .*arm id "none-particle-1" names both none on particle-ai\/particle-1 and none on vendor-b\/particle-1/);
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

  // Value: protects=a resume that gives other run settings than the run recorded is refused before anything runs, and run.json keeps the settings its sessions used; fails_when=a mismatched resume overwrites run.json or proceeds; why_new=Capy review of #119 (a rejected resume rewrote max_turns and session_kind); seam=main's resume check; no_claim=the Docker rig
  test("a resume with other run settings is refused and leaves run.json as it was", async () => {
    const out = join(mkdtempSync(join(REPO_ROOT, ".review-units-cli-")), "out");
    mkdirSync(out, { recursive: true });
    const recorded = JSON.stringify({ run_id: "review-units-prior", max_turns: 80, session_kind: "unattended" }, null, 2) + "\n";
    writeFileSync(join(out, "run.json"), recorded);
    const run = async (argv: string[]) => {
      const io = collect();
      const code = await main([...base(out), "--arms", "none", "--resume", "--dry-run", "--spend-cap", "100", ...argv], io, {});
      return { code, ...io.text() };
    };
    try {
      const changed = await run([]);
      expect(changed.code).toBe(2);
      expect(changed.err).toMatch(/^E_CACHE_STALE review-units: run review-units-prior ran with max turns 80 and session kind unattended, and this resume gives 60 and not set/);
      expect(readFileSync(join(out, "run.json"), "utf8")).toBe(recorded);
      expect((await run(["--max-turns", "80", "--session-kind", "unattended"])).code).toBe(0);
      writeFileSync(join(out, "run.json"), JSON.stringify({ run_id: "review-units-old" }) + "\n");
      expect((await run([])).code).toBe(0);
      expect((await run(["--max-turns", "80"])).err).toMatch(/^E_CACHE_STALE review-units: run review-units-old ran with max turns 60 and session kind not set/);
    } finally {
      removeTree(join(out, ".."));
    }
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

describe("review-units R2 settings (keyless)", () => {
  // Value: protects=the R2 build's run settings at the command: --allowance and --reader-map print in the dry run with the cap-stop line, a map pinned to another gstack commit or an unreadable map is refused before anything is built, and --resume refuses a run whose run.json holds another allowance or map (E_CACHE_STALE); fails_when=a gstack arm runs under another commit's map, a resume silently changes the allowance or the map, or the dry run hides the cap-stop rule; why_new=R2 build (GEVA-122); seam=main's argument checks and run.json reader
  test("allowance and reader map: dry run, refusals and resume", async () => {
    const MAP = join(REPO_ROOT, "src", "trial", "review", "reader-maps", "gstack-77fe28c39796.json");
    const PINNED = "gstack-full=garrytan/gstack@77fe28c39796cf5573e3d0836b83b2ee436a8f12";
    const out = join(mkdtempSync(join(REPO_ROOT, ".review-units-cli-")), "out");
    const run = async (argv: string[]) => {
      const io = collect();
      const code = await main(argv, io, {});
      return { code, ...io.text() };
    };
    const dry = await run([...base(out), "--arms", PINNED, "--reader-map", MAP, "--max-turns", "200", "--allowance", "40", "--cap-stops", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("cap stops: a code session the turn cap or the allowance ends is recorded as turn_cap or allowance_stop and scored on the findings it wrote before the stop");
    expect(dry.out).toContain("reader map " + MAP + " (sha256 ");
    expect(dry.out).toContain("worst case at the allowance: $80.00");
    expect((await run([...base(out), "--arms", PINNED, "--dry-run"])).out).not.toContain("cap stops");
    expect((await run([...base(out), "--arms", PINNED, "--max-turns", "200", "--allowance", "40", "--dry-run"])).out).not.toContain("cap stops");
    expect((await run([...base(out), "--arms", GSTACK, "--reader-map", MAP, "--dry-run"])).err).toMatch(/^E_USAGE .*is pinned to garrytan\/gstack@77fe28c39796cf5573e3d0836b83b2ee436a8f12, and arm gstack runs garrytan\/gstack@53522b1bbc60b3dc820842371f80ebc9db7911ec/);
    expect((await run([...base(out), "--arms", "none", "--reader-map", out + "-missing.json", "--dry-run"])).err).toMatch(/^E_USAGE .*--reader-map .*-missing\.json: /);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "run.json"), JSON.stringify({ run_id: "review-units-r2", max_turns: 200, session_kind: null, allowance_usd: 40 }));
    const other = await run([...base(out), "--arms", "none", "--max-turns", "200", "--allowance", "15", "--resume", "--dry-run"]);
    expect([other.code, other.err.split("\n")[0]]).toEqual([2, "E_CACHE_STALE review-units: run review-units-r2 ran with max turns 200, session kind not set, allowance $40 and reader map none, and this resume gives 200, not set, $15 and none"]);
    expect((await run([...base(out), "--arms", "none", "--max-turns", "200", "--allowance", "40", "--reader-map", MAP, "--resume", "--dry-run"])).code).toBe(2);
    expect((await run([...base(out), "--arms", "none", "--max-turns", "200", "--allowance", "40", "--resume", "--dry-run"])).code).toBe(0);
    removeTree(dirname(out));
  });
});

