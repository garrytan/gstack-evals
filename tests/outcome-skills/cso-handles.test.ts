// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 5's path normalization end to end: the pinned helper (gstack lib/cso at 5afef04) prints a redacted path as
// its handle "@cso-path//<32 hex>" in inspect's public manifest, with no pathId beside it. csoExposure records each printed
// handle under the unit's tree path whose id it carries, and the scorer resolves a cited handle through that record.
import { expect, test } from "bun:test";
import { csoExposure, HANDLE, pathId } from "../../lanes/outcome-skills/cso/exposure.ts";
import { citationGate, treeIndex } from "../../lanes/outcome-skills/cso/score/checks.ts";
import { normalizePath, normalizeText } from "../../lanes/outcome-skills/cso/score/text.ts";

const L = "~/.claude/skills/gstack/bin/gstack-cso-launcher";
const RUN = "1767225600000-0123456789abcdef";
const PINNED: Record<string, string> = {
  "src/a.ts": "@cso-path//86a77b4407366f3fe5640a77a305a6bf",
  "config/secrets/prod.env": "@cso-path//613263fe85be84650fb80c786d861b18",
  "app/routes/auth.py": "@cso-path//13cdea07d1682062530d3553ccb1fc7b",
};
const ROOT = "/var/lib/gstack/cso/runs/" + RUN + "/snapshot";
const inspectOut = JSON.stringify({
  report: { runId: RUN, source: { root: ROOT } },
  manifest: {
    version: 3, root: ROOT, originalHash: "a".repeat(64), executionHash: "b".repeat(64),
    entries: [
      { originalHash: "c".repeat(64), bytes: 40, mode: 420, path: "app/routes/auth.py" },
      { originalHash: "d".repeat(64), bytes: 22, mode: 420, path: "src/a.ts" },
      { originalHash: "e".repeat(64), bytes: 9, mode: 384, path: PINNED["config/secrets/prod.env"], displayPath: "config/secrets/[redacted]" },
    ],
  },
  sensitiveEvidence: [{ path: PINNED["config/secrets/prod.env"], displayPath: "config/secrets/[redacted]", findings: [{ id: "generic-secret", tier: "high", line: 1, col: 5 }] }],
}, null, 2);
const records = [
  { type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: L + " start --repo /work/repo" } }] },
  { type: "UserMessage", content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ schemaVersion: 3, runId: RUN, status: "running", source: { root: ROOT } }) }] },
  { type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: L + " inspect " + RUN } }] },
  { type: "UserMessage", content: [{ type: "tool_result", tool_use_id: "t2", content: inspectOut }] },
];
const TREE = treeIndex({ "app/routes/auth.py": "a\nb\nc\n", "src/a.ts": "x\n", "config/secrets/prod.env": "k\nv\n" });

test("our path id matches the pinned helper's snapshotPathId on three paths", () => {
  for (const [path, handle] of Object.entries(PINNED)) expect(HANDLE(pathId(path))).toBe(handle);
});

test("a pinned inspect output's handle round-trips to the tree path the scorer resolves", () => {
  const { helper } = csoExposure(records, [...TREE.files.keys()]);
  expect(helper).toEqual({ snapshot_root: ROOT, handles: { [PINNED["config/secrets/prod.env"]!]: "config/secrets/prod.env" } });
  const text = "Finding 1: " + PINNED["config/secrets/prod.env"] + ":2 holds a live key. Finding 2: " + ROOT + "/app/routes/auth.py:3 skips the check.";
  expect(normalizeText(text, helper)).toMatchObject({ text: "Finding 1: config/secrets/prod.env:2 holds a live key. Finding 2: app/routes/auth.py:3 skips the check.", snapshot_paths: 1, handles_resolved: [PINNED["config/secrets/prod.env"]], handles_unresolved: [] });
  expect(normalizePath(PINNED["config/secrets/prod.env"]!, helper)).toBe("config/secrets/prod.env");
  expect(citationGate({ texts: [text], helper }, TREE)).toEqual({ pass: true, snapshot_paths: 1, handles_resolved: 1, unresolved: [] });
});

test("a handle the helper never printed, or one naming no tree path, has no record and fails the gate", () => {
  const { helper } = csoExposure(records, ["src/a.ts"]);
  expect(helper.handles).toEqual({});
  const forged = "@cso-path//" + "f".repeat(32);
  const g = citationGate({ texts: [PINNED["config/secrets/prod.env"] + " and " + forged + " and " + PINNED["src/a.ts"]], helper }, TREE);
  expect(g.unresolved).toEqual([{ handle: PINNED["config/secrets/prod.env"]!, reason: "no record" }, { handle: forged, reason: "no record" }, { handle: PINNED["src/a.ts"]!, reason: "no record" }]);
});
