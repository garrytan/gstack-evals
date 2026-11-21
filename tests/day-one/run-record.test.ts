import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armPlan, findRun, gatePending, PLAN, readExposure, WORK, type RunRoot } from "../../lanes/day-one/exposure.ts";
import { STATE_ROOT_DIR } from "../../src/trial/state-root.ts";

const RUN = WORK + "/.gstack/tmp/autoplan/run";
const BIN = "~/.claude/skills/gstack/bin/gstack-autoplan";
const SCAFFOLD = "cd /work/app; command -v codex; mkdir -p .gstack/tmp/autoplan; " + BIN + " next --out " + RUN + " --plan /work/app/plan.md --full --scaffold 2>&1 | tail -40";
const SUBMIT = "cd /work/app; B=" + BIN + "; O=" + RUN + '; $B submit --out $O --phase ceo --voice outside --unavailable "unattended session: no off-machine data without owner consent" 2>&1 | tail -8; $B next --out $O 2>&1 | tail -8';
const closed = { closed_at: "2026-11-17T18:30:00Z", native: { status: "completed" }, outside: { status: "unavailable" } };
const body = (o: Record<string, unknown> = {}) => ({ status: "complete", plan_input: PLAN, plan_source: PLAN, out: RUN, active_plan: RUN + "/plan-active.md", updated_at: "2026-11-17T18:30:36Z", phases: { ceo: closed, design: closed, eng: closed }, ...o });

type Call = { command: string; parent?: string } | { name: string; input: Record<string, unknown> };
const tx = (calls: Call[]) => calls.map((c, i) => JSON.stringify({ type: "assistant", ...("parent" in c && c.parent ? { parent_tool_use_id: c.parent } : {}), message: { content: [{ type: "tool_use", id: "t" + i, ...("command" in c ? { name: "Bash", input: { command: c.command } } : c) }] } }) + "\n").join("");

/** Writes run.json for the run folder the session saw at seenDir, under the host root that the session saw at rootSeen. */
const put = (root: string, rootSeen: string, seenDir: string, b: object) => {
  const d = join(root, seenDir.slice(rootSeen.length));
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "run.json"), JSON.stringify(b));
};

const withDir = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "day-one-record-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Value: protects=the run-record rule (pin change 2, item A): a gstack arm's autoplan run counts only when the session's own command log holds the gstack-autoplan call that wrote it, with the same --out and --plan /work/app/plan.md, and exposure and the live gate check read that one record; fails_when=a run at the session's --out in the work tree or one in the state root is missed, a planted or hand-edited run.json counts, or a run for another plan file is read; why_new=the day-one smoke, where every A run sat at its --out under /work/app/.gstack/tmp, outside the state root the harness read, so no A session was exposed and the owner was never asked; seam=findRun, readExposure, gatePending and armPlan; no_claim=gstack-autoplan's own run.json writer
describe("the session's autoplan run record", () => {
  test("a real --out record in the work tree is found, and the live gate check reads the same record", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, RUN, body({ status: "gate_pending" }));
      writeFileSync(join(work, ".gstack/tmp/autoplan/run/plan-active.md"), "# Plan, amended\n");
      const t = tx([{ command: SCAFFOLD }, { command: SUBMIT }]);
      const f = findRun(roots, t);
      expect(f.run?.seen).toBe(RUN + "/run.json");
      expect(readExposure(f, 0)).toMatchObject({ run: RUN + "/run.json", status: "gate_pending" });
      expect(gatePending(work, t)).toBe(true);
      expect(armPlan(work, "# Plan\n", f.run)).toEqual({ text: "# Plan, amended\n", from: "autoplan" });
      const relative = tx([{ command: "cd /work/app; R=.gstack/tmp/autoplan/run; B=~/.claude/skills/gstack/bin; $B/gstack-autoplan next --out $R --plan plan.md --full 2>&1 | tail -40" }]);
      expect(findRun(roots, relative).run?.seen).toBe(RUN + "/run.json");
      expect(gatePending(work, relative)).toBe(true);
    }));

  test("a record in the state root is found, through the state root's copy and through the work tree", () =>
    withDir((dir) => {
      const root = WORK + "/" + STATE_ROOT_DIR;
      const seen = root + "/projects/app/autoplan/r1";
      const work = join(dir, "work");
      const state = join(dir, "gstack-state");
      put(work, WORK, seen, body({ out: seen }));
      put(state, root, seen, body({ out: seen }));
      const t = tx([{ command: BIN + " next --out " + seen + " --plan " + PLAN + " --full" }]);
      expect(findRun([{ dir: state, seen: root }], t).run?.seen).toBe(seen + "/run.json");
      expect(findRun([{ dir: work, seen: WORK }], t).run?.seen).toBe(seen + "/run.json");
      expect(readExposure(findRun([{ dir: state, seen: root }], t), 0)).toMatchObject({ exposed: true, voice: "fallback" });
    }));

  test("a planted run.json with no matching invocation is refused, and so is one a call wrote that was then edited by hand", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, RUN, body());
      const read = tx([{ command: SCAFFOLD }, { command: "cat " + RUN + "/run.json 2>/dev/null | head -5; jq .status " + RUN + "/run.json 2>&1" }, { command: "python3 -c \"import json; print(len(json.load(open('" + RUN + "/run.json'))['phases']) > 0)\"" }]);
      expect(readExposure(findRun(roots, read), 0)).toMatchObject({ run: RUN + "/run.json", exposed: true });
      const refused: Record<string, string> = {
        "a heredoc": tx([{ command: "cd /work/app; mkdir -p " + RUN + " && cat > " + RUN + "/run.json <<'EOF'\n{\"status\": \"complete\"}\nEOF" }]),
        "the Write tool": tx([{ name: "Write", input: { file_path: RUN + "/run.json", content: "{}" } }]),
        "calls that only name its --out": tx([{ command: SUBMIT }]),
        "an Edit after the call": tx([{ command: SCAFFOLD }, { name: "Edit", input: { file_path: RUN + "/run.json", old_string: "gate_pending", new_string: "complete" } }]),
        "sed -i after the call": tx([{ command: SCAFFOLD }, { command: "cd /work/app/.gstack/tmp/autoplan/run && sed -i 's/gate_pending/complete/' run.json" }]),
        "a python heredoc after the call": tx([{ command: SCAFFOLD }, { command: "cd " + RUN + " && python3 - <<'PY'\nimport json\nj = json.load(open('run.json'))\nj['status'] = 'complete'\njson.dump(j, open('run.json', 'w'))\nPY" }]),
        "a python write after the call": tx([{ command: SCAFFOLD }, { command: "python3 -c \"import json; p='" + RUN + "/run.json'; j=json.load(open(p)); j['status']='complete'; json.dump(j, open(p, 'w'))\"" }]),
      };
      for (const [how, t] of Object.entries(refused)) {
        const f = findRun(roots, t);
        expect([how, f.run]).toEqual([how, null]);
        const e = readExposure(f, 3);
        expect([how, e.exposed, e.run]).toEqual([how, false, null]);
        expect(e.why).toContain(RUN + "/run.json");
      }
      put(work, WORK, RUN, body({ status: "gate_pending" }));
      expect(gatePending(work, refused["the Write tool"]!)).toBe(false);
      expect(gatePending(work, refused["sed -i after the call"]!)).toBe(false);
      expect(gatePending(work, tx([{ command: SCAFFOLD }]))).toBe(true);
    }));

  test("a call or a hand edit inside an if, while, for or brace body is read like any other command", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, RUN, body({ status: "gate_pending" }));
      const wrapped = tx([{ command: "cd /work/app; if command -v codex >/dev/null; then " + BIN + " next --out " + RUN + " --plan /work/app/plan.md --full; fi" }]);
      expect(findRun(roots, wrapped).run?.seen).toBe(RUN + "/run.json");
      expect(gatePending(work, wrapped)).toBe(true);
      const looped = tx([{ command: "cd /work/app; for i in 1; do ! " + BIN + " next --out " + RUN + " --plan /work/app/plan.md --full; done" }]);
      expect(findRun(roots, looped).run?.seen).toBe(RUN + "/run.json");
      const assigned = tx([{ command: "cd /work/app; if true; then R=.gstack/tmp/autoplan/run; B=~/.claude/skills/gstack/bin; { $B/gstack-autoplan next --out $R --plan plan.md --full; }; fi" }]);
      expect(findRun(roots, assigned).run?.seen).toBe(RUN + "/run.json");
      const edited = tx([{ command: SCAFFOLD }, { command: "if [ -f " + RUN + "/run.json ]; then sed -i 's/gate_pending/complete/' " + RUN + "/run.json; fi" }]);
      expect(findRun(roots, edited).run).toBeNull();
      expect(gatePending(work, edited)).toBe(false);
      const quoted = tx([{ command: "cd /work/app; 'then' " + BIN + " next --out " + RUN + " --plan /work/app/plan.md --full" }]);
      expect(findRun(roots, quoted).run).toBeNull();
    }));

  test("a record for a different plan_input is ignored, even when it is newer", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      const other = WORK + "/.gstack/tmp/autoplan/notes";
      const notes = WORK + "/notes.md";
      put(work, WORK, RUN, body());
      put(work, WORK, other, body({ out: other, plan_input: notes, plan_source: notes, updated_at: "2026-11-17T19:00:00Z" }));
      const both = tx([{ command: SCAFFOLD }, { command: BIN + " next --out " + other + " --plan " + notes + " --full" }]);
      expect(findRun(roots, both).run?.seen).toBe(RUN + "/run.json");
      const relabelled = tx([{ command: SCAFFOLD }, { command: BIN + " next --out " + other + " --plan " + PLAN + " --full" }]);
      expect(findRun(roots, relabelled).run?.seen).toBe(RUN + "/run.json");
      const elsewhere = tx([{ command: BIN + " next --out " + RUN + " --plan " + notes + " --full" }]);
      expect(findRun(roots, elsewhere).run).toBeNull();
    }));
});

// Value: protects=the widened run-record rule (rep 3 of the smoke): a record whose plan_input is a file the session's own gstack-autoplan revise --out <run folder> --plan named, inside the run folder or /work/app, counts when the run started from /work/app/plan.md, and the arm's plan (the build's input) is that last-revised file; fails_when=a plan the session wrapped and revised is passed over, so its later gate is never asked, or the build reads a file the review did not revise last, or a plan_input outside the run folder and /work/app, a run that did not start from /work/app/plan.md, or a file named by anything other than the session's own revise call counts; why_new=rep 3's third A session, which wrapped plan.md under an Implementation plan heading as <run>/plan-v2.md after revise refused plan.md, so the rule passed its record over and the round-2 gate was never asked; seam=findRun, gatePending, readExposure and armPlan; no_claim=gstack's own plan-shape check
describe("a plan the session revised under another name", () => {
  const V2 = RUN + "/plan-v2.md";
  const wrap = (to: string, out = RUN) => "cd /work/app; O=" + out + "; { echo; echo \"## Implementation plan\"; cat plan.md; } > " + to + "; " + BIN + " revise --out $O --plan " + to + " --incorporates r-d1,r-d2 2>&1 | tail -6";

  test("counts when the session's own revise call named it inside the run folder or /work/app, and the build reads it", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, RUN, body({ status: "gate_pending", plan_input: V2 }));
      writeFileSync(join(work, "plan.md"), "# Plan, amended once\n");
      writeFileSync(join(work, ".gstack/tmp/autoplan/run/plan-v2.md"), "\n## Implementation plan\n# Plan, amended twice\n");
      const t = tx([{ command: SCAFFOLD }, { command: wrap("$O/plan-v2.md") }]);
      const f = findRun(roots, t);
      expect(f.run?.seen).toBe(RUN + "/run.json");
      expect(gatePending(work, t)).toBe(true);
      expect(readExposure(f, 2)).toMatchObject({ run: RUN + "/run.json", status: "gate_pending", exposed: false });
      expect(armPlan(work, "# Plan\n", f.run)).toEqual({ text: "\n## Implementation plan\n# Plan, amended twice\n", from: "autoplan" });
      const atWork = WORK + "/plan-wrapped.md";
      put(work, WORK, RUN, body({ plan_input: atWork }));
      writeFileSync(join(work, "plan-wrapped.md"), "## Implementation plan\n# Plan, wrapped\n");
      const w = tx([{ command: SCAFFOLD }, { command: wrap(atWork) }]);
      expect(readExposure(findRun(roots, w), 2)).toMatchObject({ run: RUN + "/run.json", exposed: true, voice: "fallback" });
      expect(armPlan(work, "# Plan\n", findRun(roots, w).run)).toEqual({ text: "## Implementation plan\n# Plan, wrapped\n", from: "autoplan" });
    }));

  test("is still passed over outside the run folder and /work/app, without a start from /work/app/plan.md, or when anything but the session's own revise named it", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      const OTHER = WORK + "/.gstack/tmp/autoplan/other";
      const cases: [string, string, string][] = [
        ["a revise call naming a file outside the run folder and /work/app", "/tmp/plan-v2.md", tx([{ command: SCAFFOLD }, { command: wrap("/tmp/plan-v2.md") }])],
        ["a revise call through .. out of /work/app", "/work/plan-v2.md", tx([{ command: SCAFFOLD }, { command: wrap("/work/app/../plan-v2.md") }])],
        ["a run started from the wrapped file, not /work/app/plan.md", V2, tx([{ command: BIN + " next --out " + RUN + " --plan " + V2 + " --full" }, { command: wrap("$O/plan-v2.md") }])],
        ["a restart that names the file with next", V2, tx([{ command: SCAFFOLD }, { command: BIN + " next --out " + RUN + " --plan " + V2 }])],
        ["a copy with no revise call", V2, tx([{ command: SCAFFOLD }, { command: "cp /work/app/plan.md " + V2 }])],
        ["a revise call for another run folder", V2, tx([{ command: SCAFFOLD }, { command: wrap(V2, OTHER) }])],
        ["a revise call naming another file", V2, tx([{ command: SCAFFOLD }, { command: wrap("$O/plan-v3.md") }])],
      ];
      for (const [how, input, t] of cases) {
        put(work, WORK, RUN, body({ status: "gate_pending", plan_input: input }));
        const f = findRun(roots, t);
        expect([how, f.run]).toEqual([how, null]);
        expect([how, gatePending(work, t)]).toEqual([how, false]);
        expect(readExposure(f, 2).why).toContain(RUN + "/run.json");
      }
    }));
});

// Value: protects=the widened run-record rule against the advisory read's seven cases; fails_when=a run whose first planned start named another file counts after a later next names plan.md, a run folder replaced by a recursive copy or rsync counts, a plan_input reached through a symlink counts (inside or outside the tree), a revise or start through the sandbox's own GSTACK_STATE_ROOT is missed, a --plan=x token is read where gstack-autoplan reads the next separate --plan, or the live work-tree scan and the copied state-root scan disagree on a deep run; why_new=the cross-family advisory read of the widened rule, which built each case; seam=commandLog, findRun, gatePending and armPlan; no_claim=a start that failed before it wrote run.json, archive tools (tar, unzip), and a recursive copy into the run folder that leaves run.json alone, which is refused anyway
describe("the widened rule against the advisory read's cases", () => {
  const V2 = RUN + "/plan-v2.md";
  const REVISE = (plan: string, out = RUN) => BIN + " revise --out " + out + " --plan " + plan + " --incorporates r-d1";
  const setup = (dir: string, input: string) => {
    const work = join(dir, "work");
    put(work, WORK, RUN, body({ status: "gate_pending", plan_input: input }));
    writeFileSync(join(work, "plan.md"), "# Plan, amended\n");
    if (input.startsWith(WORK + "/") && !input.endsWith("alias.md") && !input.endsWith("linked.md")) {
      mkdirSync(join(work, input.slice(WORK.length), ".."), { recursive: true });
      writeFileSync(join(work, input.slice(WORK.length)), "## Implementation plan\n# Plan, amended\n");
    }
    return work;
  };

  test("a run whose first planned start named another file does not count after a later next names plan.md", () =>
    withDir((dir) => {
      const work = setup(dir, WORK + "/wrapped.md");
      const t = tx([{ command: BIN + " next --out " + RUN + " --plan /work/app/notes.md --full" }, { command: REVISE("/work/app/wrapped.md") }, { command: BIN + " next --out " + RUN + " --plan /work/app/plan.md" }]);
      expect(findRun([{ dir: work, seen: WORK }], t).run).toBeNull();
      expect(gatePending(work, t)).toBe(false);
      const planless = tx([{ command: BIN + " next --out " + RUN }, { command: SCAFFOLD }, { command: REVISE("/work/app/wrapped.md") }]);
      expect(findRun([{ dir: work, seen: WORK }], planless).run?.seen).toBe(RUN + "/run.json");
    }));

  test("a run folder replaced by a recursive copy or rsync does not count", () =>
    withDir((dir) => {
      const work = setup(dir, V2);
      for (const how of ["cp -r /work/app/save/. " + RUN + "/", "cp -a /work/app/save " + RUN, "rsync -a /work/app/save/ " + RUN + "/", "mv /work/app/save " + RUN]) {
        const t = tx([{ command: SCAFFOLD }, { command: REVISE("$O/plan-v2.md".replace("$O", RUN)) }, { command: how }]);
        expect([how, findRun([{ dir: work, seen: WORK }], t).run]).toEqual([how, null]);
      }
      const ok = tx([{ command: SCAFFOLD }, { command: "cp /work/app/plan.md " + RUN + "/" }, { command: REVISE(V2) }]);
      expect(findRun([{ dir: work, seen: WORK }], ok).run?.seen).toBe(RUN + "/run.json");
    }));

  test("a plan_input reached through a symlink does not count, inside the tree or out of it, and the build then reads plan.md", () =>
    withDir((dir) => {
      const outside = join(dir, "outside.md");
      writeFileSync(outside, "# Somewhere else\n");
      for (const [name, target] of [["linked.md", outside], ["alias.md", "wrapped.md"]] as const) {
        const input = WORK + "/" + name;
        const work = setup(dir, input);
        writeFileSync(join(work, "wrapped.md"), "## Implementation plan\n# Plan, wrapped\n");
        rmSync(join(work, name), { force: true });
        symlinkSync(target, join(work, name));
        const t = tx([{ command: SCAFFOLD }, { command: REVISE(input) }]);
        const f = findRun([{ dir: work, seen: WORK }], t);
        expect([name, f.run]).toEqual([name, null]);
        expect([name, gatePending(work, t)]).toEqual([name, false]);
        expect(armPlan(work, "# Plan\n", f.run)).toEqual({ text: "# Plan, amended\n", from: "plan.md" });
      }
    }));

  test("a start and a revise through the sandbox's GSTACK_STATE_ROOT are read, and a --plan=x token is skipped as gstack-autoplan skips it", () =>
    withDir((dir) => {
      const root = WORK + "/" + STATE_ROOT_DIR;
      const sr = root + "/runs/r1";
      const work = join(dir, "work");
      const state = join(dir, "gstack-state");
      for (const [d, seen] of [[work, WORK], [state, root]] as const) {
        put(d, seen, sr, body({ status: "gate_pending", out: sr, plan_input: sr + "/wrapped.md" }));
        writeFileSync(join(d, (sr + "/wrapped.md").slice(seen.length)), "## Implementation plan\n# Plan, amended\n");
      }
      const t = tx([{ command: BIN + ' next --out "$GSTACK_STATE_ROOT/runs/r1" --plan /work/app/plan.md --full' }, { command: BIN + ' revise --out "$GSTACK_STATE_ROOT/runs/r1" --plan "$GSTACK_STATE_ROOT/runs/r1/wrapped.md"' }]);
      expect(findRun([{ dir: work, seen: WORK }], t).run?.seen).toBe(sr + "/run.json");
      expect(findRun([{ dir: state, seen: root }], t).run?.seen).toBe(sr + "/run.json");
      expect(gatePending(work, t)).toBe(true);
      const w2 = setup(dir, WORK + "/wrapped.md");
      const eq = tx([{ command: SCAFFOLD }, { command: BIN + " revise --out " + RUN + " --plan=/work/app/old.md --plan /work/app/wrapped.md" }]);
      expect(findRun([{ dir: w2, seen: WORK }], eq).run?.seen).toBe(RUN + "/run.json");
    }));

  test("the live work-tree scan and the copied state-root scan agree on deep runs", () =>
    withDir((dir) => {
      const root = WORK + "/" + STATE_ROOT_DIR;
      const work = join(dir, "work");
      const state = join(dir, "gstack-state");
      for (const sub of ["a/b/c/d/e/f/g/run", "a/b/c/d/e/f/g/h/i/j/k/l/run"]) {
        const seen = root + "/" + sub;
        put(work, WORK, seen, body({ out: seen }));
        put(state, root, seen, body({ out: seen }));
        const t = tx([{ command: BIN + " next --out " + seen + " --plan " + PLAN + " --full" }]);
        const live = findRun([{ dir: work, seen: WORK }], t).run?.seen ?? null;
        const copied = findRun([{ dir: state, seen: root }], t).run?.seen ?? null;
        expect([sub, live]).toEqual([sub, copied]);
        rmSync(work, { recursive: true, force: true });
        rmSync(state, { recursive: true, force: true });
      }
      const shallow = root + "/a/b/c/d/e/f/g/run";
      put(work, WORK, shallow, body({ out: shallow }));
      expect(findRun([{ dir: work, seen: WORK }], tx([{ command: BIN + " next --out " + shallow + " --plan " + PLAN }])).run?.seen).toBe(shallow + "/run.json");
    }));
});

// Value: protects=the run-record rule against the shell shapes a session writes: wrapper commands, command substitution, default expansion, child shells, subshell and subagent cwd, and interpreter code that only reads the record; fails_when=a real call in one of these shapes is missed, a read-only command refuses the record, an edit through env, eval or a child shell is missed, a call that only asks for help counts, or a cd in a subshell or a subagent moves the main agent's folder; why_new=the cross-family advisory read of the rule, which reproduced each shape; seam=commandLog through findRun; no_claim=a full shell, so a write through a path the code builds at run time is not seen
describe("the command log's shell shapes", () => {
  const C = BIN + " next --out " + RUN + " --plan " + PLAN + " --full";
  test("finds a real call behind a wrapper, a substitution, a default expansion or a child shell, and keeps reads as reads", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, RUN, body());
      const found: Record<string, Call[]> = {
        command: [{ command: "command " + C }],
        "an env prefix": [{ command: "env GSTACK_SESSION_KIND=unattended " + C + " 2>&1 | tail -20" }],
        "a command substitution": [{ command: 'OUT="$(' + C + ' 2>&1)"; echo "$OUT" | tail -5' }],
        backticks: [{ command: "OUT=`" + C + "`; echo $OUT" }],
        "a default expansion": [{ command: "R=${R:-" + RUN + "}; " + BIN + ' next --out "$R" --plan ' + PLAN + " --full" }],
        "bash -c": [{ command: "bash -c '" + C + "'" }],
        "a subshell cd": [{ command: "(cd /tmp && ls); " + BIN + " next --out .gstack/tmp/autoplan/run --plan " + PLAN + " --full" }],
        "a subagent's cd": [{ command: "cd /tmp", parent: "agent1" }, { command: BIN + " next --out .gstack/tmp/autoplan/run --plan " + PLAN + " --full" }],
        "a python read": [{ command: C }, { command: "python3 -c \"import sys; sys.stdout.write(open('" + RUN + "/run.json').read())\"" }],
        "an escaped dollar": [{ command: 'X=' + RUN + '; echo "\\$X is not a path"; ' + C }],
      };
      for (const [how, calls] of Object.entries(found)) expect([how, findRun(roots, tx(calls)).run?.seen]).toEqual([how, RUN + "/run.json"]);
      const refused: Record<string, Call[]> = {
        "a help call": [{ command: BIN + " --help --out " + RUN + " --plan " + PLAN }],
        "env python": [{ command: C }, { command: "env python3 -c \"open('" + RUN + "/run.json','w').write('{}')\"" }],
        eval: [{ command: C }, { command: "eval 'echo {} > " + RUN + "/run.json'" }],
        "bash -c": [{ command: C }, { command: "bash -c 'printf {} > " + RUN + "/run.json'" }],
        "a python write through a variable": [{ command: C }, { command: "python3 -c \"import json; p='" + RUN + "/run.json'; f=open(p, mode='w'); f.write('{}')\"" }],
      };
      for (const [how, calls] of Object.entries(refused)) expect([how, findRun(roots, tx(calls)).run]).toEqual([how, null]);
    }));

  test("never follows a symlink in the work tree, so a loop does not stop the scan and the live and copied trees read alike", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, RUN, body({ status: "gate_pending" }));
      symlinkSync("loop", join(work, "loop"));
      symlinkSync(join(work, ".gstack/tmp/autoplan/run"), join(work, "alias"));
      const real = tx([{ command: BIN + " next --out " + RUN + " --plan " + PLAN + " --full" }]);
      expect(findRun(roots, real).run?.seen).toBe(RUN + "/run.json");
      expect(gatePending(work, real)).toBe(true);
      const viaAlias = tx([{ command: BIN + " next --out " + WORK + "/alias --plan " + PLAN + " --full" }]);
      expect(findRun(roots, viaAlias).run).toBeNull();
      expect(gatePending(work, viaAlias)).toBe(false);
    }));

  test("a here-string, a heredoc inside a substitution or an arithmetic shift does not hide a call on a later line", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, RUN, body({ status: "gate_pending" }));
      const before: Record<string, string> = {
        "a here-string": 'grep -q x <<< "$v"',
        "a heredoc inside a substitution": "NOTE=\"$(cat <<'EOF'\nthe owner's first task\nEOF\n)\"",
        "an arithmetic shift": "(( n <<= 1 ))",
      };
      for (const [how, first] of Object.entries(before)) {
        const calls = tx([{ command: first + "\n" + C }]);
        expect([how, findRun(roots, calls).run?.seen]).toEqual([how, RUN + "/run.json"]);
        expect([how, gatePending(work, calls)]).toEqual([how, true]);
      }
    }));
});

type Step = { command: string; at?: string; done?: string };
/** A transcript of Bash calls, each with the timestamp on the message that made it and on the one that returned its result; calls in one array share one message. */
const txt = (steps: (Step | Step[])[]) => {
  let n = 0;
  return steps
    .map((s) => {
      const group = Array.isArray(s) ? s : [s];
      const ids = group.map(() => "s" + n++);
      const made = JSON.stringify({ type: "assistant", ...(group[0]!.at ? { timestamp: group[0]!.at } : {}), message: { content: group.map((c, i) => ({ type: "tool_use", id: ids[i], name: "Bash", input: { command: c.command } })) } }) + "\n";
      return made + group.map((c, i) => (c.done === undefined ? "" : JSON.stringify({ type: "user", timestamp: c.done, message: { content: [{ type: "tool_result", tool_use_id: ids[i], content: "" }] } }) + "\n")).join("");
    })
    .join("");
};

// Value: protects=the run-record rule's start match (rep 4 of the smoke and two advisory reads): a start call whose --out the command log cannot spell out (a command substitution, a variable from another shell) is tied to the run whose run.json created_at lies inside that call's own Bash call, by the transcript's timestamps, when no other start call spans that time and no other run was created in it; the live gate check reads the same record; every start call that is for no record that counts is counted; fails_when=a run started from --out "$RUN" with RUN=...$(date ...) is passed over, a run created before the call, by one of two start calls or beside another run is tied to it, another run's log printed in the same Bash call decides the record, or a start whose record is refused is not counted
describe("a start call's run, from when gstack-autoplan created it", () => {
  const MAIN = WORK + "/.gstack/tmp/autoplan/main-20261118-054759";
  const OLD = WORK + "/.gstack/tmp/autoplan/main-20261117-230000";
  const AT = "2026-11-18T05:47:59.115Z";
  const MADE = "2026-11-18T05:47:59.300Z";
  const DONE = "2026-11-18T05:47:59.453Z";
  const pending = (folder: string, o: Record<string, unknown> = {}) => body({ status: "gate_pending", out: folder, active_plan: folder + "/plan-active.md", created_at: MADE, updated_at: "2026-11-18T06:00:00Z", ...o });
  const start = "cd /work/app; RUN=.gstack/tmp/autoplan/main-$(date +%Y%m%d-%H%M%S); " + BIN + ' next --out "$RUN" --plan /work/app/plan.md --full 2>&1';

  test("a run whose --out the log cannot spell out is found from the start call it was created in, and the live gate check reads it", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, MAIN, pending(MAIN));
      const forms: [string, Step[]][] = [
        ["a substitution in a variable", [{ command: "cd /work/app; RUN=.gstack/tmp/autoplan/main-$(date +%Y%m%d-%H%M%S); mkdir -p .gstack/tmp/autoplan && chmod 700 .gstack/tmp/autoplan; echo RUN=$RUN; " + BIN + ' next --out "$RUN" --plan /work/app/plan.md --full 2>&1', at: AT, done: DONE }]],
        ["a substitution inside --out", [{ command: "mkdir -p .gstack/tmp && R=$(date +%Y%m%d-%H%M%S) && " + BIN + " next --out /work/app/.gstack/tmp/autoplan/main-$R --plan /work/app/plan.md --full 2>&1", at: AT, done: DONE }]],
        ["backticks", [{ command: "cd /work/app; " + BIN + " next --out .gstack/tmp/autoplan/main-`date +%Y%m%d-%H%M%S` --plan plan.md --full", at: AT, done: DONE }]],
        ["a variable another shell set", [{ command: "RUN=.gstack/tmp/autoplan/main-20261118-054759; echo $RUN", at: "2026-11-18T05:47:50.000Z", done: "2026-11-18T05:47:50.100Z" }, { command: "cd /work/app; " + BIN + ' next --out "$RUN" --plan /work/app/plan.md --full 2>&1', at: AT, done: DONE }]],
        ["output thrown away", [{ command: start + " > /dev/null", at: AT, done: DONE }]],
        ["a child shell's heredoc, piped", [{ command: "cd /work/app; bash <<'SH' 2>&1 | tail -40\nRUN=.gstack/tmp/autoplan/main-$(date +%s)\n" + BIN + ' next --out "$RUN" --plan /work/app/plan.md --full\nSH', at: AT, done: DONE }]],
      ];
      for (const [name, steps] of forms) {
        const t = txt(steps);
        const f = findRun(roots, t);
        expect([name, f.run?.seen, f.unmatched]).toEqual([name, MAIN + "/run.json", 0]);
        expect([name, gatePending(work, t)]).toEqual([name, true]);
        expect([name, readExposure(f, 1).unmatched]).toEqual([name, 0]);
      }
    }));

  test("a run created outside the call, by one of two start calls, beside another run or with no times on record is not tied to it", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, MAIN, pending(MAIN));
      const cases: [string, (Step | Step[])[]][] = [
        ["created before the call", [{ command: start + "; tail -20 /tmp/main-old.log", at: "2026-11-18T05:48:10.000Z", done: "2026-11-18T05:48:10.400Z" }]],
        ["created after the call returned", [{ command: start, at: "2026-11-18T05:47:58.000Z", done: "2026-11-18T05:47:59.200Z" }]],
        ["two start calls in one Bash call", [{ command: start + "; " + BIN + ' next --out "$RUN-b" --plan /work/app/plan.md', at: AT, done: DONE }]],
        ["two start calls running at once", [[{ command: start, at: AT, done: DONE }, { command: "cd /work/app; R=$(date +%s); " + BIN + " next --out .gstack/tmp/autoplan/x-$R --plan /work/app/plan.md", done: DONE }]]],
        ["another plan file", [{ command: "cd /work/app; RUN=.gstack/tmp/autoplan/main-$(date +%s); " + BIN + ' next --out "$RUN" --plan /work/app/notes.md --full', at: AT, done: DONE }]],
        ["no times on record", [{ command: start }]],
      ];
      for (const [name, steps] of cases) {
        const t = txt(steps);
        expect([name, findRun(roots, t).run]).toEqual([name, null]);
        expect([name, gatePending(work, t)]).toEqual([name, false]);
      }
      const edited = txt([{ command: start, at: AT, done: DONE }]) + tx([{ name: "Write", input: { file_path: MAIN + "/run.json", content: "{}" } }]);
      expect(findRun(roots, edited).run).toBeNull();
      expect(findRun(roots, edited).passed.join(" ")).toContain("edited by hand");
      put(work, WORK, MAIN + "-b", pending(MAIN + "-b"));
      expect(findRun(roots, txt([{ command: start, at: AT, done: DONE }])).run).toBeNull();
    }));

  test("an older run's log printed beside a new start does not decide the record", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, OLD, body({ out: OLD, created_at: "2026-11-17T23:00:00.300Z", updated_at: "2026-11-17T23:40:00Z" }));
      put(work, WORK, MAIN, pending(MAIN));
      const t = txt([
        { command: "cd /work/app; " + BIN + " next --out .gstack/tmp/autoplan/main-20261117-230000 --plan plan.md --full", at: "2026-11-17T23:00:00.100Z", done: "2026-11-17T23:00:00.500Z" },
        { command: "cd /work/app; R=$(date +%Y%m%d-%H%M%S); " + BIN + ' next --out ".gstack/tmp/autoplan/main-$R" --plan plan.md > "/tmp/main-$R.log" 2>&1; tail -20 /tmp/main-old.log', at: AT, done: DONE },
      ]);
      const f = findRun(roots, t);
      expect([f.run?.seen, f.unmatched]).toEqual([MAIN + "/run.json", 0]);
      expect(gatePending(work, t)).toBe(true);
    }));

  test("every start call that is for no record that counts is counted", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, MAIN, pending(MAIN));
      const found: Step = { command: start, at: AT, done: DONE };
      const lost: Step = { command: "cd /work/app; " + BIN + " next --out .gstack/tmp/autoplan/gone --plan /work/app/plan.md --full", at: "2026-11-18T05:40:00.000Z", done: "2026-11-18T05:40:00.300Z" };
      const empty: Step = { command: start, at: "2026-11-18T05:50:00.000Z", done: "2026-11-18T05:50:00.300Z" };
      expect(findRun(roots, txt([lost, found])).unmatched).toBe(1);
      expect(findRun(roots, txt([found, empty])).unmatched).toBe(1);
      expect(findRun(roots, txt([found, { command: "cd /work/app; " + BIN + " next --out " + MAIN }])).unmatched).toBe(0);
      const wrong = findRun(roots, txt([{ command: "cd /work/app; " + BIN + " next --out " + MAIN + " --plan /work/app/notes.md", at: AT, done: DONE }]));
      expect([wrong.run, wrong.unmatched]).toEqual([null, 1]);
      expect(readExposure(wrong, 0).unmatched).toBe(1);
      expect(findRun(roots, tx([{ command: SCAFFOLD }])).unmatched).toBe(1);
    }));

  test("a syntax check of a child shell runs nothing, and $PWD follows cd", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, MAIN, pending(MAIN));
      const made: Step = { command: start, at: AT, done: DONE };
      const checked = txt([made, { command: "cd /work/app; bash -n <<'SH'\ncp -R artifacts .gstack/tmp/autoplan\n" + BIN + " next --out .gstack/tmp/autoplan/y --plan plan.md\nSH" }]);
      expect([findRun(roots, checked).run?.seen, findRun(roots, checked).unmatched]).toEqual([MAIN + "/run.json", 0]);
      const moved = txt([made, { command: "cd " + MAIN + "; cd /work/app/scratch; printf '%s\\n' '{}' > \"$PWD/run.json\"" }]);
      expect(findRun(roots, moved).run?.seen).toBe(MAIN + "/run.json");
      const pwd = txt([{ command: "cd /work/app; " + BIN + ' next --out "$PWD/.gstack/tmp/autoplan/main-20261118-054759" --plan "$PWD/plan.md" --full' }]);
      expect(findRun(roots, pwd).run?.seen).toBe(MAIN + "/run.json");
    }));
});

// Value: protects=the completion condition (pin change, section 11): a gstack session is exposed when every applicable phase closed and its run is complete or waits at its final gate, the gate gstack wrote after the run's last phase closed, and the frozen reading (complete only) is kept beside it; fails_when=a run waiting at its final gate reads unexposed, a run waiting for an amendment, back in review after a gate, waiting with a phase open or with a phase closed after its gate, or with no matched run reads exposed, or the frozen reading counts a waiting run
describe("where the run stands when the session ends", () => {
  const ORDER = ["ceo", "design", "dx", "eng"];
  const shut = (t: string) => ({ closed_at: "2026-11-17T18:" + t + ":00Z", native: { status: "completed" }, outside: { status: "completed" } });
  const phases = { ceo: shut("10"), design: shut("15"), dx: shut("20"), eng: shut("30") };
  const waiting = (o: Record<string, unknown> = {}) => body({ status: "gate_pending", gate_rev: 3, gate: { rev: 3, items: 62, written_at: "2026-11-17T18:40:00Z" }, phase_order: ORDER, phases, ...o });
  const read = (b: object | null) => {
    let r: ReturnType<typeof readExposure> | undefined;
    withDir((dir) => {
      const work = join(dir, "work");
      mkdirSync(work, { recursive: true });
      if (b) put(work, WORK, RUN, b);
      r = readExposure(findRun([{ dir: work, seen: WORK }], tx([{ command: SCAFFOLD }])), 2);
    });
    return r!;
  };

  test("a complete run and a run waiting at its final gate are exposed; only the complete one under the frozen reading", () => {
    expect(read(body({ gate_rev: 3, gate: { rev: 3, written_at: "2026-11-17T18:40:00Z", answered_at: "2026-11-17T18:45:00Z", plan: "b" }, phase_order: ORDER, phases }))).toMatchObject({ exposed: true, final_gate: false, exposed_frozen: true });
    const final = read(waiting());
    expect(final).toMatchObject({ exposed: true, final_gate: true, exposed_frozen: false });
    expect(final.why).toContain("final gate");
    expect(final.voice).toBe("astra");
    expect(read(waiting({ phases: { ...phases, design: { skipped: "no UI scope" } } }))).toMatchObject({ exposed: true, final_gate: true, exposed_frozen: false });
    expect(read(waiting({ phases: { ...phases, eng: { ...shut("30"), closed_at: "2026-11-17T18:40:00Z" } } }))).toMatchObject({ exposed: true, final_gate: true });
  });

  test("a run waiting for an amendment, back in review after a gate, with a phase open, at a gate older than a phase's close, or never matched is not exposed", () => {
    const cases: Record<string, object | null> = {
      "waiting at an amend gate": waiting({ status: "amend_pending", amendments: [{ decision: "r-g3-d1", status: "pending", gate_rev: 3 }] }),
      "back in review after a gate": waiting({ status: "awaiting_result", phases: { ...phases, eng: { opened_at: "2026-11-17T18:45:00Z", native: { status: "dispatched" }, outside: { status: "dispatched" } } } }),
      "a phase the frozen read skips left open": waiting({ phases: { ...phases, dx: { opened_at: "2026-11-17T18:16:00Z", native: { status: "completed" }, outside: { status: "completed" } } } }),
      "eng left open": waiting({ phases: { ...phases, eng: { opened_at: "2026-11-17T18:25:00Z", native: { status: "completed" }, outside: { status: "completed" } } } }),
      "a phase in the order with no record": waiting({ phases: { ceo: shut("10"), design: shut("15"), eng: shut("30") } }),
      "a phase closed after the gate was written": waiting({ phases: { ...phases, eng: shut("50") } }),
      "a gate with no written time": waiting({ gate: { rev: 3, items: 62 } }),
      "no matched run": null,
    };
    for (const [name, b] of Object.entries(cases)) {
      const r = read(b);
      expect([name, r.exposed, r.final_gate, r.exposed_frozen]).toEqual([name, false, false, false]);
    }
    expect(read(cases["waiting at an amend gate"]!).why).toContain("amend_pending");
  });
});


// Value: protects=the run-record rule's command log against the shell forms the day-one results review left open (an EOF) line closing a heredoc inside $( ), a call inside (( )), a call inside a here-string, a "$PWD/plan.md" path in a Bash call that never ran cd, a recursive copy into /work/app made before the run existed, a background start, the parenless function form, and a quadratic scan of long inline code); fails_when=any of those forms hides a real start, or a copy made after the start, or one whose copied record predates it, counts; why_new=the day-one results PR's review rounds, which found each form and left it to this follow-up; seam=commandLog, findRun and gatePending; no_claim=forms no review named, and gstack-autoplan's own run.json writer
describe("the shell forms the results review left open", () => {
  const MAIN = WORK + "/.gstack/tmp/autoplan/main-20261118-054759";
  const AT = "2026-11-18T05:47:59.115Z";
  const MADE = "2026-11-18T05:47:59.300Z";
  const DONE = "2026-11-18T05:47:59.453Z";
  const pending = (folder: string, o: Record<string, unknown> = {}) => body({ status: "gate_pending", out: folder, active_plan: folder + "/plan-active.md", created_at: MADE, updated_at: "2026-11-18T06:00:00Z", ...o });
  const C = BIN + " next --out " + RUN + " --plan " + PLAN + " --full";
  const hidden = (work: string, t: string, name: string) => {
    expect([name, findRun([{ dir: work, seen: WORK }], t).run?.seen]).toEqual([name, RUN + "/run.json"]);
    expect([name, gatePending(work, t)]).toEqual([name, true]);
  };

  test("a call after an EOF) line, inside (( )) or inside a here-string is read", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      put(work, WORK, RUN, body({ status: "gate_pending" }));
      const forms: Record<string, string> = {
        "an EOF) line closing a heredoc inside a substitution": "NOTE=\"$(cat <<'EOF'\nthe owner's first task\nEOF)\"\n" + C,
        "a call inside an arithmetic command": "(( $(" + C + " | wc -l) > 0 ))",
        "a call inside a here-string": 'grep -q gate <<< "$(' + C + ')"',
      };
      for (const [name, command] of Object.entries(forms)) hidden(work, tx([{ command }]), name);
    }));

  test("$PWD is the folder the Bash call starts in, with no cd in it", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      put(work, WORK, RUN, body({ status: "gate_pending" }));
      hidden(work, tx([{ command: BIN + ' next --out "$PWD/.gstack/tmp/autoplan/run" --plan "$PWD/plan.md" --full' }]), "a first call");
      hidden(work, tx([{ command: "cd /work/app/.gstack" }, { command: "cd /work/app" }, { command: BIN + ' next --out "$PWD/.gstack/tmp/autoplan/run" --plan "$PWD/plan.md" --full' }]), "after cd in earlier calls");
    }));

  test("a recursive copy into /work/app counts as a hand edit unless it came before the start and returned before the record was made", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, MAIN, pending(MAIN));
      const start = BIN + " next --out " + MAIN + " --plan /work/app/plan.md --full";
      const copy = "cp -r /work/app/template/. /work/app/";
      const before = txt([{ command: copy, at: "2026-11-18T05:47:50.000Z", done: "2026-11-18T05:47:50.200Z" }, { command: start, at: AT, done: DONE }]);
      expect(findRun(roots, before).run?.seen).toBe(MAIN + "/run.json");
      expect(gatePending(work, before)).toBe(true);
      const sameCall = txt([{ command: copy + " && " + start, at: AT, done: DONE }]);
      expect(findRun(roots, sameCall).run).toBeNull();
      const copiedIn = txt([{ command: "cp -r /tmp/r/. /work/app/ && " + start, at: "2026-11-18T05:47:59.000Z", done: DONE }]);
      expect(findRun(roots, copiedIn).run).toBeNull();
      const after = txt([{ command: start, at: AT, done: DONE }, { command: copy, at: "2026-11-18T05:48:10.000Z", done: "2026-11-18T05:48:10.200Z" }]);
      expect(findRun(roots, after).run).toBeNull();
      put(work, WORK, MAIN, pending(MAIN, { created_at: "2026-11-18T05:48:30.000Z" }));
      expect(findRun(roots, sameCall).run).toBeNull();
      put(work, WORK, MAIN, pending(MAIN, { created_at: "2026-11-17T23:00:00.000Z" }));
      expect(findRun(roots, before).run).toBeNull();
      expect(findRun(roots, tx([{ command: copy }, { command: start }])).run).toBeNull();
    }));

  test("a start run in the background is tied to the run it made until the next start begins", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, MAIN, pending(MAIN));
      const start = "cd /work/app; RUN=.gstack/tmp/autoplan/main-$(date +%Y%m%d-%H%M%S); " + BIN + ' next --out "$RUN" --plan /work/app/plan.md --full';
      const returned = "2026-11-18T05:47:59.200Z";
      const tool = (input: Record<string, unknown>) =>
        JSON.stringify({ type: "assistant", timestamp: AT, message: { content: [{ type: "tool_use", id: "bg", name: "Bash", input }] } }) + "\n" + JSON.stringify({ type: "user", timestamp: returned, message: { content: [{ type: "tool_result", tool_use_id: "bg", content: "" }] } }) + "\n" + JSON.stringify({ type: "assistant", timestamp: "2026-11-18T05:49:00.000Z", message: { content: [{ type: "text", text: "waiting on the gate" }] } }) + "\n";
      for (const [name, t] of [
        ["run_in_background", tool({ command: start, run_in_background: true })],
        ["a trailing &", tool({ command: start + " > /tmp/ap.log 2>&1 &" })],
      ] as const) {
        const f = findRun(roots, t);
        expect([name, f.run?.seen, f.unmatched]).toEqual([name, MAIN + "/run.json", 0]);
        expect([name, gatePending(work, t)]).toEqual([name, true]);
      }
      expect(findRun(roots, tool({ command: start })).run).toBeNull();
      put(work, WORK, MAIN, pending(MAIN, { created_at: "not a time" }));
      expect(findRun(roots, tool({ command: start, run_in_background: true })).run).toBeNull();
      put(work, WORK, MAIN, pending(MAIN));
      const later = tool({ command: start, run_in_background: true }) + txt([{ command: "cd /work/app; " + BIN + " next --out .gstack/tmp/autoplan/other --plan /work/app/plan.md", at: "2026-11-18T05:47:59.250Z", done: "2026-11-18T05:47:59.260Z" }]);
      expect(findRun(roots, later).run).toBeNull();
    }));

  test("a trailing & backgrounds every command it ends, and a background window closes at the transcript's last timestamp", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, MAIN, pending(MAIN));
      const pre = "cd /work/app; RUN=.gstack/tmp/autoplan/main-$(date +%Y%m%d-%H%M%S); ";
      const start = BIN + ' next --out "$RUN" --plan /work/app/plan.md --full';
      const call = (command: string) => txt([{ command, at: AT, done: "2026-11-18T05:47:59.200Z" }, { command: "true", at: "2026-11-18T05:49:00.000Z" }]);
      for (const [name, command] of [
        ["a pipeline", pre + start + " | tee /tmp/ap.log &"],
        ["a subshell", pre + "( " + start + " ) &"],
        ["a group", pre + "{ " + start + "; } &"],
        ["an && list", pre + start + " && echo ok &"],
      ] as const) {
        const f = findRun(roots, call(command));
        expect([name, f.run?.seen, f.unmatched]).toEqual([name, MAIN + "/run.json", 0]);
      }
      expect(findRun(roots, call(pre + "( " + start + " ); echo ok &")).run).toBeNull();
      put(work, WORK, MAIN, pending(MAIN, { created_at: "2027-01-01T00:00:00.000Z" }));
      expect(findRun(roots, call(pre + start + " &")).run).toBeNull();
    }));

  test("a recursive copy is excused only when it ran in the foreground, in an earlier Bash call, before a foreground start", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      const roots: RunRoot[] = [{ dir: work, seen: WORK }];
      put(work, WORK, MAIN, pending(MAIN));
      const start = BIN + " next --out " + MAIN + " --plan /work/app/plan.md --full";
      const copy = "cp -r /tmp/r/. /work/app/";
      const at = (command: string) => ({ command, at: "2026-11-18T05:47:50.000Z", done: "2026-11-18T05:47:50.010Z" });
      const later = { command: "true", at: "2026-11-18T05:49:00.000Z" };
      expect(findRun(roots, txt([at(copy), { command: start, at: AT, done: DONE }, later])).run?.seen).toBe(MAIN + "/run.json");
      expect(findRun(roots, txt([at(copy + " &"), { command: start, at: AT, done: DONE }, later])).run).toBeNull();
      const bgCopy = JSON.stringify({ type: "assistant", timestamp: "2026-11-18T05:47:50.000Z", message: { content: [{ type: "tool_use", id: "c", name: "Bash", input: { command: copy, run_in_background: true } }] } }) + "\n" + JSON.stringify({ type: "user", timestamp: "2026-11-18T05:47:50.010Z", message: { content: [{ type: "tool_result", tool_use_id: "c", content: "" }] } }) + "\n";
      expect(findRun(roots, bgCopy + txt([{ command: start, at: AT, done: DONE }, later])).run).toBeNull();
      expect(findRun(roots, txt([at(copy), { command: start + " &", at: AT, done: "2026-11-18T05:47:59.200Z" }, later])).run).toBeNull();
      expect(findRun(roots, txt([{ command: copy + " & " + start + " &", at: AT, done: "2026-11-18T05:47:59.200Z" }, later])).run).toBeNull();
    }));

  test("a function body is read only where the function is called", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      put(work, WORK, RUN, body({ status: "gate_pending" }));
      for (const [name, command] of [
        ["function NAME { } never called", "function plan { " + C + "; }"],
        ["NAME() { } never called", "plan() { " + C + "; }"],
        ["NAME() { } with another command called", "plan() { " + C + "; }; plans"],
      ] as const) {
        const t = tx([{ command }]);
        expect([name, findRun([{ dir: work, seen: WORK }], t).run]).toEqual([name, null]);
        expect([name, gatePending(work, t)]).toEqual([name, false]);
      }
      hidden(work, tx([{ command: "plan() { " + C + "; }\nplan" }]), "NAME() { } then called");
      hidden(work, tx([{ command: "plan() {\n  " + C + "\n}\necho first; plan" }]), "a multi-line NAME() { } called later");
    }));

  test("a call inside a parenless function body is read", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      put(work, WORK, RUN, body({ status: "gate_pending" }));
      hidden(work, tx([{ command: "function plan { " + C + "; }; plan" }]), "function NAME { }");
      hidden(work, tx([{ command: "function plan() { " + C + "; }\nplan" }]), "function NAME() { }");
    }));

  test("a long run of inline code is read in linear time", () =>
    withDir((dir) => {
      const work = join(dir, "work");
      put(work, WORK, RUN, body({ status: "gate_pending" }));
      const t = tx([{ command: C }, { command: "python3 -c 'x = \"" + "a".repeat(200_000) + "\"; print(len(x))'" }]);
      const from = performance.now();
      expect(findRun([{ dir: work, seen: WORK }], t).run?.seen).toBe(RUN + "/run.json");
      expect(performance.now() - from).toBeLessThan(1000);
      const named = tx([{ command: C }, { command: "python3 -c 'open(\"" + RUN + "/run.json\", \"w\").write(\"{}\")'" }]);
      expect(findRun([{ dir: work, seen: WORK }], named).run).toBeNull();
    }));
});
