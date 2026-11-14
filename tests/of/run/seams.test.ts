// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the run area's dry-run seams: every pure seam passes through the area's real code, the tool seams pass on the real pinned CLI in their own process, and a container seam without Docker returns a SKIP line that is never a pass; fails_when=a frozen run rule stops holding on either side of its edge, or a SKIP reads as a pass; why_new=start rule 7's seams for the run area; seam=runSeams; no_claim=the container seams themselves, which need GSTACK_EVALS_DOCKER=1
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { runSeams } from "../../../lanes/office-hours-founder/run/seams.ts";
import { HAS_CLAUDE_CLI } from "../../adapters/harness.ts";

const REPO = join(import.meta.dir, "..", "..", "..");
const all = runSeams({});
const pure = all.filter((s) => !/^(tools|containment):/.test(s.name));

describe("pure seams", () => {
  for (const s of pure) test(s.name, async () => {
    const r = await s.run();
    expect(r.detail).toBeString();
    expect(r.ok).toBe(true);
  });
});

describe("container seams without Docker", () => {
  for (const s of all.filter((s) => s.name.startsWith("containment:"))) test(s.name + " is a SKIP, never a pass", async () => {
    const r = await s.run();
    expect(r.ok).toBe(false);
    expect(r.detail).toStartWith("SKIP");
  });
});

describe.skipIf(!HAS_CLAUDE_CLI)("tool seams on the real CLI", () => {
  test("both pass in their own process", () => {
    const code = 'import { runSeams } from "./lanes/office-hours-founder/run/seams.ts"; let bad = 0; for (const s of runSeams({}).filter((s) => s.name.startsWith("tools:"))) { const r = await s.run(); console.log((r.ok ? "PASS " : "FAIL ") + s.name + ": " + r.detail); if (!r.ok) bad++; } process.exit(bad);';
    const r = spawnSync(process.execPath, ["-e", code], { cwd: REPO, encoding: "utf8", timeout: 170_000 });
    expect(r.stdout.match(/^PASS /gm)?.length).toBe(2);
    expect(r.status).toBe(0);
  }, 180_000);
});
