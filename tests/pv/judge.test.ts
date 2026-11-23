// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeAnswer, fakeUpstream } from "../../lanes/product-value/dryrun.ts";
import { lastJson, loadPrompt, parseLabels, PROMPT_SHA256, run } from "../../lanes/product-value/judge.ts";
import { oracleList } from "../../lanes/product-value/oracle.ts";
import { buildLabelPackets, type LabelRecord, type PacketFile } from "../../lanes/product-value/packets.ts";
import { SEED } from "../../lanes/product-value/stats.ts";
import { capture, ENV, identity, keyOf, ledgerWith, meta, stage1Rows, tmp, unitsMap } from "./fixtures.ts";

const packet: PacketFile = { id: "p", prompt: "brief", items: [{ id: "i1", statement: "x" }, { id: "i2", statement: "y" }], lists: [{ id: "l1", changes: ["a", "b"] }] };

describe("the frozen prompts (section 7)", () => {
  test("each prompt file matches its pinned sha256", () => {
    for (const name of Object.keys(PROMPT_SHA256) as Array<keyof typeof PROMPT_SHA256>) expect(loadPrompt(name)).toContain("{{PACKET}}");
  });

  test("the brief and the audit prompt hold section 7's anticipation and specific-match rules verbatim and three examples", () => {
    const prereg = readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-08-geva-403-product-value-prereg/README.md"), "utf8");
    const rule = "names the specific need, use, environment or capability the item records, in substance, so that a team acting on it would have served the need.";
    const specific = "A category alone doesn't match a specific item (\"support more platforms\" doesn't match \"ARM64 Linux containers\"); a change that names the item's need without the project's exact remedy does match.";
    expect(prereg).toContain(rule);
    expect(prereg).toContain(specific);
    for (const name of ["brief", "audit"] as const) {
      const p = loadPrompt(name);
      expect(p).toContain(rule);
      expect(p).toContain(specific);
      expect(p.match(/^\d\. (Match|No match)\./gm)).toHaveLength(3);
    }
    expect(loadPrompt("audit")).toContain("quote the exact words of each change you name");
    expect(loadPrompt("pairwise")).toContain("more valuable to its real users");
    expect(loadPrompt("pairwise")).not.toContain("KEY ITEMS");
  });
});

describe("parseLabels", () => {
  test("reads a fenced or bare JSON answer; every cell needs a valid entry", () => {
    const ok = JSON.stringify({ labels: [{ list: "l1", item: "i1", anticipated: true, changes: [2, 2] }, { list: "l1", item: "i2", anticipated: false, changes: [1] }] });
    const p = parseLabels("Here it is:\n```json\n" + ok + "\n```", packet, false);
    expect(p.missing).toEqual([]);
    expect(p.cells.get("l1|i1")!.label).toEqual({ anticipated: true, changes: [2] });
    expect(p.cells.get("l1|i2")!.label).toEqual({ anticipated: false, changes: [] });
    expect(lastJson("no json here")).toBeNull();
  });

  test("an out-of-range change, an anticipated label with no change, an unknown id or a conflicting duplicate leaves the cell missing", () => {
    const bad = (e: unknown[]) => parseLabels(JSON.stringify({ labels: e }), packet, false).missing;
    expect(bad([{ list: "l1", item: "i1", anticipated: true, changes: [3] }, { list: "l1", item: "i2", anticipated: false, changes: [] }])).toEqual(["l1|i1"]);
    expect(bad([{ list: "l1", item: "i1", anticipated: true, changes: [] }, { list: "l1", item: "i2", anticipated: false }])).toEqual(["l1|i1"]);
    expect(bad([{ list: "lX", item: "i1", anticipated: false }, { list: "l1", item: "i2", anticipated: false }])).toEqual(["l1|i1"]);
    expect(bad([{ list: "l1", item: "i1", anticipated: false }, { list: "l1", item: "i1", anticipated: true, changes: [1] }, { list: "l1", item: "i2", anticipated: false }])).toEqual(["l1|i1"]);
    expect(parseLabels(null, packet, false).missing).toHaveLength(2);
  });
});

describe("pv judge through the metered client (fake upstream, temporary ledger)", () => {
  const TYPES = ["mobile", "mobile", "server", "server"] as const;
  const specs = TYPES.map((t, i) => ({ meta: meta("u" + i, { type: t }), key: keyOf("u" + i, ["a" + i]) }));
  const units = unitsMap(specs);
  const oracle = { version: 1 as const, units: Object.fromEntries(specs.map((s) => [s.meta.id, oracleList(s.key)])) };
  const rows = stage1Rows(TYPES.map((_, i) => "u" + i), (u) => "tag-a" + u.slice(1));

  test("labels every cell with the production judges, records model and version, and caches calls", async () => {
    const dir = tmp();
    const built = buildLabelPackets({ family: "plan", stage: 1, seed: SEED, units, rows, normalize: identity, oracle });
    for (const p of built.packets) await Bun.write(join(dir, "packets", p.id + ".json"), JSON.stringify(p));
    await Bun.write(join(dir, "map.json"), JSON.stringify(built.map));
    const { record, ledger } = ledgerWith(dir, ["pv-s1-plan-labels"]);
    let calls = 0;
    const seen = new Set<string>();
    const upstream = fakeUpstream((judge, prompt) => {
      calls++;
      seen.add(judge);
      if (judge === "opus" && prompt.includes("tag-a1")) return fakeAnswer(prompt, { flip: true });
      return fakeAnswer(prompt);
    });
    const args = ["--packets", join(dir, "packets"), "--map", join(dir, "map.json"), "--item", "pv-s1-plan-labels", "--run-id", "r1", "--out", join(dir, "out"), "--cache", join(dir, "cache"), "--record", record, "--ledger", ledger];
    const c = capture();
    expect(await run(args, c.io, { fetch: upstream, env: ENV })).toBe(0);
    const labels = readFileSync(join(dir, "out", "labels.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as LabelRecord);
    expect(labels.every((l) => l.version !== null && l.model_id.length > 0)).toBe(true);
    expect(labels.some((l) => l.judge === "astra" && l.version === "gpt-6-astra-2026-09-01")).toBe(true);
    expect(labels.some((l) => l.judge === "panel")).toBe(true);
    expect(seen.has("gemini")).toBe(true);
    const panelYes = labels.filter((l) => l.judge === "panel" && l.label?.anticipated);
    expect(panelYes.length).toBeGreaterThan(0);
    expect(c.err.filter((l) => l.startsWith("E_PV_LABEL_MISSING"))).toHaveLength(0);
    const first = calls;
    const c2 = capture();
    expect(await run(args.map((a) => (a === "r1" ? "r2" : a)).map((a) => (a === "pv-s1-plan-labels" ? "pv-s1-plan-labels" : a)), c2.io, { fetch: upstream, env: ENV }).catch((e) => e.code)).toBe("E_ITEM_BOUND");
    expect(await run(args, c2.io, { fetch: upstream, env: ENV })).toBe(0);
    expect(calls).toBe(first);
  });

  test("a packet still unparsable after its one resend leaves its cells unlabelled (E_PV_LABEL_MISSING)", async () => {
    const dir = tmp();
    const built = buildLabelPackets({ family: "plan", stage: 1, seed: SEED, units, rows: rows.filter((r) => r.model === "opus"), normalize: identity, oracle });
    for (const p of built.packets) await Bun.write(join(dir, "packets", p.id + ".json"), JSON.stringify(p));
    await Bun.write(join(dir, "map.json"), JSON.stringify(built.map));
    const { record, ledger } = ledgerWith(dir, ["pv-s1-plan-labels"]);
    let calls = 0;
    const c = capture();
    expect(await run(["--packets", join(dir, "packets"), "--map", join(dir, "map.json"), "--item", "pv-s1-plan-labels", "--run-id", "r1", "--out", join(dir, "out"), "--cache", join(dir, "cache"), "--record", record, "--ledger", ledger], c.io, { fetch: fakeUpstream(() => (calls++, "I can't answer")), env: ENV })).toBe(0);
    expect(calls).toBe(2 * built.packets.length);
    expect(c.err.some((l) => l.startsWith("E_PV_LABEL_MISSING "))).toBe(true);
  });
});
