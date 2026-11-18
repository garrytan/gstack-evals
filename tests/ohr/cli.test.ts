// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the lane's entry files: src/cli.ts reaches lanes/office-hours-rewrite/cli.ts by a path string, so this test imports the cli, wire, dry run, e2e and preflight directly; every sealed path is refused inside the repo; Astra routes to GPT-6.2 Astra at its priced row; fails_when=a file stops loading, the help loses a command, a command takes an output path inside the repo, an "astra" call reaches gpt-6-astra, or judge-check's exit stops matching its codes' exit 3 on a FAIL or NO READ.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMANDS } from "../../src/cli.ts";
import { CODES } from "../../src/errors/codes.ts";
import { chatPrice } from "../../src/runner/pricing/prices.ts";
import { main, outside, SUBCOMMANDS } from "../../lanes/office-hours-rewrite/cli.ts";
import { dryRun } from "../../lanes/office-hours-rewrite/dryrun.ts";
import { PLANTED_KEYS, scorePass } from "../../lanes/office-hours-rewrite/e2e-score.ts";
import { JUDGE_MODEL_KEYS } from "../../lanes/office-hours-rewrite/frozen.ts";
import { pinSource } from "../../lanes/office-hours-rewrite/preflight.ts";
import { checkInput, faithful, type Says } from "../../lanes/office-hours-rewrite/score/fixtures.ts";
import { ASTRA, routed } from "../../lanes/office-hours-rewrite/wire.ts";
import { MODELS } from "../../lanes/product-value/meter.ts";

const REPO = join(import.meta.dir, "..", "..");
const io = () => {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
};

describe("gstack-evals ohr", () => {
  test("src/cli.ts mounts ohr at this lane's cli.ts, owned by U20", () => {
    expect(COMMANDS.find((c) => c.name === "ohr")).toMatchObject({ module: "lanes/office-hours-rewrite/cli.ts", owner: "U20" });
  });

  test("the help lists every command the build mounts", async () => {
    const t = io();
    expect(await main(["--help"], t.io, {})).toBe(0);
    const names = ["author", "audit", "run", "rows", "score", "judge-check", "read", "dryrun", "e2e", "preflight"];
    expect(Object.keys(SUBCOMMANDS).sort()).toEqual(names.sort());
    for (const n of names) expect(t.out.join("\n")).toContain("  " + n + " ");
  });

  test("an unknown command exits 2 with E_USAGE", async () => {
    const t = io();
    expect(await main(["nope"], t.io, {})).toBe(2);
    expect(t.err.join("\n")).toMatch(/^E_USAGE /);
  });

  test("a sealed path inside the repo is refused, one outside it is kept", () => {
    expect(() => outside("--out", join(REPO, "x"))).toThrow(/inside the repository/);
    expect(outside("--out", "/dev/shm/ohr-x")).toBe("/dev/shm/ohr-x");
  });

  for (const [argv, flag] of [
    [["audit", "--briefs-dir", "/dev/shm/b", "--item", "i", "--spend-cap", "1", "--out", join(REPO, "audit.json")], "--out"],
    [["score", "packets", "--stage", "1", "--briefs-dir", join(REPO, "briefs"), "--launch", "/dev/shm/l", "--packets", "/dev/shm/p", "--map", "/dev/shm/m.json"], "--briefs-dir"],
    [["score", "judges", "--packets", "/dev/shm/p", "--map", join(REPO, "map.json"), "--item", "i", "--spend-cap", "1", "--out", "/dev/shm/l.ndjson"], "--map"],
    [["judge-check", "--map", join(REPO, "check.json"), "--out", "/dev/shm/c"], "--map"],
    [["read", "report", "--scored", "/dev/shm/s.json", "--out", join(REPO, "report.json")], "--out"],
    [["author", "--work", "/dev/shm/ohr-w", "--out", join(REPO, "sealed.age"), "--recipients", "r", "--identity", "k", "--reuse", "/dev/shm/first.age", "--gstack", "g", "--item", "i", "--spend-cap", "1"], "--out"],
    [["author", "--work", "/dev/shm/ohr-w", "--out", "/dev/shm/ohr-never.age", "--recipients", "r", "--identity", "k", "--resume", join(REPO, "checkpoint-000010.age"), "--gstack", "g", "--item", "i", "--spend-cap", "1"], "--resume"],
    [["author", "--work", "/dev/shm/ohr-w", "--out", "/dev/shm/ohr-never.age", "--recipients", "r", "--identity", "k", "--reuse", join(REPO, "first.age"), "--gstack", "g", "--item", "i", "--spend-cap", "1"], "--reuse"],
  ] as const) {
    test("ohr " + argv[0] + (argv[0] === "score" || argv[0] === "read" ? " " + argv[1] : "") + " refuses " + flag + " inside the repo before it reads or spends", async () => {
      const t = io();
      expect(await main([...argv], t.io, {})).toBe(2);
      expect(t.err.join("\n")).toContain(flag + " " + REPO);
      expect(t.err.join("\n")).toContain("inside the repository");
    });
  }

  test("ohr author has no pilot-only stop: the flag is refused before it reads or spends", async () => {
    const t = io();
    expect(await main(["author", "--work", "/dev/shm/ohr-w", "--out", "/dev/shm/ohr-sealed.age", "--recipients", "r", "--identity", "k", "--reuse", "/dev/shm/first.age", "--gstack", "g", "--item", "i", "--spend-cap", "1", "--pilot-only"], t.io, {})).toBe(2);
    expect(t.err.join("\n")).toContain('unknown argument "--pilot-only"');
  });

  test("ohr author keeps plaintext briefs under /dev/shm", async () => {
    const t = io();
    expect(await main(["author", "--work", "/tmp/ohr-w", "--out", "/dev/shm/x.age", "--recipients", "r", "--identity", "k", "--reuse", "/dev/shm/first.age", "--gstack", "g", "--item", "i", "--spend-cap", "1"], t.io, {})).toBe(2);
    expect(t.err.join("\n")).toContain("is not under /dev/shm");
  });

  test("ohr read decision needs every launch, the ledger record and the sealed authoring output, so no cap stop is read from a flag alone", async () => {
    const t = io();
    expect(await main(["read", "decision", "--scored", "/dev/shm/s.json", "--admission", "/dev/shm/a.json", "--judge-check", "/dev/shm/c.json", "--hand-reads", "/dev/shm/h.json", "--out", "/dev/shm/ohr-never.json", "--cap-stop"], t.io, {})).toBe(2);
    expect(t.err.join("\n")).toContain("ohr read decision needs --launch");
    for (const flag of ["--record", "--authoring", "--identity"]) {
      const u = io();
      const argv = ["read", "decision", "--scored", "/dev/shm/s.json", "--admission", "/dev/shm/a.json", "--judge-check", "/dev/shm/c.json", "--hand-reads", "/dev/shm/h.json", "--launch", "/dev/shm/l", "--record", "/dev/shm/r", "--authoring", "/dev/shm/a.age", "--identity", "k", "--out", "/dev/shm/ohr-never.json"];
      argv.splice(argv.indexOf(flag), 2);
      expect(await main(argv, u.io, {})).toBe(2);
      expect(u.err.join("\n")).toContain("ohr read decision needs " + flag);
    }
  });

  test("ohr author takes one of --reuse, for a new run, and --resume, for a stopped one, before it reads or spends", async () => {
    const base = ["author", "--work", "/dev/shm/ohr-w", "--out", "/dev/shm/ohr-never.age", "--recipients", "r", "--identity", "k", "--gstack", "g", "--item", "i", "--spend-cap", "1"];
    for (const extra of [[], ["--reuse", "/dev/shm/first.age", "--resume", "/dev/shm/c/checkpoint-000010.age"]]) {
      const t = io();
      expect(await main([...base, ...extra], t.io, {})).toBe(2);
      expect(t.err.join("\n")).toContain("takes one of --reuse, for a new run, and --resume, for a stopped one");
    }
    const t = io();
    expect(await main([...base, "--reuse", "/dev/shm/first.age", "--meter", "/tmp/ohr-meter"], t.io, {})).toBe(2);
    expect(t.err.join("\n")).toContain("is not an existing meter directory under /dev/shm");
  });

  test("every astra request goes to GPT-6.2 Astra, which has its own price row; the meter's astra key is unchanged", () => {
    expect(routed("astra")).toBe(ASTRA);
    expect(routed("opus")).toBe("opus");
    expect(MODELS[ASTRA]).toEqual({ provider: "openai", id: "gpt-6.2-astra" });
    expect("openai/" + MODELS[ASTRA].id).toBe(JUDGE_MODEL_KEYS.astra);
    expect(MODELS.astra.id).toBe("gpt-6-astra");
    expect(chatPrice("openai:gpt-6.2-astra")).toMatchObject({ input: 8, output: 40, cache_read: 0.4, cache_write: 10, long: { above_input_tokens: 272_000, input: 16, output: 60 } });
  });

  test("ohr judge-check exits 0 when both judges pass, and 3, its codes' exit, on a FAIL or a NO READ", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ohr-judge-check-"));
    const check = async (name: string, o: Parameters<typeof checkInput>[0], says: Says) => {
      const { map, gold, labels } = checkInput(o, says);
      const nd = (rows: readonly unknown[]) => rows.map((l) => JSON.stringify(l)).join("\n") + "\n";
      const files = { map: join(dir, name + "-map.json"), gold: join(dir, name + "-gold.ndjson"), labels: join(dir, name + "-labels.ndjson") };
      writeFileSync(files.map, JSON.stringify(map));
      writeFileSync(files.gold, nd(gold));
      writeFileSync(files.labels, nd([...labels, ...labels.map((l) => ({ ...l, judge: "opus", model_id: "opus" }))]));
      const t = io();
      const code = await main(["judge-check", "--map", files.map, "--out", join(dir, name + "-out"), "--gold", files.gold, "--labels", files.labels], t.io, {});
      return { code, err: t.err.join("\n") };
    };
    expect((await check("pass", { session: 40, near: 4, stock: 3 }, faithful)).code).toBe(0);
    const failed = await check("fail", { session: 40, near: 4, stock: 3 }, (b, i, kind) => (kind === "stock" ? [true, true] : faithful(b, i, kind)));
    expect(failed.err).toContain("E_OHR_JUDGE_CHECK_FAIL");
    expect(failed.code).toBe(CODES.E_OHR_JUDGE_CHECK_FAIL.exit);
    const unread = await check("unread", { session: 10, near: 4, stock: 3 }, faithful);
    expect(unread.err).toContain("E_OHR_JUDGE_CHECK_NO_READ");
    expect(unread.code).toBe(CODES.E_OHR_JUDGE_CHECK_NO_READ.exit);
    expect([CODES.E_OHR_JUDGE_CHECK_FAIL.exit, CODES.E_OHR_JUDGE_CHECK_NO_READ.exit]).toEqual([3, 3]);
  });

  test("the e2e scoring pass, the dry run and the preflight load", () => {
    expect(typeof scorePass).toBe("function");
    expect(typeof dryRun).toBe("function");
    expect(typeof pinSource).toBe("function");
    expect(Object.keys(PLANTED_KEYS).sort()).toEqual(["fx-build", "fx-t8"]);
  });

  test("the pregate runs this test when an entry file changes", () => {
    const deps = (JSON.parse(readFileSync(join(REPO, ".gstack", "pregate.json"), "utf8")) as { dependencies: Record<string, string[]> }).dependencies;
    expect(deps["lanes/office-hours-rewrite/**"]).toContain("tests/ohr/cli.test.ts");
  });
});
