import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main, probeTranscripts } from "../../lanes/day-one/cli.ts";
import { read, type ScoredBuild } from "../../lanes/day-one/analysis.ts";
import { PROBE_QUESTIONS } from "../../lanes/day-one/frozen.ts";
import { fixtureUnit } from "../../lanes/day-one/dryrun.ts";

const run = async (argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

const onShm = (() => {
  try {
    return readFileSync("/proc/mounts", "utf8").split("\n").some((l) => l.split(" ")[1] === "/dev/shm" && ["tmpfs", "ramfs"].includes(l.split(" ")[2] ?? ""));
  } catch {
    return false;
  }
})();

const planRow = (stage: "base" | "review", unit: string, arm: "n" | "d", words: number) => ({ id: stage + "/" + unit + "/r1/" + arm, cell: { stage, unit, rep: 1, arm }, state: "scored", usd: 1, voice_usd: 0, owner_usd: 0, plan: { sha256: "x", words, from: "plan.md" } });
const verdicts = (done: boolean[]) => ({ kind: "ok", tasks: done.map((d, i) => ({ id: "t" + (i + 1), done: d, why: "seen" })) });
const checkRow = (unit: string, arm: string, done: boolean[]) => ({ id: "check/" + unit + "/r1/" + arm, cell: { stage: "check", unit, rep: 1, arm }, state: "scored", usd: 3, check: { started: true, parse: verdicts(done), score: { done }, app_writes: [] } });
const stageDir = (out: string, name: string, rows: unknown[], manifest?: { units: string[]; reps: number[]; checker_sha256?: string }) => {
  mkdirSync(join(out, name), { recursive: true });
  writeFileSync(join(out, name, "rows.ndjson"), rows.map((r) => JSON.stringify(r) + "\n").join(""));
  if (manifest) writeFileSync(join(out, name, "manifest.json"), JSON.stringify(manifest));
};

describe.skipIf(!onShm)("day-one read", () => {
  test("a reading takes plans only from the units and reps of its check stages, and counts only with both receipts", async () => {
    const dir = mkdtempSync("/dev/shm/day-one-read-");
    try {
      const units = join(dir, "units");
      for (const id of ["cccccc", "pppppp"]) fixtureUnit(units, id, 2);
      const out = join(dir, "out");
      stageDir(out, "base-counted", [planRow("base", "cccccc", "n", 100)]);
      stageDir(out, "review-counted", [planRow("review", "cccccc", "d", 100)]);
      stageDir(out, "check-counted", [checkRow("cccccc", "n", [true, false, false, false, false]), checkRow("cccccc", "d", [true, true, false, false, false])], { units: ["cccccc"], reps: [1] });
      stageDir(out, "base-smoke", [planRow("base", "pppppp", "n", 0)]);
      stageDir(out, "review-smoke", [planRow("review", "pppppp", "d", 0)]);
      stageDir(out, "check-smoke", [], { units: ["pppppp"], reps: [1] });
      const argv = (tag: string) => ["read", "--out", out, "--units-dir", units, "--tag", tag, "--arms", "n", "d"];

      const counted = await run(argv("counted"));
      expect(counted.code).toBe(0);
      const c = JSON.parse(counted.out);
      expect(c.arms.n.briefs).toBe(1);
      expect(c.comparisons["d-n"].briefs).toBe(1);
      expect(c.arms.d.share).toBe(0.4);
      expect(c.arms.d.cost_per_brief).toBe(4);
      expect(c.counted).toBe(false);
      expect(c.r107).toBe("not counted");
      expect(c.blocked.length).toBe(2);

      writeFileSync(join(out, "validation.json"), JSON.stringify({ admitted: true }));
      writeFileSync(join(out, "fixtures-real.json"), JSON.stringify({ passed: true }));
      const gated = JSON.parse((await run(argv("counted"))).out);
      expect(gated.counted).toBe(true);
      expect(gated.r107).toBe("undecided");

      const smoke = JSON.parse((await run(argv("smoke"))).out);
      expect(smoke.arms.n.briefs).toBe(1);
      expect(smoke.arms.n.share).toBe(0);

      const missing = await run(argv("nosuch"));
      expect(missing.code).toBe(2);
      expect(missing.err).toContain("no check stage manifest");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a passing validation counts a reading only when it scored that reading's check stages", async () => {
    const dir = mkdtempSync("/dev/shm/day-one-read-");
    try {
      const units = join(dir, "units");
      fixtureUnit(units, "cccccc", 2);
      const out = join(dir, "out");
      stageDir(out, "base-counted", [planRow("base", "cccccc", "n", 100)]);
      stageDir(out, "review-counted", [planRow("review", "cccccc", "d", 100)]);
      stageDir(out, "check-counted", [checkRow("cccccc", "n", [true, false, false, false, false]), checkRow("cccccc", "d", [true, true, false, false, false])], { units: ["cccccc"], reps: [1], checker_sha256: "repaired" });
      writeFileSync(join(out, "fixtures-real.json"), JSON.stringify({ passed: true }));
      const argv = ["read", "--out", out, "--units-dir", units, "--tag", "counted", "--arms", "n", "d"];
      writeFileSync(join(out, "validation.json"), JSON.stringify({ admitted: true, tags: ["repaired"], checker_sha256: "repaired" }));
      const other = JSON.parse((await run(argv)).out);
      expect(other.counted).toBe(false);
      expect(other.blocked).toEqual(["the checker validation scored repaired, not this reading's check stages"]);
      writeFileSync(join(out, "validation.json"), JSON.stringify({ admitted: true, tags: ["counted"], checker_sha256: "repaired" }));
      expect(JSON.parse((await run(argv)).out).counted).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a passing validation counts a reading only when every check stage in it ran the checker that was validated", async () => {
    const dir = mkdtempSync("/dev/shm/day-one-read-");
    try {
      const units = join(dir, "units");
      fixtureUnit(units, "cccccc", 2);
      const out = join(dir, "out");
      stageDir(out, "base-counted", [planRow("base", "cccccc", "n", 100)]);
      stageDir(out, "review-counted", [planRow("review", "cccccc", "d", 100)]);
      stageDir(out, "check-frozen", [checkRow("cccccc", "n", [false, false, false, false, false]), checkRow("cccccc", "d", [false, false, false, false, false])], { units: ["cccccc"], reps: [1] });
      stageDir(out, "check-counted", [checkRow("cccccc", "n", [true, false, false, false, false]), checkRow("cccccc", "d", [true, true, false, false, false])], { units: ["cccccc"], reps: [1], checker_sha256: "repaired" });
      stageDir(out, "check-counted-s", [], { units: ["cccccc"], reps: [1], checker_sha256: "repaired" });
      writeFileSync(join(out, "fixtures-real.json"), JSON.stringify({ passed: true }));
      const argv = (...tags: string[]) => ["read", "--out", out, "--units-dir", units, "--tag", ...tags, "--arms", "n", "d"];
      writeFileSync(join(out, "validation.json"), JSON.stringify({ admitted: true, tags: ["counted"], checker_sha256: "repaired" }));
      const mixed = JSON.parse((await run(argv("frozen", "counted"))).out);
      expect(mixed.counted).toBe(false);
      expect(mixed.blocked).toEqual(["the checker validation scored checker repaired, and this reading's check stages ran none, repaired"]);
      const shared = JSON.parse((await run(argv("counted", "counted-s"))).out);
      expect(shared.counted).toBe(true);
      expect(shared.arms.d.share).toBe(0.4);
      writeFileSync(join(out, "validation.json"), JSON.stringify({ admitted: true, tags: ["counted"] }));
      expect(JSON.parse((await run(argv("counted"))).out).blocked).toEqual(["the checker validation scored checker none, and this reading's check stages ran repaired"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a reading carries each session's frozen exposure reading from its review row", async () => {
    const dir = mkdtempSync("/dev/shm/day-one-read-");
    try {
      const units = join(dir, "units");
      fixtureUnit(units, "cccccc", 2);
      const out = join(dir, "out");
      stageDir(out, "base-counted", [planRow("base", "cccccc", "n", 100)]);
      stageDir(out, "review-counted", [{ ...planRow("review", "cccccc", "d", 100), exposure: { exposed: true, final_gate: true, exposed_frozen: false, voice: "astra" } }]);
      stageDir(out, "check-counted", [checkRow("cccccc", "n", [true, false, false, false, false]), checkRow("cccccc", "d", [true, true, false, false, false])], { units: ["cccccc"], reps: [1] });
      const c = JSON.parse((await run(["read", "--out", out, "--units-dir", units, "--tag", "counted", "--arms", "n", "d"])).out);
      expect(c.arms.d.exposed).toEqual({ yes: 1, no: 0 });
      expect(c.arms.d.exposed_frozen).toEqual({ yes: 0, no: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("day-one stage", () => {
  test("--parallel below 1 or not a whole number is refused before anything opens", async () => {
    for (const v of ["0", "-1", "1.5", "two"]) {
      const r = await run(["stage", "--parallel", v]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("--parallel is a whole number from 1");
    }
  });
  test("a units dir off a RAM-backed mount is refused before anything opens", async () => {
    const r = await run(["stage", "--stage", "base", "--arms", "n", "--units-dir", import.meta.dir, "--units", "aaaaaa"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("is not on a RAM-backed mount");
  });
  test("every command that reads sealed plaintext refuses a path off a RAM-backed mount", async () => {
    const d = import.meta.dir;
    for (const argv of [["units", "--units-dir", d, "--units", "aaaaaa"], ["read", "--out", d, "--units-dir", d, "--tag", "t", "--arms", "n"], ["controls", "--units-dir", d, "--labels", join(d, "x")], ["gold", "--labels", join(d, "x"), "--gold", join(d, "y")], ["validate", "score", "--out", d, "--tag", "t", "--key", join(d, "k"), "--labels", join(d, "x")]]) {
      const r = await run(argv);
      expect(r.code).toBe(2);
      expect(r.err).toContain("is not on a RAM-backed mount");
    }
  });
});

describe.skipIf(!onShm)("day-one validate", () => {
  test("a seeded, blinded draw of 12 builds, 3 per arm, then kappa on done against the checker", async () => {
    const shm = mkdtempSync("/dev/shm/day-one-validate-");
    try {
      const units = join(shm, "units");
      const out = join(shm, "out");
      const ids = ["aaaaaa", "bbbbbb", "cccccc"];
      for (const id of ids) fixtureUnit(units, id, 2);
      const arms = ["n", "d", "r", "a"];
      const rows = ids.flatMap((u, i) => arms.map((a, j) => checkRow(u, a, [true, (i + j) % 2 === 0, j > 1, false, i === 2])));
      stageDir(out, "check-wave", rows, { units: ids, reps: [1] });
      for (const r of rows) {
        mkdirSync(join(out, "builds", r.cell.unit, "r1", r.cell.arm, "tree"), { recursive: true });
        writeFileSync(join(out, "builds", r.cell.unit, "r1", r.cell.arm, "tree", "start.sh"), "node server.js\n");
      }
      const dest = join(shm, "draw");
      const key = join(shm, "key.json");
      const drawn = await run(["validate", "draw", "--out", out, "--units-dir", units, "--tag", "wave", "--dest", dest, "--key", key]);
      expect(drawn.code).toBe(0);
      expect(drawn.out).toContain("drew 12 of 12 scored builds (a 3, d 3, n 3, r 3), 60 tasks");
      const labels = readdirSync(dest);
      expect(labels.length).toBe(12);
      expect(labels.some((l) => arms.includes(l) || ids.includes(l))).toBe(false);
      expect(existsSync(join(dest, labels[0]!, "app", "start.sh")) && existsSync(join(dest, labels[0]!, "tasks.json"))).toBe(true);

      const k = JSON.parse(readFileSync(key, "utf8")) as Record<string, { row: string; arm: string }>;
      const byId = new Map(rows.map((r) => [r.id, r]));
      const hand = (flip: boolean, list = labels) => list.map((l) => JSON.stringify({ label: l, tasks: byId.get(k[l]!.row)!.check.parse.tasks.map((t) => ({ id: t.id, done: flip ? !t.done : t.done })) })).join("\n") + "\n";
      writeFileSync(join(shm, "agree.ndjson"), hand(false));
      const agree = await run(["validate", "score", "--out", out, "--tag", "wave", "--key", key, "--labels", join(shm, "agree.ndjson")]);
      expect(agree.code).toBe(0);
      expect(JSON.parse(readFileSync(join(out, "validation.json"), "utf8"))).toMatchObject({ builds: 12, pairs: 60, kappa: 1, admitted: true });
      writeFileSync(join(shm, "flip.ndjson"), hand(true));
      const flip = await run(["validate", "score", "--out", out, "--tag", "wave", "--key", key, "--labels", join(shm, "flip.ndjson")]);
      expect(flip.code).toBe(2);
      expect(flip.err).toContain("E_DAYONE_VALIDATION");
      expect(JSON.parse(readFileSync(join(out, "validation.json"), "utf8")).admitted).toBe(false);
      writeFileSync(join(shm, "no-a.ndjson"), hand(false, labels.filter((l) => k[l]!.arm !== "a")));
      const noA = await run(["validate", "score", "--out", out, "--tag", "wave", "--key", key, "--labels", join(shm, "no-a.ndjson")]);
      expect(noA.code).toBe(2);
      expect(noA.err).toContain("3 drawn builds have no labels");
      writeFileSync(join(shm, "padded.ndjson"), labels.map((l) => { const ts = byId.get(k[l]!.row)!.check.parse.tasks; return JSON.stringify({ label: l, tasks: [...ts, ...ts, ...ts, ...ts].map((t) => ({ id: t.id, done: t.done })) }); }).join("\n") + "\n");
      const padded = await run(["validate", "score", "--out", out, "--tag", "wave", "--key", key, "--labels", join(shm, "padded.ndjson")]);
      expect(padded.code).toBe(0);
      expect(JSON.parse(readFileSync(join(out, "validation.json"), "utf8"))).toMatchObject({ pairs: 60, admitted: true });
      writeFileSync(join(shm, "partial.ndjson"), labels.map((l) => JSON.stringify({ label: l, tasks: byId.get(k[l]!.row)!.check.parse.tasks.slice(0, 4).map((t) => ({ id: t.id, done: t.done })) })).join("\n") + "\n");
      const partial = await run(["validate", "score", "--out", out, "--tag", "wave", "--key", key, "--labels", join(shm, "partial.ndjson")]);
      expect(partial.code).toBe(2);
      expect(partial.err).toContain("not exactly the build's 5 tasks");
      writeFileSync(join(shm, "twice.ndjson"), hand(false) + hand(false));
      expect((await run(["validate", "score", "--out", out, "--tag", "wave", "--key", key, "--labels", join(shm, "twice.ndjson")])).code).not.toBe(0);
      writeFileSync(join(shm, "conflict.ndjson"), labels.map((l) => { const ts = byId.get(k[l]!.row)!.check.parse.tasks; return JSON.stringify({ label: l, tasks: [...ts.map((t) => ({ id: t.id, done: t.done })), { id: ts[0]!.id, done: !ts[0]!.done }] }); }).join("\n") + "\n");
      const conflict = await run(["validate", "score", "--out", out, "--tag", "wave", "--key", key, "--labels", join(shm, "conflict.ndjson")]);
      expect(conflict.code).not.toBe(0);
      expect(conflict.err).toContain("labelled both done and not done");
    } finally {
      rmSync(shm, { recursive: true, force: true });
    }
  });

  test("a second draw with --exclude leaves out the first draw's builds, and the receipt names its check tags", async () => {
    const shm = mkdtempSync("/dev/shm/day-one-validate-");
    try {
      const units = join(shm, "units");
      const out = join(shm, "out");
      const ids = ["aaaaaa", "bbbbbb", "cccccc", "dddddd"];
      for (const id of ids) fixtureUnit(units, id, 2);
      const rows = ids.flatMap((u, i) => ["n", "d", "r", "a"].map((a, j) => checkRow(u, a, [true, (i + j) % 2 === 0, j > 1, false, i === 2])));
      stageDir(out, "check-wave", rows, { units: ids, reps: [1], checker_sha256: "repaired" });
      for (const r of rows) mkdirSync(join(out, "builds", r.cell.unit, "r1", r.cell.arm, "tree"), { recursive: true });
      const first = join(shm, "key1.json");
      expect((await run(["validate", "draw", "--out", out, "--units-dir", units, "--tag", "wave", "--dest", join(shm, "d1"), "--key", first, "--count", "8"])).code).toBe(0);
      const second = join(shm, "key2.json");
      const drawn = await run(["validate", "draw", "--out", out, "--units-dir", units, "--tag", "wave", "--dest", join(shm, "d2"), "--key", second, "--count", "8", "--exclude", first]);
      expect(drawn.code).toBe(0);
      expect(drawn.out).toContain("drew 8 of 8 scored builds");
      const cells = (k: string) => Object.values(JSON.parse(readFileSync(k, "utf8")) as Record<string, { unit: string; arm: string }>).map((c) => c.unit + "/" + c.arm);
      expect(cells(second).length).toBe(8);
      expect(cells(second).filter((c) => cells(first).includes(c))).toEqual([]);
      const k = JSON.parse(readFileSync(second, "utf8")) as Record<string, { row: string }>;
      const byId = new Map(rows.map((r) => [r.id, r]));
      writeFileSync(join(shm, "agree.ndjson"), Object.keys(k).map((l) => JSON.stringify({ label: l, tasks: byId.get(k[l]!.row)!.check.parse.tasks.map((t) => ({ id: t.id, done: t.done })) })).join("\n") + "\n");
      await run(["validate", "score", "--out", out, "--tag", "wave", "--key", second, "--labels", join(shm, "agree.ndjson")]);
      expect(JSON.parse(readFileSync(join(out, "validation.json"), "utf8"))).toMatchObject({ tags: ["wave"], checker_sha256: "repaired", builds: 8, pairs: 40, kappa: 1 });
    } finally {
      rmSync(shm, { recursive: true, force: true });
    }
  });

  test("a draw with no scored builds from one of N, D, R and A is never admitted, however well the rest agree", async () => {
    const shm = mkdtempSync("/dev/shm/day-one-validate-");
    try {
      const units = join(shm, "units");
      const out = join(shm, "out");
      const ids = ["aaaaaa", "bbbbbb", "cccccc"];
      for (const id of ids) fixtureUnit(units, id, 2);
      const rows = ids.flatMap((u, i) => ["n", "d", "r"].map((a, j) => checkRow(u, a, [true, (i + j) % 2 === 0, j > 1, false, i === 2])));
      stageDir(out, "check-wave", rows, { units: ids, reps: [1] });
      for (const r of rows) mkdirSync(join(out, "builds", r.cell.unit, "r1", r.cell.arm, "tree"), { recursive: true });
      const dest = join(shm, "draw");
      const key = join(shm, "key.json");
      expect((await run(["validate", "draw", "--out", out, "--units-dir", units, "--tag", "wave", "--dest", dest, "--key", key, "--count", "9"])).code).toBe(0);
      const k = JSON.parse(readFileSync(key, "utf8")) as Record<string, { row: string }>;
      const byId = new Map(rows.map((r) => [r.id, r]));
      writeFileSync(join(shm, "agree.ndjson"), readdirSync(dest).map((l) => JSON.stringify({ label: l, tasks: byId.get(k[l]!.row)!.check.parse.tasks.map((t) => ({ id: t.id, done: t.done })) })).join("\n") + "\n");
      const score = await run(["validate", "score", "--out", out, "--tag", "wave", "--key", key, "--labels", join(shm, "agree.ndjson")]);
      expect(score.code).toBe(2);
      expect(score.err).toContain("builds for a");
      expect(JSON.parse(readFileSync(join(out, "validation.json"), "utf8"))).toMatchObject({ pairs: 45, kappa: 1, admitted: false });
    } finally {
      rmSync(shm, { recursive: true, force: true });
    }
  });
});

test("a reading counts each arm's builds whose app never started", () => {
  const build = (arm: "n" | "a", started: boolean | null): ScoredBuild => ({ unit: "u" + arm + String(started), rep: 1, arm, done: started ? [true, false, false, false, false] : [false, false, false, false, false], empty_plan: false, contaminated: false, implied: [false, false, false, false, false], obvious: false, started });
  const r = read([build("n", false), build("n", true), build("a", true), build("a", null)], ["n", "a"]);
  expect(r.arms.n!.not_started).toBe(1);
  expect(r.arms.a!.not_started).toBe(0);
});

test("a reading prints the frozen exposure reading beside the one sessions are exposed under", () => {
  const build = (arm: "n" | "a", unit: string, exposed: boolean | null, exposed_frozen: boolean | null): ScoredBuild => ({ unit, rep: 1, arm, done: [unit !== "u3", false, false, false, false], empty_plan: false, contaminated: false, implied: [false, false, false, false, false], obvious: false, exposed, exposed_frozen });
  const r = read([build("n", "u1", null, null), build("n", "u2", null, null), build("n", "u3", null, null), build("a", "u1", true, true), build("a", "u2", true, false), build("a", "u3", false, false)], ["n", "a"]);
  expect(r.arms.a!.exposed).toEqual({ yes: 2, no: 1 });
  expect(r.arms.a!.exposed_frozen).toEqual({ yes: 1, no: 2 });
  expect(r.a_n_exposed!.briefs).toBe(2);
  expect(r.a_n_exposed_frozen!.briefs).toBe(1);
});

describe.skipIf(!onShm)("day-one validate with the strengthened arms in the wave", () => {
  test("scored S-full and S-dayone builds never push N, D, R or A under 3 at the default 12, and fill later slots without a floor of their own", async () => {
    const shm = mkdtempSync("/dev/shm/day-one-validate-");
    try {
      const units = join(shm, "units");
      const out = join(shm, "out");
      const ids = ["aaaaaa", "bbbbbb", "cccccc"];
      for (const id of ids) fixtureUnit(units, id, 2);
      const rows = ids.flatMap((u, i) => ["n", "d", "r", "a", "s-full", "s-dayone"].map((a, j) => checkRow(u, a, [true, (i + j) % 2 === 0, j > 1, false, i === 2])));
      stageDir(out, "check-wave", rows, { units: ids, reps: [1] });
      for (const r of rows) mkdirSync(join(out, "builds", r.cell.unit, "r1", r.cell.arm, "tree"), { recursive: true });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const draw = async (name: string, extra: string[]) => {
        const dest = join(shm, name);
        const key = join(shm, name + ".json");
        expect((await run(["validate", "draw", "--out", out, "--units-dir", units, "--tag", "wave", "--dest", dest, "--key", key, ...extra])).code).toBe(0);
        const k = JSON.parse(readFileSync(key, "utf8")) as Record<string, { row: string; arm: string }>;
        const per: Record<string, number> = {};
        for (const v of Object.values(k)) per[v.arm] = (per[v.arm] ?? 0) + 1;
        writeFileSync(join(shm, name + ".ndjson"), Object.keys(k).map((l) => JSON.stringify({ label: l, tasks: byId.get(k[l]!.row)!.check.parse.tasks.map((t) => ({ id: t.id, done: t.done })) })).join("\n") + "\n");
        return { per, score: await run(["validate", "score", "--out", out, "--tag", "wave", "--key", key, "--labels", join(shm, name + ".ndjson")]) };
      };
      const twelve = await draw("d12", []);
      expect(twelve.per).toEqual({ n: 3, d: 3, r: 3, a: 3 });
      expect(twelve.score.code).toBe(0);
      const fourteen = await draw("d14", ["--count", "14"]);
      expect((fourteen.per["s-full"] ?? 0) + (fourteen.per["s-dayone"] ?? 0)).toBe(2);
      expect(fourteen.score.code).toBe(0);
    } finally {
      rmSync(shm, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!onShm)("day-one tags", () => {
  test("a --tag that could leave the sealed --out is refused by every command that reads one", async () => {
    const shm = mkdtempSync("/dev/shm/day-one-tag-");
    try {
      const bad = "x/../../../../tmp/day-one-leak";
      const d = join(shm, "d");
      mkdirSync(d);
      for (const argv of [
        ["stage", "--stage", "base", "--arms", "n", "--units-dir", d, "--units", "aaaaaa", "--reps", "1", "--out", d, "--receipts", join(d, "r"), "--item", "day1-plans", "--spend-cap", "1", "--tag", bad],
        ["read", "--out", d, "--units-dir", d, "--tag", bad, "--arms", "n"],
        ["validate", "draw", "--out", d, "--units-dir", d, "--tag", bad, "--dest", join(d, "dest"), "--key", join(d, "key")],
        ["validate", "score", "--out", d, "--tag", bad, "--key", join(d, "k"), "--labels", join(d, "x")],
      ]) {
        const r = await run(argv);
        expect(r.code).toBe(2);
        expect(r.err).toContain("is not lowercase letters, digits and hyphens");
      }
      expect(existsSync("/tmp/day-one-leak")).toBe(false);
    } finally {
      rmSync(shm, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!onShm)("day-one probe", () => {
  test("ten transcripts share one meter capped at --spend-cap", async () => {
    const shm = mkdtempSync("/dev/shm/day-one-probe-");
    try {
      const capMicros = 1e6;
      const priceMicros = 50_000;
      let opened = 0;
      let spent = 0;
      const open = (async () => {
        opened++;
        let left = capMicros;
        return {
          leaseId: "lease-" + opened,
          call: async () => {
            if (left < priceMicros) return { text: null, problem: "the lease is spent", status: 0 };
            left -= priceMicros;
            spent += priceMicros;
            return { text: "A few plants. [source: profile]", status: 200 };
          },
          spent: () => spent,
          close: async () => ({ spent_micros: spent, unknown_micros: 0 }),
        };
      }) as never;
      const err: string[] = [];
      const us = ["p1", "p2", "p3"].map((id) => ({ id, profile: "I have about a dozen plants." }));
      const code = await probeTranscripts({ us, count: 10, out: shm, io: { out: () => {}, err: (t) => err.push(t) }, open });
      expect(10 * PROBE_QUESTIONS.length * priceMicros).toBeGreaterThan(capMicros);
      expect(opened).toBe(1);
      expect(spent).toBeLessThanOrEqual(capMicros);
      expect(code).toBe(2);
      expect(err.join("\n")).toContain("E_DAYONE_OWNER");
    } finally {
      rmSync(shm, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!onShm)("day-one controls", () => {
  test("the stock control allows 5% of primary checks and the volume control needs 90% agreement", async () => {
    const dir = mkdtempSync("/dev/shm/day-one-controls-");
    try {
      const units = join(dir, "units");
      const ids = Array.from({ length: 7 }, (_, i) => "u" + String(i).padStart(5, "0"));
      for (const id of ids) fixtureUnit(units, id, 2);
      const lab = (covered: boolean[]) => covered.map((c, i) => ({ id: "t" + (i + 1), covered: c, usable: c }));
      const none = [false, false, false, false, false];
      const write = (stockHits: number, padFlip: boolean) => {
        const rows = [...ids.map((u, i) => ({ key: "stock|" + u, labels: lab(i < stockHits ? [true, false, false, false, false] : none) })), { key: "n/" + ids[0], labels: lab([true, true, false, false, false]) }, { key: "padded|n/" + ids[0], labels: lab(padFlip ? [false, false, true, true, true] : [true, true, false, false, false]) }];
        writeFileSync(join(dir, "labels.ndjson"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
        return run(["controls", "--units-dir", units, "--labels", join(dir, "labels.ndjson")]);
      };
      expect((await write(1, false)).code).toBe(0);
      const stock = await write(2, false);
      expect(stock.code).toBe(2);
      expect(stock.err).toContain("E_DAYONE_CONTROLS");
      expect((await write(0, true)).code).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
