// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { discordance, editsFile, roomCheck, s3Share, transferCheck, turnKind, turnsOf } from "../../lanes/decision-routing/score/admission.ts";

describe("room and transfer", () => {
  test("room is 15% to 90% inclusive", () => {
    expect(roomCheck(0.15).ok).toBe(true);
    expect(roomCheck(0.9).ok).toBe(true);
    expect(roomCheck(0.149).ok).toBe(false);
    expect(roomCheck(0.901).ok).toBe(false);
  });
  test("transfer needs Opus at 40% or more", () => {
    expect(transferCheck(0.4).ok).toBe(true);
    expect(transferCheck(0.39).ok).toBe(false);
  });
});

describe("the cut's ceiling, S3", () => {
  test.each([
    ["sed -i 's/a/b/' django/db/models.py", true],
    ["cat > /testbed/fix.py <<'EOF'\nprint(1)\nEOF", true],
    ["echo x >> setup.cfg", true],
    ["python - <<'EOF'\nopen('a.py','w').write('x')\nEOF", true],
    ["git apply /tmp/p.diff", true],
    ["tee a.py < b", true],
    ["mv a.py b.py", true],
    ["cat django/db/models.py", false],
    ["grep -rn foo . > /dev/null", false],
    ["python -m pytest tests/test_a.py 2>&1 | tail -20", false],
    ["ls -la", false],
  ])("editsFile(%p) is %p", (cmd, want) => expect(editsFile(cmd as string)).toBe(want as boolean));
  test("turn kinds", () => {
    expect(turnKind(["echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && git add -A && git diff --cached"])).toBe("submit");
    expect(turnKind(["python -m pytest tests/x.py"])).toBe("test");
    expect(turnKind(["grep -rn foo src"])).toBe("search");
    expect(turnKind(["cat a.py", "head b.py"])).toBe("read");
    expect(turnKind(["sed -i s/a/b/ a.py"])).toBe("edit");
  });
  test("share of dollars in turns that edit no file, with HOLDS ruled out under 80%", () => {
    const traj = { messages: [
      { role: "system", content: "x" },
      { role: "assistant", extra: { actions: [{ command: "grep -rn foo ." }] } },
      { role: "tool", content: "" },
      { role: "assistant", extra: { actions: [{ command: "sed -i s/a/b/ a.py" }, { command: "cat a.py" }] } },
      { role: "assistant", extra: { actions: [{ command: "python -m pytest" }] } },
    ] };
    const t = turnsOf(traj, [1, 1, 2]);
    expect(t.aligned).toBe(true);
    const s = s3Share(t.turns);
    expect(s.share).toBeCloseTo(0.75, 12);
    expect(s.by_kind.search).toBeCloseTo(0.25, 12);
    expect(s.by_kind.test).toBeCloseTo(0.5, 12);
    expect(s.holds_possible).toBe(false);
    expect(turnsOf(traj, [1, 1]).aligned).toBe(false);
    expect(s3Share([{ usd: 9, edits: false, kind: "read" }, { usd: 1, edits: true, kind: "edit" }]).holds_possible).toBe(true);
  });
});

describe("discordance admission, task bootstrap 80% upper bound", () => {
  const pairs = (discordant: number) => Array.from({ length: 40 }, (_, i) => ({ task: "t" + (i % 20), model: i < 20 ? "opus" : "sol", a: 1, b: i < discordant ? 0 : 1 }));
  test("no discordance admits", () => {
    const d = discordance(pairs(0));
    expect(d).toMatchObject({ d: 0, n_pairs: 40, n_tasks: 20, upper80: 0, admitted: true });
  });
  test("4 of 40 discordant: d = 0.10, upper bound inside 0.20, admitted", () => {
    const d = discordance(pairs(4));
    expect(d.d).toBeCloseTo(0.1, 12);
    expect(d.upper80).toBeGreaterThan(0.1);
    expect(d.upper80).toBeLessThanOrEqual(0.2);
    expect(d.admitted).toBe(true);
  });
  test("10 of 40 discordant: d = 0.25, kept out", () => {
    const d = discordance(pairs(10));
    expect(d.d).toBeCloseTo(0.25, 12);
    expect(d.admitted).toBe(false);
  });
  test("seed 20261112 and 10,000 draws by default, deterministic", () => {
    expect(discordance(pairs(6))).toEqual(discordance(pairs(6), { seed: 20261112, draws: 10000 }));
  });
});
