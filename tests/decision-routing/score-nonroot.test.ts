// Copyright (c) 2026 Garry Tan. MIT License.
// Agent commands the non-root fix can make fail (score/nonroot.ts): a pip install that failed, a write under ~/.cache that
// failed, a git config --global that failed, and any sudo, read from each session's trajectory (command, output, exit
// code). Counted per model and cell, with a flag for a cell where more than 10% of sessions hit one kind and the gap
// between cells per kind; a reading for the Captain, printed by admit and score, never a verdict or a stop code.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main as admit } from "../../lanes/decision-routing/score/admit-cli.ts";
import { commandRuns, hitKinds, nonrootReading, printNonroot } from "../../lanes/decision-routing/score/nonroot.ts";

const DENIED = "error: [Errno 13] Permission denied: '/usr/local/lib/python3.11/site-packages/foo'";
const CASES: Array<[string, string, string, number, string[]]> = [
  ["pip install denied counts", "pip install foo", DENIED, 1, ["pip_install"]],
  ["python -m pip install that fails counts", "python -m pip install -e .", "ERROR: Could not install packages", 1, ["pip_install"]],
  ["pip install that succeeds does not count", "pip install foo", "Successfully installed foo-1.0", 0, []],
  ["~/.cache write denied counts", "mkdir -p ~/.cache/x", "mkdir: cannot create directory '/root/.cache/x': Permission denied", 1, ["cache_write"]],
  ["~/.cache write that works does not count", "mkdir -p ~/.cache/x", "", 0, []],
  ["git config --global denied counts", "git config --global user.email a@b.c", "error: could not lock config file /root/.gitconfig: Permission denied", 255, ["git_global"]],
  ["git config --global that works does not count", "git config --global user.email a@b.c", "", 0, []],
  ["local git config failing does not count", "git config user.email a@b.c", "error: could not lock config file .git/config: Permission denied", 255, []],
  ["any sudo counts, even one that works", "sudo apt-get install -y jq", "jq is already the newest version", 0, ["sudo"]],
  ["sudo after && counts", "cd /testbed && sudo pip install foo", DENIED, 1, ["pip_install", "sudo"]],
  ["a word containing sudo does not count", "echo pseudocode", "pseudocode", 0, []],
  ["permission denied elsewhere is not one of the four", "cat /etc/shadow", "cat: /etc/shadow: Permission denied", 1, []],
];

for (const [name, command, output, returncode, kinds] of CASES) {
  test("table: " + name, () => {
    expect([...hitKinds({ command, output, returncode })].sort() as string[]).toEqual(kinds);
  });
}

const traj = (runs: Array<[string, string, number]>) => ({
  messages: [
    { role: "system", content: "s" },
    ...runs.flatMap(([command, output, returncode], i) => [
      { role: "assistant", content: "", extra: { actions: [{ command, tool_call_id: "c" + i }] } },
      { role: "tool", tool_call_id: "c" + i, content: "<output>", extra: { raw_output: output, returncode } },
    ]),
  ],
});

test("commandRuns pairs each action with its observation's output and exit code", () => {
  expect(commandRuns(traj([["ls", "a", 0], ["pip install x", DENIED, 1]]))).toEqual([
    { command: "ls", output: "a", returncode: 0 },
    { command: "pip install x", output: DENIED, returncode: 1 },
  ]);
});

function trial(root: string, name: string, model: string, cell: string, runs: Array<[string, string, number]>) {
  const dr = join(root, name, "agent", "dr");
  mkdirSync(dr, { recursive: true });
  writeFileSync(join(root, name, "result.json"), JSON.stringify({ task_name: "owner__repo-" + name.split("__")[0]!.slice(1) }));
  writeFileSync(join(dr, "dr-summary.json"), JSON.stringify({ session: name, model, cell, exit_status: "submitted", session_ms: 1 }));
  writeFileSync(join(dr, "meter.json"), JSON.stringify({ meter_id: "m-" + name }));
  writeFileSync(join(dr, "trajectory.json"), JSON.stringify(traj(runs)));
  return join(root, name);
}

test("per model and cell counts, the over-10% flag and the gap between cells", () => {
  const root = mkdtempSync(join(tmpdir(), "dr-nonroot-"));
  try {
    const dirs = [
      trial(root, "t1__N", "opus", "N", [["pip install x", DENIED, 1]]),
      ...Array.from({ length: 9 }, (_, i) => trial(root, "t" + (i + 2) + "__N", "opus", "N", [["ls", "", 0]])),
      ...Array.from({ length: 10 }, (_, i) => trial(root, "t" + (i + 1) + "__R", "opus", "R", i < 3 ? [["pip install x", DENIED, 1], ["sudo ls", "", 0]] : [["ls", "", 0]])),
    ];
    const r = nonrootReading(dirs);
    expect(r.rows).toEqual([
      { model: "opus", cell: "N", sessions: 10, pip_install: 1, cache_write: 0, git_global: 0, sudo: 0 },
      { model: "opus", cell: "R", sessions: 10, pip_install: 3, cache_write: 0, git_global: 0, sudo: 3 },
    ]);
    expect(r.over_10pct).toEqual([{ model: "opus", cell: "R", kind: "pip_install", rate: 0.3 }, { model: "opus", cell: "R", kind: "sudo", rate: 0.3 }]);
    expect(r.gaps.find((g) => g.model === "opus" && g.kind === "pip_install")).toEqual({ model: "opus", kind: "pip_install", gap: 0.2, high: "R", low: "N" });
    const text = printNonroot(r).join("\n");
    expect(text).toContain("opus R: 10 sessions, pip install failed 3, ~/.cache write failed 0, git config --global failed 0, sudo 3");
    expect(text).toContain("more than 10% of sessions hit one kind: opus R pip_install 30.0%; opus R sudo 30.0%");
    expect(text).toContain("opus pip_install 20.0% (R over N); opus cache_write 0.0%;");
    expect(text).not.toMatch(/DR_[A-Z_]+|STOP|verdict/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("admit prints the reading and writes it into admission.json", async () => {
  const root = mkdtempSync(join(tmpdir(), "dr-nonroot-admit-"));
  try {
    trial(join(root, "cal"), "t1__N__opus", "opus", "N", [["git config --global user.name x", "error: could not lock config file /root/.gitconfig: Permission denied", 255]]);
    trial(join(root, "pil"), "t1__R__opus", "opus", "R", [["ls", "", 0]]);
    writeFileSync(join(root, "j.ndjson"), "");
    const out = join(root, "admission.json");
    const logs: string[] = [];
    const log = console.log;
    console.log = (s: string) => logs.push(s);
    try {
      await admit(["--calibration", join(root, "cal"), "--pilot", join(root, "pil"), "--journal", join(root, "j.ndjson"), "--prices", join(import.meta.dir, "../../lanes/decision-routing/config/prices.json"), "--out", out]);
    } finally {
      console.log = log;
    }
    expect(logs.join("\n")).toContain("opus N: 1 sessions, pip install failed 0, ~/.cache write failed 0, git config --global failed 1, sudo 0");
    expect(JSON.parse(readFileSync(out, "utf8")).nonroot.rows.map((x: any) => x.cell)).toEqual(["N", "R"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
