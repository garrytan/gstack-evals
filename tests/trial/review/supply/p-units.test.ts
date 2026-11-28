// Value: protects=P units keep suite rank order with decoys after and home-field units out, the fix commit is the first
// later commit touching a blocker path (S1, S2) or the first fix-PR commit touching one (S3), and disclosure reads the
// review comment, falling back to the PR's opening; fails_when=the wrong commit or date decides gate 1;
// why_new=GEVA-590 section 2 gate 1 for P; seam=readSuite, checkP with a local remote and a stub GitHub API;
// no_claim=GitHub's real API shapes beyond created_at and sha
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkP, readSuite, type PUnit } from "../../../../src/trial/review/supply/p-units.ts";
import { commitAll, git, tree } from "../../../cli/helpers.ts";

const unit = (o: Partial<PUnit> & { id: string }): any => ({ repo: "o/r", pr: 1, head: "h", base: "b", group: "S1", rank: 1, evidence: "e", blockers: [{ case: "rrb-x", paths: ["a.ts"] }], ...o });

describe("readSuite", () => {
  test("rank order, decoys after by id, home field out, ran from stage 1", () => {
    const suite = { units: [unit({ id: "c", rank: 2 }), unit({ id: "z", group: "N", rank: null }), unit({ id: "h", group: "H-206", rank: null }), unit({ id: "a", rank: 1, group: "S3" }), unit({ id: "y", group: "N", rank: null })] };
    const got = readSuite(suite, { units: [{ id: "c" }, { id: "y" }] });
    expect(got.map((u) => [u.id, u.rank, u.decoy, u.ran])).toEqual([["a", 1, false, false], ["c", 2, false, true], ["y", null, true, true], ["z", null, true, false]]);
    expect(got[0]!.cases).toEqual(["rrb-x"]);
    expect(() => readSuite({ units: [unit({ id: "x", rank: null })] }, { units: [] })).toThrow("E_RMS_INPUT");
  });
});

function remote() {
  const root = tree({ "a.ts": "one();\n", "b.ts": "x();\n" });
  const base = commitAll(root, "base");
  writeFileSync(join(root, "a.ts"), "bug();\n");
  git(root, "commit", "-q", "-am", "the PR", "--date=2026-07-02T00:00:00Z");
  const head = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "b.ts"), "y();\n");
  git(root, "commit", "-q", "-am", "unrelated", "--date=2026-07-03T00:00:00Z");
  const other = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "a.ts"), "fixed();\n");
  git(root, "commit", "-q", "-am", "address review", "--date=2026-06-20T00:00:00Z");
  const fix = git(root, "rev-parse", "HEAD");
  git(root, "update-ref", "refs/pull/1/head", fix);
  git(root, "checkout", "-q", "-b", "side", base);
  git(root, "config", "uploadpack.allowFilter", "true");
  git(root, "config", "uploadpack.allowAnySHA1InWant", "true");
  return { root, base, head, other, fix };
}

describe("checkP", () => {
  test("S1: the first later commit touching a blocker path; its author date before July fails gate 1", () => {
    const r = remote();
    const calls: string[] = [];
    const github = (repo: string, pr: number) => {
      calls.push(repo + "#" + pr);
      return { created_at: "2026-07-01T12:00:00Z", commits: [r.head, r.other, r.fix], comments: { "98": "2026-07-05T00:00:00Z" } };
    };
    const work = mkdtempSync(join(tmpdir(), "rms-p-"));
    const u = readSuite({ units: [{ ...unit({ id: "o/r#1@x", head: r.head, base: r.base, evidence: "https://github.com/o/r/pull/1#discussion_r99" }) }] }, { units: [] })[0]!;
    const rec = checkP(u, { work, github, url: () => "file://" + r.root });
    expect(rec.error).toBeUndefined();
    expect(rec.fix).toMatchObject({ commit: r.fix, pr: 1 });
    expect(rec.disclosure).toEqual({ "the PR's opening (no readable review comment)": "2026-07-01T12:00:00Z" });
    expect(rec.gates.g1).toMatchObject({ fail: expect.stringContaining("author date 2026-06-20") });
    expect(rec.gates.g4).toBe("ok");
    expect(calls).toEqual(["o/r#1"]);
    const read = checkP({ ...u, evidence: "https://github.com/o/r/pull/1#discussion_r98" }, { work, github, url: () => "file://" + r.root });
    expect(read.disclosure).toEqual({ "the review comment": "2026-07-05T00:00:00Z" });
  });

  test("S3 reads the fix PR; a decoy reads its head; no touching commit fails gate 1", () => {
    const r = remote();
    const work = mkdtempSync(join(tmpdir(), "rms-p-"));
    const github = () => ({ created_at: "2026-08-01T00:00:00Z", commits: [r.other], comments: {} });
    const s3 = readSuite({ units: [unit({ id: "s3", group: "S3", head: r.head, base: r.base, evidence: "https://github.com/o/r/pull/1" }), unit({ id: "n", group: "N", rank: null, head: r.head, base: r.base })] }, { units: [] });
    const a = checkP(s3[0]!, { work, github, url: () => "file://" + r.root });
    expect(a.fix).toBeNull();
    expect(a.gates.g1).toEqual({ fail: "no commit in fix PR #1 changes a path the blocker names" });
    const d = checkP(s3[1]!, { work, github, url: () => "file://" + r.root });
    expect(d.gates.g1).toBe("ok");
    expect(d.head_dates?.author).toStartWith("2026-07-02");
  });
});
