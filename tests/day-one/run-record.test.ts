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
});
