// Keyless tests for gstack-evals waste (src/waste/crewlog.ts). Every fixture is invented here; none is copied from a
// real session, receipt or replay file.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashTraits, gateFamily, parseShell, program, readExport, receiptLoop, scanPrs, scanReceipts, scanSession, scanThreads, wasteCommand } from "../../src/waste/crewlog.ts";

let clock = 0;
let ids = 0;
const at = () => new Date(Date.UTC(2026, 0, 5) + 1000 * clock++).toISOString();

interface C {
  tool: string;
  input: unknown;
  result?: string;
  chars?: number;
  inChars?: number;
  ms?: number;
  error?: boolean;
}

function call(c: C) {
  const text = typeof c.input === "string" ? c.input : JSON.stringify(c.input);
  const result = c.result ?? "";
  return { tool: c.tool, durationMs: c.ms ?? 1000, input: { text, chars: c.inChars ?? text.length }, result: { text: result, chars: c.chars ?? result.length, is_error: c.error ?? false } };
}
const run = (calls: C[], code = "return 1;") => ({ id: "item-" + ids++, source: "tool", tool: "execute", createdAt: at(), input: { text: code, chars: code.length }, calls: calls.map(call) });
const bash = (command: string, result = "ok", more: Partial<C> & { execution?: string; machine?: unknown } = {}): C => {
  const { execution, machine, ...rest } = more;
  return { tool: "bash", input: { command, description: "a step", ...(execution ? { execution } : {}), ...(machine ? { machine } : {}) }, result, ...rest };
};
const tool = (name: string, input: unknown, result = "{}"): C => ({ tool: name, input, result });
const direct = (name: string, input: unknown, result = "done") => {
  const text = JSON.stringify(input);
  return { id: "item-" + ids++, source: "tool", tool: name, createdAt: at(), input: { text, chars: text.length }, result: { text: result, chars: result.length, is_error: false } };
};
const say = (model: string) => ({ id: "item-" + ids++, source: "assistant", text: "a note", model, createdAt: at() });
const scan = (...items: unknown[]) => scanSession(readExport(JSON.stringify({ items })));
const names = (command: string) => parseShell(command).map((s) => program(s).name);

describe("shell parsing", () => {
  test("splits on separators outside quotes and keeps quoted text whole", () => {
    const segs = parseShell("cd app && bun test 'a;b' | tee out.txt; echo \"x && y\"\nls -la");
    expect(segs.map((s) => program(s).name)).toEqual(["cd", "bun", "tee", "echo", "ls"]);
    expect(program(segs[1]!).args).toEqual(["test", "a;b"]);
    expect(program(segs[3]!).args).toEqual(["x && y"]);
  });

  test("redirects to files write; fd duplicates and /dev/null do not", () => {
    const writes = (c: string) => parseShell(c).some((s) => s.writes);
    expect(writes("bun test 2>&1 | head -5")).toBe(false);
    expect(writes("bun test >/dev/null 2>&1")).toBe(false);
    expect(writes("bun test > log.txt")).toBe(true);
    expect(writes("echo hi >> notes.md")).toBe(true);
    expect(writes("make all &> build.log")).toBe(true);
  });

  test("here-doc bodies are skipped, not read as commands", () => {
    const segs = parseShell("cat > notes.md <<'EOF'\nrm -rf build\ngit push\nEOF\nbun test");
    expect(segs.map((s) => program(s).name)).toEqual(["cat", "bun"]);
    expect(segs[0]!.writes && segs[0]!.heredoc).toBe(true);
  });

  test("wrappers, assignments and paths are stripped from the program name", () => {
    expect(names("FOO=1 timeout -s KILL 60 env -i bun test")).toEqual(["bun"]);
    expect(names("./node_modules/.bin/tsc --noEmit")).toEqual(["tsc"]);
    expect(names("if git diff --quiet; then echo same; fi")).toEqual(["git", "echo", "fi"]);
    expect(names("x=$(git rev-parse HEAD) && echo \"$x\" # a comment; rm -rf it")).toEqual(["", "echo"]);
  });
});

describe("bash traits", () => {
  test("checks are test, typecheck, lint and pregate commands without a fix flag", () => {
    for (const c of ["bun test", "bun test tests/a.test.ts", "bun run typecheck", "bun run errors:check", "npx tsc --noEmit", "python3 -m pytest -q", "go test ./...", "gstack-pregate run", "cd app && npm test"]) expect(bashTraits(c).check).toBe(true);
    for (const c of ["eslint --fix .", "bun run errors:doc", "bun install", "git status", "jest -u"]) expect(bashTraits(c).check).toBe(false);
  });

  test("edits, commits and pushes change the tree; reads and unknown tools do not", () => {
    for (const c of ["git commit -m 'x'", "git -C repo merge main", "sed -i 's/a/b/' f.txt", "perl -pi -e 's/a/b/' f.txt", "cp a b", "python3 tool.py", "find . -name '*.tmp' -delete", "echo x > f", "bun run errors:doc", "bash -c 'make'"]) expect(bashTraits(c).changes).toBe(true);
    for (const c of ["git status --short", "cat f.txt", "ls -la", "bun test", "gstack-ship-receipt read --pr 1", "git log --oneline -3", "sleep 5"]) expect(bashTraits(c).changes).toBe(false);
    expect(bashTraits("git push origin topic").push).toBe(true);
    expect(bashTraits("gstack-pregate sealed && git push").push).toBe(true);
    expect(bashTraits("git status").push).toBe(false);
  });

  test("the strict rule also breaks on any program outside the read-only and check lists", () => {
    expect(bashTraits("gstack-ship-receipt read --pr 1").strictChanges).toBe(true);
    expect(bashTraits("cat f | grep x | wc -l").strictChanges).toBe(false);
    expect(bashTraits(". ./launch.env && gstack-pregate run").strictChanges).toBe(false);
    expect(bashTraits("echo \"$(make-thing)\"").strictChanges).toBe(true);
  });

  test("polls are status reads, alone or with sleeps", () => {
    for (const c of ["gh pr checks 12", "sleep 30 && gh pr checks 12", "git status --short", "curl -s http://localhost:3000/health", "tail -n 20 run.log", "pgrep -f server"]) expect(bashTraits(c).poll).toBe(true);
    for (const c of ["gh pr checks 12 && bun test", "tail -f run.log", "curl -s https://example.com", "sleep 30"]) expect(bashTraits(c).poll).toBe(false);
    expect(bashTraits("sleep 30 && gh pr checks 12").sleep).toBe(true);
  });
});

describe("thread exports", () => {
  test("R1 counts an identical re-run with no edit, commit or push between", () => {
    const s = scan(run([bash("bun test", "12 pass")]), run([bash("bun test", "12 pass", { ms: 2500 })]));
    expect(s.r1).toEqual({ calls: 1, ms: 2500, approx_calls: 0 });
    expect(s.r1_checks.calls).toBe(1);
    expect(s.r1_ship_checks.calls).toBe(1);
    expect(s.r1_strict.calls).toBe(1);
    expect(s.checks).toEqual({ calls: 2, ms: 3500 });
    expect(s.informative_reruns).toBe(0);
  });

  test("an edit, commit, push or opened PR between two runs resets R1", () => {
    const between: C[] = [tool("edit", { path: "f.ts", old_string: "a", new_string: "b" }), bash("git commit -am 'x'"), bash("git push"), tool("pr_create", { title: "x" }), tool("write", { path: "g.ts", content: "x" })];
    for (const b of between) expect(scan(run([bash("bun test", "12 pass")]), run([b]), run([bash("bun test", "12 pass")])).r1.calls).toBe(0);
  });

  test("a different result is an informative re-run, never waste", () => {
    const s = scan(run([bash("bun test", "1 fail")]), run([bash("bun test", "12 pass")]));
    expect(s.r1.calls).toBe(0);
    expect(s.informative_reruns).toBe(1);
  });

  test("a cut result makes the match approximate", () => {
    const s = scan(run([bash("bun test", "12 pass", { chars: 9000 })]), run([bash("bun test", "12 pass", { chars: 9000 })]));
    expect(s.r1).toEqual({ calls: 1, ms: 1000, approx_calls: 1 });
    expect(s.cut_results).toBe(2);
    expect(scan(run([bash("bun test", "12 pass", { chars: 9000 })]), run([bash("bun test", "12 pass", { chars: 9001 })])).r1.calls).toBe(0);
  });

  test("an unknown program between runs breaks only the strict reading", () => {
    const s = scan(run([bash("bun test", "ok")]), run([bash("gstack-ship-receipt read --pr 3", "x")]), run([bash("bun test", "ok")]));
    expect(s.r1.calls).toBe(1);
    expect(s.r1_strict.calls).toBe(0);
  });

  test("background work and subagents reset R1; a message to the Captain does not", () => {
    const first = run([bash("bun test", "ok")]);
    const again = () => run([bash("bun test", "ok")]);
    expect(scan(first, run([bash("bun test", "{\"operation_id\":\"op\"}", { execution: "background" })]), again()).r1.calls).toBe(0);
    expect(scan(first, run([tool("subagent_create", { tasks: [] })]), again()).r1.calls).toBe(0);
    expect(scan(first, run([tool("message_agent", { to: "2", text: "go", state: "working" })]), again()).r1.calls).toBe(0);
    expect(scan(first, direct("message_agent", { text: "status", state: "working" }), again()).r1.calls).toBe(1);
  });

  test("a background check is counted as a check, never as R1", () => {
    const bg = () => run([bash("bun test", "{\"operation_id\":\"op\"}", { execution: "background" })]);
    const s = scan(bg(), bg());
    expect(s.checks.calls).toBe(2);
    expect(s.background_checks).toBe(2);
    expect(s.r1.calls).toBe(0);
  });

  test("the machine is part of the command key", () => {
    expect(scan(run([bash("bun test", "ok")]), run([bash("bun test", "ok", { machine: { subagent: "1" } })])).r1.calls).toBe(0);
  });

  test("a bash call whose input was cut is unreadable and resets both readings", () => {
    const s = scan(run([bash("bun test", "ok")]), run([{ ...bash("bun test && git commit", "ok"), input: "{\"command\":\"bun te", inChars: 400 }]), run([bash("bun test", "ok")]));
    expect(s.unreadable_bash).toBe(1);
    expect(s.r1.calls).toBe(0);
  });

  test("a call that crosses the boundary itself is never R1 or a pushed-head check", () => {
    const s = scan(run([bash("printf x >> counter.txt", "")]), run([bash("printf x >> counter.txt", "")]));
    expect(s.r1.calls).toBe(0);
    expect(s.r1_strict.calls).toBe(0);
    expect(scan(run([bash("git push -u origin topic")]), run([bash("printf x >> f && bun test", "ok")])).pushed_head_checks.calls).toBe(0);
  });

  test("the command key keeps whitespace inside quotes", () => {
    expect(scan(run([bash("grep -q 'a  b' f", "")]), run([bash("grep -q 'a b' f", "")])).r1.calls).toBe(0);
  });

  test("checks after a push with no change since are at a pushed head", () => {
    const s = scan(run([bash("bun test", "ok")]), run([bash("git push -u origin topic")]), run([bash("bun test", "ok", { ms: 4000 })]), run([tool("edit", { path: "f" })]), run([bash("bun test", "ok")]));
    expect(s.pushed_head_checks).toEqual({ calls: 1, ms: 4000 });
    expect(scan(run([tool("pr_create", { title: "t" })]), run([bash("bun run typecheck", "ok")])).pushed_head_checks.calls).toBe(1);
  });

  test("only a successful push in the same machine and directory makes a pushed head", () => {
    const after = (push: C, check = bash("bun test", "ok")) => scan(run([push]), run([check])).pushed_head_checks.calls;
    expect(after(bash("git push", "rejected", { error: true }))).toBe(0);
    expect(after(bash("git push", "ok", { machine: { subagent: "1" } }))).toBe(0);
    expect(after(bash("cd repo-a && git push"), bash("cd repo-b && bun test", "ok"))).toBe(0);
    expect(after(bash("cd repo-a && git push"), bash("cd repo-a && bun test", "ok"))).toBe(1);
  });

  test("pr_create after a push keeps the pushed head's machine and directory", () => {
    const s = scan(run([bash("cd repo-a && git push")]), run([tool("pr_create", { title: "t" })]), run([bash("cd repo-a && bun test", "ok")]));
    expect(s.pushed_head_checks.calls).toBe(1);
  });

  test("pr_create after a tree change resets to its machine and no directory", () => {
    const s = scan(run([bash("cd repo-a && git push")]), run([tool("edit", { path: "f" })]), run([tool("pr_create", { title: "t" })]), run([bash("bun test", "ok")]));
    expect(s.pushed_head_checks.calls).toBe(1);
  });

  test("a check in the pushed directory after a tree change and pr_create is not at the pushed head", () => {
    const s = scan(run([bash("cd repo-a && git push")]), run([tool("edit", { path: "f" })]), run([tool("pr_create", { title: "t" })]), run([bash("cd repo-a && bun test", "ok")]));
    expect(s.pushed_head_checks.calls).toBe(0);
  });

  test("pr_create from the primary after a push on a subagent resets to the primary", () => {
    const s = scan(run([bash("git push", "ok", { machine: { subagent: "1" } })]), run([tool("pr_create", { title: "t" })]), run([bash("bun test", "ok")]));
    expect(s.pushed_head_checks.calls).toBe(1);
  });

  test("a check in another directory after pr_create is not at the pushed head", () => {
    const s = scan(run([bash("cd repo-a && git push")]), run([tool("pr_create", { title: "t" })]), run([bash("cd repo-b && bun test", "ok")]));
    expect(s.pushed_head_checks.calls).toBe(0);
  });

  test("patches, sourced scripts and attached in-place flags cross the boundary", () => {
    const again = (mid: C) => scan(run([bash("bun test", "ok")]), run([mid]), run([bash("bun test", "ok")]));
    for (const mid of [tool("apply_patch", { patch: "x" }), bash("source ./repair.sh", ""), bash(". ./repair.sh", "")]) {
      expect(again(mid).r1.calls).toBe(0);
      expect(again(mid).r1_strict.calls).toBe(0);
    }
    expect(again(bash(". ./launch.env", "")).r1.calls).toBe(1);
    expect(bashTraits("sed --in-place=.bak s/a/b/ f").changes).toBe(true);
    expect(bashTraits("sort -oout.txt in.txt").changes).toBe(true);
  });

  test("R4a counts identical status polls separated only by polls, sleeps and waits", () => {
    const s = scan(
      run([bash("gh pr checks 7", "pending")]),
      run([bash("sleep 30", "")]),
      direct("wait", { description: "w", duration_seconds: 200 }),
      run([tool("thread_get", { thread_id: "this" }), bash("gh pr checks 7", "pending")]),
      run([bash("gh pr checks 7", "pending")]),
    );
    expect(s.r4a.calls).toBe(2);
    expect(s.r4b).toMatchObject({ sleep_calls: 1, waits: 1, timer_waits: 1, timer_seconds: 200 });
    expect(s.r1.calls).toBe(0);
  });

  test("work between polls, or a changed result, ends the run", () => {
    expect(scan(run([bash("gh pr checks 7", "pending")]), run([bash("bun test", "ok")]), run([bash("gh pr checks 7", "pending")])).r4a.calls).toBe(0);
    const s = scan(run([bash("git status --short", "M a")]), run([bash("git status --short", "M b")]), run([bash("git status --short", "M b")]));
    expect(s.r4a.calls).toBe(1);
  });

  test("only a pure sleep keeps a poll run", () => {
    for (const between of ["echo x > f; sleep 1", "sleep 5; bun test"]) expect(scan(run([bash("gh pr checks 7", "pending")]), run([bash(between, "")]), run([bash("gh pr checks 7", "pending")])).r4a.calls).toBe(0);
    expect(bashTraits("sleep 30").idle).toBe(true);
    expect(bashTraits("git status > out.txt").poll).toBe(false);
  });

  test("Capy status tools poll too", () => {
    const s = scan(run([tool("subagent_list", {}, "[1 working]")]), run([tool("subagent_list", {}, "[1 working]")]), run([tool("subagent_list", {}, "[1 done]")]));
    expect(s.r4a.calls).toBe(1);
  });

  test("waits and program sleeps are counted, not timed", () => {
    const s = scan(direct("wait", { description: "w", operation_ids: ["op-1"] }), direct("wait", { description: "w", wake_at: "2026-01-06T00:00:00Z" }), run([], "await sleep(20000); await sleep (5000);"));
    expect(s.r4b).toEqual({ sleep_calls: 0, sleep_ms: 0, waits: 2, timer_waits: 1, timer_seconds: 0, operation_waits: 1, program_sleep_sites: 2 });
  });

  test("assistant models are counted", () => {
    expect(scan(say("model-a"), say("model-a"), say("model-b")).models).toEqual({ "model-a": 2, "model-b": 1 });
  });

  test("an export of JSON-line pages, newest page first and overlapping, reads in time order", () => {
    const a = run([bash("bun test", "ok")]);
    const b = run([bash("bun test", "ok")]);
    const c = run([bash("bun test", "ok")]);
    const text = JSON.stringify({ items: [b, c] }) + "\n" + JSON.stringify({ items: [a, b] }) + "\n";
    expect(readExport(text).map((i) => i.id)).toEqual([a.id, b.id, c.id]);
    expect(scanSession(readExport(text)).r1.calls).toBe(2);
  });

  test("an item without createdAt or an unknown shape is refused", () => {
    expect(() => readExport(JSON.stringify({ items: [{ id: "x", source: "tool" }] }))).toThrow("createdAt");
    expect(() => readExport(JSON.stringify({ rows: [] }))).toThrow("not a transcript page");
    expect(() => readExport("{\n")).toThrow("line 1 is not JSON");
    expect(() => readExport("\n\n")).toThrow("no JSON value");
    expect(readExport("[]")).toEqual([]);
  });

  test("scanThreads digests each export and sums the sessions", () => {
    const text = JSON.stringify({ items: [run([bash("bun test", "ok")]), run([bash("bun test", "ok")])] });
    const out = scanThreads([text, text]);
    expect(out.sessions[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.totals).toMatchObject({ calls: 4, r1: { calls: 2 } });
  });
});

describe("receipts", () => {
  const block = (loop: unknown) => "## Receipt\n\u0060\u0060\u0060gstack-ship-receipt\n" + JSON.stringify({ schema_version: 1, pr: 1, review_loop: loop }, null, 2) + "\n\u0060\u0060\u0060\n";

  test("reads rounds from the receipt block, or passes plus fix-checks", () => {
    expect(receiptLoop(block({ passes: 2, rounds: 3 }))).toEqual({ passes: 2, rounds: 3 });
    expect(receiptLoop(block({ passes: 2, fix_checks: 1 }))).toEqual({ passes: 2, rounds: 3 });
    expect(receiptLoop(block({ passes: 1 }))).toEqual({ passes: 1, rounds: 1 });
    expect(receiptLoop(block({ passes: 1 }) + block({ passes: 3, rounds: 3 }))).toEqual({ passes: 3, rounds: 3 });
  });

  test("falls back to the last REVIEW_LOOP line", () => {
    expect(receiptLoop("REVIEW_LOOP: passes=1 fix_checks=0\nREVIEW_LOOP: passes=3 blocking_found=1 fix_checks=1 scope=frozen")).toEqual({ passes: 3, rounds: 4 });
    expect(receiptLoop("REVIEW_LOOP: passes=2 blocking_found=0")).toEqual({ passes: 2, rounds: 2 });
    expect(receiptLoop("no receipt here")).toBeNull();
  });

  test("counts rounds and passes past the cap of 2", () => {
    const out = scanReceipts([block({ passes: 2, rounds: 3 }), block({ passes: 1, rounds: 1 }), "REVIEW_LOOP: passes=4", "nothing"]);
    expect(out).toMatchObject({ files: 4, no_receipt: 1, with_passes: 3, passes: 7, passes_past_cap: 2, prs_passes_past_cap: 1, with_rounds: 3, rounds: 8, rounds_past_cap: 3, prs_rounds_past_cap: 2, rounds_by_count: { "1": 1, "3": 1, "4": 1 } });
    expect(out.digests).toHaveLength(4);
  });

  test("a receipt block that is not JSON is refused", () => {
    expect(() => scanReceipts(["\u0060\u0060\u0060gstack-ship-receipt\nnot json\n\u0060\u0060\u0060"])).toThrow("input 1 of 1");
  });
});

describe("per-PR data", () => {
  const data = {
    prs: [
      {
        heads: [{ jobs: 2, wall_min: 5 }, { jobs: 0, wall_min: 1.5 }],
        ci: { workflow_runs: 3, reruns: 1, red_heads: 0, job_minutes: 10, wall_min_final_head: 5 },
        gates: [
          { gate: "pregate", runs: 2, wall_min: "est. 5-10" },
          { gate: "ship_preflight", runs: 1, wall_min: 4 },
          { gate: "ship_panel", passes: 3, rounds: 4, runs: 1 },
          { gate: "capy_review", runs: 2 },
        ],
      },
      { heads: [{ jobs: 1, wall_min: 2 }], ci: { workflow_runs: 1, reruns: 0 }, gates: [{ gate: "pregate", wall_min: null }], review_loop: { passes: 1, fix_checks: 1 } },
      { in_sample: false, heads: [{ jobs: 9 }], ci: { reruns: 9 } },
    ],
    catches: [
      { first_gate: "ship_panel:outside_voice" },
      { first_gate: "ci:test", count: 3 },
      { first_gate: "capy_review", strict: false },
      { first_gate: "escaped" },
      { first_gate: "ship_panel:red_team", extra_outside_window: true },
      { first_gate: "pregate:sealed", strict: true },
    ],
  };

  test("counts heads, CI reruns, local checks, review rounds and first gates", () => {
    const out = scanPrs(data);
    expect(out.prs).toBe(2);
    expect(out.heads).toBe(3);
    expect(out.ci).toEqual({ heads_with_jobs: 2, heads_without_jobs: 1, heads_jobs_not_measured: 0, workflow_runs: 4, reruns: 1, red_heads: 0, job_minutes: 10, wall_min_all_heads: 8.5, wall_min_final_heads: 5 });
    expect(out.local_checks.pregate).toEqual({ prs_with_gate: 2, runs: 2, runs_not_measured: 1, wall_min: null, wall_estimate_only: 1 });
    expect(out.local_checks.ship_preflight).toEqual({ prs_with_gate: 1, runs: 1, runs_not_measured: 0, wall_min: 4, wall_estimate_only: 0 });
    expect(out.local_checks.ubicloud_verify).toEqual({ prs_with_gate: 0, runs: null, runs_not_measured: 0, wall_min: null, wall_estimate_only: 0 });
    expect(out.review).toEqual({ prs_with_passes: 2, passes: 4, passes_past_cap: 1, prs_passes_past_cap: 1, passes_per_head: 1.33, prs_with_rounds: 2, rounds: 6, rounds_past_cap: 2, prs_rounds_past_cap: 1, ship_runs: 1, platform_review_runs: 2, platform_review_runs_per_head: 1 });
    expect(out.catches).toEqual({ counted: 5, by_first_gate: { ship_panel: 1, ci: 3, pregate: 1 }, escapes: 1, not_strict: 1, outside_window: 1 });
  });

  test("a head with no job count is not measured, never a head without jobs", () => {
    expect(scanPrs({ prs: [{ heads: [{}] }] }).ci).toMatchObject({ heads_with_jobs: 0, heads_without_jobs: 0, heads_jobs_not_measured: 1 });
  });

  test("a field the data lacks is null, not zero", () => {
    const out = scanPrs({ prs: [{ heads: [] }] });
    expect(out.ci.reruns).toBeNull();
    expect(out.review.passes).toBeNull();
    const unmatched = scanPrs({ prs: [{ heads: [{ jobs: 1 }, { jobs: 1 }], review_loop: { passes: 2 }, gates: [{ gate: "capy_review", runs: 2 }] }, { review_loop: { passes: 20 }, gates: [{ gate: "capy_review", runs: 20 }] }] });
    expect(unmatched.review.passes_per_head).toBe(1);
    expect(unmatched.review.platform_review_runs_per_head).toBe(1);
    expect(out.review.rounds_past_cap).toBeNull();
    expect(out.catches).toBeNull();
    expect(() => scanPrs({ rows: [] })).toThrow("prs array");
  });

  test("first gates map to families by prefix", () => {
    expect(["ship_panel:full", "capy_review", "crew_review", "review:/review", "ci:fast", "writers_room", "paid_screen:claim_check", "train_gate:merge lane", "local:probe", "escaped->later", "something"].map(gateFamily)).toEqual(["ship_panel", "capy_review", "crew_review", "other_review", "ci", "cold_read", "paid_screen", "train_gate", "local_probe", "escaped", "other"]);
  });
});

describe("gstack-evals waste", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "waste-test-"));
    dirs.push(d);
    return d;
  };
  async function cli(argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await wasteCommand(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
    return { code, out: out.join("\n"), err: err.join("\n") };
  }

  test("usage errors exit 2 with E_USAGE on every line", async () => {
    const d = tmp();
    const f = join(d, "a.json");
    writeFileSync(f, "{}");
    for (const argv of [[], ["nope"], ["threads"], ["threads", "--bogus", f], ["threads", "--label"], ["prs", f, f]]) {
      const r = await cli(argv);
      expect(r.code).toBe(2);
      for (const line of r.err.split("\n")) expect(line).toStartWith("E_USAGE ");
    }
  });

  test("an unreadable or malformed input exits 2 with E_WASTE_INPUT and never names its path", async () => {
    const d = tmp();
    const missing = join(d, "missing-export.jsonl");
    const bad = join(d, "bad-export.jsonl");
    writeFileSync(bad, "not json\n");
    for (const argv of [["threads", missing], ["threads", bad], ["prs", bad], ["receipts", bad, missing]]) {
      const r = await cli(argv);
      expect(r.code).toBe(2);
      expect(r.out).toBe("");
      for (const line of r.err.split("\n")) expect(line).toStartWith("E_WASTE_INPUT ");
      expect(r.err).not.toContain(d);
    }
  });

  test("prints counts and digests as JSON, never the commands, results or paths it read", async () => {
    const d = tmp();
    const f = join(d, "export-one.jsonl");
    const secretish = "zz-invented-marker-output";
    writeFileSync(f, JSON.stringify({ items: [run([bash("bun test quokka-suite", secretish)]), run([bash("bun test quokka-suite", secretish)])] }) + "\n");
    const r = await cli(["threads", "--label", "repo-k7", f]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out).toMatchObject({ reader: "gstack-evals waste", schema: 1, mode: "threads", label: "repo-k7", totals: { r1: { calls: 1 } } });
    expect(r.out).not.toContain("quokka");
    expect(r.out).not.toContain(secretish);
    expect(r.out).not.toContain(d);
  });
});
