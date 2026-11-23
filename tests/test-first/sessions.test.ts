// Copyright (c) 2026 Garry Tan. MIT License.
// B2's keyless start captures (lanes/test-first/sessions.ts), committed from b2 sessions run under fixtures/start: each
// Claude Code arm's first request and the prove-it load pass their checks, their digests are the ones the arm manifests
// record, and each check fails on a capture changed the way a broken arm would be. The Codex stub session's capture shows the
// typed mention and prove-it's injected item; codexProblems is checked both ways on request bodies.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_CASES, claudeProblems, CODEX_CASE, codexProblems, startDigest, type StartCapture } from "../../lanes/test-first/sessions.ts";
import { MANIFESTS } from "../../lanes/test-first/arms.ts";
import { LINE, PROVE_IT, SKILL } from "../../lanes/test-first/pins.ts";
import { START_MARK } from "../../lanes/test-first/table.ts";
import { isReasonCode } from "../../src/errors/codes.ts";

const FIX = join(import.meta.dir, "fixtures/start");
const cap = (name: string): StartCapture => JSON.parse(readFileSync(join(FIX, name, "capture.json"), "utf8"));
const sdk = (name: string) => readFileSync(join(FIX, name, "sdk-messages.jsonl"), "utf8");
const manifestStart = (label: string) => JSON.parse(readFileSync(join(MANIFESTS, label + ".json"), "utf8")).start as Record<string, string>;
const caseOf = (name: string) => CLAUDE_CASES.find((c) => c.name === name)!;

describe("Claude Code start captures", () => {
  for (const c of CLAUDE_CASES) {
    test(c.name + " passes its checks and is the capture its manifest records", () => {
      expect(claudeProblems(c, cap(c.name), sdk(c.name))).toEqual([]);
      expect(manifestStart(c.label)[c.name]).toBe(startDigest(cap(c.name) as unknown as Record<string, unknown>));
    });
  }
  test("the line's check fails when the line is missing, and none's when it arrives", () => {
    const line = cap("line-stop");
    expect(claudeProblems(caseOf("line-stop"), { ...line, user: line.user.map((u) => u.replaceAll(LINE, "")), system_has_line: false }, sdk("line-stop"))[0]).toContain("the line is not in");
    const none = cap("none-stop");
    expect(claudeProblems(caseOf("none-stop"), { ...none, user: [...none.user, LINE] }, sdk("none-stop"))[0]).toContain("the line reached the none arm");
  });
  test("a listing beyond Claude Code's own fails none; prove-it listed fails gstack, and missing fails prove-it", () => {
    const none = cap("none-stop");
    expect(claudeProblems(caseOf("none-stop"), { ...none, names: [...none.names, "verify"] }, sdk("none-stop")).length).toBe(1);
    const g = cap("gstack-stop");
    expect(claudeProblems(caseOf("gstack-stop"), { ...g, names: [...g.names, SKILL] }, sdk("gstack-stop"))[0]).toContain("names prove-it");
    const p = cap("prove-it-typed");
    expect(claudeProblems(caseOf("prove-it-typed"), { ...p, names: p.names.filter((n) => n !== SKILL) }, sdk("prove-it-typed"))[0]).toContain("does not name prove-it");
  });
  test("switches that read otherwise, or no hook event, fail the gstack arms", () => {
    const g = cap("gstack-stop");
    expect(claudeProblems(caseOf("gstack-stop"), { ...g, probe: { ...g.probe, telemetry: "community" } }, sdk("gstack-stop"))[0]).toContain("telemetry community");
    expect(claudeProblems(caseOf("gstack-stop"), { ...g, hook_log: "" }, sdk("gstack-stop"))[0]).toContain("logged no event");
  });
  test("an untyped prompt fails the typed case, and a load with no start output fails the load case", () => {
    const p = cap("prove-it-typed");
    expect(claudeProblems(caseOf("prove-it-typed"), { ...p, user: p.user.map((u) => u.replaceAll("<command-name>/", "<x>/")) }, sdk("prove-it-typed"))[0]).toContain("not typed");
    const l = cap("prove-it-load");
    expect(claudeProblems(caseOf("prove-it-load"), { ...l, loaded: l.loaded!.replaceAll(START_MARK, "") }, sdk("prove-it-load"))[0]).toContain("no output of gstack's start step");
  });
});

describe("Codex start capture", () => {
  test("the typed mention reached the model and prove-it's item was injected, as the manifest records", () => {
    const c = JSON.parse(readFileSync(join(FIX, CODEX_CASE.name, "capture.json"), "utf8"));
    expect([c.exit, c.model, c.effort]).toEqual([0, "gpt-6.2-sol", "low"]);
    expect(c.typed).toContain("$" + SKILL + " add()");
    expect(c.injected.length).toBe(1);
    expect(manifestStart(CODEX_CASE.label)[CODEX_CASE.name]).toBe(startDigest(c));
  });
  const body = (items: object[], model = "gpt-6.2-sol", effort = "low") => ({ model, reasoning: { effort }, input: items });
  const typed = { type: "message", role: "user", content: [{ type: "input_text", text: "$" + SKILL + " fix it" }] };
  const skill = { type: "message", role: "user", content: [{ type: "input_text", text: "<skill>" + PROVE_IT.stepLine + "</skill>" }] };
  test("codexProblems passes a typed request with the injected item and fails each way it can break", () => {
    expect(codexProblems([body([typed, skill])])).toEqual([]);
    expect(codexProblems([body([typed])])[0]).toContain("injected nothing");
    expect(codexProblems([body([skill])])[0]).toContain("typed prompt");
    expect(codexProblems([body([typed, skill], "gpt-6.1-sol")])[0]).toContain("model gpt-6.1-sol");
    expect(codexProblems([body([typed, skill], "gpt-6.2-sol", "medium")])[0]).toContain("effort");
    expect(codexProblems([])[0]).toContain("no request");
  });
});

describe("reason codes", () => {
  test("every reason code the B2 lane prints is registered in src/errors/codes.ts", () => {
    const dir = join(import.meta.dir, "../../lanes/test-first");
    const used = new Set(readdirSync(dir).filter((f) => f.endsWith(".ts")).flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/\bE_B2_[A-Z_]+\b/g)].map((m) => m[0])));
    expect(used.has("E_B2_SESSIONS")).toBe(true);
    expect([...used].filter((c) => !isReasonCode(c))).toEqual([]);
  });
});
