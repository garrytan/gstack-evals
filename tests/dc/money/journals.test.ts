// Copyright (c) 2026 Garry Tan. MIT License.
// Wiring item 6: the proxy journals a same-host relaunch reads. The dry-run cases drive the real service, proxies and
// journals end to end; these pin the scan's reasons for what stays unknown.
import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { journalCases } from "../../../lanes/design-constructed/money/dryrun-journals.ts";
import { appendLink, linksFile, settleFromJournals } from "../../../lanes/design-constructed/money/journals.ts";
import type { Sub } from "../../../lanes/design-constructed/money/types.ts";

const held = (id: string) => ({ id, reserveMicros: 1_000_000 }) as unknown as Sub;

describe("proxy journal recovery", () => {
  test("a torn link line is skipped, a sub with no link and one whose journal is gone stay unknown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-journals-test-"));
    try {
      const sessions = join(dir, "sessions");
      mkdirSync(sessions, { recursive: true });
      appendLink(sessions, { sub: "s-gone", item: "dc-stage1-opus", lease: "L1", meter: "m1", journal: join(sessions, "x", "journal.ndjson") });
      appendFileSync(linksFile(sessions), '{"sub":"s-torn","ite');
      const scan = await settleFromJournals({ controller: {} as never, local: {} as never, wal: {} as never, journalDir: dir, held: [held("s-gone"), held("s-torn")] });
      expect(scan.settled).toEqual([]);
      expect(Object.fromEntries(scan.unknown.map((u) => [u.sub, u.why]))).toEqual({ "s-gone": "its proxy journal could not be read", "s-torn": "no slot was linked to it" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const c of journalCases()) test(c.name, async () => expect(await c.check()).toBeNull(), 60_000);
});
