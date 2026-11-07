// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless render gate (GEVA-392 addendum): every history's report request for every model and arm, built and checked
// as the drive builds and checks it before a send, printing counts and structure only.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../lanes/tbv/cli.ts";
import { run } from "../../lanes/tbv/gate.ts";
import { PLACEHOLDERS, type Family, type History, type HistoryEvent, type SpliceSet } from "../../lanes/tbv/types.ts";
import { shape } from "./fixtures/s2.ts";

const TURNS = join(import.meta.dir, "../../wiki/plans/2026-11-05-geva-313-trust-but-verify-prereg/turns.txt");
const root = mkdtempSync(join(tmpdir(), "tbv-gate-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const hist = (task: string, family: Family, events: HistoryEvent[]): History => ({ schema: "tbv-history.v1", source: family === "investigate" ? "A" : "B", task, cluster: task + "-cluster", family, events, sha256: "0".repeat(64), side: { files: [], resolved: null, patch: null } });
const call = (n: number, id: string, file: string): HistoryEvent => ({ n, kind: "tool-use", id, name: "Read", input: { file_path: file } });
const res = (n: number, id: string, content: string): HistoryEvent => ({ n, kind: "tool-result", tool_use_id: id, content, is_error: false });
const PLAIN = hist("task-secret-plain", "investigate", [{ n: 1, kind: "user-text", text: "Find the bug." }, call(2, "toolu_p1", "p.py"), res(3, "toolu_p1", "secret body p")]);
const LATE = hist("task-secret-late", "investigate", [{ n: 1, kind: "user-text", text: "Find the bug." }, call(2, "toolu_l1", "a.py"), call(3, "toolu_l2", "b.py"), res(4, "toolu_l1", "secret body a"), call(5, "toolu_l3", "c.py"), res(6, "toolu_l3", "secret body c"), res(7, "toolu_l2", "secret body b")]);
const SHIP = hist("task-secret-ship", "ship", [{ n: 1, kind: "user-text", text: "Get pull request #9 ready to merge." }, { n: 2, kind: "tool-use", id: "toolu_s9", name: "Bash", input: { command: "gh pr checks 9" } }, res(3, "toolu_s9", "secret checks")]);
const MISSING = hist("task-secret-missing", "investigate", [{ n: 1, kind: "user-text", text: "Find the bug." }, call(2, "toolu_m1", "a.py"), call(3, "toolu_m2", "b.py"), res(4, "toolu_m1", "secret body a")]);
const CLASH = hist("task-secret-clash", "investigate", [{ n: 1, kind: "user-text", text: "Find the bug." }, call(2, "toolu_s1", "a.py"), res(3, "toolu_s1", "secret body a")]);

const splice = (family: Family): SpliceSet => ({
  schema: "tbv-splice.v1",
  family,
  pin: "a".repeat(40),
  opening: [{ type: "text", text: "<command-name>/" + family + "</command-name>\n<command-args>" + PLACEHOLDERS.firstUser + "</command-args>" }],
  head: [
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_s1", name: "Read", input: { file_path: "~/p.md" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_s1", content: "1\t**Bounded closer.** Short." }] },
  ],
  tail: [],
  closer: { kind: "preamble", paragraph: "**Bounded closer.** Short." },
  skillStart: null,
  files: [],
  sha256: "2".repeat(64),
});
const put = (path: string, v: unknown) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(v));
};
function setup(name: string, tasks: Record<string, unknown>, shapes = ["none", "lens", "current"] as const) {
  const dir = join(root, name);
  mkdirSync(join(dir, "tasks"), { recursive: true });
  for (const [rel, h] of Object.entries(tasks)) put(join(dir, "tasks", rel), h);
  mkdirSync(join(dir, "shapes"), { recursive: true });
  for (const arm of shapes) put(join(dir, "shapes", "shape-" + arm + ".json"), shape(arm));
  for (const f of ["investigate", "ship"] as const) put(join(dir, "splices", "splice-" + f + ".json"), splice(f));
  return dir;
}
const argv = (dir: string) => ["render-gate", "--tasks", join(dir, "tasks"), "--shapes", join(dir, "shapes"), "--splices", join(dir, "splices"), "--turns", TURNS, "--cwd", "/app", "--date", "2026-11-05"];
async function gate(dir: string) {
  const out: string[] = [], err: string[] = [];
  const code = await main(argv(dir), { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const quiet = (text: string) => expect(text).not.toMatch(/task-secret|toolu_|secret body|secret checks|a\.py|Find the bug/);

test("every report request of every history, model and arm passes, late parallel results included, and only counts print", async () => {
  const r = await gate(setup("pass", { "investigate/plain.json": PLAIN, "investigate/late.json": LATE, "ship/ship.json": SHIP }));
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(r.out).toContain("tbv render-gate: 3 histories (investigate 2, ship 1); models opus, sol, particle; arms none, lens, current; 27 report requests");
  expect(r.out).toContain("family investigate: 2 histories, 1 with rebuilt turns (1 response)");
  expect(r.out).toContain("family ship: 1 history, 0 with rebuilt turns (0 responses)");
  expect(r.out).toMatch(/^investigate sol: 6 requests: 6 valid, 0 size drops, 0 refused; largest estimate \d+ tokens$/m);
  expect(r.out).toMatch(/^requests sha256 [0-9a-f]{64}$/m);
  expect(r.out.split("\n").at(-1)).toBe("Verdict: PASS (27 of 27 valid, 0 size drops)");
  quiet(r.out);
  const again = await gate(setup("pass-again", { "ship/ship.json": SHIP, "investigate/late.json": LATE, "investigate/plain.json": PLAIN }));
  expect(again.out.match(/requests sha256 \S+/)![0]).toBe(r.out.match(/requests sha256 \S+/)![0]);
});

test("a request at or over its model's window counts as a size drop, not a refusal, and the gate still passes", async () => {
  const BIG = hist("task-secret-big", "investigate", [{ n: 1, kind: "user-text", text: "x".repeat(3_030_000) }]);
  const r = await gate(setup("size", { "investigate/big.json": BIG }));
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/^investigate opus: 3 requests: 0 valid, 3 size drops, 0 refused; largest estimate \d+ tokens$/m);
  expect(r.out).toMatch(/^investigate sol: 3 requests: 3 valid, 0 size drops, 0 refused; largest estimate \d+ tokens$/m);
  expect(r.out).not.toMatch(/^refused:/m);
  expect(r.out.split("\n").at(-1)).toBe("Verdict: PASS (6 of 9 valid, 3 size drops)");
  quiet(r.out);
});

test("a history whose turns cannot be rebuilt, or whose request the validator refuses, fails the gate by position and reason with no id", async () => {
  const r = await gate(setup("fail", { "investigate/a-missing.json": MISSING, "investigate/b-clash.json": CLASH, "investigate/plain.json": PLAIN }));
  expect(r.code).toBe(1);
  expect(r.out).toContain("refused: history 1 of 3 (investigate, source A), opus none: E_TBV_HISTORY the turns cannot be rebuilt at event 4: 1 of the response's calls has no result");
  expect(r.out).toContain("refused: history 2 of 3 (investigate, source A), particle current: E_TBV_REQUEST the validator refused it: tool_use id <id> repeats");
  expect(r.out).not.toMatch(/refused: history 2 of 3 \(investigate, source A\), \w+ (none|lens):/);
  expect(r.out).toContain("family investigate: 3 histories, 0 with rebuilt turns (0 responses), 1 refused at render");
  expect(r.out.split("\n").at(-1)).toBe("Verdict: FAIL (12 of 27 refused, 15 valid, 0 size drops)");
  quiet(r.out);
});

test("a gstack arm whose request fails the closer byte check is refused, as the drive refuses it before a send", async () => {
  const dir = setup("closer", { "investigate/plain.json": PLAIN });
  put(join(dir, "splices", "splice-investigate.json"), { ...splice("investigate"), closer: { kind: "preamble", paragraph: "**Another closer.** Long." } });
  const r = await gate(dir);
  expect(r.code).toBe(1);
  expect(r.out).toContain("refused: history 1 of 1 (investigate, source A), opus current: E_TBV_REQUEST the closer byte check failed");
  expect(r.out.split("\n").at(-1)).toBe("Verdict: FAIL (3 of 9 refused, 6 valid, 0 size drops)");
});

test("the gate fails closed on an empty input, a file that is not a history, or no shapes", async () => {
  for (const [dir, why] of [
    [setup("empty", {}), "no tbv-history.v1 file under"],
    [setup("stray", { "investigate/plain.json": PLAIN, "investigate/extract.json": { schema: "tbv-extract.v1" } }), "file 1 of 2 under --tasks is not a tbv-history.v1 history"],
    [setup("noshapes", { "investigate/plain.json": PLAIN }, [] as never), "no tbv-shape.v1 file in"],
  ] as const) {
    const r = await gate(dir);
    expect(r.code).toBe(2);
    expect(r.err.split("\n")[0]).toStartWith("E_TBV_INPUT gstack-evals tbv render-gate: ");
    expect(r.err).toContain(why);
    expect(r.out).toBe("");
    await expect(run(argv(dir), { out: () => {}, err: () => {} })).rejects.toMatchObject({ code: "E_TBV_INPUT" });
  }
});
