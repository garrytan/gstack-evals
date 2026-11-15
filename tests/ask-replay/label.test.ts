import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import { s1Match } from "../../lanes/ask-replay/chains.ts";
import { plainStore } from "../../lanes/ask-replay/custody.ts";
import { labelRecord, labelSend } from "../../lanes/ask-replay/fixtures.ts";
import { FROZEN } from "../../lanes/ask-replay/frozen.ts";
import { CODEBOOK, checkCodebook, labelId, labelJob, labelPrompt, labelReadout, labelSamples, labelSchema, toLabel } from "../../lanes/ask-replay/label.ts";
import { ledgerRows } from "../../lanes/ask-replay/ledger.ts";
import { finalRecords, ledgerClient, runShard } from "../../lanes/ask-replay/run.ts";
import { generate } from "../../lanes/ask-replay/synthetic/generator.ts";
import type { AskItem, Label, LabelReply, ModelKey, SampleRecord } from "../../lanes/ask-replay/types.ts";

const items = generate().items;
const byId = new Map(items.map((i) => [i.item, i]));
const positionOf = (it: AskItem) => {
  const m = s1Match(it);
  return m ? ledgerRows(it).findIndex((r) => r.order === m.order) + 1 : null;
};
const answeredRows = (it: AskItem) => ledgerRows(it).flatMap((r, i) => (r.status === "answered" ? [i + 1] : []));
const reply = (it: AskItem, cls: Label = it.label, answers: "yes" | "no" | "unclear" = "yes"): LabelReply => ({ class: cls, repeats_of: it.label === "DUPLICATE" ? positionOf(it) : null, answer_judgement: answeredRows(it).map((row) => ({ row, answers })), reason: "r" });
const recs = (kind: "audit" | "contingency" | "link", model: ModelKey, its: readonly AskItem[], f: (it: AskItem) => LabelReply | null = (it) => reply(it)): SampleRecord[] => its.map((it) => labelRecord(labelId(it.item, kind, model), it.item, model, f(it)));

describe("the codebook and the labeller prompt (section 7)", () => {
  test("codebook.md matches frozen.json's sha256, and a changed codebook stops with E_ASK_PIN", () => {
    expect(() => checkCodebook()).not.toThrow();
    expect(() => checkCodebook(CODEBOOK + " ")).toThrow(/E_ASK_PIN/);
    for (const c of ["DECISION", "DUPLICATE", "PERMISSION_FOR_DEFAULT", "OBSERVABLE", "first lettered decision", "needless"]) expect(CODEBOOK).toContain(c);
  });
  test("the prompt holds the codebook, the numbered earlier asks with their quoted answers, the ask and the owner's next message", () => {
    const it = items.find((i) => i.after_reply && ledgerRows(i).some((r) => r.status === "answered"))!;
    const p = labelPrompt(it);
    expect(p.system).toContain(CODEBOOK);
    expect(p.user).toContain("[1] asked ");
    expect(p.user).toContain("marked answered by the owner's message at ");
    expect(p.user).toContain(it.draft);
    expect(p.user).toContain(it.after_reply!.text);
  });
  test("the labeller is blind to the audit label, the item id and the thread code", () => {
    for (const it of items.slice(0, 20)) {
      const p = labelPrompt(it);
      const twin = labelPrompt({ ...it, item: "i-" + "0".repeat(24), label: it.label === "DECISION" ? "DUPLICATE" : "DECISION", thread: "S9" });
      expect(twin).toEqual(p);
      expect(p.system + p.user).not.toContain(it.item);
    }
  });
  test("the request carries the label schema, every field required, with both Anthropic cache breakpoints", () => {
    const s = labelSamples(items.slice(0, 1), "audit", "opus")[0]!;
    const b = labelJob.body(items[0]!, s, 4000) as any;
    expect(b.output_config.format.schema).toEqual(labelSchema());
    expect(b.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
    const a = labelJob.body(items[0]!, { ...s, model: "astra" }, 4000) as any;
    expect(a).toMatchObject({ model: "gpt-6-astra", store: false, reasoning: { effort: "medium" } });
    expect((labelSchema() as any).required).toEqual(["class", "repeats_of", "answer_judgement", "reason"]);
  });
  test("reading a label: case-insensitive class, positions from 1, bad entries dropped, unknown class refused", () => {
    expect(toLabel({ class: "duplicate", repeats_of: "3", answer_judgement: [{ row: 2, answers: "Yes" }, { row: 0, answers: "yes" }, { row: 1, answers: "maybe" }], reason: "x" })).toEqual({ class: "DUPLICATE", repeats_of: 3, answer_judgement: [{ row: 2, answers: "yes" }], reason: "x" });
    expect(toLabel({ class: "DECISION", repeats_of: 0 })!.repeats_of).toBeNull();
    expect(toLabel({ class: "NEEDLESS" })).toBeNull();
    expect(labelJob.parse('thinking... {"class": "OBSERVABLE", "repeats_of": null, "answer_judgement": [], "reason": "r"}')!.class).toBe("OBSERVABLE");
  });
  test("samples: every item for the audit, duplicates only for linking, and linking runs on Opus alone", () => {
    expect(labelSamples(items, "audit", "astra")).toHaveLength(60);
    const link = labelSamples(items, "link", "opus");
    expect(link).toHaveLength(20);
    expect(link.every((s) => byId.get(s.item)!.label === "DUPLICATE" && s.id === labelId(s.item, "link", "opus"))).toBe(true);
    expect(() => labelSamples(items, "link", "astra")).toThrow(/E_USAGE/);
    expect(() => labelSamples(items, "audit", "sol")).toThrow(/E_USAGE/);
  });
});

describe("labeller calls on the driver", () => {
  test("a stub labeller through the spend ledger: labels sealed, an unparsable reply retried once then MISSING", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-label-"));
    try {
      const record = join(dir, "record");
      recordApproval(record, { action: "init", item: "ask-test", cap_micros: 50_000_000, quotes: [{ words: "test ledger, not an approval", by: "tests", source: "tests" }], admission: "warn" });
      const local = openLocalLedger(ledgerPath(join(dir, "ledger.sqlite"), {}));
      const leaseId = openLease(record, local, { item: "ask-test", run_id: "ask-test" }).lease_id;
      const bodies: Array<Record<string, unknown>> = [];
      const bad = items[3]!.item;
      const send = labelSend((s) => (s.item === bad ? "unparsable" : reply(byId.get(s.item)!)), [], bodies);
      const store = plainStore(join(dir, "labels"));
      const samples = labelSamples(items.slice(0, 6), "audit", "astra");
      const r = await runShard({ items: byId, samples, gstack: null, client: ledgerClient({ local, leaseId, runId: "ask-test", maxOutputTokens: 4000, send }), store, out: join(dir, "out"), maxOutputTokens: 4000, sleep: async () => {}, job: labelJob });
      settleLease(record, local, leaseId);
      local.close();
      expect(r).toMatchObject({ ran: 6, missing: { parse: 1 } });
      const got = store.read();
      expect(got.get(labelId(items[0]!.item, "audit", "astra"))!.label).toEqual(reply(items[0]!));
      expect(got.get(labelId(bad, "audit", "astra"))).toMatchObject({ missing: "parse", attempts: 2 });
      expect(bodies.every((b) => (b as any).model === "gpt-6-astra")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the label readout", () => {
  const dups = items.filter((i) => i.label === "DUPLICATE");
  test("labellers that agree with the audit: the audit labels stand, chains from the Opus links, answer judgements by row id", () => {
    const records = [...recs("audit", "opus", items), ...recs("audit", "astra", items), ...recs("link", "opus", dups)];
    const r = labelReadout(items, records);
    expect(r.summary.kappa!.stands).toBe(true);
    expect(r.primary).toHaveLength(60);
    expect(r.views.map((v) => [v.name, v.items.length])).toEqual([["the labellers' agreement on the audited items", 60]]);
    expect(r.links!.length).toBe(dups.filter((d) => positionOf(d)).length);
    for (const l of r.links!) expect(l.to).toBe(s1Match(byId.get(l.item)!)!.order);
    expect(r.summary.links.astra_agreement).toBe(1);
    const rows = items.reduce((s, it) => s + answeredRows(it).length, 0);
    expect(r.summary.answer_judgement).toMatchObject({ answered_rows: rows, both_yes: rows, judged_answer_share: 1, labeller_agreement: 1 });
    expect([...r.answer_judged.keys()].every((k) => k.startsWith("q-"))).toBe(true);
  });
  test("kappa below 0.6 with the contingency run: the labellers' agreement becomes the primary, and each labeller's labels sit beside it", () => {
    const flip = (it: AskItem) => reply(it, it.label === "DECISION" ? "DUPLICATE" : "DECISION", "no");
    const records = [...recs("audit", "opus", items, flip), ...recs("audit", "astra", items, flip), ...recs("contingency", "opus", []), ...recs("contingency", "astra", [])];
    const failed = labelReadout(items, records);
    expect(failed.summary.kappa!.stands).toBe(false);
    expect(failed.summary.contingency_needed).toBe(true);
    const half = items.slice(0, 30);
    const rest = items.slice(30);
    const withC = labelReadout(items, [...recs("audit", "opus", half, flip), ...recs("audit", "astra", half, (it) => (it === half[0] ? reply(it) : flip(it))), ...recs("contingency", "opus", rest, flip), ...recs("contingency", "astra", rest, flip)]);
    expect(withC.summary.primary_labels).toBe("the labellers' agreement");
    expect(withC.primary).toHaveLength(59);
    expect(withC.primary.every((it) => it.label !== byId.get(it.item)!.label)).toBe(true);
    expect(withC.views.map((v) => v.name)).toEqual(["the audit's labels", "Opus labels", "Astra labels"]);
    expect(withC.summary.answer_judgement.both_no).toBeGreaterThan(0);
  });
  test("a missing label or a position past the list counts as no label and no link", () => {
    const d = dups[0]!;
    const r = labelReadout(items, [labelRecord(labelId(d.item, "link", "opus"), d.item, "opus", { ...reply(d), repeats_of: 999 }), labelRecord(labelId(dups[1]!.item, "link", "opus"), dups[1]!.item, "opus", null)]);
    expect(r.links).toEqual([]);
    expect(r.summary.missing_labels).toBe(1);
    expect(r.summary.kappa).toBeNull();
  });
});
