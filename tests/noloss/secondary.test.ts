import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseArm } from "../../lanes/review-noloss/contract.ts";
import { snapshot } from "../../lanes/review-noloss/ingest.ts";
import { ScoreError } from "../../lanes/review-noloss/score.ts";
import { ideaWins, newBlockers } from "../../lanes/review-noloss/secondary.ts";
import { loadSuite, REPO_ROOT } from "../../lanes/review-noloss/suite.ts";
import { cleanup, editArm, run, tmp, writeArm } from "./helpers.ts";

afterAll(cleanup);
const { suite, sha256 } = loadSuite("gsta167-14pr");
const example = snapshot(join(REPO_ROOT, "lanes/review-noloss/example/arm-example"));
const blocking = (id: string, n: number) => JSON.stringify({ id, severity: "CRITICAL", path: "lib/x.ts", line: n, summary: "Synthetic unmatched blocking finding number " + n + ".", reader: "testing" });
const HEAD = "pr\tfinding\tpass\truling\tjudge\tsaw_label\tversion\tbatch\tnote";
const append = (f: Map<string, Buffer>, pr: string, line: string) => f.set("findings/" + pr + ".jsonl", Buffer.from(f.get("findings/" + pr + ".jsonl")!.toString("utf8").replace(/\n*$/, "\n") + line + "\n"));
// alpha raises v1 on 3593 (a defect) and finds 3526 B1, which beta misses; beta raises r1 on 3526 (a defect) and r2 on 3593 (not a defect).
const alphaFiles = (() => {
  const f = new Map(editArm(example, (a) => ((a.id = "alpha"), (a.label = "Alpha arm (synthetic)"))));
  append(f, "3593", blocking("v1", 1));
  append(f, "3526", JSON.stringify({ id: "a-3526-b1", severity: "CRITICAL", path: "lib/y.ts", line: 9, summary: "Synthetic match.", reader: "testing" }));
  const rows = f.get("judgments.tsv")!.toString("utf8").replace(/\n+$/, "").split("\n").map((l) => {
    const c = l.split("\t");
    if (c[0] === "3526" && c[1] === "B1") [c[2], c[3], c[4], c[5]] = ["F", "a-3526-b1", "CRITICAL", "CRITICAL"];
    return c.join("\t");
  });
  f.set("judgments.tsv", Buffer.from(rows.join("\n") + "\n"));
  f.set("adjudication.tsv", Buffer.from(HEAD + "\n3593\tv1\t1\tdefect\tj\tno\t1\tb\t\n"));
  return f;
})();
const betaFiles = (() => {
  const f = new Map(editArm(example, (a) => ((a.id = "beta"), (a.label = "Beta arm (synthetic)"))));
  append(f, "3526", blocking("r1", 2));
  append(f, "3593", blocking("r2", 3));
  f.set("adjudication.tsv", Buffer.from(HEAD + "\n3526\tr1\t1\tdefect\tj\tno\t1\tb\t\n3593\tr2\t1\tnot-defect\tj\tno\t1\tb\t\n"));
  return f;
})();
const alpha = parseArm(alphaFiles, suite, sha256);
const beta = parseArm(betaFiles, suite, sha256);

describe("noloss secondary", () => {
  test("new blockers pair by PR the way false blockers do, and have no reading for a stopped or unadjudicated arm", () => {
    expect(newBlockers(suite, alpha, beta, { seed: 1, draws: 2000 })).toMatchObject({ complete: true, prs: 14, totals: { variant: 1, reference: 1 }, difference: 0, p_two_sided: 1 });
    const stopped = parseArm(editArm(betaFiles, (a) => (a.status = "stopped")), suite, sha256);
    expect(newBlockers(suite, alpha, stopped, { seed: 1, draws: 2000 }).reasons).toEqual(["arm beta stopped"]);
    const bare = new Map(betaFiles);
    bare.delete("adjudication.tsv");
    expect(newBlockers(suite, alpha, parseArm(bare, suite, sha256), { seed: 1, draws: 2000 }).reasons).toEqual(["arm beta has 2 blocking findings with no adjudication row"]);
  });

  test("idea-card wins: found in every pass by the variant and in none by the reference, beside a seeded swap null", () => {
    const blockers = suite.units.flatMap((u) => u.blockers).filter((b) => b.counts === "blocking").length;
    const w = ideaWins(suite, alpha, beta, { seed: 20261031, permutations: 2000 });
    expect(w).toMatchObject({ wins: 1, blockers, left_out: 0, null_p95: 1, above_null: false, won: ["3526 B1"] });
    expect(w.null_mean).toBeCloseTo(0.5, 1);
    expect(ideaWins(suite, beta, alpha, { seed: 20261031, permutations: 2000 }).wins).toBe(0);
    expect(ideaWins(suite, alpha, beta, { seed: 20261031, permutations: 2000 })).toEqual(w);
    expect(() => ideaWins(suite, alpha, { ...beta, arm: { ...beta.arm, passes: 2 } }, { seed: 1, permutations: 10 })).toThrow(ScoreError);
  });

  test("the CLI reads ingested arms and needs a seed", async () => {
    const dir = tmp("noloss-secondary-");
    const root = join(dir, "arms");
    for (const [id, f] of [["alpha", alphaFiles], ["beta", betaFiles]] as const) expect((await run(["ingest", writeArm(join(dir, "src", id), f), "--suite", "gsta167-14pr", "--root", root])).code).toBe(0);
    const r = await run(["secondary", "--suite", "gsta167-14pr", "--root", root, "--variant", "alpha", "--reference", "beta", "--seed", "20261031", "--permutations", "2000"]);
    expect([r.code, r.err]).toEqual([0, ""]);
    expect(r.out).toContain("new blockers per pass per PR: variant 0.0714, reference 0.0714 (1 and 1 in all, 14 PRs); difference 0");
    expect(r.out).toContain("idea-card wins: 1 of " + suite.units.flatMap((u) => u.blockers).filter((b) => b.counts === "blocking").length + " blocking blockers");
    expect(r.out).toContain("  won: 3526 B1");
    expect(r.out).toMatch(/^recall, alpha: blocking \d+\/\d+ = [\d.]+ \[[\d., ]+\]; at any severity \d+\/\d+ = /m);
    expect(r.out).toMatch(/^recall, beta: blocking /m);
    expect((await run(["secondary", "--suite", "gsta167-14pr", "--root", root, "--variant", "alpha", "--reference", "beta"])).err).toStartWith("E_USAGE");
    expect((await run(["secondary", "--suite", "gsta167-14pr", "--root", root, "--variant", "alpha", "--reference", "beta", "--seed", "1", "--draws", "200"])).err).toStartWith("E_USAGE");
  });
});
