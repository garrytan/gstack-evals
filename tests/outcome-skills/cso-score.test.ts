// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 5 and section 15's scoring fixtures, both ways: the oracle report hits; the stock list, a right file with
// the wrong class, a wrong file with the right class, a whole-file range, a hit with no stated mechanism and a hit at
// position 11 don't; a finding surfaced mid-run counts after a short final message; redaction removes every marker and
// keeps citations; the stage 0 citation gate; phantom paths and lines; precision, validity and the miss anatomy.
import { describe, expect, test } from "bun:test";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import type { SessionRecord, UnitRecord } from "../../lanes/outcome-skills/cso/types.ts";
import type { Finding, FindingLabels } from "../../lanes/outcome-skills/cso/judge/schema.ts";
import { parsePassA } from "../../lanes/outcome-skills/cso/judge/schema.ts";
import { citationGate, phantoms, treeIndex } from "../../lanes/outcome-skills/cso/score/checks.ts";
import { missAnatomy, pooledPrecision, scoreSession } from "../../lanes/outcome-skills/cso/score/outcomes.ts";
import { normalizePath, redact, REDACTED, scoredText } from "../../lanes/outcome-skills/cso/score/text.ts";

const p = loadCsoPrereg();
const lines = (n: number, tag: string) => Array.from({ length: n }, (_, i) => tag + " line " + (i + 1)).join("\n") + "\n";
const TREE = treeIndex({
  "src/parse.js": lines(120, "parse"), "src/other.js": lines(50, "other"), "lib/index.js": lines(900, "index"),
  "vendor/gstack/index.js": lines(10, "v"), "src/csound/synth.c": lines(30, "c"), "README.md": "readme\n",
});
const H = "@cso-path//" + "a".repeat(32), H2 = "@cso-path//" + "b".repeat(32), ROOT = "/var/cso/runs/1731000000000-0123456789abcdef/snapshot";
const UNIT: UnitRecord = {
  schema: "cso-unit.v1", unit: "u1", position: 7, part: "part1", index: 0, repo: "acme/lib", ghsa: "GHSA-2222-3333-4444", cves: ["CVE-2026-1111"], fix_commit: "f".repeat(40), parent: "e".repeat(40),
  ecosystem: "npm", published: "2026-08-01", month: "2026-08", cwe_ids: ["CWE-22"], cwe_families: ["path-traversal"], fix_files: ["src/parse.js", "test/parse.test.js"],
  hunks: [{ file: "src/parse.js", start: 40, end: 44, insert_only: false, text: "x" }], advisory: { summary: "Path traversal in parse", details: "join without normalize" },
  source_files: 5, kind: "library", known_open: [{ ghsa: "GHSA-5555-6666-7777", summary: "Prototype pollution in other", files: ["src/other.js"] }], tree_sha256: "0".repeat(64),
};
const session = (o: Partial<SessionRecord> = {}): SessionRecord => ({
  schema: "cso-session.v1", unit: "u1", arm: "cso", model: "opus", stage: "stage2", model_id: "claude-opus-5-5", harness: "claude-code", harness_version: "x", end: "completed", reason: null,
  attempts: 1, continuations: 0, done_seen: true, texts: ["Report\nDONE"], opened: ["src/parse.js"], helper: { snapshot_root: ROOT, handles: { [H]: ROOT + "/src/parse.js" } },
  exposure: { loaded: true, procedure_ran: true, run_id: null, completeness: "complete", findings_submitted: 1, tooling_errors: 0, host_reads_after_start: 0, scope: "daily/default" },
  cost_usd: 1, wall_sec: 10, turns: 3, tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0 }, ...o,
});
const yes: FindingLabels = { location: "yes", class: "yes", same_defect: "yes", grounding: "yes", file_level: "yes", known: null, validity: "supported", quotes: {} };
const no: FindingLabels = { ...yes, location: "no", class: "no", same_defect: "no", grounding: "no", file_level: "no", validity: "unsupported" };
const f = (path: string, start: number | null, end: number | null = start, symbol: string | null = null, source: "final" | "earlier" = "final"): Finding => ({ text: "finding at " + path, source, citations: [{ path, start, end, symbol }] });
const score = (findings: Finding[], labels: FindingLabels[], s = session()) => scoreSession(UNIT, s, scoredText(s, p), { findings, labels }, TREE, p);

describe("section 5: the four hit rules", () => {
  test("the oracle report hits: fix file, range in the hunk, right class, same defect, grounded", () => {
    const sc = score([f("src/parse.js", 41, 43)], [yes]);
    expect(sc.named).toBe(true);
    expect(sc.hits).toBe(1);
    expect(sc.supported).toBe(1);
  });
  test("a range within 10 lines of the hunk hits; 11 lines away does not", () => {
    expect(score([f("src/parse.js", 54, 56)], [yes]).named).toBe(true);
    expect(score([f("src/parse.js", 55, 57)], [yes]).named).toBe(false);
  });
  test("the stock list does not hit: files with no range, the judge saying no", () => {
    const fs = ["src/parse.js", "src/other.js", "lib/index.js"].map((x) => f(x, null));
    expect(score(fs, fs.map(() => ({ ...no, class: "yes" as const }))).named).toBe(false);
  });
  test("a right file with the wrong class does not hit, but file-level needs the class too", () => {
    const sc = score([f("src/parse.js", 41)], [{ ...yes, class: "no" }]);
    expect(sc.named).toBe(false);
    expect(sc.file_level).toBe(false);
  });
  test("a wrong file with the right class does not hit, even when the judge says location yes", () => {
    expect(score([f("src/other.js", 41)], [yes]).named).toBe(false);
  });
  test("a whole-file range never points into the code", () => {
    const sc = score([f("src/parse.js", 1, 120)], [yes]);
    expect(sc.named).toBe(false);
    expect(sc.file_level).toBe(true);
  });
  test("a named function holding the hunk counts only when the judge places it", () => {
    expect(score([f("src/parse.js", null, null, "parsePath")], [yes]).named).toBe(true);
    expect(score([f("src/parse.js", null, null, "parsePath")], [{ ...yes, location: "no" }]).named).toBe(false);
  });
  test("a hit with no stated mechanism does not hit", () => {
    expect(score([f("src/parse.js", 41)], [{ ...yes, grounding: "no" }]).named).toBe(false);
  });
  test("can't tell on any rule is not named and is counted", () => {
    const sc = score([f("src/parse.js", 41)], [{ ...yes, same_defect: "cant_tell" }]);
    expect(sc.named).toBe(false);
    expect(sc.hit_cant_tell).toBe(1);
  });
  test("a hit at position 11 does not count; the over-10 share records it", () => {
    const fs = [...Array.from({ length: 10 }, () => f("src/other.js", 3)), f("src/parse.js", 41)];
    const sc = score(fs, fs.slice(0, 10).map(() => no));
    expect(sc.named).toBe(false);
    expect(sc.counted).toBe(10);
    expect(sc.findings_total).toBe(11);
    expect(sc.over_k).toBe(true);
  });
  test("a handle that does not resolve leaves the finding without a location", () => {
    expect(score([f(H2, 41)], [yes]).named).toBe(false);
    expect(score([f(H, 41)], [yes]).named).toBe(true);
    expect(score([f(ROOT + "/src/parse.js", 41)], [yes]).named).toBe(true);
  });
});

describe("section 5: secondaries", () => {
  test("known-real precision needs all four rules on a known open advisory, and the match is supported", () => {
    const known = { ghsa: "GHSA-5555-6666-7777", location: "yes" as const, class: "yes" as const, same_defect: "yes" as const, grounding: "yes" as const };
    const sc = score([f("src/other.js", 10), f("src/other.js", 20), f("README.md", 1)], [{ ...no, known }, { ...no, known: { ...known, grounding: "no" } }, { ...no, validity: "cant_tell" }]);
    expect(sc.known_real).toBe(1);
    expect(sc.supported).toBe(1);
    expect(sc.unsupported).toBe(1);
    expect(sc.cant_tell).toBe(1);
    expect(pooledPrecision([sc, score([f("src/parse.js", 41)], [yes])], "known_real")).toEqual({ num: 2, den: 4, rate: 0.5 });
    expect(pooledPrecision([sc, score([f("src/parse.js", 41)], [yes])], "hits")).toEqual({ num: 1, den: 4, rate: 0.25 });
  });
  test("no assistant text is not named with zero findings; a session gap and a judge gap score nothing", () => {
    const empty = session({ texts: ["", "  "], end: "safety_stop" });
    const sc = scoreSession(UNIT, empty, scoredText(empty, p), null, TREE, p);
    expect([sc.named, sc.counted, sc.gap]).toEqual([false, 0, null]);
    const g = session({ end: "gap", reason: "upstream twice" });
    expect(scoreSession(UNIT, g, scoredText(g, p), null, TREE, p).gap).toBe("session");
    expect(scoreSession(UNIT, session(), scoredText(session(), p), { findings: { gap: "malformed twice" }, labels: null }, TREE, p)).toMatchObject({ gap: "judge", named: null });
  });
});

describe("section 5: the scored text", () => {
  test("a finding surfaced mid-run counts after a short final message, and the delivery measure says so", () => {
    const s = session({ texts: ["Finding: src/parse.js:41 joins user input into a path without normalizing it.", "Audit complete.\nDONE"] });
    const st = scoredText(s, p);
    expect(st.final).toBe("Audit complete.\nDONE");
    expect(st.text).toContain("src/parse.js:41");
    const sc = score([f("src/parse.js", 41, 41, null, "earlier")], [yes], s);
    expect(sc.named).toBe(true);
    expect(sc.named_final).toBe(false);
  });
  test("caps: the final message to 40,000 characters, earlier text newest first to 20,000", () => {
    const s = session({ texts: ["old".repeat(5000), "mid".repeat(5000), "x".repeat(50000)] });
    const st = scoredText(s, p);
    expect(st.final.length).toBe(40000);
    expect(st.earlier.map((e) => [e.index, e.text.length])).toEqual([[1, 15000], [0, 5000]]);
    expect(st.earlier_truncated && st.final_truncated).toBe(true);
  });
  test("pass A's order rule: final-message findings first, then earlier ones, each in the judge's order", () => {
    const reply = JSON.stringify({ findings: [{ text: "e1", source: "earlier", citations: [] }, { text: "f1", source: "final", citations: [{ path: "a.js", start: 3 }] }, { text: "f2", source: "final", citations: [] }] });
    expect(parsePassA(reply)!.map((x) => x.text)).toEqual(["f1", "f2", "e1"]);
    expect(parsePassA("not json")).toBeNull();
  });
});

describe("section 6 attack 8: redaction after normalization", () => {
  const report = [
    "Ran /cso with gstack-cso-launcher and gstack-cso start; evidence before assurance.",
    "Run 1731000000000-0123456789abcdef gave a RunReportV3 with FindingV3 rows. The CSO says: cso done. gstack installed.",
    "Status: complete", "Ran: phases 0-14", "Reason: none", "Next: finish",
    "| F1 | " + ROOT + "/src/parse.js:41 | path traversal |", "Also " + H + " line 12, " + H2 + " line 3,",
    "src/csound/synth.c:4 and vendor/gstack/index.js:2 and src/cso/x.ts are cited.",
  ].join("\n");
  const s = session({ texts: [report] });
  const out = scoredText(s, p).text;
  test("every listed marker is gone", () => {
    for (const m of ["/cso ", "gstack-cso-launcher", "gstack-cso ", "evidence before assurance", "1731000000000-0123456789abcdef", "RunReportV3", "FindingV3", "The CSO", "cso done", "gstack installed", "Status: complete", "Next: finish"]) expect(out).not.toContain(m);
    expect(out).toContain(REDACTED);
  });
  test("citations stay: a snapshot-rooted path (normalized), a handle, src/csound/, a gstack directory and a cso directory", () => {
    expect(out).toContain("| src/parse.js:41 |");
    expect(out).not.toContain(ROOT);
    expect(out).toContain("Also src/parse.js line 12");
    expect(out).toContain(H2 + " line 3");
    expect(out).toContain("src/csound/synth.c:4");
    expect(out).toContain("vendor/gstack/index.js:2");
    expect(out).toContain("src/cso/x.ts");
  });
  test("redaction alone never touches a path, and normalizePath resolves both helper forms", () => {
    expect(redact("see vendor/gstack/a.js and /cso", p)).toBe("see vendor/gstack/a.js and " + REDACTED);
    expect(normalizePath(H, s.helper)).toBe("src/parse.js");
    expect(normalizePath(ROOT + "/src/parse.js", s.helper)).toBe("src/parse.js");
    expect(normalizePath(H2, s.helper)).toBeNull();
  });
});

describe("mechanical checks", () => {
  test("phantoms: a path not in the tree and a line past the file's end; a unique basename resolves", () => {
    const ph = phantoms("src/parse.js:41, src/parse.js:500, src/missing.js:3, other.js:7, docs/none/x.md", TREE);
    expect([ph.paths, ph.lines]).toEqual([2, 1]);
    expect(ph.items.map((i) => i.path).sort()).toEqual(["docs/none/x.md", "src/missing.js", "src/parse.js"]);
  });
  test("the stage 0 citation gate passes resolved snapshot and handle citations", () => {
    const g = citationGate(session({ texts: [ROOT + "/src/parse.js:41 and " + H] }), TREE);
    expect(g).toMatchObject({ pass: true, snapshot_paths: 1, handles_resolved: 1 });
  });
  test("the gate flags an unresolved handle and a handle recorded outside the tree", () => {
    const s = session({ texts: [H2 + " and @cso-path//" + "c".repeat(32)], helper: { snapshot_root: ROOT, handles: { ["@cso-path//" + "c".repeat(32)]: ROOT + "/gone.js" } } });
    const g = citationGate(s, TREE);
    expect(g.pass).toBe(false);
    expect(g.unresolved.map((u) => u.reason)).toEqual(["no record", "outside the tree"]);
  });
  test("a plain wrong path leaves the gate passing and goes to the phantom count", () => {
    const s = session({ texts: ["src/wrong.js:4 and " + ROOT + "/src/nowhere.js:2"] });
    expect(citationGate(s, TREE).pass).toBe(true);
    expect(score([], [], s).phantoms.paths).toBe(2);
  });
});

describe("section 10: the miss anatomy, in the plan's order", () => {
  const miss = (o: Partial<SessionRecord>, fs: Finding[] | null = []) => {
    const s = session(o);
    return missAnatomy(UNIT, s, scoredText(s, p), fs, TREE, p);
  };
  test("each cause in turn", () => {
    expect(miss({ end: "safety_stop" })).toBe("safety_stop");
    expect(miss({ end: "limit_wall" })).toBe("limit_tooling_or_not_assessed");
    expect(miss({ exposure: { ...session().exposure, completeness: "not_assessed" } })).toBe("limit_tooling_or_not_assessed");
    expect(miss({ opened: ["src/other.js"] })).toBe("never_opened_fix_file");
    expect(miss({ texts: ["Looked at src/other.js:3"] })).toBe("opened_not_named");
    expect(miss({ texts: ["src/parse.js:90 has an XSS"] }, [f("src/parse.js", 90)])).toBe("other_flaw_or_class");
    const late = [...Array.from({ length: 10 }, () => f("src/other.js", 1)), f("src/parse.js", 41)];
    expect(miss({ texts: ["... src/parse.js:41 ..."] }, late)).toBe("outside_first_k");
  });
  test("a helper handle or a snapshot-rooted path in opened is the tree file it names", () => {
    expect(miss({ opened: [H], texts: ["Looked at src/other.js:3"] })).toBe("opened_not_named");
    expect(miss({ opened: [ROOT + "/src/parse.js"], texts: ["Looked at src/other.js:3"] })).toBe("opened_not_named");
  });
  test("a glob in opened opens the fix files it matches", () => {
    expect(miss({ opened: ["src/*.js"], texts: ["Looked at src/other.js:3"] })).toBe("opened_not_named");
    expect(miss({ opened: ["src/p?rse.js"], texts: ["Looked at src/other.js:3"] })).toBe("opened_not_named");
    expect(miss({ opened: ["lib/*.js", "*.js"] })).toBe("never_opened_fix_file");
  });
});
