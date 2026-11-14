// Value: protects=the score area's paid-stage commands: packets, check packets, the metered judge with its strict Vertex check and unlabelled count, and the scorer's outputs, all keyless.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { entryId } from "../../../lanes/office-hours-founder/run/manifest.ts";
import { commands, judgeWith } from "../../../lanes/office-hours-founder/score/cli.ts";
import { row, stubCaller, unit, type StubCells } from "../../../lanes/office-hours-founder/score/fixtures.ts";
import type { PacketMap } from "../../../lanes/office-hours-founder/score/packets.ts";
import type { SessionRow } from "../../../lanes/office-hours-founder/types.ts";

const ROOT = mkdtempSync(join(tmpdir(), "of-score-cli-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const ENV = { ANTHROPIC_API_KEY: "stub-not-a-key", OPENAI_API_KEY: "stub-not-a-key", OPENROUTER_API_KEY: "stub-not-a-key" };
let n = 0;
const dir = (name: string) => join(ROOT, name + "-" + ++n);

function io() {
  const o = { out: [] as string[], err: [] as string[] };
  return { o, io: { out: (t: string) => o.out.push(t), err: (t: string) => o.err.push(t) } };
}

function writeUnits(units: ReturnType<typeof unit>[], names: Record<string, string> = {}): string {
  const d = dir("units");
  for (const u of units) {
    mkdirSync(join(d, u.meta.id), { recursive: true });
    writeFileSync(join(d, u.meta.id, "unit.json"), JSON.stringify(u.meta));
    writeFileSync(join(d, u.meta.id, "key.json"), JSON.stringify(u.key));
    writeFileSync(join(d, u.meta.id, "sheet.json"), JSON.stringify(u.sheet));
    if (names[u.meta.id]) writeFileSync(join(d, u.meta.id, "names.txt"), names[u.meta.id]!);
  }
  return d;
}

function writeLaunch(rows: SessionRow[]): string {
  const d = dir("launch");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "rows.ndjson"), rows.map((r) => JSON.stringify({ id: entryId(r), cell: r.stage === 1 ? "stage1" : "stage2", row: { ...r, questions: null, pushes: null, named_source: null }, why: "test", transcript: null, state_root: null, attempts: [{ attempt: 1, outcome: "block", why: "test", usd: 0, sim_usd: 0, contained: [] }] })).join("\n") + "\n");
  return d;
}

/** A stub model server in each judge provider's shape; served names Gemini's provider. */
function upstream(o: { served?: string; edit?: (judge: string, attempt: number, block: string, c: StubCells) => StubCells } = {}): typeof fetch {
  const counts = new Map<string, number>();
  const judge = stubCaller((j, _a, b, c) => (o.edit ? o.edit(j, counts.get(j) ?? 1, b, c) : c));
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = String((body.input ?? body.messages)?.[0]?.content ?? "");
    const who = u.includes("anthropic") ? "opus" : u.includes("openrouter") ? "gemini" : "astra";
    counts.set(who, prompt.includes("sent a second time") ? 2 : 1);
    const text = (await judge({ judge: who, prompt, effort: "medium", maxTokens: 0, label: "x:" + (counts.get(who) ?? 1) })).text ?? "";
    if (who === "opus") return Response.json({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5-stub", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    if (who === "gemini") return Response.json({ id: "gen-1", model: "google/gemini-4-argon-stub", provider: o.served ?? "Google", choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } });
    return Response.json({ id: "resp_1", object: "response", model: "gpt-6-astra-stub", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1200 } });
  }) as typeof fetch;
}

function ledger(item: string) {
  const d = dir("ledger");
  const record = join(d, "record");
  recordApproval(record, { action: "init", item, cap_micros: 50_000_000, quotes: [{ words: "keyless test ledger, not an approval", by: "test", source: "tests/of/score/cli.test.ts" }], admission: "warn" });
  return { record, ledger: join(d, "ledger.sqlite") };
}

const UNITS = [unit("u1"), unit("u2", { key: { customer: "Teachers at rural primary schools", wedge: "A printed weekly lesson pack" } })];
const S1 = ["u1", "u2"].flatMap((u) => [row({ unit: u }), row({ unit: u, model: "particle" }), row({ unit: u, kind: "reference" })]);

async function build(cmd: "packets" | "check-packets", rows: SessionRow[] = S1, extra: string[] = []) {
  const units = writeUnits(UNITS);
  const out = dir("packets"), map = dir("map") + ".json";
  const x = io();
  const code = await commands[cmd]!.run([...(cmd === "packets" ? ["--stage", "1"] : []), "--launch", writeLaunch(rows), "--units", units, "--out", out, "--map", map, ...extra], x.io, {});
  return { code, out, map, units, o: x.o };
}

describe("packets and check-packets", () => {
  test("packets writes the packets and the map outside them, and prints counts and a digest only", async () => {
    const b = await build("packets");
    expect(b.code).toBe(0);
    const map = JSON.parse(readFileSync(b.map, "utf8")) as PacketMap;
    expect(map.kind).toBe("label");
    expect(b.o.out[0]).toMatch(/^of packets: stage 1, 6 sessions: \d+ packets \(.*label 4.*\), \d+ blocks; map sha256 [0-9a-f]{64}$/);
    expect(b.o.out.join("\n")).not.toContain("bicycle");
  });
  test("check-packets writes the audit packets with the anchors", async () => {
    const b = await build("check-packets");
    const map = JSON.parse(readFileSync(b.map, "utf8")) as PacketMap;
    expect(map.kind).toBe("check");
    expect(Object.values(map.packets).some((p) => Object.values(p.blocks).some((r) => r.kind === "oracle"))).toBe(true);
    expect(Object.values(map.packets).every((p) => p.prompt === "audit")).toBe(true);
  });
  test("refusals: a path inside the repo, an existing out, a stage mismatch, stage 2 without gold, a real unit without names", async () => {
    await expect(commands.packets!.run(["--stage", "1", "--launch", writeLaunch(S1), "--units", writeUnits(UNITS), "--out", join(process.cwd(), "tmp-packets"), "--map", dir("m")], io().io, {})).rejects.toThrow(/^E_USAGE --out .* is inside the repo/);
    const b = await build("packets");
    await expect(commands.packets!.run(["--stage", "1", "--launch", writeLaunch(S1), "--units", b.units, "--out", b.out, "--map", dir("m")], io().io, {})).rejects.toThrow("exists");
    await expect(commands.packets!.run(["--stage", "2", "--launch", writeLaunch(S1), "--units", b.units, "--out", dir("p"), "--map", dir("m")], io().io, {})).rejects.toThrow("is a stage 1 session");
    await expect(commands.packets!.run(["--stage", "2", "--launch", writeLaunch([row({ stage: 2, unit: "u1" })]), "--units", b.units, "--out", dir("p"), "--map", dir("m")], io().io, {})).rejects.toThrow("needs --check-map");
    const real = writeUnits([unit("r1", { stratum: "real", set: "real" })]);
    await expect(commands.packets!.run(["--stage", "2", "--launch", writeLaunch([row({ stage: 2, unit: "r1" })]), "--units", real, "--out", dir("p"), "--map", dir("m")], io().io, {})).rejects.toThrow("has no names.txt");
  });
});

async function judgeRun(b: { out: string; map: string }, o: { effort?: string; upstream?: typeof fetch; item?: string; l?: ReturnType<typeof ledger> } = {}) {
  const item = o.item ?? "of-judge-test-" + n;
  const l = o.l ?? ledger(item);
  const labels = join(dir("labels"), "labels.ndjson");
  const x = io();
  const run = judgeWith(o.upstream ?? upstream());
  const code = await run(["--packets", b.out, "--map", b.map, "--item", item, "--spend-cap", "5", "--out", labels, "--effort", o.effort ?? "medium", "--cache", dir("cache"), "--record", l.record, "--ledger", l.ledger, "--concurrency", "2"], x.io, ENV);
  return { code, labels, o: x.o, item, record: l.record };
}

test("stage 2 packets take the judge check's map, packets and labels for their gold", async () => {
  const c = await build("check-packets");
  const j = await judgeRun(c, { effort: "max" });
  const units = writeUnits([...UNITS, unit("z1", { set: "comparison" })]);
  const out = dir("packets"), map = dir("map") + ".json";
  const x = io();
  expect(await commands.packets!.run(["--stage", "2", "--launch", writeLaunch([row({ stage: 2, unit: "z1" })]), "--units", units, "--out", out, "--map", map, "--check-map", c.map, "--check-packets", c.out, "--check-labels", j.labels], x.io, {})).toBe(0);
  const roles = Object.values((JSON.parse(readFileSync(map, "utf8")) as PacketMap).packets).map((p) => p.role);
  expect(roles.filter((r) => r === "gold").length).toBeGreaterThan(0);
  expect(roles.filter((r) => r === "label")).toHaveLength(1);
});

describe("judge", () => {
  test("labels every packet through one settled lease, with versions, and no unlabelled line when every cell came back", async () => {
    const b = await build("packets");
    const j = await judgeRun(b);
    expect(j.code).toBe(0);
    const labels = readFileSync(j.labels, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(labels.some((l) => l.judge === "panel")).toBe(true);
    expect(labels.find((l) => l.judge === "astra")).toMatchObject({ model_version: "gpt-6-astra-stub", model_id: "openai:gpt-6-astra", effort: "medium" });
    expect(j.o.err.filter((e) => e.startsWith("E_OF_LABEL_MISSING"))).toEqual([]);
    const it = readItem(j.record, j.item);
    expect(it.open).toBeNull();
    expect(it.leases).toHaveLength(1);
    expect(j.o.out.at(-1)).toMatch(/labels sha256 [0-9a-f]{64}$/);
  });
  test("max effort only on check packets, medium only on the rest", async () => {
    await expect(judgeRun(await build("packets"), { effort: "max" })).rejects.toThrow("E_USAGE --effort max doesn't fit a label map");
    await expect(judgeRun(await build("check-packets"), { effort: "medium" })).rejects.toThrow("E_USAGE --effort medium doesn't fit a check map");
    const c = await judgeRun(await build("check-packets"), { effort: "max" });
    expect(readFileSync(c.labels, "utf8")).toContain('"effort":"max"');
  });
  test("cells still missing after the resend print one E_OF_LABEL_MISSING line with their count", async () => {
    const j = await judgeRun(await build("packets", [row({ unit: "u1" })]), { upstream: upstream({ edit: (_j, _a, _b, c) => ({ ...c, next: undefined }) }) });
    expect(j.code).toBe(0);
    expect(j.o.err.filter((e) => e.startsWith("E_OF_LABEL_MISSING"))).toEqual([expect.stringMatching(/^E_OF_LABEL_MISSING \d+ cells stayed unlabelled/)]);
  });
  test("a Gemini tie vote served by Google AI Studio stops the command with E_OF_PROVIDER_DRIFT and settles the lease", async () => {
    const b = await build("packets", [row({ unit: "u1", model: "particle" })]);
    const item = "of-judge-drift";
    const l = ledger(item);
    const split = upstream({ served: "Google AI Studio", edit: (j, _a, _b, c) => (j === "opus" ? { ...c, next: !c.next } : c) });
    await expect(judgeRun(b, { upstream: split, item, l })).rejects.toThrow(/^E_OF_PROVIDER_DRIFT google\/gemini-4-argon was served by Google AI Studio, not Google Vertex/);
    const it = readItem(l.record, item);
    expect(it.open).toBeNull();
    expect(it.leases[0]!.close).not.toBeNull();
    const agree = await judgeRun(b, { upstream: upstream({ served: "Google AI Studio" }) });
    expect(agree.code).toBe(0);
  });
});

test("score writes scored.ndjson and stock.ndjson and prints W counts per model and arm", async () => {
  const b = await build("packets");
  const j = await judgeRun(b);
  const out = join(dir("scored"), "scored.ndjson");
  const x = io();
  const units = writeUnits(UNITS);
  expect(await commands.score!.run(["--launch", writeLaunch(S1), "--units", units, "--map", b.map, "--labels", j.labels, "--out", out], x.io, {})).toBe(0);
  const scored = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(scored).toHaveLength(6);
  expect(existsSync(join(out, "..", "stock.ndjson"))).toBe(true);
  expect(x.o.out).toContain("stage 1 arm constructed opus none: W=1 1, W=0 1, unscored 0");
  expect(x.o.out.at(-1)).toMatch(/^of score: 6 sessions, 12 stock readings; scored sha256 [0-9a-f]{64}$/);
});
