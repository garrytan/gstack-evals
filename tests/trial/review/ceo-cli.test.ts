// gstack-evals ceo rows --checks, the per-cell diagnostics, the data refusals and the readings' joins, and noloss
// judge-run --ceo: the brief's two pinned reads, the judge request bodies (Sol at reasoning effort medium, the Anthropic
// judges with no thinking field), section 8's failure rule with one retry, a duplicated review line, and a stopped run.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { ceoBriefReads, ceoReplyAnswers, CEO_D_READ_SHA256, CEO_REM_READ_SHA256 } from "../../../lanes/review-noloss/judge-run.ts";
import { BRIEF, ceo, dBlock, honest, JUDGES, judgeRun, ledger, pipeline, remBlock, ROOT, runDir, sessionDir, SMOKE, STAGE1_NONE, tmp, U1, U2, U3, unitsDir, upstream, type Sent } from "./ceo-pipeline.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const fresh = (tag: string) => {
  const d = tmp(tag);
  dirs.push(d);
  unitsDir(d);
  return d;
};
const lastLine = (s: string) => s.trim().split("\n").at(-1)!;

describe("ceo rows --checks", () => {
  test("smoke sessions that are readable, determinate, scored and exposed pass, and exit 0", async () => {
    const d = fresh("checks");
    const r = await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", runDir(d, "smoke", SMOKE), "--checks"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("session smoke:standalone:opus:" + U1 + ":p1: journaled pass, transcript_readable pass, block pass, end_state_determinate pass, scored pass, review_sections_read pass, mode_named pass; end state scored; exposed true; first failed: none");
    expect(r.out).toContain("handoff_ceo_only pass, findings_written pass");
    expect(lastLine(r.out)).toBe("checks: 12 sessions, 12 pass, 0 fail");
  });

  test("an unexposed smoke session, a no-block, a gap and a cap-stopped session each fail with their first failed check, and exit 1", async () => {
    const d = fresh("checks-fail");
    const smoke = SMOKE.map((s) => (s.model === "sol" && s.arm === "gstack-forced" && s.unit === U2 ? { ...s, how: "unexposed" as const } : s));
    const r = await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", runDir(d, "run", [...smoke, ...STAGE1_NONE]), "--checks"]);
    expect(r.code).toBe(1);
    const sum = r.out.split("\n").find((l) => l.startsWith("checks: "))!;
    expect(sum).toContain("smoke:standalone:sol:" + U2 + ":p1 (mode_named)");
    expect(sum).toContain("none:sol:" + U2 + ":p2 (block)");
    expect(sum).toContain("none:opus:" + U3 + ":p3 (block)");
    expect(sum).toContain("none:particle:" + U3 + ":p2 (journaled)");
    expect(sum).toContain("4 fail");
    expect(lastLine(r.out)).toMatch(/^fix: /);
  });

  test("a stored end state the table doesn't give fails end_state_determinate in --checks and is refused when writing rows", async () => {
    const d = fresh("determinate");
    const run = runDir(d, "run", [...STAGE1_NONE, ...SMOKE], (e) => {
      if (e.cell.arm === "none" && e.cell.unit === U1 && e.cell.pass === 1 && e.cell.model.includes("sol")) e.ceo_outcome.end_state = "no-block";
    });
    const c = await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", run, "--checks"]);
    expect(c.out).toContain("none:sol:" + U1 + ":p1 (end_state_determinate)");
    const w = await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", run, "--out", join(d, "rows.json")]);
    expect(w.code).toBe(2);
    expect(lastLine(w.err)).toMatch(/^E_USAGE fix: /);
  });
});

describe("ceo rows: diagnostics and data refusals", () => {
  test("rows print per-cell counts only: no-block, gaps, incomplete, more than three issues, zero-output", async () => {
    const d = fresh("diag");
    const r = await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", runDir(d, "run", [...STAGE1_NONE, ...SMOKE]), "--out", join(d, "rows.json")]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("cell none:opus: 9 planned; 8 scored, 0 no-block, 1 gap, 0 incomplete; 1 with more than three issues, 0 zero-output, 0 follow-ups; mean issue words ");
    expect(r.out).toContain("cell none:sol: 6 planned; 5 scored, 1 no-block, 0 gap, 0 incomplete; 1 with more than three issues, 1 zero-output, 1 follow-ups");
    expect(r.out).toContain("cell none:particle: 6 planned; 5 scored, 0 no-block, 0 gap, 1 incomplete");
    expect(r.out).toContain("cell smoke autoplan-ceo:opus: 2 planned; 2 scored");
  });

  test("a planned session missing from every run, and from stops.json, is a gap row", async () => {
    const d = fresh("missing");
    const run = runDir(d, "run", [...STAGE1_NONE.filter((s) => !(s.model === "opus" && s.unit === U2 && s.pass === 3)), ...SMOKE]);
    expect((await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", run, "--out", join(d, "rows.json")])).code).toBe(0);
    const row = JSON.parse(readFileSync(join(d, "rows.json"), "utf8")).rows.find((r: any) => r.id === "none:opus:" + U2 + ":p3");
    expect([row.status, row.issues, row.usd]).toEqual(["gap", [], 0]);
  });

  test("a session in two runs is refused, naming both runs and which to drop", async () => {
    const d = fresh("dup");
    const a = runDir(d, "a", [...STAGE1_NONE, ...SMOKE]);
    const b = runDir(d, "b", [STAGE1_NONE[0]!]);
    const r = await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", a, "--run", b, "--out", join(d, "rows.json")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain(a + " (journal) and " + b + " (journal)");
    expect(lastLine(r.err)).toContain("fix: drop one of the two --run dirs");
  });

  test("a session outside the plan is refused with a fix line", async () => {
    const d = fresh("outside");
    const r = await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", runDir(d, "run", [...STAGE1_NONE, ...SMOKE, { model: "opus", arm: "lens", unit: U1, pass: 1 }]), "--out", join(d, "rows.json")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("lens:opus:" + U1 + ":p1");
    expect(lastLine(r.err)).toMatch(/^E_USAGE fix: drop the --run/);
  });
});

describe("readings join the three judges", () => {
  test("labels, rem, leak and stock calls come from the replies; held and unkeyed units carry rem null", async () => {
    const d = fresh("join");
    const p = await pipeline(d, 1, [runDir(d, "run", [...STAGE1_NONE, ...SMOKE])]);
    const rd = JSON.parse(readFileSync(p.readings, "utf8"));
    const r1 = rd.reviews.find((r: any) => r.id === "none:opus:" + U1 + ":p1");
    const call = (l: string, rem: boolean | null) => ({ sol: l, opus: l, sonnet: l, rem: rem === null ? null : { sol: rem, opus: rem, sonnet: rem } });
    expect(r1.labels).toEqual([call("D", true), call("R1", false), call("none", false)]);
    expect(r1.leak).toEqual({ sol: false, opus: false });
    expect(rd.reviews.find((r: any) => r.id === "none:opus:" + U2 + ":p1").labels[0]).toEqual(call("D", null));
    expect(rd.reviews.find((r: any) => r.id === "none:opus:" + U3 + ":p1").labels[0]).toEqual(call("D", null));
    expect(rd.reviews.find((r: any) => r.smoke).labels).toEqual([]);
    expect(rd.stock.find((s: any) => s.unit === U1 && s.row === "A").labels).toEqual([call("none", false), call("R1", false), call("none", false)]);
    expect(rd.stock.filter((s: any) => s.unit === U3)).toEqual([]);
    expect(rd.units.find((u: any) => u.id === U1)).toEqual({ id: U1, kind: "changed", strict: "2026-07-14", category: "scope", role: "maintainer", remedy: true, remedy_kind: "scope", decoy: "R1", second_order: false });
    expect(rd.units.find((u: any) => u.id === U3)).toMatchObject({ kind: "held", remedy: false, remedy_kind: null, decoy: null, second_order: false });
    const heldPacket = JSON.parse(readFileSync(join(p.packets, JSON.parse(readFileSync(p.key, "utf8")).units.find((u: any) => u.unit === U3).d_packet.file), "utf8"));
    expect(heldPacket.key.D).toBeNull();
    expect(heldPacket.key.note).toContain("no decisive issue");
    expect(JSON.parse(readFileSync(p.key, "utf8")).units.find((u: any) => u.unit === U3).rem_packet).toBeNull();
  });
});

describe("noloss judge-run --ceo", () => {
  test("the brief's D read and remedy read are cut at the rule and pinned; another brief is refused with a fix line", () => {
    const brief = readFileSync(BRIEF, "utf8");
    const reads = ceoBriefReads(brief);
    expect(CEO_D_READ_SHA256).toBe("83d5d644b97aa87003ea38a8cb273b64590f1c50129430612af2432072852589");
    expect(CEO_REM_READ_SHA256).toBe("75a90494a8a097cd5318b081b204bfd7b6b2fde8e11c147171b7cc1659c19923");
    expect(reads.D).toBe(readFileSync(join(ROOT, "wiki/plans/2026-11-04-geva-285-ceo-outcome-prereg/judge-brief.md"), "utf8"));
    expect(reads.D + "\n---\n" + reads.rem).toBe(brief);
    expect(reads.rem.startsWith("\nThe D read's prompt is everything above the rule")).toBe(true);
    expect(() => ceoBriefReads(reads.D)).toThrow(/sha256[\s\S]*\nfix: /);
  });

  test("section 8's failure rule: no block, two blocks, a duplicated review line, an unknown review, a wrong length, an unknown label or value, a review left out", () => {
    const rv = [{ review: "ra", issues: 2 }, { review: "rb", issues: 3 }];
    const ok = [{ review: "ra", labels: ["D", "none"], leak: "no" }, { review: "rb", labels: ["R1", "none", "none"], leak: "yes" }];
    expect(ceoReplyAnswers("D", rv, "intro\n" + dBlock(ok))).toEqual({ ra: { labels: ["D", "none"], leak: "no" }, rb: { labels: ["R1", "none", "none"], leak: "yes" } });
    expect(ceoReplyAnswers("D", rv, "I can't help with that.")).toContain("0 ceo-judge blocks");
    expect(ceoReplyAnswers("D", rv, dBlock(ok) + dBlock(ok))).toContain("2 ceo-judge blocks");
    expect(ceoReplyAnswers("D", rv, dBlock([...ok, ok[0]]))).toContain("twice");
    expect(ceoReplyAnswers("D", rv, dBlock([...ok, { review: "rz", labels: [], leak: "no" }]))).toContain("doesn't hold");
    expect(ceoReplyAnswers("D", rv, dBlock([...ok, { review: "the plan ships before the audit", labels: [], leak: "no" }]))).not.toContain("audit");
    expect(ceoReplyAnswers("D", rv, dBlock([ok[0], { ...ok[1], labels: ["D"] }]))).toContain("not 3");
    expect(ceoReplyAnswers("D", rv, dBlock([ok[0], { ...ok[1], labels: ["D2", "none", "none"] }]))).toContain("label outside");
    expect(ceoReplyAnswers("D", rv, dBlock([ok[0], { ...ok[1], leak: "maybe" }]))).toContain("leak");
    expect(ceoReplyAnswers("D", rv, dBlock([ok[0]]))).toContain("1 of 2 reviews unanswered");
    expect(ceoReplyAnswers("rem", rv, remBlock([{ review: "ra", rem: ["yes", "no"] }, { review: "rb", rem: ["no", "no", "no"] }]))).toEqual({ ra: { rem: ["yes", "no"] }, rb: { rem: ["no", "no", "no"] } });
    expect(ceoReplyAnswers("rem", rv, remBlock([{ review: "ra", rem: ["yes", "true"] }, { review: "rb", rem: ["no", "no", "no"] }]))).toContain("other than yes and no");
    expect(ceoReplyAnswers("rem", rv, dBlock(ok))).toContain("0 ceo-judge-rem blocks");
  });

  const setup = async (tag: string) => {
    const d = fresh(tag);
    const run = runDir(d, "run", [...STAGE1_NONE, ...SMOKE]);
    await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", run, "--out", join(d, "rows.json")]);
    await ceo(["packets", "--rows", join(d, "rows.json"), "--units", join(d, "units"), "--seed", "5", "--out", join(d, "packets"), "--key", join(d, "key.json")]);
    const { record, db } = ledger(d, ["sol", "opus", "sonnet"]);
    const args = (judge: string, item: string, out: string) => ["--packets", join(d, "packets"), "--key", join(d, "key.json"), "--brief", BRIEF, "--judge", judge, "--item", item, "--out", join(d, out), "--ledger", db, "--record", record, "--concurrency", "1"];
    return { d, args };
  };

  test("request bodies: the Sol judge sends reasoning effort medium; the Opus and Sonnet judges send no thinking field and no effort", async () => {
    const { args } = await setup("bodies");
    const sent: Sent[] = [];
    for (const [j, item] of [[JUDGES.sol, "sol"], [JUDGES.opus, "opus"], [JUDGES.sonnet, "sonnet"]] as const) expect((await judgeRun(args(j, item, "out-" + item), upstream(sent, honest))).code).toBe(0);
    const of = (m: string) => sent.filter((s) => s.model === m).map((s) => s.body);
    expect(of("gpt-6.1-sol").length).toBe(4);
    for (const b of of("gpt-6.1-sol")) expect(b.reasoning).toEqual({ effort: "medium" });
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
      expect(of(m).length).toBe(4);
      for (const b of of(m)) {
        expect("thinking" in b).toBe(false);
        expect("reasoning" in b).toBe(false);
      }
    }
    const prompts = sent.map((s) => (s.body.input ?? s.body.messages)[0].content as string);
    const reads = ceoBriefReads(readFileSync(BRIEF, "utf8"));
    expect(prompts.filter((p) => p.startsWith(reads.D + "\n=== Packet: ")).length).toBe(9);
    expect(prompts.filter((p) => p.startsWith(reads.rem + "\n=== Packet: ")).length).toBe(3);
  });

  test("one retry: a duplicated review line is malformed and asked again; a second failure leaves the packet missing, and readings read null calls and no leak", async () => {
    const { d, args } = await setup("retry");
    const key = JSON.parse(readFileSync(join(d, "key.json"), "utf8"));
    const dU1 = key.units.find((u: any) => u.unit === U1).d_packet.file;
    const dU2 = key.units.find((u: any) => u.unit === U2).d_packet.file;
    const flaky = (m: string, f: string, packet: any, attempt: number) => {
      const good = honest(m, f, packet, attempt);
      if (m !== "gpt-6.1-sol") return good;
      if (f === dU1 && attempt === 1) return good.replace("\n" + FENCE_END, "\n" + good.split("\n")[1] + "\n" + FENCE_END);
      if (f === dU2) return "I won't judge this.";
      return good;
    };
    const sent: Sent[] = [];
    const sol = await judgeRun(args(JUDGES.sol, "sol", "sol"), upstream(sent, flaky));
    expect(sol.code).toBe(0);
    expect(sol.err).toContain(dU1 + " was refused (attempt 1)");
    expect(sol.err).toContain("JUDGE_REPLY_REFUSED: noloss judge-run --ceo: the reply for ");
    expect(sol.err).toContain("twice");
    const replies = JSON.parse(readFileSync(join(d, "sol", "replies.json"), "utf8"));
    expect(replies.packets.find((p: any) => p.file === dU1)).toMatchObject({ status: "answered", attempts: 2 });
    expect(replies.packets.find((p: any) => p.file === dU2)).toMatchObject({ status: "missing" });
    expect(replies.packets.find((p: any) => p.file === dU2).cause).toContain("refused twice");
    for (const [j, item] of [[JUDGES.opus, "opus"], [JUDGES.sonnet, "sonnet"]] as const) expect((await judgeRun(args(j, item, item), upstream([], honest))).code).toBe(0);
    const r = await ceo(["readings", "--rows", join(d, "rows.json"), "--key", join(d, "key.json"), "--sol", join(d, "sol"), "--opus", join(d, "opus"), "--sonnet", join(d, "sonnet"), "--units", join(d, "units"), "--out", join(d, "readings.json")]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/missing D calls: sol [1-9]\d*, opus 0, sonnet 0/);
    const row = JSON.parse(readFileSync(join(d, "readings.json"), "utf8")).reviews.find((x: any) => x.id === "none:opus:" + U2 + ":p1");
    expect(row.labels[0]).toEqual({ sol: null, opus: "D", sonnet: "D", rem: null });
    expect(row.leak).toEqual({ sol: false, opus: false });
  });

  test("a run that stops records every packet it didn't answer as missing with the cause, and doesn't resume", async () => {
    const { d, args } = await setup("stop");
    const key = JSON.parse(readFileSync(join(d, "key.json"), "utf8"));
    const second = key.packets[1].file;
    const r = await judgeRun(args(JUDGES.opus, "opus", "opus"), upstream([], honest, (_m, f) => (f === second ? 400 : 200)));
    expect(r.code).toBe(2);
    const replies = JSON.parse(readFileSync(join(d, "opus", "replies.json"), "utf8"));
    expect(replies.state).toBe("stopped");
    expect(replies.packets.length).toBe(key.packets.length);
    expect(replies.packets[0].status).toBe("answered");
    for (const p of replies.packets.slice(1)) expect([p.status, p.cause]).toEqual(["missing", "no answer: the run stopped (UPSTREAM)"]);
    const again = await judgeRun(args(JUDGES.opus, "opus", "opus"), upstream([], honest));
    expect(again.code).toBe(2);
    expect(again.err).toContain("not empty");
  });

  test("a judge outside section 8's three is refused with a fix line", async () => {
    const { args } = await setup("judge");
    const r = await judgeRun(args("anthropic/claude-haiku-5-5", "sol", "out"));
    expect(r.code).toBe(2);
    expect(lastLine(r.err)).toMatch(/^fix: pass --judge openai\/gpt-6.1-sol/);
  });
});

describe("review fixes on #225", () => {
  test("--checks fails transcript_readable for a none session whose transcript is gone, though its journal parse is a block", async () => {
    const d = fresh("checks-none-transcript");
    const run = runDir(d, "run", [...SMOKE, ...STAGE1_NONE]);
    rmSync(join(sessionDir(run, { model: "opus", arm: "none", unit: U1, pass: 2 }), "transcript.ndjson"));
    const r = await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", run, "--checks"]);
    expect(r.code).toBe(1);
    expect(r.out.split("\n").find((l) => l.startsWith("checks: "))!).toContain("none:opus:" + U1 + ":p2 (transcript_readable)");
  });

  test("packets refuses a --key that reaches --out through a symlink", async () => {
    const d = fresh("packets-alias");
    mkdirSync(join(d, "packets"));
    symlinkSync(join(d, "packets"), join(d, "alias"));
    const r = await ceo(["packets", "--rows", join(d, "rows.json"), "--units", join(d, "units"), "--seed", "3", "--out", join(d, "packets"), "--key", join(d, "alias", "key.json")]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("is inside --out");
  });

  test("judge-run --ceo refuses a --key that reaches --packets through a symlink", async () => {
    const d = fresh("judge-alias");
    mkdirSync(join(d, "packets"));
    symlinkSync(join(d, "packets"), join(d, "alias"));
    const r = await judgeRun(["--packets", join(d, "packets"), "--key", join(d, "alias", "key.json"), "--brief", BRIEF, "--judge", JUDGES.sol, "--item", "sol", "--out", join(d, "out")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("E_NOLOSS_BLIND");
    expect(r.err).toContain("is inside --packets");
  });
});
const FENCE_END = "\x60\x60\x60\n";
