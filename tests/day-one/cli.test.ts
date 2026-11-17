import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../lanes/day-one/cli.ts";
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
const stageDir = (out: string, name: string, rows: unknown[], manifest?: { units: string[]; reps: number[] }) => {
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
      expect(noA.err).toContain("builds for a");
      writeFileSync(join(shm, "twice.ndjson"), hand(false) + hand(false));
      expect((await run(["validate", "score", "--out", out, "--tag", "wave", "--key", key, "--labels", join(shm, "twice.ndjson")])).code).not.toBe(0);
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
