// Copyright (c) 2026 Garry Tan. MIT License.
// PD-15's clone re-fetch (gstack-evals dc clones) on invented repositories fetched over file://: every entry matches and
// the recipes, author and exports readers take the output as it stands; a tree mismatch and an unfetchable commit drop
// with their reasons and nothing is swapped in; the record's names, paths, commits and trees reach no output.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../../lanes/design-constructed/cli.ts";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { exportUnit } from "../../../lanes/design-constructed/run/export.ts";
import { appViewOf } from "../../../lanes/design-constructed/wire/author.ts";
import { clonesRow, REFETCH_REASONS, refetchClones } from "../../../lanes/design-constructed/wire/clones.ts";
import { cloneFixture, leaked, threeWay, type CloneFixture } from "../../../lanes/design-constructed/wire/dryrun-clones.ts";
import { candidatesFromFrame } from "../../../lanes/design-constructed/wire/recipes.ts";

const withFixture = async (fn: (f: CloneFixture) => void | Promise<void>) => {
  const f = cloneFixture();
  try {
    await fn(f);
  } finally {
    f.dispose();
  }
};

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
};

const thrown = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DcError);
    return (e as DcError).code + " " + (e as Error).message;
  }
  throw new Error("did not throw");
};

describe("dc clones (PD-15)", () => {
  test("every entry matches, and the recipes, author and exports readers read the output as the frame's layout", () =>
    withFixture(async (f) => {
      // Value: protects=PD-15's re-fetch writes exactly what the kept clones' readers take: the recipes row's --frame folder (clones.json, filecheck.json, run.json), apps.json's checkout and exportUnit's clone source at the recorded commit and tree; fails_when=a reader can't take the output, a clone's HEAD or tree differs from the record, or the folders carry a name; why_new=nothing re-fetched the kept clones; seam=refetchClones, candidatesFromFrame, appViewOf, exportUnit; no_claim=GitHub over HTTPS (the command line's clone seam)
      const entries = [
        { position: 9, nameWithOwner: f.repos.moved.name, oid: f.repos.moved.first.oid, tree: f.repos.moved.first.tree, fetched: true, reason: null, path: "clones/elsewhere" },
        { position: 4, nameWithOwner: f.repos.match.name, commit: f.repos.match.second.oid, tree: f.repos.match.second.tree },
      ];
      const out = join(f.work, "out");
      const r = refetchClones(f.record(entries), out, f.clone);
      expect(r.lines[1]).toBe("clones: 2 records, 2 matched, 0 dropped");
      expect(r.lines.some((l) => l.startsWith("dropped:"))).toBe(false);
      expect(readdirSync(join(out, "clones")).sort()).toEqual(["c004", "c009"]);
      const { candidates, counts } = candidatesFromFrame(out);
      expect(candidates.map((c) => [c.id, c.pin])).toEqual([["c004", f.repos.match.second.oid], ["c009", f.repos.moved.first.oid]]);
      expect(counts).toEqual({ cloneAttempts: 2, clones: 2, fileCheckPasses: 2 });
      expect((await candidates[0]!.tree()).length).toBeGreaterThan(0);
      const view = appViewOf({ label: "app-a", dir: "clones/c009", designFiles: [], routeFiles: [] }, out);
      expect(view.read("src/styles/theme.ts")).toBe("export const theme = { radius: 4 };\n");
      const ex = exportUnit({ source: { clone: join(out, "clones", "c009") }, expect: { commit: f.repos.moved.first.oid, tree: f.repos.moved.first.tree }, evidence: [{ path: "docs/research/interviews.md", text: "Invented notes.\n" }], out: join(f.work, "export") });
      expect(ex.manifest.base).toEqual({ pin: f.repos.moved.first.oid, tree: f.repos.moved.first.tree });
      expect(leaked(r.lines, f.secrets)).toBeNull();
    }));

  test("a tree mismatch and an unfetchable commit drop with their reasons; nothing is swapped in and no name prints", () =>
    withFixture((f) => {
      // Value: protects=PD-15's drop rule: a commit that can't be fetched or a tree that differs from the record drops that base app with its frame position and reason printed, and no other repository is fetched in its place; fails_when=a mismatched or unfetchable app stays, its folder remains, a drop line is missing, an unrecorded repository is fetched, or a printed line or a written file name carries a name, path, commit or tree from the record; why_new=nothing re-fetched the kept clones; seam=clonesRow, refetchClones; no_claim=GitHub over HTTPS
      const out = join(f.work, "out");
      const c = capture();
      const code = clonesRow(f.clone)({ flags: new Map([["--record", f.record(threeWay(f))], ["--out", out]]), bools: new Set(), rest: [] }, c.io, undefined as never);
      expect(code).toBe(0);
      expect(c.out).toContain("clones: 3 records, 1 matched, 2 dropped");
      expect(c.out).toContain("dropped: frame position 8: " + REFETCH_REASONS.tree + "; the base app drops and is never swapped for another");
      expect(c.out).toContain("dropped: frame position 12: " + REFETCH_REASONS.unfetchable + "; the base app drops and is never swapped for another");
      expect(c.err).toEqual([]);
      expect(f.asked).toEqual([f.repos.match.name, f.repos.moved.name, f.repos.gone.name]);
      expect(readdirSync(join(out, "clones"))).toEqual(["c003"]);
      const clones = JSON.parse(readFileSync(join(out, "clones.json"), "utf8"));
      expect(clones.map((x: any) => [x.position, x.fetched, x.path, x.reason])).toEqual([
        [3, true, "clones/c003", null],
        [8, false, null, REFETCH_REASONS.tree],
        [12, false, null, REFETCH_REASONS.unfetchable],
      ]);
      expect(candidatesFromFrame(out).candidates.map((x) => x.id)).toEqual(["c003"]);
      expect(leaked([...c.out, ...c.err, ...readdirSync(out), ...readdirSync(join(out, "clones"))], f.secrets)).toBeNull();
    }));

  test("a record that marks kept fetches only its kept entries, counts the rest as not kept and drops none of them", () =>
    withFixture((f) => {
      // Value: protects=the sealed record holds every frame clone with a kept flag, and the re-fetch takes only the file-check passes: an entry with kept false is never fetched, never dropped and prints only as a count, and source is not read; a record with some flags missing or a flag that isn't true or false refuses; fails_when=a kept:false entry is fetched, written or counted as dropped, the not-kept count is missing, or a half-flagged record runs; why_new=the real record carries every frame clone, not only the passes; seam=refetchClones; no_claim=GitHub over HTTPS
      const [gone, match, moved] = threeWay(f);
      const entries = [
        { ...gone, kept: false, source: "frame" },
        { ...match, kept: true, source: "frame" },
        { ...moved, kept: false, source: "frame" },
      ];
      const out = join(f.work, "out");
      const r = refetchClones(f.record(entries), out, f.clone);
      expect(r.lines.slice(1, 3)).toEqual(["clones: 1 records, 1 matched, 0 dropped", "not kept: 2 records the file check didn't keep; never fetched, never dropped"]);
      expect(r.lines.some((l) => l.startsWith("dropped:"))).toBe(false);
      expect(f.asked).toEqual([f.repos.match.name]);
      expect(readdirSync(join(out, "clones"))).toEqual(["c003"]);
      const clones = JSON.parse(readFileSync(join(out, "clones.json"), "utf8"));
      expect(clones.map((x: any) => [x.position, x.fetched])).toEqual([[3, true]]);
      expect(JSON.parse(readFileSync(join(out, "run.json"), "utf8")).counts).toEqual({ records: 1, not_kept: 2, matched: 1, dropped: [], filecheck_passes: 1 });
      expect(leaked(r.lines, f.secrets)).toBeNull();
      expect(thrown(() => refetchClones(f.record([{ ...match, kept: true }, moved]), join(f.work, "half"), f.clone))).toBe("E_USAGE --record entry 1 has no true or false kept flag, while other entries carry one");
      expect(thrown(() => refetchClones(f.record([{ ...match, kept: "yes" }]), join(f.work, "word"), f.clone))).toContain("E_USAGE --record entry 0 has no true or false kept flag");
      expect(f.asked).toEqual([f.repos.match.name]);
    }));

  test("refusals name an entry's index only, never what the record holds", () =>
    withFixture((f) => {
      // Value: protects=the sealed record's custody: a malformed record, a repeated position, a used --out and an --out inside the repository refuse with E_USAGE, and no message carries a name, path, commit or tree from the record; fails_when=a refusal echoes record contents or the row writes into the repository; why_new=nothing re-fetched the kept clones; seam=refetchClones; no_claim=none
      const good = threeWay(f);
      const messages = [
        thrown(() => refetchClones(f.record([{ ...good[0], tree: "not-a-tree " + f.repos.gone.name }]), join(f.work, "a"), f.clone)),
        thrown(() => refetchClones(f.record([good[1], { ...good[1] }]), join(f.work, "b"), f.clone)),
        thrown(() => refetchClones(f.record([]), join(f.work, "c"), f.clone)),
        thrown(() => {
          const p = join(f.work, "broken.json");
          writeFileSync(p, "[{ " + f.repos.match.name + " ]");
          refetchClones(p, join(f.work, "d"), f.clone);
        }),
        thrown(() => {
          mkdirSync(join(f.work, "used"));
          refetchClones(f.record(good), join(f.work, "used"), f.clone);
        }),
        thrown(() => refetchClones(f.record(good), join(import.meta.dir, "inside"), f.clone)),
      ];
      expect(messages[0]).toContain("E_USAGE --record entry 0 needs");
      expect(messages[1]).toContain("E_USAGE --record entry 1 repeats frame position 3");
      expect(messages[2]).toContain("E_USAGE --record holds no clone entries");
      expect(messages[3]).toBe("E_USAGE --record is not JSON");
      expect(messages[4]).toContain("exists already");
      expect(messages[5]).toContain("outside the repository");
      expect(existsSync(join(import.meta.dir, "inside"))).toBe(false);
      expect(leaked(messages, f.secrets)).toBeNull();
      expect(f.asked).toEqual([]);
    }));

  test("the command line row fetches through the frame's own clone seam, which refuses a name that isn't owner/name as unfetchable", () =>
    withFixture(async (f) => {
      // Value: protects=the cli row is wired to the frame's hardened GitHub clone seam and keeps a refused fetch's message off every output; fails_when=the row is missing, prints the name or the seam's error, or a bad name escapes the drop; why_new=nothing re-fetched the kept clones; seam=cli.ts main, realSeams().clone; no_claim=a real GitHub fetch (the name never reaches git)
      const name = "quillmarsh studio/../lantern ledger";
      const record = f.record([{ position: 5, nameWithOwner: name, oid: f.repos.match.first.oid, tree: f.repos.match.first.tree }]);
      const c = capture();
      const code = await main(["clones", "--record", record, "--out", join(f.work, "out")], c.io);
      expect(code).toBe(0);
      expect(c.out.join("\n")).toContain("clones: 1 records, 0 matched, 1 dropped");
      expect(c.out.join("\n")).toContain("dropped: frame position 5: " + REFETCH_REASONS.unfetchable);
      expect(leaked([...c.out, ...c.err], [...f.secrets, "quillmarsh studio", "lantern ledger", "not a repository name"])).toBeNull();
      const usage = capture();
      expect(await main(["clones", "--record", record], usage.io)).toBe(2);
      expect(usage.err.join("\n")).toStartWith("E_USAGE gstack-evals dc clones: usage: gstack-evals dc clones --record");
    }));
});
