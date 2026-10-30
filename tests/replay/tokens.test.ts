import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { tokensCli } from "../../lanes/review-replay/tokens-cli.ts";
import { exportTokens, flaggedRows, loadTable, median, p90, TABLE_PATH, tableProblems, type TokenRow } from "../../lanes/review-replay/tokens.ts";

const NOW = new Date("2026-10-29T12:00:00Z");
const OPUS = ["export", "--model", "claude-opus-5-5", "--for", "review-dispatch-compare"];
const MEDIAN = JSON.stringify({ specialist: { full: 6929, light: 5446 } });

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

async function call(argv: string[], now = NOW) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await tokensCli(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, now);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function committed(): any {
  return JSON.parse(readFileSync(TABLE_PATH, "utf8"));
}

function tableFile(table: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "tokens-test-"));
  roots.push(dir);
  const path = join(dir, "review-tokens.json");
  writeFileSync(path, JSON.stringify(table));
  return path;
}

/** A valid row with n trials whose output tokens are base, base + 1, ..., measured on as_of. */
function measuredRow(effort: "full" | "light", n: number, base: number, as_of: string): TokenRow {
  const trials = Array.from({ length: n }, (_, i) => ({ id: effort + "." + i, input_tokens: 1000, output_tokens: base + i }));
  const out = trials.map((t) => t.output_tokens);
  return {
    model: "claude-opus-5-5",
    role: "specialist",
    effort,
    provider_effort: effort === "full" ? "high" : "medium",
    input_tokens: { median: 1000, p90: 1000 },
    output_tokens: { median: median(out), p90: p90(out) },
    n,
    source_run_ids: ["gsta131-eval1"],
    as_of,
    trials,
  };
}

function expectError(r: { code: number; out: string; err: string }, code: string) {
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  for (const line of r.err.split("\n")) expect(line).toStartWith(code + " ");
  expect(r.err).toContain(code + " docs: docs/errors.md#" + code.toLowerCase());
}

describe("the review token table", () => {
  test("the committed table validates and holds GSTA-131's eval 1 specialist rows", () => {
    const table = loadTable();
    expect(TABLE_PATH).toBe(join(REPO_ROOT, "tables/review-tokens.json"));
    expect(tableProblems(committed())).toEqual([]);
    expect(table.rows.map((r) => [r.model, r.role, r.effort, r.provider_effort, r.n, r.output_tokens.median, r.output_tokens.p90, r.as_of])).toEqual([
      ["claude-opus-5-5", "specialist", "full", "high", 6, 6929, 13566, "2026-10-27"],
      ["claude-opus-5-5", "specialist", "light", "medium", 6, 5446, 9009, "2026-10-27"],
    ]);
    for (const row of table.rows) {
      expect(row.source_run_ids).toEqual(["gsta131-eval1"]);
      expect(row.trials.map((t) => t.id.split(".")[0]).toSorted()).toEqual(["t-maint-code", "t-maint-code", "t-maint-code", "t-testing-code", "t-testing-code", "t-testing-code"]);
    }
    expect(table.flag_rules).toMatchObject({ min_n: 10, max_age_days: 30 });
  });

  test("medians round half up to whole tokens and p90 takes the nearest rank", () => {
    expect(median([3420, 5388, 6881, 6976, 11933, 13566])).toBe(6929);
    expect(median([3451, 4651, 4828, 6064, 7613, 9009])).toBe(5446);
    expect(median([1, 2])).toBe(2);
    expect(median([5, 1, 3])).toBe(3);
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    expect(p90([4, 1, 3, 2, 5, 6, 7, 8, 9, 10, 11])).toBe(10);
  });

  test("validation recomputes every statistic and checks n, sources and duplicates", () => {
    const table = committed();
    table.rows[0].output_tokens.median = 6928;
    table.rows[1].n = 7;
    table.rows[1].source_run_ids = ["unknown-run"];
    table.rows.push({ ...table.rows[0] });
    const problems = tableProblems(table).join("\n");
    expect(problems).toContain('rows[0].output_tokens must be {"median":6929,"p90":13566}');
    expect(problems).toContain("rows[1].n is 7 but it lists 6 trials");
    expect(problems).toContain("rows[1].source_run_ids must name runs listed in sources");
    expect(problems).toContain("rows[2] repeats claude-opus-5-5 specialist full");
    expect(tableProblems({ schema_version: 1, flag_rules: { min_n: 10, max_age_days: 30 }, sources: {}, rows: [] })).toContain("rows must be a non-empty array");
  });

  test("flaggedRows applies n under 10 and as_of over 30 days", () => {
    const table = loadTable();
    expect(flaggedRows(table, table.rows, NOW).map((f) => f.reasons)).toEqual([["n=6 is under 10"], ["n=6 is under 10"]]);
    const old = flaggedRows(table, table.rows, new Date("2026-11-27T00:00:00Z"));
    expect(old[0]!.reasons).toEqual(["n=6 is under 10", "as_of 2026-10-27 is 31 days old, over 30"]);
    expect(flaggedRows(table, [measuredRow("full", 10, 100, "2026-09-29")], NOW)).toEqual([]);
  });

  test("exportTokens names every missing row and never fills one", () => {
    const table = loadTable();
    expect(exportTokens(table, "claude-opus-5-5", "median")).toMatchObject({ ok: true, tokens: JSON.parse(MEDIAN) });
    expect(exportTokens(table, "claude-haiku-5-5", "median")).toEqual({
      ok: false,
      missing: [
        { model: "claude-haiku-5-5", role: "specialist", effort: "full" },
        { model: "claude-haiku-5-5", role: "specialist", effort: "light" },
      ],
    });
  });
});

describe("gstack-evals tokens export", () => {
  test("median and p90 exports print exactly the --tokens object, flagged rows on stderr only", async () => {
    const median = await call([...OPUS, "--stat", "median"]);
    expect(median).toEqual({
      code: 0,
      out: MEDIAN,
      err: "flagged: claude-opus-5-5 specialist full: n=6 is under 10\nflagged: claude-opus-5-5 specialist light: n=6 is under 10",
    });
    const p90 = await call([...OPUS, "--stat", "p90", "--role", "specialist"]);
    expect(p90.code).toBe(0);
    expect(p90.out).toBe(JSON.stringify({ specialist: { full: 13566, light: 9009 } }));
  });

  test("a fresh row with n of 10 or more is not flagged; an old one is, and stdout keeps the same shape", async () => {
    const table = committed();
    table.rows = [measuredRow("full", 10, 7000, "2026-10-20"), measuredRow("light", 12, 5000, "2026-08-01")];
    const r = await call([...OPUS, "--stat", "median", "--table", tableFile(table)]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(JSON.stringify({ specialist: { full: 7005, light: 5006 } }));
    expect(r.err).toBe("flagged: claude-opus-5-5 specialist light: as_of 2026-08-01 is 89 days old, over 30");
  });

  test("a missing model exits 2 with E_TOKENS_COVERAGE naming the rows needed, stdout empty", async () => {
    const r = await call(["export", "--model", "claude-haiku-5-5", "--for", "review-dispatch-compare", "--stat", "median"]);
    expectError(r, "E_TOKENS_COVERAGE");
    expect(r.err).toContain("lacks the measured rows claude-haiku-5-5 specialist full, claude-haiku-5-5 specialist light;");
  });

  test("a missing role exits 2 with E_TOKENS_COVERAGE and exports none of the other roles", async () => {
    const r = await call([...OPUS, "--stat", "median", "--role", "specialist", "--role", "red-team"]);
    expectError(r, "E_TOKENS_COVERAGE");
    expect(r.err).toContain("lacks the measured rows claude-opus-5-5 red-team full, claude-opus-5-5 red-team light;");
    expect(r.err).not.toContain("specialist full");
  });

  test("a missing effort exits 2 with E_TOKENS_COVERAGE naming that effort alone", async () => {
    const table = committed();
    table.rows = table.rows.filter((row: TokenRow) => row.effort === "full");
    const r = await call([...OPUS, "--stat", "median", "--table", tableFile(table)]);
    expectError(r, "E_TOKENS_COVERAGE");
    expect(r.err).toContain("lacks the measured rows claude-opus-5-5 specialist light;");
    expect(r.err).not.toContain("specialist full");
  });

  test("bad usage and an unreadable or invalid table exit 2 with E_USAGE", async () => {
    const invalid = committed();
    invalid.rows[0].n = 9;
    const cases: Array<[string[], string]> = [
      [["export", "--model", "claude-opus-5-5", "--stat", "median"], "needs --for"],
      [[...OPUS], "needs --stat"],
      [["export", "--stat", "median", "--for", "review-dispatch-compare"], "needs --model"],
      [[...OPUS, "--stat", "mean"], '--stat is median or p90, not "mean"'],
      [["export", "--model", "claude-opus-5-5", "--stat", "median", "--for", "pricing"], '--for is review-dispatch-compare, not "pricing"'],
      [[...OPUS, "--stat", "median", "--model", "claude-opus-5-5"], "--model is given twice"],
      [[...OPUS, "--stat", "median", "--json"], 'does not take "--json"'],
      [[...OPUS, "--stat"], "--stat needs a value"],
      [[...OPUS, "--stat", "median", "--table", join(tmpdir(), "no-such-tokens.json")], "cannot read the token table"],
      [[...OPUS, "--stat", "median", "--table", tableFile(invalid)], "rows[0].n is 9 but it lists 6 trials"],
      [["import"], 'unknown tokens command "import"'],
    ];
    for (const [argv, message] of cases) {
      const r = await call(argv);
      expectError(r, "E_USAGE");
      expect(r.err).toContain(message);
    }
  });

  test("--help prints the usage and exits 0; no subcommand prints it and exits 2", async () => {
    for (const argv of [["--help"], ["export", "--help"]]) {
      const r = await call(argv);
      expect(r.code).toBe(0);
      expect(r.out).toStartWith("Usage: gstack-evals tokens export --model <id> --stat median|p90 --for review-dispatch-compare");
    }
    expect((await call([])).code).toBe(2);
  });

  test("bin/gstack-evals tokens export runs through the dispatcher", () => {
    const bin = join(REPO_ROOT, "bin", "gstack-evals");
    const ok = Bun.spawnSync([bin, "tokens", ...OPUS, "--stat", "median"]);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.toString()).toBe(MEDIAN + "\n");
    for (const line of ok.stderr.toString().trim().split("\n")) expect(line).toStartWith("flagged: ");
    const gap = Bun.spawnSync([bin, "tokens", "export", "--model", "claude-haiku-5-5", "--stat", "median", "--for", "review-dispatch-compare"]);
    expect(gap.exitCode).toBe(2);
    expect(gap.stdout.toString()).toBe("");
    expect(gap.stderr.toString()).toStartWith("E_TOKENS_COVERAGE ");
  });
});
