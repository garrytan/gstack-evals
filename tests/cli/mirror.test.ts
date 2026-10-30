import { describe, expect, test } from "bun:test";
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCall } from "../../src/skill-eval/cli/call.ts";
import { parseFlags, SKILL_EVAL_FLAGS } from "../../src/skill-eval/cli/flags.ts";
import { MIRROR_FILES, MirrorAliasError, mirrorRun, SCRUB_KEYS } from "../../src/skill-eval/cli/mirror.ts";
import { mirrorReceipts } from "../../src/skill-eval/cli/skill-eval.ts";
import { collect, tree } from "./helpers.ts";

describe("--mirror's scrub", () => {
  // Value: protects=a mirror copies only the top-level verdict and receipts, drops each SCRUB_KEYS value (transcript turns, machine paths, meter, lease and container ids), rewrites the out dir, named roots, other machine paths and meter ids inside any string, drops a journal line that does not parse, and creates nothing for an out dir with no record; fails_when=a transcript, a path under the out dir, a meter id or a file under runs/ or proxy/ reaches the mirror; why_new=GST-273 (U10b builds --mirror); seam=mirrorRun; no_claim=a real run's files (tests/adapters/run-host.test.ts covers one)
  test("verdict and receipts keep their numbers and lose transcripts, paths and meter ids", () => {
    const root = mkdtempSync(join(tmpdir(), "gse-mirror-unit-"));
    const out = join(root, "out");
    const arms = join(root, "skills");
    mkdirSync(join(out, "runs", "m", "after", "t", "r1-t0", "host"), { recursive: true });
    mkdirSync(join(out, "proxy"), { recursive: true });
    const meter = "m_" + "0123456789abcdef01234567";
    const agentPath = join("/", "home", "agent", ".claude", "skills", "demo", "SKILL.md");
    writeFileSync(join(out, "runs", "m", "after", "t", "r1-t0", "host", "transcript.ndjson"), JSON.stringify({ type: "assistant", text: "SECRET TRANSCRIPT LINE" }) + "\n");
    writeFileSync(join(out, "proxy", "journal.ndjson"), JSON.stringify({ meter_id: meter }) + "\n");
    writeFileSync(join(out, "verdict.json"), JSON.stringify({ verdict: "pass", exit_code: 0, reasons: ["E_X see " + join(out, "runs", "m") + " and meter " + meter], spend: { ledger: join(root, "ledger"), ledger_record: join(root, "record"), lease_id: "item.0001.abc123", committed: 120, cap: 5000000 }, warnings: ["arm dir " + join(arms, "after") + " and " + agentPath] }));
    writeFileSync(join(out, "run.json"), JSON.stringify({ run_id: "r", recovery: { lease_id: "item.0001.abc123", proxy_container: "gse-proxy-1", journal: join(out, "proxy", "journal.ndjson") } }));
    writeFileSync(join(out, "cells.ndjson"), JSON.stringify({ cell: { model: "m", arm: "after", task: "t" }, record: { turns: ["SECRET TRANSCRIPT LINE", "FINAL ANSWER TEXT"], files_read: ["SKILL.md"], cost_micros: 77, termination: { kind: "completed" }, meter_id: meter } }) + "\nnot json " + join(out, "x") + "\n");
    writeFileSync(join(out, "adjudication.ndjson"), JSON.stringify({ dir: join(out, "judge", "abc"), judge_route: "openai /v1/responses", judgment: "done", cost_micros: 5 }) + "\n");
    writeFileSync(join(out, "progress.json"), JSON.stringify({ last: { cell: "m after t round 1 trial 0" }, notes: ["file:///" + "etc/x", "PATH=/usr/bin:/srv/b", "key:/opt/k", "near " + arms + "2/x", "rate 3/4 and/or"] }));
    const dest = join(root, "mirror");
    const written = mirrorRun(out, dest, [arms, join(root, "ledger")]);
    expect(written.map((w) => w.slice(dest.length + 1)).sort()).toEqual(["adjudication.ndjson", "cells.ndjson", "progress.json", "run.json", "verdict.json"]);
    expect(readdirSync(dest).sort()).toEqual(["adjudication.ndjson", "cells.ndjson", "progress.json", "run.json", "verdict.json"]);
    expect(JSON.parse(readFileSync(join(dest, "progress.json"), "utf8")).notes).toEqual(["file://<path>", "PATH=<path>", "key:<path>", "near <path>", "rate 3/4 and/or"]);
    const text = readdirSync(dest).map((f) => readFileSync(join(dest, f), "utf8")).join("\n");
    for (const leak of [out, root, meter, "SECRET TRANSCRIPT LINE", "FINAL ANSWER TEXT", "item.0001.abc123", "gse-proxy-1", agentPath, "not json"]) expect(text).not.toContain(leak);
    const verdict = JSON.parse(readFileSync(join(dest, "verdict.json"), "utf8"));
    expect(verdict).toMatchObject({ verdict: "pass", exit_code: 0, spend: { ledger: null, ledger_record: null, lease_id: null, committed: 120, cap: 5000000 } });
    expect(verdict.reasons).toEqual(["E_X see <out>/runs/m and meter <meter>"]);
    expect(verdict.warnings).toEqual(["arm dir <path>/after and <path>"]);
    const cells = readFileSync(join(dest, "cells.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(cells).toEqual([{ cell: { model: "m", arm: "after", task: "t" }, record: { turns: [], files_read: ["SKILL.md"], cost_micros: 77, termination: { kind: "completed" }, meter_id: null } }]);
    expect(JSON.parse(readFileSync(join(dest, "adjudication.ndjson"), "utf8"))).toEqual({ dir: null, judge_route: "openai /v1/responses", judgment: "done", cost_micros: 5 });
    expect(JSON.parse(readFileSync(join(dest, "run.json"), "utf8"))).toEqual({ run_id: "r", recovery: null });
    expect(Object.keys(SCRUB_KEYS)).toEqual(expect.arrayContaining(["turns", "meter_id", "lease_id", "dir", "ledger", "recovery"]));
    expect(MIRROR_FILES).not.toContain("transcript.ndjson" as never);
    const nothing = join(root, "empty-out");
    mkdirSync(nothing);
    expect(mirrorRun(nothing, join(root, "mirror2"))).toEqual([]);
    expect(() => readdirSync(join(root, "mirror2"))).toThrow();
  });

  // Value: protects=a mirror directory that is the out directory under another name (a symlink) is refused before any write, and a reused mirror directory loses the records the new run did not write, so a mirror never overwrites its receipts or mixes two runs; fails_when=a symlinked destination rewrites the source, or an earlier run's verdict or journals survive beside a later run's records; why_new=Capy's review of #69; seam=mirrorRun, canonical; no_claim=none beyond protects
  test("an aliased destination is refused and a reused one keeps only this run's records", () => {
    const root = mkdtempSync(join(tmpdir(), "gse-mirror-alias-"));
    const out = join(root, "out");
    mkdirSync(out);
    writeFileSync(join(out, "cells.ndjson"), JSON.stringify({ record: { turns: ["kept in the source"] } }) + "\n");
    symlinkSync(out, join(root, "alias"));
    expect(() => mirrorRun(out, join(root, "alias"))).toThrow(MirrorAliasError);
    expect(readFileSync(join(out, "cells.ndjson"), "utf8")).toContain("kept in the source");
    const dest = join(root, "public");
    writeFileSync(join(out, "verdict.json"), JSON.stringify({ verdict: "pass" }));
    expect(mirrorRun(out, dest).length).toBe(2);
    const next = join(root, "out2");
    mkdirSync(next);
    writeFileSync(join(next, "calibration.json"), JSON.stringify({ exit_code: 0 }));
    expect(mirrorRun(next, dest).length).toBe(1);
    expect(readdirSync(dest)).toEqual(["calibration.json"]);
    expect(existsSync(join(dest, "verdict.json"))).toBe(false);
  });

  // Value: protects=a mirror file that is a symlink or a hardlink to a source receipt is replaced by a new file, so the scrubbed copy never writes through it into the out directory; fails_when=a per-file alias in the mirror directory rewrites a source receipt; why_new=Capy's review of #69; seam=mirrorRun; no_claim=none beyond protects
  test("a mirror file that links to a source receipt is replaced, not written through", () => {
    const root = mkdtempSync(join(tmpdir(), "gse-mirror-link-"));
    const out = join(root, "out");
    mkdirSync(out);
    const raw = JSON.stringify({ record: { turns: ["kept in the source"] } }) + "\n";
    writeFileSync(join(out, "cells.ndjson"), raw);
    writeFileSync(join(out, "verdict.json"), JSON.stringify({ dir: "/kept/in/the/source" }));
    const dest = join(root, "public");
    mkdirSync(dest);
    symlinkSync(join(out, "cells.ndjson"), join(dest, "cells.ndjson"));
    linkSync(join(out, "verdict.json"), join(dest, "verdict.json"));
    expect(mirrorRun(out, dest).length).toBe(2);
    expect(readFileSync(join(out, "cells.ndjson"), "utf8")).toBe(raw);
    expect(readFileSync(join(out, "verdict.json"), "utf8")).toContain("/kept/in/the/source");
    expect(lstatSync(join(dest, "cells.ndjson")).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(dest, "verdict.json")).nlink).toBe(1);
    expect(readFileSync(join(dest, "cells.ndjson"), "utf8")).not.toContain("kept in the source");
    expect(readFileSync(join(dest, "verdict.json"), "utf8")).not.toContain("/kept/in/the/source");
  });

  // Value: protects=a mirror directory that became the out directory after the call resolved (a symlink made mid-run) stops the CLI's run layer with a coded E_USAGE line and a failed call, and writes nothing; fails_when=mirrorRun's alias refusal reaches the CLI uncoded, where skill-eval reports it as E_INTERNAL; why_new=Capy's review of #69; seam=mirrorReceipts over resolveCall; no_claim=the refusal before the run (tests/cli/call.test.ts)
  test("an alias found at mirror time is a coded E_USAGE stop", () => {
    const root = mkdtempSync(join(tmpdir(), "gse-mirror-stop-"));
    const out = join(root, "out");
    mkdirSync(out);
    writeFileSync(join(out, "cells.ndjson"), JSON.stringify({ record: { turns: ["kept in the source"] } }) + "\n");
    const skill = tree({ "SKILL.md": "# demo\n\nNEVER guess.\n" });
    const parsed = parseFlags(["--arms", "before=" + skill + ",after=" + skill + ",none", "--tasks", join(skill, "tasks.json"), "--host", "claude", "--model", "claude-opus-5-5", "--out", out, "--mirror", join(root, "public")], SKILL_EVAL_FLAGS, {});
    if (typeof parsed === "string") throw new Error(parsed);
    const call = resolveCall(parsed, {}, tree({ ".keep": "" }));
    if ("code" in call) throw new Error(call.code + " " + call.message);
    symlinkSync(out, join(root, "public"));
    const io = collect();
    expect(mirrorReceipts(call, io, false)).toBe(false);
    const err = io.text().err;
    expect(err).toStartWith("E_USAGE skill-eval: --mirror: the mirror directory " + join(root, "public") + " is the out directory " + out);
    expect(err.split("\n").every((line) => line.startsWith("E_USAGE "))).toBe(true);
    expect(io.text().out).toBe("");
    expect(readFileSync(join(out, "cells.ndjson"), "utf8")).toContain("kept in the source");
  });
});
