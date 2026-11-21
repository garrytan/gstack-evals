import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUITE } from "../../../lanes/codex-hooks/c/analysis/frozen.ts";
import { readStates, StatesError } from "../../../lanes/codex-hooks/c/analysis/record.ts";
import { exposure, pilotFlags, readContractLog } from "../../../lanes/codex-hooks/c/contract.ts";
import type { OutcomeRow } from "../../../lanes/codex-hooks/c/outcomes.ts";
import type { SessionReadout } from "../../../lanes/codex-hooks/c/readout.ts";
import { itemUnits } from "../../../lanes/codex-hooks/c/pins.ts";
import { exposureOf, phaseRecords, sessionId, sessionRecords } from "../../../lanes/codex-hooks/c/records.ts";
import { readSessionRollouts } from "../../../lanes/codex-hooks/c/rollout.ts";
import { sessionStates } from "../../../lanes/codex-hooks/c/states.ts";
import { loadSuite, type Unit } from "../../../lanes/review-noloss/suite.ts";
import { unitTaskId } from "../../../src/trial/review/unit.ts";

// The fixtures are the real Codex 0.170.0 sessions readouts.test.ts reads (tests/codex-hooks/c/fixtures/README.md).
const FIX = join(import.meta.dir, "fixtures");
const { suite } = loadSuite(SUITE.path);
const A = suite.units[0]!;
const B = suite.units[1]!;
const KEY = randomBytes(32);

function readout(fixture: string, arm: string, unit: Unit, o: Partial<OutcomeRow> = {}, attempt = 1): SessionReadout {
  const host = join(FIX, fixture, "host");
  const r = readSessionRollouts(host);
  const cell = { model: "gpt-6.1-sol", arm, unit: unit.id, pass: 1 };
  const outcome: OutcomeRow = { ...cell, attempt, class: "scored", scored: true, code: null, reasons: [], termination: "done", root_models: [], sub_models: [], journal_models: [], journal_efforts: [], cli_versions: [], requests: 1, rerun: false, gap: false, ...o };
  return { cell, attempt, moved: false, dir: join(FIX, fixture), states: sessionStates(cell, r, KEY), exposure: exposure(r, readContractLog(host)), flags: pilotFlags(r), outcome, usd: 0.5, questions: { asked: 0, same_title: 0 } };
}
const jsonl = (rows: readonly unknown[]) => rows.map((r) => JSON.stringify(r) + "\n").join("");

describe("the states file the analysis reads, from the rig's readouts (lanes/codex-hooks/c/records.ts)", () => {
  // Value: protects=every session class the rig reads becomes lines the analysis's readStates accepts: a blocked session gives first-stop and final lines, an unblocked one a final line, a cap stop, an unscored safety stop and a second infrastructure failure one final line with no findings and their code, and c-none no exposure; fails_when=a scored, blocked or gap session is written in a shape readStates refuses or counts differently; why_new=GEVA-562 part C, the rig and the analysis were built apart; seam=sessionRecords, readStates; no_claim=sessions of a paid run
  test("every class of session reads back through readStates", () => {
    const sessions = [
      readout("block", "c-on", A),
      readout("met", "c-on", B),
      readout("off", "c-off", A),
      readout("off", "c-off", B, { class: "cap_stop", scored: false, code: "CAP_STOP" }),
      readout("none", "c-none", A),
      readout("none", "c-none", B, { class: "safety", scored: false, code: null }),
      readout("nojson", "c-high", A),
      readout("block", "c-high", B, { class: "infra", scored: false, code: "E_CODEX_C_DRIFT", gap: true }, 2),
    ];
    const lines = sessions.flatMap((s) => sessionRecords(s, s.cell.unit === A.id ? A : B));
    const file = readStates(jsonl(lines), suite, { passes: 1, units: [A.id, B.id] });
    expect(file.missing).toEqual([]);
    expect(file.sessions).toHaveLength(8);
    expect(file.states).toHaveLength(7);
    const at = (arm: string, u: Unit) => file.sessions.find((s) => s.id === sessionId(arm, u, 1))!;
    const blocked = at("c-on", A);
    expect([blocked.outcome, blocked.blocked, blocked.states!.first_stop.record.findings!.length, blocked.states!.final.record.findings!.length]).toEqual(["scored", true, 1, 2]);
    expect(blocked.exposure).toEqual({ evaluated_stops: 2, blocks: 1, items_named: ["adversarial-pass", "review-report"], fail_open: false, false_block: false, would_block: null, read_shape_flags: 0, unknown_namespace_spawns: 0, subagent_other_model: 0 });
    expect(blocked.states!.first_stop.id).not.toBe(blocked.states!.final.id);
    const met = at("c-on", B);
    expect([met.blocked, met.states!.first_stop.id]).toEqual([false, met.states!.final.id]);
    expect([at("c-off", A).blocked, at("c-off", A).exposure?.would_block]).toEqual([false, true]);
    expect(at("c-none", A).exposure).toBeNull();
    expect([at("c-off", B).outcome, at("c-off", B).outcome_code, at("c-off", B).states]).toEqual(["cap_stop", "CAP_STOP", null]);
    expect([at("c-none", B).outcome, at("c-none", B).outcome_code, at("c-none", B).safety_stop]).toEqual(["gap", "SAFETY_STOP", true]);
    expect([at("c-high", B).outcome, at("c-high", B).outcome_code, at("c-high", B).attempts]).toEqual(["gap", "E_CODEX_C_DRIFT", 2]);
    const nojson = at("c-high", A);
    expect([nojson.states!.first_stop.record.no_block, nojson.states!.first_stop.record.findings, nojson.states!.final.record.findings!.length]).toEqual([true, null, 1]);
    expect(nojson.states!.first_stop.record.message).toContain("src/a.ts sets a to 2");
  });

  // Value: protects=a finding's file is made relative to the repository as review-units' findings.jsonl writes it (the session's work path and ./ dropped, a path outside the repository null), and a state whose text is blank scores as finding nothing rather than going to extraction; fails_when=the judge sees the container's work path or an empty message is sent for key-blind extraction; why_new=GEVA-562 part C; seam=sessionRecords; no_claim=paths a model writes in prose
  test("repo-relative files and blank text", () => {
    const s = readout("met", "c-on", A);
    const final = s.states.find((x) => x.state === "final")!;
    const work = "/work/" + unitTaskId(A) + "/";
    final.findings = [work + "src/x.ts", "./src/y.ts", "/etc/hosts", null].map((file, i) => ({ file, line: i + 1, severity: "Critical", claim: "wrong", evidence: "" }));
    expect(sessionRecords(s, A)[0]!.findings!.map((f) => f.file)).toEqual(["src/x.ts", "src/y.ts", null, null]);
    final.text = "   ";
    final.outcome = "missing";
    const [line] = sessionRecords(s, A);
    expect([line!.findings, line!.no_block, line!.message, line!.no_text]).toEqual([[], false, null, false]);
    expect(() => readStates(jsonl([{ ...line!, no_block: true, findings: null, message: "" }]), suite, { passes: 1, units: [A.id] })).toThrow(StatesError);
  });

  // Value: protects=an item the controller stopped at its cap before a session started (the CAP_STOP marker, no session row) still reaches the analysis as cap_stop lines for every planned cell it never ran, so section 5.8's "any cap stop ends the part INCOMPLETE" holds; fails_when=a cap stop with no session row reads as a few missing sessions, which the analysis tolerates; why_new=GEVA-562 part C, PR 400 review; seam=phaseRecords, capStopRecord; no_claim=cap stops review-units reports inside a session
  test("a cap stop before any session started", () => {
    const root = mkdtempSync(join(tmpdir(), "chc-records-"));
    try {
      mkdirSync(join(root, "c-pilot"), { recursive: true });
      writeFileSync(join(root, "c-pilot", "CAP_STOP"), "stopped\n");
      const ids = itemUnits("c-pilot", suite.units.map((u) => u.id));
      const p = phaseRecords(root, "pilot", (i) => (i === "c-pilot" ? suite.units.filter((u) => ids.includes(u.id)).map((u) => ({ id: u.id, repo: u.repo, pr: u.pr, head: u.head })) : []));
      expect(p.items).toEqual([{ item: "c-pilot", sessions: 0, lines: 18, not_run: 18, cap_stopped: true }]);
      expect(p.skipped).toEqual(["h-pilot"]);
      const file = readStates(p.text, suite, { passes: 1, units: ids });
      expect(file.sessions.map((s) => [s.outcome, s.outcome_code, s.states])).toEqual(Array.from({ length: 18 }, () => ["cap_stop", "CAP_STOP", null]));
      expect(file.missing.map((m) => m.arm)).toEqual(Array.from({ length: 6 }, () => "c-high"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Value: protects=pre-run change 1's pilot flags reach the analysis: flagged SKILL.md read shapes are counted and a sub-agent on another model is counted once per sighting; fails_when=a flagged read or an override is dropped on the way to the states file; why_new=GEVA-562 part C; seam=exposureOf; no_claim=which flags the Captain hears, which the readout's summary decides
  test("pilot flags in the exposure", () => {
    expect(exposureOf(readout("codemode", "c-on", A))).toMatchObject({ read_shape_flags: 3, items_named: ["adversarial-pass"] });
    expect(exposureOf(readout("override", "c-on", A))).toMatchObject({ subagent_other_model: 2, unknown_namespace_spawns: 0 });
    expect(exposureOf(readout("falseblock", "c-high", A))).toMatchObject({ false_block: true, unknown_namespace_spawns: 1 });
  });
});
