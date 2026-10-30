import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { snapshot } from "../../lanes/review-noloss/ingest.ts";
import { REPO_ROOT } from "../../lanes/review-noloss/suite.ts";
import { cleanup, editArm, run, tmp, writeArm } from "./helpers.ts";

afterAll(cleanup);
const example = snapshot(join(REPO_ROOT, "lanes/review-noloss/example/arm-example"));
const raw = (id: string, label: string, drop: string[] = []) => {
  const f = editArm(example, (a) => {
    a.id = id;
    a.label = label;
  });
  f.delete("judgments.tsv");
  for (const pr of drop) f.set("findings/" + pr + ".jsonl", Buffer.from(""));
  return f;
};

interface Key {
  batch: string;
  packets: Array<{ file: string; unit: string; sha256: string }>;
  entries: Array<{ packet: string; opaque: string; finding: string }>;
}
type Answer = Record<string, string[]>;
const blockersOf = (dir: string, file: string) => (JSON.parse(readFileSync(join(dir, file), "utf8")) as { unit: { pr: number }; blockers: Array<{ id: string }> });
/** What an honest judge would answer: a finding matches the blocker its synthetic id names. */
const honest = (key: Key, packets: string): Answer =>
  Object.fromEntries(
    key.packets.flatMap((p) => {
      const pk = blockersOf(packets, p.file);
      return pk.blockers.map((b) => [p.file + " " + b.id, key.entries.filter((e) => e.packet === p.file && e.finding === "ex-" + pk.unit.pr + "-" + b.id.toLowerCase()).map((e) => e.opaque)]);
    }),
  );
const reply = (key: Key, judge: string, answers: Answer, only?: Set<string>) => ({
  batch: key.batch,
  judge,
  packets: key.packets
    .map((p) => ({ file: p.file, sha256: p.sha256, blockers: Object.entries(answers).filter(([k]) => k.startsWith(p.file + " ") && (!only || only.has(k))).map(([k, matches]) => ({ id: k.split(" ")[1], matches })) }))
    .filter((p) => p.blockers.length),
});
const named = (text: string) => new Set([...text.matchAll(/(packets\/\S+\.json) (B\d+)/g)].map((m) => m[1] + " " + m[2]));

describe("blinded judging: register, packet, reply, join and score", () => {
  const dir = tmp("noloss-judge-");
  const root = join(dir, "arms");
  const packets = join(dir, "packets");
  const keyPath = join(dir, "key.json");
  const out = join(dir, "judged");
  const armDir = (id: string) => join(root, "gsta167-14pr", id);
  const save = (name: string, value: unknown) => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(value));
    return p;
  };
  const join_ = (extra: string[] = [], arms = [armDir("alpha"), armDir("beta")]) => run(["judge-join", "--suite", "gsta167-14pr", "--key", keyPath, "--out", out, ...arms.flatMap((a) => ["--arm", a]), ...extra]);

  test("raw arms ingest, and packets pool them under opaque ids with the key outside", async () => {
    for (const [id, label, drop] of [["alpha", "Alpha arm (synthetic)", []], ["beta", "Beta arm (synthetic)", ["3593"]]] as const) {
      expect((await run(["ingest", writeArm(join(dir, "src", id), raw(id, label, [...drop])), "--suite", "gsta167-14pr", "--root", root])).code).toBe(0);
    }
    const inside = await run(["judge-packet", "--suite", "gsta167-14pr", "--arm", armDir("alpha"), "--seed", "7", "--out", join(dir, "p0"), "--key", join(dir, "p0", "key.json")]);
    expect([inside.code, inside.err.split("\n")[0]]).toEqual([2, expect.stringMatching(/^E_NOLOSS_BLIND --key .* is inside --out/)]);
    const r = await run(["judge-packet", "--suite", "gsta167-14pr", "--arm", armDir("alpha"), "--arm", armDir("beta"), "--seed", "7", "--out", packets, "--key", keyPath]);
    expect(r.code).toBe(0);
    expect(readdirSync(join(packets, "packets")).length).toBe(14);
    const text = readdirSync(join(packets, "packets")).map((f) => readFileSync(join(packets, "packets", f), "utf8")).join("\n");
    for (const leak of ["alpha", "beta", "Alpha arm", "claude-opus", "gpt-6.1-sol", "adversarial-native", "FIXABLE", "CRITICAL", "ex-3593-b1", "confidence", "fingerprint", "testing"]) expect(text).not.toContain(leak);
    const batch = readFileSync(join(packets, "batch.json"), "utf8");
    for (const leak of ["alpha", "beta", "Alpha arm", "claude-opus", "tree_sha256"]) expect(batch).not.toContain(leak);
    const one = JSON.parse(readFileSync(join(packets, "packets", "3596.json"), "utf8"));
    for (const f of one.findings) expect(Object.keys(f).sort()).toEqual(["id", "line", "path", "text"]);
    expect(one.blockers[0].cause.length).toBeGreaterThan(20);
  });

  test("a packet that would leak an arm id is refused without printing the text", async () => {
    expect((await run(["ingest", writeArm(join(dir, "src", "example"), raw("example", "Example arm")), "--suite", "gsta167-14pr", "--root", root])).code).toBe(0);
    const r = await run(["judge-packet", "--suite", "gsta167-14pr", "--arm", armDir("example"), "--seed", "7", "--out", join(dir, "p1"), "--key", join(dir, "k1.json")]);
    expect([r.code, r.err]).toEqual([2, expect.stringContaining("its text names an arm id or label")]);
    expect(r.err).not.toContain("Synthetic example finding");
    expect(existsSync(join(dir, "p1"))).toBe(false);
  });

  test("join waits for the second judge and the third read, then writes blind judgments for both arms", async () => {
    const key: Key = JSON.parse(readFileSync(keyPath, "utf8"));
    const primary = honest(key, packets);
    const p1 = save("primary.json", reply(key, "judge one", primary));
    const wait2 = await join_(["--reply", p1]);
    expect([wait2.code, wait2.err]).toEqual([2, expect.stringContaining("scoring waits for the second judge")]);
    const need2 = named(wait2.err);
    expect(need2.has("packets/3593.json B1")).toBe(true);
    expect((await join_(["--reply", p1, "--second", save("same.json", reply(key, "judge one", primary, need2))])).err).toContain("a second read needs another judge");
    const flipped = [...need2][0]!;
    const sameOutcome = [...need2].find((k) => k !== flipped && primary[k]!.length > 0);
    const p2 = save("second.json", reply(key, "judge two", { ...primary, [flipped]: [], ...(sameOutcome ? { [sameOutcome]: primary[sameOutcome]!.slice(0, 1) } : {}) }, need2));
    const wait3 = await join_(["--reply", p1, "--second", p2]);
    expect([wait3.code, wait3.err]).toEqual([2, expect.stringContaining("scoring waits for a third read")]);
    const need3 = new Set([flipped, ...(sameOutcome && primary[sameOutcome]!.length > 1 ? [sameOutcome] : [])]);
    expect(named(wait3.err)).toEqual(need3);
    const p3 = save("third.json", reply(key, "judge three", primary, need3));
    const done = await join_(["--reply", p1, "--second", p2, "--third", p3]);
    expect(done.code).toBe(0);
    const tsv = readFileSync(join(out, "alpha", "judgments.tsv"), "utf8");
    expect(tsv).toContain("judge three (third read)");
    expect(tsv.split("\n").slice(1).filter(Boolean).every((l) => l.split("\t")[7] === "no")).toBe(true);
    const again = await join_(["--reply", p1, "--second", p2, "--third", p3]);
    expect([again.code, again.err]).toEqual([2, expect.stringContaining("already exists; pass --replace")]);
  });

  test("a stale arm, a swapped packet or another batch is refused", async () => {
    const key: Key = JSON.parse(readFileSync(keyPath, "utf8"));
    const primary = honest(key, packets);
    const changed = await join_(["--reply", save("p.json", reply(key, "j", primary))], [join(out, "alpha"), armDir("beta")]);
    expect(changed.err).toContain("changed since the packets were built");
    const swapped = reply(key, "j", primary);
    swapped.packets[0]!.sha256 = "0".repeat(64);
    expect((await join_(["--reply", save("s.json", swapped)])).err).toContain("stale or swapped packet");
    expect((await join_(["--reply", save("b.json", { ...reply(key, "j", primary), batch: "f".repeat(64) })])).err).toContain("not this key's batch");
    const tampered = JSON.parse(readFileSync(keyPath, "utf8"));
    tampered.packets[0].sha256 = "0".repeat(64);
    const r = await run(["judge-join", "--suite", "gsta167-14pr", "--key", save("tampered.json", tampered), "--out", out, "--arm", armDir("alpha"), "--arm", armDir("beta"), "--reply", save("t.json", reply(key, "j", primary))]);
    expect(r.err).toContain("does not hash to its own batch digest");
  });

  test("the judged arms ingest and score as blind judging", async () => {
    for (const id of ["alpha", "beta"]) expect((await run(["ingest", join(out, id), "--suite", "gsta167-14pr", "--root", root, "--replace", "blind judgments from the test batch"])).code).toBe(0);
    const r = await run(["score", "--suite", "gsta167-14pr", "--variant", "beta", "--reference", "alpha", "--margin", "10", "--margin-reason", "test", "--root", root, "--json"]);
    const rec = JSON.parse(r.out);
    expect(rec.judging).toMatchObject({ labelled: false, blind_share: { variant: 1, reference: 1 } });
    expect(rec.result.losses).toBe(2);
    expect(rec.result.verdict).not.toBe(null);
    expect(r.out).not.toContain("labelled judging");
  });
});
