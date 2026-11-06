// ceo rows, packets and readings under the stage 2 amendment: the enforced arm's four checks and gate lines, the smoke
// rerun (--smoke-round 2), the PASS line's units: clause cutting --order, the proxy's per-session meter and termination
// on rows and readings, a copy-out failure named, and section 3.6's note 2 on an enforced row. Every test here fails at
// 715c659, which has no enforced arm, no --smoke-round, no --order and no meter record.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { ceo, ORDER, pipeline, PROJECTION, runDir, SMOKE, SMOKE2, STAGE1_NONE, STAGE2, tmp, U1, U2, U3, unitsDir, type Session } from "./ceo-pipeline.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const fresh = (tag: string) => {
  const d = tmp(tag);
  roots.push(d);
  unitsDir(d);
  return d;
};
const json = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const rows1 = (d: string, runs: string[], round: string[] = ["--smoke-round", "2"], out: string[] = ["--out", join(d, "rows.json")]) => ceo(["rows", "--stage", "1", "--units", join(d, "units"), ...runs.flatMap((r) => ["--run", r]), ...round, ...out]);
const METER = { peak_inflight_usd: 3.25, peak_inflight_calls: 2, largest_prompt: 133119, bytes_per_token: 5.67, cache_write: ["5m"] };
const smoke2 = (edit: (s: Session) => Session = (s) => s) => SMOKE2.map((s) => edit({ ...s }));

describe("the smoke rerun: --smoke-round 2 plans enforced and standalone, and the enforced arm reads four checks", () => {
  // Value: protects=section 8's gate reads the rerun's 12 sessions with enforced's four checks; fails_when=rows plan autoplan-ceo for the rerun, or an enforced session reads exposed without an armed and released gate; why_new=stage 2 amendment 3.3 item 6, 4.2, 8; seam=ceo rows; no_claim=the gate report's own counts, which the armed test reads
  test("rows read 12 smoke sessions, enforced exposed on all four checks, and record smoke_round 2", async () => {
    const d = fresh("round2");
    const r = await rows1(d, [runDir(d, "none", STAGE1_NONE), runDir(d, "smoke2", SMOKE2)]);
    expect([r.code, r.err]).toEqual([0, ""]);
    const out = json(join(d, "rows.json"));
    expect(out.smoke_round).toBe(2);
    const smoke = out.rows.filter((x: any) => x.smoke);
    expect(smoke.length).toBe(12);
    expect([...new Set(smoke.map((x: any) => x.arm))].sort()).toEqual(["enforced", "standalone"]);
    expect(smoke.every((x: any) => x.exposed === true)).toBe(true);
    const c = await rows1(d, [join(d, "none"), join(d, "smoke2")], ["--smoke-round", "2"], ["--checks"]);
    const line = c.out.split("\n").find((l) => l.startsWith("session smoke:enforced:opus:" + U1))!;
    expect(line).toContain("review_sections_read pass, mode_named pass, gate_armed pass, gate_released pass");
    expect(c.out).toContain("gate: smoke enforced:opus: 2 sessions; report exits 0 on 2; blocks per session 0, 0; released on the first stop 2 of 2");
  });
  test("stage 1's own smoke is round 1, and each round refuses the other's sessions", async () => {
    const d = fresh("rounds");
    const none = runDir(d, "none", STAGE1_NONE);
    const r1 = await rows1(d, [none, runDir(d, "smoke1", SMOKE)], [], ["--out", join(d, "r1.json")]);
    expect(r1.code).toBe(0);
    expect(json(join(d, "r1.json")).smoke_round).toBe(1);
    const mixed = await rows1(d, [none, join(d, "smoke1")]);
    expect([mixed.code, mixed.err]).toEqual([2, expect.stringContaining("outside stage 1's plan")]);
    const back = await rows1(d, [none, runDir(d, "smoke2", SMOKE2)], ["--smoke-round", "1"], ["--out", join(d, "r2.json")]);
    expect([back.code, back.err]).toEqual([2, expect.stringContaining("outside stage 1's plan")]);
    expect((await rows1(d, [none, join(d, "smoke2")], ["--smoke-round", "3"])).code).toBe(2);
  });
  test("a gate report that isn't exit 0 with a fired run, an exhausted gate, a failed copy or no report reads unexposed", async () => {
    const d = fresh("gates");
    const cases: Record<string, Partial<Session>> = {
      [U1 + ":opus"]: { gate: { exit: 2, fired: 0, released: 0 } },
      [U2 + ":opus"]: { gate: { exit: 0, blocked: 3, released: 0, exhausted: 1 } },
      [U1 + ":sol"]: { copyOut: ["skill-gates: EACCES"] },
      [U2 + ":sol"]: { gate: { exit: null } },
      [U1 + ":particle"]: { gate: { exit: 1 } },
      [U2 + ":particle"]: { gate: { exit: 3 } },
    };
    const sessions = smoke2((s) => (s.arm === "gstack-enforced" ? { ...s, ...(cases[s.unit + ":" + s.model] ?? {}) } : s));
    const c = await rows1(d, [runDir(d, "none", STAGE1_NONE), runDir(d, "smoke2", sessions)], ["--smoke-round", "2"], ["--checks"]);
    expect(c.code).toBe(1);
    const failed = (unit: string, model: string) => c.out.split("\n").find((l) => l.startsWith("session smoke:enforced:" + model + ":" + unit))!.split("first failed: ")[1];
    expect([failed(U1, "opus"), failed(U2, "opus"), failed(U1, "sol"), failed(U2, "sol"), failed(U1, "particle"), failed(U2, "particle")]).toEqual(["gate_armed", "gate_released", "gate_armed", "gate_armed", "gate_armed", "gate_armed"]);
    expect(c.out).toContain("copy_out: smoke:enforced:sol:" + U1 + ":p1: trial.json logged a copy-out failure, so gate_armed reads false");
    expect(c.out).toContain("gate: smoke enforced:opus: 2 sessions; report exits 0 on 1, 2 on 1; blocks per session 0, 3; released on the first stop 0 of 2");
  });
});

describe("stage 2: the PASS line's units: clause cuts --order", () => {
  // Value: protects=the projection sha256 the Captain records fixes which units stage 2 runs; fails_when=rows plan units past the cut, or accept an order or PASS line that doesn't match the suite; why_new=stage 2 amendment 3.5 (Size) and section 4.5; seam=ceo rows --stage 2; no_claim=the seeded order's own provenance, which the custody addendum posts
  const write = (d: string, name: string, v: unknown) => (writeFileSync(join(d, name), typeof v === "string" ? v : JSON.stringify(v)), join(d, name));
  const rows2 = (d: string, run: string, proj: string, order: string) => ceo(["rows", "--stage", "2", "--units", join(d, "units"), "--run", run, "--projection", proj, "--order", order, "--out", join(d, "rows2.json")]);
  test("changed 1 of 2 plans the first changed unit and the held unit only, and rows carry the order", async () => {
    const d = fresh("cut");
    const proj = write(d, "proj.txt", PROJECTION.replace("changed 2 of 2, last " + U2, "changed 1 of 2, last " + U1));
    const order = write(d, "order.json", ORDER);
    const run = runDir(d, "run", STAGE2.filter((s) => s.unit !== U2));
    const r = await rows2(d, run, proj, order);
    expect([r.code, r.err]).toEqual([0, ""]);
    const out = json(join(d, "rows2.json"));
    expect(out.order).toEqual(ORDER);
    expect(out.units.map((u: any) => u.id)).toEqual([U1, U3].sort());
    expect([...new Set(out.rows.map((x: any) => x.unit))].sort()).toEqual([U1, U3].sort());
    const past = await rows2(d, runDir(d, "all", STAGE2), proj, order);
    expect([past.code, past.err]).toEqual([2, expect.stringContaining("outside stage 2's plan")]);
  });
  test("an order or PASS line that doesn't match is refused, and so is autoplan-ceo in stage 2", async () => {
    const d = fresh("cut-refuse");
    const run = runDir(d, "run", STAGE2);
    const order = write(d, "order.json", ORDER);
    const ok = write(d, "ok.txt", PROJECTION);
    expect((await rows2(d, run, ok, order)).code).toBe(0);
    const bad: Array<[string, string, string]> = [
      ["no units clause", write(d, "p1.txt", PROJECTION.replace(/; units: [^\n]*/, "")), order],
      ["wrong last unit", write(d, "p2.txt", PROJECTION.replace("last " + U2, "last " + U1)), order],
      ["wrong count", write(d, "p3.txt", PROJECTION.replace("changed 2 of 2", "changed 2 of 3")), order],
      ["autoplan-ceo cell", write(d, "p4.txt", PROJECTION.replace("enforced:opus", "autoplan-ceo:opus")), order],
      ["order missing a unit", ok, write(d, "o1.json", ORDER.slice(0, 2))],
      ["order with a wrong kind", ok, write(d, "o2.json", ORDER.map((u) => (u.id === U3 ? { ...u, kind: "changed" } : u)))],
    ];
    for (const [why, p, o] of bad) {
      const r = await rows2(d, run, p, o);
      expect([why, r.code, /^(E_[A-Z_]+ )?fix: \S/.test(r.err.trim().split("\n").at(-1)!)]).toEqual([why, 2, true]);
    }
  });
});

describe("rows and readings carry the proxy's meter and the termination", () => {
  // Value: protects=projection's trip check and peak in-flight read come from the rerun's own sessions (notes F and K); fails_when=rows or readings drop or reshape the meter record, or a session with none reads one; why_new=stage 2 amendment section 5, carried notes F, I and K; seam=ceo rows and ceo readings; no_claim=the proxy's arithmetic, which the proxy test covers
  test("a session's meter reaches its row and its readings row; one without, or a malformed one, reads null", async () => {
    const d = fresh("meter");
    const sessions = smoke2((s) => (s.model === "sol" && s.unit === U1 ? { ...s, meter: METER } : s.model === "sol" ? { ...s, meter: { ...METER, cache_write: ["2h"] } } : s));
    const p = await pipeline(d, 1, [runDir(d, "none", STAGE1_NONE), runDir(d, "smoke2", sessions)], { smokeRound: 2 });
    expect(p.log.filter((_, i) => i !== 1).map((l) => l.code)).toEqual(p.log.slice(1).map(() => 0));
    const row = (f: string, arm: string, unit: string) => json(f)[f === p.rows ? "rows" : "reviews"].find((x: any) => x.smoke && x.arm === arm && x.model === "sol" && x.unit === unit);
    for (const f of [p.rows, p.readings]) {
      expect(row(f, "enforced", U1).meter).toEqual(METER);
      expect(row(f, "enforced", U2).meter).toBeNull();
      expect(row(f, "enforced", U1).termination).toBe("completed");
    }
    expect(json(p.readings).smoke_round).toBe(2);
    expect(json(p.readings).reviews.filter((x: any) => !x.smoke).every((x: any) => x.meter === null)).toBe(true);
  });
});

describe("findings_written reads false and is named when the copy-out failed", () => {
  // Value: protects=a session whose ceo-review.md copy failed can't read written; fails_when=a non-empty logs.copy_out leaves findings_written true or goes unnamed; why_new=stage 2 amendment 3.2; seam=ceo rows; no_claim=the copy itself, which trial.ts's test covers
  test("an autoplan session with a logged copy failure fails findings_written, is named, and counts in the disagreement line", async () => {
    const d = fresh("copyout");
    const sessions = SMOKE.map((s) => (s.arm === "gstack-auto" && s.model === "opus" && s.unit === U1 ? { ...s, copyOut: ["ceo-review.md: EACCES"] } : s));
    const c = await rows1(d, [runDir(d, "none", STAGE1_NONE), runDir(d, "smoke1", sessions)], [], ["--checks"]);
    const line = c.out.split("\n").find((l) => l.startsWith("session smoke:autoplan-ceo:opus:" + U1))!;
    expect(line).toContain("findings_written fail");
    expect(c.out).toContain("copy_out: smoke:autoplan-ceo:opus:" + U1 + ":p1: trial.json logged a copy-out failure, so findings_written reads false");
    const r = await rows1(d, [join(d, "none"), join(d, "smoke1")], [], ["--out", join(d, "rows.json")]);
    expect(r.out).toContain("findings: smoke autoplan-ceo:opus: 1 session where the transcript reading of findings_written and the on-disk copy disagree (report-only)");
  });
});

describe("section 3.6, note 2: an enforced row's issues come from its one stored parse", () => {
  // Value: protects=the judge-call count for enforced rows rests on the same single parse as every other arm; fails_when=an enforced row's issues, words, fixes or fix_words come from anywhere but ceoRowFields of its journal parse, or packets and readings take them elsewhere; why_new=stage 2 amendment 3.6 item 2; seam=ceo rows, packets, readings; no_claim=that the one parse is right, which ceo-outcome.test.ts covers
  test("rows, the packet key and readings hold the same issues for an enforced row as its journal's parse", async () => {
    const d = fresh("note2");
    const proj = join(d, "projection.txt");
    writeFileSync(proj, PROJECTION);
    const run = runDir(d, "run", STAGE2);
    const p = await pipeline(d, 2, [run], { projection: proj });
    expect(p.log.map((l) => l.code)).toEqual(p.log.map(() => 0));
    const journal = readFileSync(join(run, "cells.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const entry = journal.find((e) => e.cell.arm === "gstack-enforced" && e.cell.unit === U1 && e.cell.pass === 1);
    const cut = (t: string) => t.split(/\s+/).filter(Boolean).slice(0, 40).join(" ");
    const row = json(p.rows).rows.find((x: any) => x.arm === "enforced" && x.unit === U1 && x.pass === 1);
    expect(row.issues).toEqual(entry.parse.top.map((t: any) => cut(t.issue)));
    const reading = json(p.readings).reviews.find((x: any) => x.id === row.id);
    expect([reading.issues, reading.words, reading.fixes, reading.fix_words]).toEqual([row.issues, row.words, row.fixes, row.fix_words]);
    const key = json(p.key);
    const ku = key.units.find((u: any) => u.unit === U1);
    const k = ku.reviews.find((x: any) => x.row === row.id);
    expect(k.issues).toBe(row.issues.length);
    const packet = json(join(p.packets, ku.d_packet.file));
    expect(packet.reviews.find((x: any) => x.review === k.id).issues).toEqual(row.issues.slice(0, k.issues));
  });
});
