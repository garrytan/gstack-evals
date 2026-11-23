// Copyright (c) 2026 Garry Tan. MIT License.
// Pre-run change 3 (rule R113): the primary comparison is computed and printed only at the interim read, on exactly
// the first half, and at the final read, on exactly what that read's action calls for. ohr read interim prints only
// its action when it continues, refuses rows outside the half, and refuses a half that is not whole; ohr read decision
// and ohr read report refuse to read stage 2 without the interim read.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../../lanes/office-hours-rewrite/cli.ts";
import { PINS, ARMS } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { row } from "../../../lanes/office-hours-rewrite/read/seams.ts";
import { entryId, loadBriefs, makeManifest, manifestSha256, manifestText } from "../../../lanes/office-hours-rewrite/run/manifest.ts";
import { fixtureBriefs } from "../../../lanes/office-hours-rewrite/run/seams.ts";
import type { ManifestEntry, ScoredSession } from "../../../lanes/office-hours-rewrite/types.ts";

const briefs = fixtureBriefs();
const metas = new Map(loadBriefs(briefs).map((m) => [m.id, m]));
const first = makeManifest({ launch: "stage2", briefsDir: briefs, models: ["opus", "sol"], arms: [...ARMS], pins: PINS, buildCommit: "b", dropped: [], look: { part: "first" } });
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function launchDir(o: { entries?: readonly ManifestEntry[]; stops?: unknown[]; manifest?: string } = {}): string {
  const dir = tmp("ohr-look-launch-");
  writeFileSync(join(dir, "manifest.json"), o.manifest ?? manifestText(first));
  writeFileSync(join(dir, "rows.ndjson"), (o.entries ?? first.entries).map((e) => JSON.stringify({ id: entryId(e), launch: "stage2", row: { ...e, end: "block" }, why: "", attempts: [] })).join("\n") + "\n");
  writeFileSync(join(dir, "stops.json"), JSON.stringify({ stops: o.stops ?? [], unrun: [] }));
  return dir;
}
const scoredFile = (rows: ScoredSession[]) => {
  const p = join(tmp("ohr-look-scored-"), "scored.json");
  writeFileSync(p, JSON.stringify(rows));
  return p;
};
const scored = (e: ManifestEntry, R: (e: ManifestEntry) => 0 | 1 = () => 1) => {
  const m = metas.get(e.brief)!;
  return row({ ...e, kind: m.kind, cluster: m.cluster, set: "comparison", R: R(e), R2: R(e), R3: R(e) });
};
async function run(argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [], err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, {});
  return { code, out, err };
}
const interim = (scoredPath: string, dir: string) => {
  const out = join(tmp("ohr-look-out-"), "interim.json");
  return { out, argv: ["read", "interim", "--scored", scoredPath, "--launch", dir, "--out", out] };
};

describe("ohr read interim", () => {
  test("a read that continues prints its action and no number, and seals the read beside it", async () => {
    const i = interim(scoredFile(first.entries.map((e) => scored(e))), launchDir());
    const r = await run(i.argv);
    expect(r.code).toBe(0);
    expect(r.out.length).toBe(1);
    expect(r.out[0]).toStartWith("ohr read interim: continue");
    expect(r.out[0]).not.toMatch(/[0-9]/);
    const rec = JSON.parse(readFileSync(i.out, "utf8"));
    expect(rec.read.action).toBe("continue");
    expect(rec.part1_manifest_sha256).toBe(manifestSha256(first));
    expect(rec.half).toEqual(first.half);
  });
  test("a read that stops prints its numbers and says the estimate may be overstated", async () => {
    const R = (e: ManifestEntry) => (e.arm === "new" || metas.get(e.brief)!.kind === "builder" ? 1 : 0) as 0 | 1;
    const r = await run(interim(scoredFile(first.entries.map((e) => scored(e, R))), launchDir()).argv);
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toContain("stop-new");
    expect(r.out.join("\n")).toContain("possibly overstated");
  });
  test("a scored stage 2 row outside the half is refused", async () => {
    const outside = makeManifest({ launch: "stage2", briefsDir: briefs, models: ["opus", "sol"], arms: [...ARMS], pins: PINS, buildCommit: "b", dropped: [] }).entries.find((e) => !first.entries.some((f) => entryId(f) === entryId(e)))!;
    const r = await run(interim(scoredFile([...first.entries, outside].map((e) => scored(e))), launchDir()).argv);
    expect(r.code).not.toBe(0);
    expect(r.err.join("\n")).toStartWith("E_OHR_READ_INPUT");
  });
  test("a half with a session that has no row, or that ended on a cap stop, is refused", async () => {
    const short = await run(interim(scoredFile(first.entries.map((e) => scored(e))), launchDir({ entries: first.entries.slice(1) })).argv);
    expect(short.err.join("\n")).toStartWith("E_OHR_READ_INPUT");
    const capped = await run(interim(scoredFile(first.entries.map((e) => scored(e))), launchDir({ stops: [{ code: "CAP_STOP", message: "planted" }] })).argv);
    expect(capped.err.join("\n")).toStartWith("E_OHR_READ_INPUT");
  });
  test("a launch that is not stage 2's first part is refused", async () => {
    const whole = makeManifest({ launch: "stage2", briefsDir: briefs, models: ["opus", "sol"], arms: [...ARMS], pins: PINS, buildCommit: "b", dropped: [] });
    const r = await run(interim(scoredFile(whole.entries.map((e) => scored(e))), launchDir({ manifest: manifestText(whole), entries: whole.entries })).argv);
    expect(r.err.join("\n")).toStartWith("E_OHR_READ_INPUT");
  });
});

describe("the final reads", () => {
  const flags = (names: string[]) => names.flatMap((n) => [n, join(tmpdir(), "absent" + n.replace(/-/g, "_"))]);
  test("ohr read decision refuses stage 2 without the interim read", async () => {
    const r = await run(["read", "decision", ...flags(["--scored", "--admission", "--judge-check", "--hand-reads", "--launch", "--record", "--authoring", "--identity", "--out"])]);
    expect(r.code).toBe(2);
    expect(r.err.join("\n")).toContain("--interim");
  });
  test("ohr read report refuses stage 2 without the interim read", async () => {
    const r = await run(["read", "report", ...flags(["--scored", "--launch", "--out"])]);
    expect(r.code).toBe(2);
    expect(r.err.join("\n")).toContain("--interim");
  });
});
