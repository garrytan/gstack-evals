// Copyright (c) 2026 Garry Tan. MIT License.
// The handover from the miner to authoring: dx handover reads a miner's --out and writes one folder per kept,
// screen-positive unit whose window has closed, as dx author reads it. A fake gh answers the base README and manifest
// reads over GraphQL; the tests check the files through author's own reader, ids minted at random that survive a rerun,
// the skips counted by reason, an in-repo or foreign --units refused, and the miner's own read of a positive unit.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openGitHub } from "../../../lanes/aftermath/gh.ts";
import { listUnits, loadUnit, run as authorRun } from "../../../lanes/devex/author/cli.ts";
import { triagePrompt } from "../../../lanes/devex/author/funnel.ts";
import { main as dx } from "../../../lanes/devex/cli.ts";
import { basePaths, run as handoverRun } from "../../../lanes/devex/mine/handover.ts";
import { screenRead, type WindowItem } from "../../../lanes/devex/mine/window.ts";
import { DX_UNIT_ID } from "../../../src/trial/review/devex.ts";

const ROOT = join(import.meta.dir, "../../..");
const dir = mkdtempSync(join(tmpdir(), "dx-handover-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SHA = "b".repeat(40);
const order = (n: number) => String(n).padStart(64, "0");
const drawn = (n: number, repo: string, to: string) => ({ id: repo + "#" + n, repo, number: n, order: order(n), merged_at: "2026-07-20T00:00:00Z", side: "dev", licence_field: "MIT", base: null, exposure: "2026-07-10T00:00:00Z", release: { kind: "release", tag: "v1", published_at: "2026-08-01T00:00:00Z", prerelease: false }, window: { from: "2026-08-01T00:00:00.000Z", to } });
const CLOSED = "2026-09-30T00:00:00.000Z", OPEN = "2026-12-30T00:00:00.000Z";
const cand = { ref: "issue 50", date: "2026-08-02T00:00:00Z", title: "zorbit export --json fails", association: "NONE", passage: "running zorbit export --json prints nothing", body: "running zorbit export --json prints nothing and exits 0" };

/** A miner --out with four kept units: two positive and closed, one negative, one whose window is open. */
function minerOut(): string {
  const out = mkdtempSync(join(dir, "miner-"));
  mkdirSync(join(out, "read"));
  const kept = [drawn(1, "quillcorp/zorbit", CLOSED), drawn(2, "quillcorp/zorbit", CLOSED), drawn(3, "other/thing", OPEN), drawn(4, "other/thing", CLOSED)];
  writeFileSync(join(out, "draws.json"), JSON.stringify({ kept, drops: {}, draws: 9, steps: [] }));
  const row = (n: number, positive: boolean) => JSON.stringify({ id: kept[n - 1]!.id, prerelease: false, identifiers: [{ token: "--json", df: 1 }], window_items: 3, candidates: positive ? [{ kind: "issue", number: 50, author_association: "NONE", sources: ["screen"] }] : [], positive });
  writeFileSync(join(out, "screen.jsonl"), [row(1, true), row(2, false), row(4, true)].join("\n") + "\n");
  for (const n of [1, 4]) {
    writeFileSync(join(out, "read", order(n) + ".json"), JSON.stringify({ id: kept[n - 1]!.id, source: "Adds --json to zorbit export. UNIT-" + n, base_sha: SHA, readme_path: "README.md", manifest_paths: ["package.json"], records: [{ ref: "issue 50", date: "2026-08-02T00:00:00Z", title: "zorbit export --json fails", body: cand.body }, { ref: "pr 51", date: "2026-08-03T00:00:00Z", title: "Speed up", body: null }], candidates: [cand] }));
  }
  return out;
}

const fakeGh = (log: string[]) =>
  openGitHub({
    floor: 0,
    tries: 1,
    backoffMs: () => 0,
    paceMs: 0,
    exec: (args, input) => {
      if (args[1] !== "graphql") return { status: 0, stdout: JSON.stringify({ resources: { graphql: { remaining: 5000, reset: 0 } } }), stderr: "" };
      const { query, variables } = JSON.parse(input ?? "{}");
      log.push(query);
      const repository: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(variables as Record<string, string>)) {
        if (!/^e\d+$/.test(k)) continue;
        const path = v.slice(v.indexOf(":") + 1);
        repository["f" + k.slice(1)] = { text: path === "README.md" ? "# Zorbit\nThe zorbit tool.\n" : JSON.stringify({ name: "zorbit-cli", bin: { zorb: "bin.js" } }), isBinary: false };
      }
      return { status: 0, stdout: JSON.stringify({ data: { repository, rateLimit: { cost: 1, remaining: 4999, resetAt: "2026-11-09T00:00:00Z" } } }), stderr: "" };
    },
  });

const sink = () => {
  const o = { out: [] as string[], err: [] as string[] };
  return { o, io: { out: (t: string) => void o.out.push(t), err: (t: string) => void o.err.push(t) } };
};
const NOW = "2026-11-09T00:00:00Z";
const idsOf = (units: string) => JSON.parse(readFileSync(join(units, "ids.json"), "utf8")).units as Array<{ id: string; repo: string; number: number; draw_digest: string }>;

describe("dx handover", () => {
  test("writes funnel.json and alias.json that author's own reader loads, with every field filled, and counts the skips", async () => {
    const from = minerOut(), units = join(dir, "units-a"), queries: string[] = [];
    const s = sink();
    expect(await handoverRun(["--from", from, "--units", units, "--now", NOW], s.io, { gh: fakeGh(queries) })).toBe(0);
    expect(s.o.out.join("\n")).toBe("dx handover: written 2; skipped window-open 1, screen-negative 1, unscreened 0, unread 0, already 0");
    const ids = idsOf(units);
    expect(ids.map((u) => [u.repo, u.number, u.draw_digest])).toEqual([["quillcorp/zorbit", 1, order(1)], ["other/thing", 4, order(4)]]);
    for (const u of ids) {
      expect(DX_UNIT_ID.test(u.id)).toBe(true);
      expect(u.id).not.toMatch(/zorbit|thing|quill|other|#|\//i);
      const { unit, alias } = loadUnit(units, u.id);
      expect(unit.id).toBe(u.id);
      expect(unit.draw_digest).toBe(u.draw_digest);
      expect(unit.release_at).toBe("2026-08-01T00:00:00Z");
      expect(unit.window).toEqual({ from: "2026-08-01T00:00:00.000Z", to: CLOSED });
      expect(unit.source).toContain("UNIT-" + u.number);
      expect(unit.identifiers).toEqual(["--json"]);
      expect(unit.candidates).toEqual([cand]);
      expect(unit.records.length).toBe(2);
      expect(unit.readme).toBe("# Zorbit\nThe zorbit tool.\n");
      expect(unit.real_names).toContain(u.repo);
      expect(unit.real_names).toContain("zorbit-cli");
      expect(alias.entries.map((e) => e.original)).toContain("zorbit-cli");
      expect(triagePrompt(unit)).toContain(cand.passage);
    }
    expect(listUnits(units).map((u) => u.draw_digest).sort()).toEqual([order(1), order(4)]);
    expect(queries.length).toBe(2);
    for (const q of queries) expect(q).toContain("object(expression: $e0)");
  });

  test("a rerun reuses every id and reads nothing; a closed window the miner never screened is counted; a fresh dir mints fresh ids", async () => {
    const from = minerOut(), units = join(dir, "units-b");
    await handoverRun(["--from", from, "--units", units, "--now", NOW], sink().io, { gh: fakeGh([]) });
    const before = idsOf(units);
    const queries: string[] = [], second = sink(), third = sink();
    await handoverRun(["--from", from, "--units", units, "--now", NOW], second.io, { gh: fakeGh(queries) });
    expect(idsOf(units)).toEqual(before);
    expect(queries.length).toBe(0);
    expect(second.o.out.join("\n")).toBe("dx handover: written 0; skipped window-open 1, screen-negative 1, unscreened 0, unread 0, already 2");
    await handoverRun(["--from", from, "--units", units, "--now", "2027-01-01T00:00:00Z"], third.io, { gh: fakeGh([]) });
    expect(third.o.out.join("\n")).toBe("dx handover: written 0; skipped window-open 0, screen-negative 1, unscreened 1, unread 0, already 2");
    const fresh = join(dir, "units-b2");
    await handoverRun(["--from", from, "--units", fresh, "--now", NOW], sink().io, { gh: fakeGh([]) });
    expect(idsOf(fresh).map((u) => u.id)).not.toEqual(before.map((u) => u.id));
  });

  test("an in-repo --units, and an existing --units the producer did not write, are refused with E_USAGE", async () => {
    const from = minerOut();
    const inRepo = sink();
    expect(await dx(["handover", "--from", from, "--units", join(ROOT, "tmp-units-handover")], inRepo.io)).toBe(2);
    expect(inRepo.o.err[0]).toMatch(/^E_USAGE .*inside the repository/);
    expect(existsSync(join(ROOT, "tmp-units-handover"))).toBe(false);
    const foreign = join(dir, "foreign");
    mkdirSync(foreign);
    writeFileSync(join(foreign, "notes.txt"), "x");
    const f = sink();
    expect(await dx(["handover", "--from", from, "--units", foreign], f.io)).toBe(2);
    expect(f.o.err[0]).toMatch(/^E_USAGE /);
    expect(readdirSync(foreign)).toEqual(["notes.txt"]);
  });

  test("dx author's keyless run on the handed-over units refuses only for its missing item", async () => {
    const from = minerOut(), units = join(dir, "units-c"), work = join(dir, "work-c");
    await handoverRun(["--from", from, "--units", units, "--now", NOW], sink().io, { gh: fakeGh([]) });
    const id = idsOf(units)[0]!.id;
    const s = sink();
    expect(await dx(["author", "--units", units, "--work", work, "--ids", id], s.io)).toBe(2);
    expect(s.o.err[0]).toMatch(/^E_USAGE .*--item/);
    expect(loadUnit(units, id).unit.id).toBe(id);
    expect(typeof authorRun).toBe("function");
  });
});

describe("the miner's read of a positive unit", () => {
  const unit = { repo: "fixture-owner/fixture-repo", number: 40, title: "Add the export --format flag", text: "Adds \x60--format\x60 to \x60fixture-repo export\x60 and the export_format option.", closing: [41], files: ["src/cli/export.ts"], diff: null, timeline_refs: [] };
  const item = (k: WindowItem["kind"], n: number, title: string, body: string, assoc = "NONE", files: string[] = []): WindowItem => ({ kind: k, number: n, title, body, author_association: assoc, created_at: "2026-08-02T00:00:00Z", merged_at: k === "pr" ? "2026-08-03T00:00:00Z" : null, files });
  test("keeps every window record, with a body only where an identifier names it, and each candidate's passage around its match", () => {
    const long = "x".repeat(2000) + " setting export_format does nothing " + "y".repeat(2000);
    const r = screenRead(unit, [item("issue", 52, "Bug", long), item("pr", 53, "Docs for export", "see #41", "MEMBER", ["docs/export.md"]), item("pr", 54, "Tidy", "unrelated", "MEMBER", ["src/parse.ts"]), item("pr", 40, "the unit itself", "x")]);
    expect(r.screen.candidates.map((c) => c.number)).toEqual([52, 53]);
    expect(r.records.map((x) => [x.ref, x.date, x.body === null])).toEqual([["issue 52", "2026-08-02T00:00:00Z", false], ["pr 53", "2026-08-03T00:00:00Z", true], ["pr 54", "2026-08-03T00:00:00Z", true]]);
    const c = r.candidates[0]!;
    expect([c.ref, c.title, c.association, c.body.length]).toEqual(["issue 52", "Bug", "NONE", long.length]);
    expect(c.passage).toContain("export_format");
    expect(c.passage.length).toBeLessThan(700);
    expect(r.candidates[1]!.passage).toBe("see #41");
  });
  test("base paths: the root README and the manifests near the root, never vendored or test ones", () => {
    const p = basePaths([{ path: "README.md", type: "blob" }, { path: "docs/README.md", type: "blob" }, { path: "package.json", type: "blob" }, { path: "packages/cli/package.json", type: "blob" }, { path: "node_modules/x/package.json", type: "blob" }, { path: "tests/fixtures/package.json", type: "blob" }, { path: "a/b/c/d/Cargo.toml", type: "blob" }, { path: "crates/x/Cargo.toml", type: "blob" }]);
    expect(p).toEqual({ readme_path: "README.md", manifest_paths: ["package.json", "crates/x/Cargo.toml", "packages/cli/package.json"] });
  });
});
