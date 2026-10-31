import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { snapshot } from "../../lanes/review-noloss/ingest.ts";
import { judgeRunCmd } from "../../lanes/review-noloss/judge-run.ts";
import { ScoreError } from "../../lanes/review-noloss/score.ts";
import { loadSuite, REPO_ROOT, setSealedRoot, sha256, unitId } from "../../lanes/review-noloss/suite.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { cleanup, editArm, run, tmp, writeArm } from "./helpers.ts";
import { planPanel, writePlanArm } from "./plan-panel.ts";

afterAll(cleanup);
const KEYS = { ANTHROPIC_API_KEY: "fake-anthropic-value-for-judge-run-tests", OPENAI_API_KEY: "fake-openai-value-for-judge-run-tests", OPENROUTER_API_KEY: "fake-openrouter-value-for-judge-run-tests" };
const QUOTE = { words: "Approve the keyless test cap", by: "test", source: "tests/noloss/judge-run.test.ts" };
const BRIEF = join(REPO_ROOT, "wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/judge-brief.md");
const OPUS = "anthropic/claude-opus-5-5";
const SOL = "openai/gpt-6.1-sol";
const SONNET = "anthropic/claude-sonnet-5-5";
const example = snapshot(join(REPO_ROOT, "lanes/review-noloss/example/arm-example"));

interface Key {
  batch: string;
  packets: Array<{ file: string; unit: string; sha256: string }>;
  entries: Array<{ packet: string; opaque: string; arm: string; pass: number; finding: string }>;
}
type Sent = { model: string; file: string; body: any };
type Answer = (model: string, file: string, packet: any, attempt: number) => string;

/** A fake provider behind the proxy: answer() gives the text, sent in each route's response shape. */
const upstream = (sent: Sent[], answer: Answer) => async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const prompt: string = (body.input ?? body.messages)[0].content;
  const file = /=== Packet: (\S+) ===/.exec(prompt)![1]!;
  const packet = JSON.parse(prompt.split("=== Packet: " + file + " ===\n")[1]!.split("\n=== ")[0]!);
  sent.push({ model: body.model, file, body });
  const text = answer(body.model, file, packet, sent.filter((s) => s.model === body.model && s.file === file).length);
  return body.input
    ? Response.json({ id: "r", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 0 } } })
    : Response.json({ id: "m", type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } });
};
const judgeRun = async (argv: string[], fetch?: (url: string, init: RequestInit) => Promise<Response>) => {
  const out: string[] = [];
  const err: string[] = [];
  try {
    const code = await judgeRunCmd(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, { env: KEYS, fetch });
    return { code, out: out.join("\n"), err: err.join("\n") };
  } catch (e) {
    if (e instanceof ScoreError) return { code: 2, out: out.join("\n"), err: e.code + " " + e.message };
    throw e;
  }
};
const nextCommand = (out: string) => out.split("\n").find((l) => l.startsWith("next: "))!.slice("next: gstack-evals noloss ".length).split(" ");
const tsvRows = (path: string) => readFileSync(path, "utf8").replace(/\n+$/, "").split("\n").slice(1).map((l) => l.split("\t"));
/** An honest matching judge: a finding matches the blocker its synthetic id names; flip lists blockers it answers with no match. */
const matching = (key: Key, flip: string[] = []) => (file: string, packet: any) =>
  JSON.stringify({
    batch: key.batch,
    judge: "a model naming itself",
    packets: [{ file, blockers: packet.blockers.map((b: any) => ({ id: b.id, matches: flip.includes(file + " " + b.id) ? [] : key.entries.filter((e) => e.packet === file && e.finding === "ex-" + packet.unit.pr + "-" + b.id.toLowerCase()).map((e) => e.opaque) })), impact: Object.fromEntries(packet.findings.map((f: any, i: number) => [f.id, i % 2 ? "non-blocking" : "blocking"])) }],
  });

describe("judge-run on a matching batch", () => {
  const dir = tmp("noloss-judge-run-");
  const root = join(dir, "arms");
  const packets = join(dir, "packets");
  const keyPath = join(dir, "key.json");
  const record = join(dir, "record");
  const armDir = (id: string) => join(root, "gsta167-14pr", id);
  const args = (out: string, extra: string[] = []) => ["--suite", "gsta167-14pr", "--packets", packets, "--key", keyPath, "--arm", armDir("alpha"), "--arm", armDir("beta"), "--brief", BRIEF, "--primary", OPUS, "--second", SOL, "--third", SONNET, "--item", "judge", "--out", out, "--ledger", join(dir, "ledger.sqlite"), "--record", record, "--concurrency", "3", ...extra];
  let key: Key;

  test("the three judges run, the replies hold no impact, and judge-join and ingest take the files as written", async () => {
    for (const [id, label, drop] of [["alpha", "Alpha arm (synthetic)", []], ["beta", "Beta arm (synthetic)", ["3593"]]] as const) {
      const f = editArm(example, (a) => ((a.id = id), (a.label = label)));
      f.delete("judgments.tsv");
      for (const pr of drop) f.set("findings/" + pr + ".jsonl", Buffer.from(""));
      expect((await run(["ingest", writeArm(join(dir, "src", id), f), "--suite", "gsta167-14pr", "--root", root])).code).toBe(0);
    }
    expect((await run(["judge-packet", "--suite", "gsta167-14pr", "--arm", armDir("alpha"), "--arm", armDir("beta"), "--seed", "20261031", "--out", packets, "--key", keyPath])).code).toBe(0);
    key = JSON.parse(readFileSync(keyPath, "utf8"));
    recordApproval(record, { action: "init", item: "judge", cap_micros: 100_000_000, quotes: [QUOTE], admission: "warn" });
    const sent: Sent[] = [];
    const out = join(dir, "run1");
    const honest = matching(key);
    const r = await judgeRun(args(out), upstream(sent, (model, file, packet) => (model === "gpt-6.1-sol" ? matching(key, ["packets/3593.json B1"])(file, packet) : "Here is my reply.\n```json\n" + honest(file, packet) + "\n```")));
    expect([r.code, r.err]).toEqual([0, expect.any(String)]);
    expect(sent.filter((s) => s.model === "claude-opus-5-5").length).toBe(14);
    expect(sent.some((s) => s.model === "gpt-6.1-sol" && s.file === "packets/3593.json")).toBe(true);
    expect(sent.filter((s) => s.model === "claude-sonnet-5-5").map((s) => s.file)).toEqual(["packets/3593.json"]);
    const sol = sent.find((s) => s.model === "gpt-6.1-sol")!.body;
    expect([sol.reasoning, sol.max_output_tokens, sol.tools, sol.instructions]).toEqual([{ effort: "medium" }, 16000, undefined, undefined]);
    const opus = sent.find((s) => s.model === "claude-opus-5-5")!.body;
    expect([opus.max_tokens, opus.system, opus.tools, opus.messages.length]).toEqual([16000, undefined, undefined, 1]);
    expect(opus.messages[0].content.startsWith("=== Judge brief ===\n" + readFileSync(BRIEF, "utf8"))).toBe(true);
    const primary = readFileSync(join(out, "primary.json"), "utf8");
    expect(primary).not.toContain("impact");
    expect(JSON.parse(primary)).toMatchObject({ batch: key.batch, judge: OPUS });
    expect(JSON.parse(primary).packets.length).toBe(14);
    expect(JSON.parse(readFileSync(join(out, "third.json"), "utf8")).packets).toEqual([{ file: "packets/3593.json", sha256: key.packets.find((p) => p.file === "packets/3593.json")!.sha256, blockers: [{ id: "B1", matches: expect.any(Array) }] }]);
    const impact = tsvRows(join(out, "impact.tsv"));
    expect(impact.filter((row) => row[2] === OPUS).length).toBe(key.entries.length);
    expect(new Set(impact.map((row) => row[3]))).toEqual(new Set(["blocking", "non-blocking"]));
    expect(new Set(impact.map((row) => row[4]))).toEqual(new Set([key.batch]));
    const runFile = JSON.parse(readFileSync(join(out, "run.json"), "utf8"));
    expect(runFile).toMatchObject({ state: "finished", batch: key.batch, brief: { sha256: sha256(readFileSync(BRIEF)) }, models: { primary: OPUS, second: SOL, third: SONNET }, item: "judge", unjudged: 0 });
    for (const f of ["primary.json", "second.json", "third.json", "impact.tsv"]) expect(runFile.files[f]).toBe(sha256(readFileSync(join(out, f))));
    expect(readItem(record, "judge").leases.map((l) => l.close?.how)).toEqual(["settled"]);
    const joined = await run(nextCommand(r.out));
    expect([joined.code, joined.err]).toEqual([0, ""]);
    expect(readFileSync(join(out, "joined", "alpha", "judgments.tsv"), "utf8")).toContain(SONNET + " (third read)");
    for (const id of ["alpha", "beta"]) expect((await run(["ingest", join(out, "joined", id), "--suite", "gsta167-14pr", "--root", join(dir, "judged")])).code).toBe(0);
  });

  test("an answer whose entries are not objects is a refusal, not a crash", async () => {
    const sent: Sent[] = [];
    const out = join(dir, "run-null");
    const honest = matching(key);
    recordApproval(record, { action: "init", item: "judge-null", cap_micros: 100_000_000, quotes: [QUOTE], admission: "warn" });
    const r = await judgeRun(args(out).map((a) => (a === "judge" ? "judge-null" : a)), upstream(sent, (model, file, packet) => (model === "claude-opus-5-5" && file === "packets/3593.json" ? JSON.stringify({ packets: [{ file, blockers: [null] }] }) : honest(file, packet))));
    expect(r.code).toBe(0);
    expect(sent.filter((s) => s.model === "claude-opus-5-5" && s.file === "packets/3593.json").length).toBe(2);
    expect(JSON.parse(readFileSync(join(out, "unjudged.json"), "utf8")).entries.map((e: { packet: string }) => e.packet)).toEqual(["packets/3593.json"]);
    expect(readItem(record, "judge-null").leases.map((l) => l.close?.how)).toEqual(["settled"]);
  });

  test("a provider failure mid-run stops every worker, settles the lease and writes no reply file", async () => {
    const sent: Sent[] = [];
    const out = join(dir, "run-down");
    const honest = matching(key);
    recordApproval(record, { action: "init", item: "judge-down", cap_micros: 100_000_000, quotes: [QUOTE], admission: "warn" });
    const base = upstream(sent, (_m, file, packet) => honest(file, packet));
    const flaky = async (url: string, init: RequestInit) => {
      if (String(init.body).includes("=== Packet: packets/3596.json ===")) throw new Error("connection reset");
      return base(url, init);
    };
    const r = await judgeRun(args(out).map((a) => (a === "judge" ? "judge-down" : a)), flaky);
    expect(r.code).toBe(2);
    const runFile = JSON.parse(readFileSync(join(out, "run.json"), "utf8"));
    expect(runFile).toMatchObject({ state: "stopped" });
    expect(runFile.stop).toBeTruthy();
    for (const f of ["primary.json", "second.json", "third.json", "impact.tsv"]) expect(existsSync(join(out, f))).toBe(false);
    expect(readItem(record, "judge-down").leases.map((l) => l.close?.how)).toEqual(["settled"]);
  });

  test("an answer judge-join would refuse is asked again once, and a second refusal leaves the packet unjudged", async () => {
    const sent: Sent[] = [];
    const out = join(dir, "run2");
    const honest = matching(key);
    const answer: Answer = (model, file, packet, attempt) => {
      if (model === "claude-opus-5-5" && file === "packets/3596.json" && attempt === 1) return "I cannot judge this.";
      if (model === "claude-opus-5-5" && file === "packets/3516.json") return JSON.stringify({ packets: [{ file, blockers: [{ id: "B9", matches: [] }] }] });
      return honest(file, packet);
    };
    recordApproval(record, { action: "init", item: "judge-2", cap_micros: 100_000_000, quotes: [QUOTE], admission: "warn" });
    const r = await judgeRun(args(out).map((a) => (a === "judge" ? "judge-2" : a)), upstream(sent, answer));
    expect(r.code).toBe(0);
    expect(r.err).toContain("the primary judge's answer for packets/3596.json was refused (attempt 1): the answer holds no JSON object");
    expect(sent.filter((s) => s.model === "claude-opus-5-5" && s.file === "packets/3596.json").length).toBe(2);
    expect(sent.filter((s) => s.model === "claude-opus-5-5" && s.file === "packets/3516.json").length).toBe(2);
    for (const f of ["3596.1.txt", "3596.2.txt", "3516.1.txt", "3516.2.txt"]) expect(existsSync(join(out, "raw", "primary", f))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, "unjudged.json"), "utf8"))).toEqual({ batch: key.batch, entries: [{ role: "primary", packet: "packets/3516.json", reason: expect.stringContaining('answers blocker "B9"') }] });
    expect(existsSync(join(out, "third.json"))).toBe(false);
    const next = nextCommand(r.out);
    expect(next).toContain("--unjudged");
    const joined = await run(next);
    expect([joined.code, joined.err]).toEqual([0, ""]);
    const rows = tsvRows(join(out, "joined", "alpha", "judgments.tsv"));
    const gap = rows.filter((row) => row[0] === "3516");
    expect(gap.length).toBeGreaterThan(0);
    for (const row of gap) expect([row[2], row[6], row[8], row[10]]).toEqual(["M", "judge-run", "no judgment: the primary judge's reply for packets/3516.json was refused twice", "incomplete"]);
    expect(rows.filter((row) => row[0] !== "3516").every((row) => row[10] === "")).toBe(true);
    expect((await run(["ingest", join(out, "joined", "alpha"), "--suite", "gsta167-14pr", "--check"])).code).toBe(0);
    const other = join(dir, "other-unjudged.json");
    writeFileSync(other, JSON.stringify({ batch: "f".repeat(64), entries: [] }));
    const refused = await run([...next.map((a) => (a.endsWith("unjudged.json") ? other : a)), "--replace", "test"]);
    expect([refused.code, refused.err]).toEqual([2, expect.stringContaining("not this key's batch")]);
  });

  test("a third judge equal to the primary, --out among the packets, a key among them or a used --out is refused before any send", async () => {
    const sent: Sent[] = [];
    const fake = upstream(sent, () => "");
    const out = join(dir, "run3");
    const third = await judgeRun(args(out).map((a) => (a === SONNET ? OPUS : a)), fake);
    expect([third.code, third.err]).toEqual([2, expect.stringMatching(/^E_USAGE --third anthropic\/claude-opus-5-5 already judges this batch/)]);
    expect((await judgeRun(args(join(packets, "replies")), fake)).err).toMatch(/^E_USAGE --out .* is inside --packets/);
    expect((await judgeRun(args(out).map((a) => (a === keyPath ? join(packets, "key.json") : a)), fake)).err).toMatch(/^E_NOLOSS_BLIND --key .* is inside --packets/);
    expect((await judgeRun(args(join(dir, "run1")), fake)).err).toMatch(/^E_USAGE --out .* is not empty/);
    expect([sent.length, existsSync(out)]).toEqual([0, false]);
  });

  test("--dry-run prints each request's worst case and spends and writes nothing", async () => {
    const leases = readItem(record, "judge").leases.length;
    const out = join(dir, "dry");
    const r = await run(["judge-run", ...args(out), "--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n").filter((l) => /^(primary|second|third) {2}\S+ {2}packets\/\S+ {2}worst case \$/.test(l)).length).toBe(42);
    expect(r.out).toMatch(/worst case: primary \$[\d.]+ on 14 packets; .* Nothing was sent or written\.$/);
    expect([existsSync(out), readItem(record, "judge").leases.length]).toEqual([false, leases]);
  });
});

describe("judge-run on an adjudication batch", () => {
  const dir = tmp("noloss-judge-run-adj-");
  const clone = join(dir, "clone");
  mkdirSync(join(clone, "lib"), { recursive: true });
  writeFileSync(join(clone, "lib", "x.ts"), Array.from({ length: 120 }, (_, i) => "export const v" + (i + 1) + " = " + (i + 1) + ";").join("\n") + "\n");
  const git = (...a: string[]) => spawnSync("git", ["-C", clone, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } }).stdout.trim();
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "fixture head");
  const head = git("rev-parse", "HEAD");
  // The suite with unit 3593's head moved to the fixture repo's commit, so its evidence sheet reads real code.
  const base = loadSuite("gsta167-14pr").suite;
  const suitePath = join(dir, "suite.json");
  writeFileSync(suitePath, JSON.stringify({ ...base, units: base.units.map((u) => (u.pr === 3593 ? { ...u, head, id: unitId(u.repo, u.pr, head) } : u)) }));
  const finding = (id: string, path: string, line: number | null, evidence?: string) => JSON.stringify({ id, severity: "CRITICAL", path, line, summary: "Synthetic unmatched blocking finding " + id + ".", reader: "testing", ...(evidence === undefined ? {} : { evidence }) });
  const arm = (id: string, label: string, lines: string[]) => {
    const f = new Map(editArm(example, (a) => ((a.id = id), (a.label = label))));
    f.set("findings/3593.jsonl", Buffer.from(f.get("findings/3593.jsonl")!.toString("utf8").replace(/\n*$/, "\n") + lines.join("\n") + "\n"));
    return writeArm(join(dir, "arms", id + "-" + lines.length), f);
  };
  const alpha = arm("alpha", "Alpha arm (synthetic)", [finding("v1", "lib/x.ts", 10, "Line 10 sets v10, a CRITICAL value.")]);
  const beta = arm("beta", "Beta arm (synthetic)", [finding("r1", "lib/x.ts", null, "The whole file."), finding("r2", "lib/gone.ts", 5)]);
  const record = join(dir, "record");
  recordApproval(record, { action: "init", item: "judge", cap_micros: 100_000_000, quotes: [QUOTE], admission: "warn" });
  const packetize = async (arms: string[], name: string) => {
    expect((await run(["judge-packet", "--suite", suitePath, ...arms.flatMap((a) => ["--arm", a]), "--seed", "20261101", "--out", join(dir, name), "--key", join(dir, name + "-key.json"), "--adjudicate"])).code).toBe(0);
    return JSON.parse(readFileSync(join(dir, name + "-key.json"), "utf8")) as Key;
  };
  const args = (name: string, arms: string[], out: string, extra: string[] = []) => ["--suite", suitePath, "--packets", join(dir, name), "--key", join(dir, name + "-key.json"), ...arms.flatMap((a) => ["--arm", a]), "--brief", BRIEF, "--primary", OPUS, "--second", SOL, "--third", SONNET, "--item", "judge", "--out", out, "--ledger", join(dir, "ledger.sqlite"), "--record", record, ...extra];

  test("evidence sheets go out with the packet, verifiable stays out of the replies, and unverifiable.tsv counts the frozen sensitivity rulings", async () => {
    const key = await packetize([alpha, beta], "packets");
    const of = (opaque: string) => key.entries.find((e) => e.opaque === opaque)!.finding;
    const RULE: Record<string, Record<string, [string, boolean]>> = {
      "claude-opus-5-5": { v1: ["defect", true], r1: ["not-defect", true], r2: ["not-defect", false] },
      "gpt-6.1-sol": { v1: ["defect", true], r1: ["not-defect", true], r2: ["defect", true] },
      "claude-sonnet-5-5": { v1: ["defect", true], r1: ["not-defect", true], r2: ["not-defect", false] },
    };
    const sent: Sent[] = [];
    const out = join(dir, "run1");
    const r = await judgeRun(args("packets", [alpha, beta], out, ["--source", "garrytan/gstack=" + clone]), upstream(sent, (model, file, packet) => JSON.stringify({ packets: [{ file, findings: packet.findings.map((f: any) => ({ id: f.id, ruling: RULE[model]![of(f.id)]![0] })), verifiable: Object.fromEntries(packet.findings.map((f: any) => [f.id, RULE[model]![of(f.id)]![1]])) }] })));
    expect([r.code, r.err]).toEqual([0, expect.stringMatching(/^RIG_UNPROVEN: noloss judge-run: line item judge leased without admission/)]);
    expect(sent.map((s) => s.model)).toEqual(["claude-opus-5-5", "gpt-6.1-sol", "claude-sonnet-5-5"]);
    const sheet = JSON.parse(readFileSync(join(out, "sheets", "3593.json"), "utf8"));
    expect(sent[0]!.body.messages[0].content.endsWith("=== Evidence sheet: packets/3593.json ===\n" + readFileSync(join(out, "sheets", "3593.json"), "utf8"))).toBe(true);
    const byFinding = (id: string) => sheet.findings.find((f: any) => of(f.id) === id);
    expect(byFinding("v1")).toMatchObject({ evidence: "Line 10 sets v10, a [severity] value.", code: { path: "lib/x.ts", from: 1, to: 40 }, code_note: null });
    expect(byFinding("v1").code.text.split("\n")[9]).toBe("10  export const v10 = 10;");
    expect(byFinding("r1").code).toMatchObject({ from: 1, to: 120 });
    expect(byFinding("r2")).toMatchObject({ evidence: "", code: null, code_note: expect.stringContaining("lib/gone.ts is not a file") });
    expect(readFileSync(join(out, "primary.json"), "utf8")).not.toContain("verifiable");
    expect(tsvRows(join(out, "verifiable.tsv")).length).toBe(9);
    expect(tsvRows(join(out, "unverifiable.tsv"))).toEqual([["beta", "3593", "1", "r2", OPUS + "," + SONNET]]);
    expect(r.out).toContain("unverifiable not-defect rulings, arm beta: 1, 0.0714 per PR cluster per pass (1 passes, 14 PR clusters)");
    expect(r.out).toContain("unverifiable not-defect rulings, arm alpha: 0, 0.0000");
    const joined = await run(nextCommand(r.out));
    expect([joined.code, joined.err]).toEqual([0, ""]);
    const rows = tsvRows(join(out, "joined", "beta", "adjudication.tsv"));
    expect(rows.map((row) => [row[1], row[3], row[4]])).toEqual([["r1", "not-defect", OPUS], ["r2", "not-defect", SONNET + " (third read)"]]);
  });

  test("a leak in the evidence or a missing clone refuses the run before any send", async () => {
    const leaky = arm("beta", "Beta arm (synthetic)", [finding("r1", "lib/x.ts", 3, "As the Beta arm (synthetic) saw, v3 is wrong."), finding("r2", "lib/x.ts", 4), finding("r3", "lib/x.ts", 5)]);
    await packetize([alpha, leaky], "leaky");
    const sent: Sent[] = [];
    const out = join(dir, "run2");
    const r = await judgeRun(args("leaky", [alpha, leaky], out, ["--source", "garrytan/gstack=" + clone]), upstream(sent, () => ""));
    expect([r.code, r.err]).toEqual([2, expect.stringContaining('3593, arm beta, finding "r1": its evidence names an arm id or label')]);
    expect(r.err).not.toContain("v3 is wrong");
    const none = await judgeRun(args("leaky", [alpha, leaky], out), upstream(sent, () => ""));
    expect(none.err).toMatch(/^E_USAGE no --source clone for garrytan\/gstack, which unit garrytan\/gstack#3593@\w+ needs at head \w+/);
    expect([sent.length, existsSync(out)]).toEqual([0, false]);
  });
});

describe("judge-run on a plan adjudication batch", () => {
  test("the evidence sheet strips gstack's heading words as the plan packet does", async () => {
    const dir = tmp("noloss-judge-run-plan-");
    const panel = planPanel(dir, { seeded: 1, decoy: 1 });
    const S = ["--sealed-root", panel.sealedRoot];
    const text = (u: { pr: number }) => ({ section: "Scope", claim: "Synthetic finding on unit " + u.pr + ".", evidence: "The Premise Challenge reads context/goals.md; see the GSTACK REVIEW REPORT.", fix: "Synthetic." });
    const src = writePlanArm(join(dir, "src", "noisy"), panel.suite, { id: "noisy", passes: 1, outcome: () => "M", noise: 1, text });
    expect((await run(["ingest", src, "--suite", panel.stubPath, "--root", join(dir, "arms"), ...S])).code).toBe(0);
    const arm = join(dir, "arms", panel.suite.id, "noisy");
    const packets = join(dir, "packets");
    const keyPath = join(dir, "key.json");
    expect((await run(["judge-packet", "--suite", panel.stubPath, "--arm", arm, "--seed", "7", "--out", packets, "--key", keyPath, "--adjudicate", "--source", "example/plan-panel=" + panel.clone, ...S])).code).toBe(0);
    const record = join(dir, "record");
    recordApproval(record, { action: "init", item: "judge", cap_micros: 100_000_000, quotes: [QUOTE], admission: "warn" });
    const out = join(dir, "run");
    const ruled = (_model: string, file: string, packet: any) => JSON.stringify({ packets: [{ file, findings: packet.findings.map((f: any) => ({ id: f.id, ruling: "not-defect" })), verifiable: Object.fromEntries(packet.findings.map((f: any) => [f.id, true])) }] });
    setSealedRoot(panel.sealedRoot);
    try {
      const r = await judgeRun(["--suite", panel.stubPath, "--packets", packets, "--key", keyPath, "--arm", arm, "--brief", BRIEF, "--primary", OPUS, "--second", SOL, "--third", SONNET, "--item", "judge", "--out", out, "--ledger", join(dir, "ledger.sqlite"), "--record", record, "--source", "example/plan-panel=" + panel.clone], upstream([], ruled));
      expect(r.code).toBe(0);
    } finally {
      setSealedRoot(null);
    }
    const sheets = readdirSync(join(out, "sheets"));
    expect(sheets.length).toBe(1);
    const sheet = JSON.parse(readFileSync(join(out, "sheets", sheets[0]!), "utf8"));
    expect(sheet.findings.map((f: { evidence: string }) => f.evidence)).toEqual(["The reads context/goals.md; see the."]);
  });
});
