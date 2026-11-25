// Value: protects=the review-models pilot path: every line item is recorded with its cap and the recorded words, checked
// verbatim against the approvals file and the pre-run changes, items with no words are listed and not recorded, a path
// raises only the items it changes, the pilot plan leases each cell's own item and the retry reserve, the pilot argv
// carries the seed, cell items, web_search removal and each repo's commands, and review-units takes prebuilt, stripped
// unit repositories as they stand; fails_when=a quote is recorded that the record does not hold, a no-words item gets a
// cap, a rerun of items re-records, a pilot item short of 11 reviews is leased, a repo runs on default commands, or a
// built unit's stripped config comes back; why_new=GEVA-590 pilot run driver (prereg sections 3, 8 and 11; pre-run
// changes 1 and 2); seam=rm-run main with a stub gstack-approvals and a temp ledger, pilotUnits, pilotCellItems,
// pilotArgv, loadUnitRepos and a review-units dry run on toy units built by buildChecked; no_claim=Docker or a model,
// which the keyless end-to-end covers
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildChecked } from "../../../src/trial/review/supply/b-units.ts";
import type { Draw } from "../../../src/trial/review/supply/draw.ts";
import { RM_CELLS } from "../../../src/trial/review/rm-cells.ts";
import { envelopeStatus } from "../../../src/runner/ledger/envelope.ts";
import { ledgerStatus, openLease } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { LedgerError } from "../../../src/runner/ledger/record.ts";
import { main, ORDER_SEED, PILOT_ENVELOPE_USD, PILOT_PROGRAM, pilotArgv, pilotCellItems, pilotUnits, QUOTES, REVIEW_CAP_USD, rmItems, SESSION_ALLOWANCE_USD } from "../../../src/trial/review/rm-run.ts";
import { armId } from "../../../src/trial/review/run.ts";
import { historyProblems } from "../../../src/trial/review/unit.ts";
import { builtDir, loadUnitRepos } from "../../../src/trial/review/unit-repos.ts";
import { commitAll, git, tree } from "../../cli/helpers.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const scratch = (prefix: string, root = tmpdir()) => {
  mkdirSync(root, { recursive: true });
  const d = mkdtempSync(join(root, prefix));
  dirs.push(d);
  return d;
};

function world(approvals: string) {
  const dir = scratch("rm-run-");
  const bin = join(dir, "gstack-approvals");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const file = join(dir, "approvals.md");
  writeFileSync(file, approvals);
  const env = { GSTACK_EVALS_APPROVALS_BIN: bin, GSTACK_EVALS_LEDGER_RECORD: join(dir, "record"), GSTACK_EVALS_LEDGER: join(dir, "ledger.sqlite"), PATH: process.env.PATH ?? "" };
  const run = async (...argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s) }, env);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  return { dir, file, env, run };
}

const approvalsText = () => Object.values(QUOTES).filter((q) => q.in === "approvals").map((q) => "- " + q.words).join("\n") + "\n";
const lines = (text: string, tag: string) => text.split("\n").filter((l) => l.startsWith(tag + " ")).map((l) => l.split(" ")[1]);

describe("rm-run items", () => {
  test("records the envelope and every item with its words, holds on a rerun and raises on a path", async () => {
    const w = world(approvalsText());
    const first = await w.run("items", "--approvals", w.file);
    expect(first.err).toBe("");
    expect(first.code).toBe(0);
    expect(first.out).toContain("ENVELOPE geva590-pilot $1034 (each arm's line $414)");
    const withWords = rmItems().map((i) => i.item);
    expect(lines(first.out, "INIT").toSorted()).toEqual(withWords.toSorted());
    expect(withWords).toHaveLength(20);
    const env = envelopeStatus(join(w.dir, "record"), PILOT_PROGRAM);
    expect(env.items.toSorted()).toEqual(RM_CELLS.map((c) => "geva590-pilot-" + c.id.toLowerCase()).toSorted());
    expect(env.program).toMatchObject({ cap_micros: 1034 * 1e6, skill_cap_micros: 414 * 1e6, skills: RM_CELLS.map((c) => armId(c.arm, c.model)) });
    expect(env.program.quotes).toEqual([{ words: QUOTES.envelope.words, by: "gstack-evals Captain (GEVA-2)", source: QUOTES.envelope.source }]);
    for (const item of ["geva590-visibility", "geva590-probes", "geva590-judge", "geva590-labels"]) expect(ledgerStatus(join(w.dir, "record"), item)[0]!.approval!.quotes).toEqual([{ words: "Approved by the gstack-evals Captain, 2026-11-25, inside the recorded all-in caps.", by: "gstack-evals Captain (GEVA-2)", source: QUOTES.items.source }]);
    const again = await w.run("items", "--approvals", w.file);
    expect(again.code).toBe(0);
    expect(lines(again.out, "HELD").toSorted()).toEqual(withWords.toSorted());
    expect(lines(again.out, "INIT")).toEqual([]);
    const full = await w.run("items", "--approvals", w.file, "--path", "full");
    expect(full.code).toBe(0);
    expect(lines(full.out, "RAISE").toSorted()).toEqual(["geva590-judge", "geva590-retry"]);
    expect(full.out).toContain("RAISE geva590-retry $987");
    expect(full.out).toContain("RAISE geva590-judge $100");
    const fable = await w.run("items", "--approvals", w.file, "--path", "fable-leaves");
    expect(lines(fable.out, "RAISE").toSorted()).toEqual(["geva590-validation-n", "geva590-validation-oa", "geva590-validation-os"]);
    expect(fable.out).toContain("RAISE geva590-validation-oa $331.5");
  }, 60_000);

  test("a dry run prints the ledger calls and records nothing", async () => {
    const w = world(approvalsText());
    const r = await w.run("items", "--approvals", w.file, "--dry-run");
    expect(r.code).toBe(0);
    expect(r.out).toContain("WOULD gstack-evals ledger envelope --program geva590-pilot --cap 1034 --skill-cap 414 --skills gstack-sol-opus,gstack-astra-opus,gstack-sol-fable,gstack-astra-fable,none-opus --credit-rate 1 --words");
    expect(r.out).toContain("WOULD gstack-evals ledger init --cap 120 --item geva590-pilot-os --admission required --program geva590-pilot --skills gstack-sol-opus --words");
    expect(existsSync(join(w.dir, "record"))).toBe(false);
  });

  test("a quote missing from the approvals file records nothing", async () => {
    const w = world(approvalsText().replace(QUOTES.retryRule.words, "reruns stop"));
    const r = await w.run("items", "--approvals", w.file);
    expect(r.code).toBe(2);
    expect(r.err).toStartWith("E_RM_RUN rm-run items: 1 quote is not in the record verbatim");
    expect(r.err).toContain("If the reserve runs out during the run");
    expect(existsSync(join(w.dir, "record"))).toBe(false);
  });

  test("the envelope admits the five pilot leases at exactly $1,034 and refuses a cent more", async () => {
    const w = world(approvalsText());
    expect((await w.run("items", "--approvals", w.file)).code).toBe(0);
    const record = join(w.dir, "record");
    const status = new Map(ledgerStatus(record).map((s) => [s.item, s]));
    const cells = pilotCellItems((i) => status.get(i)!.left_micros / 1e6).cells;
    const local = LocalLedger.open(join(w.dir, "run-host.sqlite"));
    const lease = (item: string, usd: number) => {
      try {
        openLease(record, local, { item, run_id: "geva590-pilot-" + item, amount_micros: Math.round(usd * 1e6), requireAdmission: () => null });
        return "ok";
      } catch (e) {
        if (e instanceof LedgerError) return e.code;
        throw e;
      }
    };
    const [first, ...rest] = Object.values(cells);
    for (const c of rest) expect(lease(c.item, c.cap_usd)).toBe("ok");
    expect(lease(first!.item, first!.cap_usd + 0.01)).toBe("ENVELOPE_PROGRAM_STOP");
    expect(lease(first!.item, first!.cap_usd)).toBe("ok");
    expect(envelopeStatus(record, PILOT_PROGRAM).total).toMatchObject({ open_micros: 1034 * 1e6, left_micros: 0 });
    expect(lease("geva590-retry", 1)).toBe("ok");
  });
});

const drawn = (id: string, pool: string) => ({ id, pool, repo: id.split("#")[0]!, flags: null });
const unitId = (n: number, pr = n) => "o/r" + n + "#" + pr + "@" + String(n).padStart(12, "0");

describe("the pilot plan", () => {
  test("pilotUnits takes 5 P, 5 B and the decoy, sorted, and refuses any other shape", () => {
    const d = { schema: "rm-draw.v1", draw_seed: 1, pilot: { p: [1, 2, 3, 4, 5].map((n) => drawn(unitId(n), "P")), b: [6, 7, 8, 9, 10].map((n) => drawn(unitId(n, 0), "B")), decoy: drawn(unitId(11), "decoy") }, validation: [], counted: [], decoys: [], capped: [] } as unknown as Draw;
    const ids = pilotUnits(d);
    expect(ids).toHaveLength(11);
    expect(ids).toEqual(ids.toSorted());
    expect(() => pilotUnits({ ...d, pilot: { ...d.pilot, b: d.pilot.b.slice(1) } })).toThrow("E_RM_RUN the draw's pilot holds 5 P, 4 B");
    expect(() => pilotUnits({ ...d, schema: "x" } as unknown as Draw)).toThrow("E_RM_RUN");
  });

  test("pilotCellItems leases each cell's own item at its worst case, landing exactly on the envelope", () => {
    const left = new Map<string, number>([["geva590-pilot-os", 120], ["geva590-pilot-oa", 224], ["geva590-pilot-fs", 310], ["geva590-pilot-fa", 414], ["geva590-pilot-n", 11], ["geva590-retry", 295]]);
    const items = pilotCellItems((i) => left.get(i) ?? null);
    expect(Object.keys(items.cells).toSorted()).toEqual(RM_CELLS.map((c) => armId(c.arm, c.model)).toSorted());
    const want = { OS: 115.5, OA: 214.5, FS: 297, FA: 396, N: 11 };
    for (const c of RM_CELLS) expect(items.cells[armId(c.arm, c.model)]).toEqual({ item: "geva590-pilot-" + c.id.toLowerCase(), cap_usd: want[c.id], allowance_usd: SESSION_ALLOWANCE_USD[c.id] });
    expect([SESSION_ALLOWANCE_USD.N, REVIEW_CAP_USD.N]).toEqual([3, 1]);
    expect(Object.values(items.cells).reduce((s, c) => s + c.cap_usd, 0)).toBe(PILOT_ENVELOPE_USD);
    expect(items.retry).toEqual({ item: "geva590-retry", run_id: "geva590-retry", cap_usd: 295 });
    expect(pilotCellItems((i) => (i === "geva590-retry" ? 0 : left.get(i)!)).retry).toBeNull();
    expect(pilotCellItems((i) => (i === "geva590-pilot-fa" ? 100 : left.get(i)!)).cells["gstack-astra-fable"]!.cap_usd).toBe(100);
    expect(() => pilotCellItems((i) => (i === "geva590-pilot-fa" ? 35 : left.get(i)!))).toThrow("geva590-pilot-fa has $35.00 left, under one session's allowance of $36");
    expect(() => pilotCellItems((i) => (i === "geva590-retry" ? null : left.get(i)!))).toThrow("geva590-retry has no approved cap");
  });

  test("the pilot argv carries the seed, the cell items, the web_search removal, the record and no-op install and test", () => {
    const plan = scratch("rm-plan-");
    const ids = [unitId(1), unitId(2, 0), unitId(3)];
    writeFileSync(join(plan, "pilot-units.txt"), ids.join("\n") + "\n");
    const argv = pilotArgv({ plan, unitRepos: "/u", out: "/o", record: "/run-host/record", upstream: "http://stub", dryRun: true });
    const after = (flag: string, n = 1) => argv.slice(argv.indexOf(flag) + 1, argv.indexOf(flag) + 1 + n);
    expect(after("--units", 3)).toEqual(ids);
    expect(after("--install", 3)).toEqual(["o/r1=true", "o/r2=true", "o/r3=true"]);
    expect(after("--test", 3)).toEqual(["o/r1=true", "o/r2=true", "o/r3=true"]);
    expect(after("--record")).toEqual(["/run-host/record"]);
    expect(after("--order-seed")).toEqual([String(ORDER_SEED)]);
    expect(after("--cell-items")).toEqual([join(plan, "cell-items.json")]);
    expect(after("--parallel")).toEqual(["5"]);
    expect(after("--upstream")).toEqual(["http://stub"]);
    expect(argv).toContain("--remove-voice-web-search");
    expect(argv.at(-1)).toBe("--dry-run");
  });
});

function toyUnits() {
  const settings = JSON.stringify({ hooks: { Stop: [] }, permissions: { allow: ["Bash"] }, model: "x" });
  const source = tree({ "package.json": "{\"name\":\"toy\"}\n", "src/app.ts": "export const add = (a: number, b: number) => a + b;\n", ".claude/settings.json": settings, ".mcp.json": "{}\n", "CLAUDE.md": "toy\n" });
  commitAll(source, "initial");
  git(source, "branch", "-M", "main");
  writeFileSync(join(source, "src/app.ts"), "export const add = (a: number, b: number) => a - b;\n");
  git(source, "commit", "-q", "-am", "simplify add");
  const bic = git(source, "rev-parse", "HEAD");
  const base = git(source, "rev-parse", "HEAD^");
  git(source, "checkout", "-q", "-b", "feature");
  writeFileSync(join(source, "src/app.ts"), "export const add = (a: number, b: number) => a + b + 0;\n");
  git(source, "commit", "-q", "-am", "feature change");
  const head = git(source, "rev-parse", "HEAD");
  git(source, "checkout", "-q", "main");
  const build = scratch("rm-units-");
  const refs = [
    { id: "o/toy#7@" + head.slice(0, 12), repo: "o/toy", pr: 7, head, base: bic },
    { id: "o/toy#0@" + bic.slice(0, 12), repo: "o/toy", pr: 0, head: bic, base },
  ];
  const rows = refs.map((unit) => {
    const built = buildChecked({ unit, source, dest: builtDir(build, unit.id), needles: { strings: [], fix: "0".repeat(40) } });
    return { id: unit.id, repo: built.repo, instructions: built.instructions, problems: built.problems };
  });
  writeFileSync(join(build, "units.json"), JSON.stringify(rows, null, 2));
  return { build, rows, ids: refs.map((r) => r.id) };
}

describe("prebuilt unit repositories", () => {
  test("a P and a B unit load as built, stripped config stays stripped, and the history check stays clean on a copy", () => {
    const t = toyUnits();
    for (const row of t.rows) expect(row.problems).toEqual([]);
    const loaded = loadUnitRepos(t.build, t.ids);
    expect(loaded.suite).toMatchObject({ id: "unit-repos", sealed: true });
    expect(loaded.units.map((u) => [u.pr, u.repo])).toEqual([[7, "o/toy"], [0, "o/toy"]]);
    for (const id of t.ids) {
      const dir = builtDir(t.build, id);
      expect(JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"))).toEqual({ model: "x" });
      expect(existsSync(join(dir, ".mcp.json"))).toBe(false);
      expect(historyProblems(dir, loaded.repos.get(id)!)).toEqual([]);
      const copy = join(scratch("rm-copy-"), "u");
      cpSync(dir, copy, { recursive: true });
      expect(historyProblems(copy, { ...loaded.repos.get(id)!, dir: copy })).toEqual([]);
    }
    expect(() => loadUnitRepos(t.build, ["o/toy#9@000000000000"])).toThrow("not in");
    const rows = JSON.parse(readFileSync(join(t.build, "units.json"), "utf8"));
    rows[0].problems = ["gate 4 refused it"];
    writeFileSync(join(t.build, "units.json"), JSON.stringify(rows));
    expect(() => loadUnitRepos(t.build, t.ids)).toThrow("the build refused it: gate 4 refused it");
  }, 60_000);

  test("rm-run pilot --dry-run plans all five cells on the prebuilt units", async () => {
    const t = toyUnits();
    const plan = scratch("rm-plan-");
    writeFileSync(join(plan, "pilot-units.txt"), t.ids.join("\n") + "\n");
    const left = (i: string) => (i === "geva590-retry" ? 295 : 500);
    writeFileSync(join(plan, "cell-items.json"), JSON.stringify(pilotCellItems(left)));
    const out = join(scratch("rm-out-", join(homedir(), ".cache", "gstack-evals-tests")), "run");
    const env = { PATH: process.env.PATH ?? "", HOME: homedir(), ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "" };
    const o: string[] = [];
    const e: string[] = [];
    const code = await main(["pilot", "--plan", plan, "--unit-repos", t.build, "--ledger-record", join(plan, "record"), "--out", out, "--upstream", "http://127.0.0.1:9", "--dry-run"], { out: (s) => o.push(s), err: (s) => e.push(s) }, env);
    const text = o.join("\n");
    expect(e.join("\n")).toBe("");
    expect(code).toBe(0);
    expect(text).toContain("review-units dry run: nothing is built, written or spent");
    expect(text).toContain(String(ORDER_SEED));
    for (const c of RM_CELLS) expect(text).toContain(armId(c.arm, c.model));
    expect(existsSync(out)).toBe(false);
  }, 60_000);
});
