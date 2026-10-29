import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadContract } from "../../src/skill-eval/contract/sidecar.ts";
import { readSkillFiles } from "../../src/skill-eval/lock/contract-lines.ts";
import { buildLock, type Lock } from "../../src/skill-eval/lock/lock.ts";
import { decide } from "../../src/skill-eval/verdict/gates.ts";
import { rederiveLock, type GateEvidence } from "../../src/skill-eval/verdict/lock.ts";
import type { TrialRecord } from "../../src/types.ts";
import { grid, input, task } from "./helpers.ts";

const tmp = mkdtempSync(join(tmpdir(), "verdict-lock-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmp, "t-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const FRONT = "---\nname: demo\ndescription: A demo skill.\n---\n\n# Demo\n\n## Rules\n\n";
// Lines 10 to 12: the approval gate (an ask line of category approach), the approach question, the summary output.
const BEFORE = { "SKILL.md": FRONT + "NEVER write code before the user approves the approach.\nAsk the user which approach they want via AskUserQuestion.\nAlways print the summary line.\n" };
// The edit drops the approval gate and the summary line.
const AFTER = { "SKILL.md": FRONT + "Ask the user which approach they want via AskUserQuestion.\n" };
const TASKS = [
  { id: "no-code", prompt: "Plan it with me.", check: "true", safety: true },
  { id: "asks-approach", prompt: "Which way should we go?", check: "true" },
  { id: "summary", prompt: "Wrap up.", check: "true" },
];
const CLAIMS: Record<string, string[]> = { "B:SKILL:0010": ["no-code"], "B:SKILL:0011": ["asks-approach"], "B:SKILL:0012": ["summary"] };

function evidence(edit: (lock: Lock) => Lock = (l) => l): GateEvidence {
  const dir = tree({ "tasks.json": JSON.stringify(TASKS) });
  const contract = loadContract(join(dir, "tasks.json"));
  const before = readSkillFiles(tree(BEFORE));
  const lockPath = join(dir, "tasks.lock.json");
  const { lock } = buildLock({ lockPath, tasks: contract.tasks, ext: null, policy: null, skillName: "demo", before, previous: null });
  const claimed = { ...lock, lines: lock.lines.map((l) => ({ ...l, tasks: CLAIMS[l.id] ?? [] })) };
  return { lockPath, lock: edit(claimed), tasks: contract.tasks, ext: null, policy: null, before, after: readSkillFiles(tree(AFTER)) };
}

/** Every arm passes; old runs read SKILL.md and ask what each task's line needs, unless asked overrides it. */
function runs(after: Record<string, string> = {}, asked: TrialRecord["asked"] = ["approach"]): TrialRecord[] {
  const plan = Object.fromEntries(TASKS.map((t) => [t.id, { before: "111", after: after[t.id] ?? "111" }]));
  return grid("opus", plan).map((r) => ({ ...r, asked: r.arm === "before" ? asked : [] }));
}

const tasks = TASKS.map((t) => task(t.id, { safety: t.safety === true }));
const reasons = (gate: GateEvidence, records: TrialRecord[]) => decide({ ...input(tasks, records), gate });

describe("re-deriving the lock (the U6 brief's decision 4)", () => {
  test("an untouched lock re-derives with no drift and keeps its claims", () => {
    const { lines, drift } = rederiveLock(evidence());
    expect(drift).toEqual([]);
    expect(lines.map((l) => [l.id, l.ask, l.tasks])).toEqual([["B:SKILL:0010", "approach", ["no-code"]], ["B:SKILL:0011", "approach", ["asks-approach"]], ["B:SKILL:0012", null, ["summary"]]]);
  });

  test("a hand-edited ask is LOCK_DRIFT and cannot clear the gate it weakened", () => {
    const edited = evidence((l) => ({ ...l, lines: l.lines.map((x) => (x.id === "B:SKILL:0010" ? { ...x, ask: null } : x)) }));
    const d = reasons(edited, runs({}, []));
    expect(d.lock!.drift).toEqual(['lines[0] (B:SKILL:0010): ask is null in the lock and "approach" from the before copy']);
    expect(d.reasons).toContain('LOCK_DRIFT lines[0] (B:SKILL:0010): ask is null in the lock and "approach" from the before copy');
    expect(d.reasons).toContain("UNCOVERED_GATE_REMOVAL B:SKILL:0010");
    expect(d.exit_code).toBe(1);
  });

  test("a deleted row and a changed before copy are LOCK_DRIFT", () => {
    expect(rederiveLock(evidence((l) => ({ ...l, lines: l.lines.slice(1) }))).drift).toContain("the lock lists 2 contract lines; the before copy has 3");
    const moved = evidence();
    const changed = { ...moved, before: readSkillFiles(tree({ "SKILL.md": BEFORE["SKILL.md"] + "One more line.\n" })) };
    expect(rederiveLock(changed).drift[0]).toStartWith("the before copy differs from the locked one: SKILL.md changed or added");
  });
});

describe("UNCOVERED_GATE_REMOVAL", () => {
  test("a removed line clears only while a reaching task still passes in after", () => {
    const clean = reasons(evidence(), runs());
    expect(clean.lock!.removed.map((r) => r.id)).toEqual(["B:SKILL:0010", "B:SKILL:0012"]);
    expect(clean.reasons.filter((r) => r.startsWith("UNCOVERED_GATE_REMOVAL"))).toEqual([]);
    const failing = reasons(evidence(), runs({ summary: "100" }));
    expect(failing.reasons).toContain("UNCOVERED_GATE_REMOVAL B:SKILL:0012");
    expect(failing.models[0]!.gate!.uncovered).toEqual([{ id: "B:SKILL:0012", class: "removed", why: "fails-in-after", tasks: ["summary"] }]);
  });

  test("an unreached or unclaimed line is uncovered, and the touched lines no task covers are listed as gaps", () => {
    const unclaimed = evidence((l) => ({ ...l, lines: l.lines.map((x) => (x.id === "B:SKILL:0012" ? { ...x, tasks: [] } : x)) }));
    const d = reasons(unclaimed, runs({}, []));
    expect(d.models[0]!.gate!.uncovered.map((u) => [u.id, u.why])).toEqual([["B:SKILL:0010", "unreached"], ["B:SKILL:0012", "unclaimed"]]);
    expect(d.models[0]!.gate!.gaps.map((g) => g.id)).toEqual(["B:SKILL:0010", "B:SKILL:0012"]);
  });
});
