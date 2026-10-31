import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractError, mapSeverity, parseArm, type ArmJson } from "../../lanes/review-noloss/contract.ts";
import { prepare, publish, snapshot } from "../../lanes/review-noloss/ingest.ts";
import { insideRepo, loadSuite, REPO_ROOT, type Suite } from "../../lanes/review-noloss/suite.ts";
import { nolossCli } from "../../lanes/review-noloss/cli.ts";

const EXAMPLE = join(REPO_ROOT, "lanes/review-noloss/example/arm-example");
const { suite, sha256 } = loadSuite("gsta167-14pr");
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "noloss-contract-"));
  dirs.push(d);
  return d;
};
const base = () => snapshot(EXAMPLE);
const edit = (files: Map<string, Buffer>, name: string, f: (t: string) => string) => {
  const m = new Map(files);
  m.set(name, Buffer.from(f(m.get(name)!.toString("utf8"))));
  return m;
};
const refusal = (files: Map<string, Buffer>, s: Suite = suite) => {
  try {
    parseArm(files, s, sha256);
  } catch (e) {
    if (e instanceof ContractError) return { code: e.code, text: e.message };
    throw e;
  }
  return null;
};
const armJson = (f: (a: Record<string, unknown>) => void) => (t: string) => {
  const a = JSON.parse(t);
  f(a);
  return JSON.stringify(a);
};

describe("arm contract v1", () => {
  test("the committed example arm fits, judged and live", () => {
    const arm = parseArm(base(), suite, sha256);
    expect(arm.state).toBe("judged");
    expect(arm.judgments!.length).toBe(29);
    expect(arm.findings!.size).toBe(14);
    expect(arm.cost.length).toBe(15);
  });

  test("arm.json: contract_version is required and an unknown major is refused; ids are path-safe", () => {
    expect(refusal(edit(base(), "arm.json", armJson((a) => delete a.contract_version)))?.text).toMatch(/contract_version: missing/);
    expect(refusal(edit(base(), "arm.json", armJson((a) => (a.contract_version = 2))))?.text).toMatch(/not supported; this reader supports 1/);
    expect(refusal(edit(base(), "arm.json", armJson((a) => (a.id = "A'"))))?.text).toMatch(/write A' as A2/);
    expect(refusal(edit(base(), "arm.json", armJson((a) => (a.suite = "other"))))?.text).toMatch(/names suite other/);
    expect(refusal(edit(base(), "arm.json", armJson((a) => (a.suite_sha256 = "0".repeat(64)))))?.text).toMatch(/suite digest/);
  });

  test("severity: canonical labels map to themselves, others need an exact entry, readers override", () => {
    const arm = { severity_map: { default: { FIXABLE: "CRITICAL" }, by_reader: { "outside-voice": { High: "CRITICAL" } } } } as unknown as ArmJson;
    expect(mapSeverity(arm, "INFORMATIONAL", null)).toBe("INFORMATIONAL");
    expect(mapSeverity(arm, "FIXABLE", "x")).toBe("CRITICAL");
    expect(mapSeverity(arm, "fixable", "x")).toBeNull();
    expect(mapSeverity(arm, "High", "outside-voice")).toBe("CRITICAL");
    expect(mapSeverity(arm, "High", "testing")).toBeNull();
    expect(refusal(edit(base(), "arm.json", armJson((a) => ((a.severity_map as any).default.INFORMATIONAL = "CRITICAL"))))?.text).toMatch(/must map to itself/);
    expect(refusal(edit(base(), "arm.json", armJson((a) => delete a.severity_map)))?.text).toMatch(/raw label "FIXABLE".*no entry/);
  });

  test("judgments: a missing row is an error, never a miss", () => {
    const r = refusal(edit(base(), "judgments.tsv", (t) => t.split("\n").filter((l) => !l.startsWith("3593\tB2")).join("\n")));
    expect(r?.code).toBe("E_NOLOSS_JUDGMENT");
    expect(r?.text).toMatch(/no row for garrytan\/gstack#3593@89156431975e B2 pass 1/);
    expect(r?.text).toMatch(/never add an M row/);
  });

  test("judgments: an outcome must follow the matched finding's mapped severity", () => {
    expect(refusal(edit(base(), "judgments.tsv", (t) => t.replace(/^(3593\tB1\t)F(\t[^\t]+\tCRITICAL\t)CRITICAL/m, "$1D$2INFORMATIONAL")))?.text).toMatch(/map to CRITICAL, so the outcome is F, not D/);
    expect(refusal(edit(base(), "judgments.tsv", (t) => t.replace(/^(3593\tB1\tF\t)[^\t]+/m, "$1no-such-id")))?.text).toMatch(/"no-such-id" is not a pass-1 finding/);
    expect(refusal(edit(base(), "judgments.tsv", (t) => t.replace(/^3593\tB1\t/m, "3593\tB9\t")))?.text).toMatch(/has no blocker "B9"/);
    expect(refusal(edit(base(), "judgments.tsv", (t) => t.replace(/^(3593\tB1\tF\t[^\t]+\t)CRITICAL/m, "$1FIXABLE")))?.text).toMatch(/raw_severity/);
  });

  test("judgments: with no map, an INFORMATIONAL finding never counts as F", () => {
    const files = edit(edit(base(), "arm.json", armJson((a) => delete a.severity_map)), "findings/3593.jsonl", (t) => t.replace(/"label":"FIXABLE",?/g, ""));
    const noFixable = new Map([...files].map(([k, v]) => [k, k.startsWith("findings/") ? Buffer.from(v.toString("utf8").replace(/,"label":"FIXABLE"/g, "").replace(/"label":"Medium",/g, "")) : v]));
    const counter = edit(noFixable, "judgments.tsv", (t) => t.replace(/^(3593\tB1\t)F\t([^\t]+)\tCRITICAL\tCRITICAL/m, "$1F\t$2\tINFORMATIONAL\tCRITICAL"));
    const f = edit(counter, "findings/3593.jsonl", (t) => t.replace('"id":"ex-3593-b1","severity":"CRITICAL"', '"id":"ex-3593-b1","severity":"INFORMATIONAL"'));
    expect(refusal(f)?.text).toMatch(/map to INFORMATIONAL, so the outcome is D, not F/);
  });

  test("findings: absolute paths, missing unit files and unknown units are refused", () => {
    expect(refusal(edit(base(), "findings/3593.jsonl", (t) => t.replace('"path":"lib/', '"path":"/opt/checkout/lib/')))?.text).toMatch(/machine path/);
    const noFile = new Map(base());
    noFile.delete("findings/3583.jsonl");
    expect(refusal(noFile)?.text).toMatch(/no findings file for garrytan\/gstack#3583/);
    const stray = new Map(base());
    stray.set("findings/9999.jsonl", Buffer.from(""));
    expect(refusal(stray)?.text).toMatch(/names no unit/);
  });

  test("cost: a row needs a known meter, aggregates need covers, totals cannot repeat", () => {
    expect(refusal(edit(base(), "cost.tsv", (t) => t.replace("lane-counter-delta", "")))?.text).toMatch(/is not a meter source/);
    expect(refusal(edit(base(), "cost.tsv", (t) => t + "*\tall\t\t\t\t\t\t5\t\t\troot-counter-delta\t\n"))?.text).toMatch(/must list the units it covers/);
    expect(refusal(edit(base(), "cost.tsv", (t) => t + "3593\tall\t\t\t\t\t\t5\t\t\troot-counter-delta\t\n"))?.text).toMatch(/second all-scope row/);
    const aliased = edit(base(), "cost.tsv", (t) => t.replace("input_tokens", "input").replace(/^pr\tscope/, "pr\tvoice"));
    expect(refusal(aliased)).toBeNull();
  });

  test("transcribed arms: no findings, matched_finding -, labels seen, sources digested", () => {
    const rows = ["pr\tblocker_id\toutcome\tmatched_finding\traw_severity\tmapped_severity\tjudge\tsaw_label\tnote"];
    for (const u of suite.units) for (const b of u.blockers) rows.push([u.pr, b.id, "M", "-", "", "", "lane", "yes", ""].join("\t"));
    const files = new Map<string, Buffer>([
      ["arm.json", Buffer.from(JSON.stringify({ contract_version: 1, id: "T", label: "T", suite: suite.id, date: "2026-10-30", passes: 1, provenance: "transcribed", transcribed_from: [{ name: "results.md", sha256: "0".repeat(64) }] }))],
      ["judgments.tsv", Buffer.from(rows.join("\n"))],
    ]);
    expect(parseArm(files, suite).provenance).toBe("transcribed");
    expect(refusal(edit(files, "judgments.tsv", (t) => t.replace("\tyes\t", "\tno\t")))?.text).toMatch(/labels in view/);
    expect(refusal(edit(files, "arm.json", armJson((a) => delete a.transcribed_from)))?.text).toMatch(/transcribed_from/);
  });

  test("a raw arm (findings, no judgments) is valid and not yet judged", () => {
    const raw = new Map(base());
    raw.delete("judgments.tsv");
    expect(parseArm(raw, suite).state).toBe("raw");
  });
});

describe("noloss ingest", () => {
  test("symlinks and files outside the contract are refused", () => {
    const d = tmp();
    cpSync(EXAMPLE, join(d, "arm"), { recursive: true });
    writeFileSync(join(d, "arm", "notes.txt"), "x");
    expect(() => snapshot(join(d, "arm"))).toThrow(/notes.txt.*not part of arm contract v1/);
    rmSync(join(d, "arm", "notes.txt"));
    symlinkSync(join(d, "arm", "cost.tsv"), join(d, "arm", "findings", "link.jsonl"));
    expect(() => snapshot(join(d, "arm"))).toThrow(/symlink/);
  });

  test("a scan hit is refused without echoing it, and --digest-only publishes only the digest", () => {
    const secret = "sk-" + "a".repeat(30);
    const files = edit(base(), "findings/3593.jsonl", (t) => t.replace(/Synthetic example finding for [^"]* B1\./, "leaked " + secret));
    let msg = "";
    try {
      prepare(files, suite, sha256, []);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/finding "ex-3593-b1".*sk-key/);
    expect(msg).not.toContain(secret);
    const p = prepare(files, suite, sha256, ["ex-3593-b1"]);
    expect(p.out.get("findings/3593.jsonl")!.toString()).not.toContain(secret);
    expect(p.out.get("findings/3593.jsonl")!.toString()).toContain("digest_only");
    expect(() => prepare(files, suite, sha256, ["nope"])).toThrow(/names no finding: nope/);
  });

  test("fields kept under --digest-only and the --replace reason must pass the scan too", () => {
    const secret = "sk-" + "b".repeat(30);
    const files = edit(base(), "findings/3593.jsonl", (t) => t.replace('"category":"example"', '"category":"' + secret + '"'));
    let msg = "";
    try {
      prepare(files, suite, sha256, ["all"]);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/findings\/3593.jsonl line \d+ of the output.*sk-key/);
    expect(msg).not.toContain(secret);
    const root = tmp();
    const first = publish(prepare(base(), suite, sha256, []), suite, root, null);
    const changed = edit(base(), "cost.tsv", (t) => t.replace("\t60\t", "\t61\t"));
    expect(() => publish(prepare(changed, suite, sha256, []), suite, root, "rerun with " + secret)).toThrow(/--replace reason without keys/);
    expect(JSON.parse(readFileSync(join(first.dest, "ingest.json"), "utf8")).replaced).toBeNull();
  });

  test("publish is atomic and idempotent; a different arm needs --replace with a reason", () => {
    const root = tmp();
    const first = publish(prepare(base(), suite, sha256, []), suite, root, null);
    expect(first.status).toBe("published");
    expect(existsSync(join(first.dest, "ingest.json"))).toBe(true);
    expect(publish(prepare(base(), suite, sha256, []), suite, root, null).status).toBe("unchanged");
    const changed = edit(base(), "cost.tsv", (t) => t.replace("\t60\t", "\t61\t"));
    expect(() => publish(prepare(changed, suite, sha256, []), suite, root, null)).toThrow(/--replace/);
    const r = publish(prepare(changed, suite, sha256, []), suite, root, "fixed a wall time");
    expect(r.status).toBe("replaced");
    expect(JSON.parse(readFileSync(join(r.dest, "ingest.json"), "utf8")).replaced).toMatch(/fixed a wall time/);
  });

  test("a sealed suite's arms never land inside the repo", () => {
    const sealed = { ...suite, sealed: true };
    const p = prepare(base(), sealed, sha256, []);
    expect(() => publish(p, sealed, join(REPO_ROOT, "lanes/review-noloss/arms"), null)).toThrow(/sealed/);
    expect(publish(p, sealed, tmp(), null).status).toBe("published");
  });

  test("insideRepo resolves symlinks: a link from outside into the repo is inside, also for a path that does not exist yet", () => {
    const repo = tmp();
    const outside = tmp();
    symlinkSync(repo, join(outside, "alias"));
    expect([join(outside, "alias"), join(outside, "alias", "sealed.tsv"), join(outside, "alias", "new", "deeper", "flags.jsonl")].map((d) => insideRepo(d, repo))).toEqual([true, true, true]);
    expect(insideRepo(join(repo, "not-yet", "x.tsv"), join(outside, "alias"))).toBe(true);
    expect([join(outside, "x.tsv"), join(outside, "none", "x.tsv")].map((d) => insideRepo(d, repo))).toEqual([false, false]);
  });

  test("the CLI: ingest --check on the example, suite --check, and refusals start with their code", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (t: string) => out.push(t), err: (t: string) => err.push(t) };
    expect(await nolossCli(["ingest", EXAMPLE, "--suite", "gsta167-14pr", "--check"], io)).toBe(0);
    expect(await nolossCli(["suite", "--check"], io)).toBe(0);
    expect(out.join("\n")).toMatch(/ingest --check ok: arm example/);
    expect(await nolossCli(["ingest", join(EXAMPLE, "findings"), "--suite", "gsta167-14pr", "--check"], io)).toBe(2);
    for (const line of err.join("\n").split("\n")) expect(line).toStartWith("E_NOLOSS_ARM ");
    expect(await nolossCli(["bogus"], io)).toBe(2);
  });
});
