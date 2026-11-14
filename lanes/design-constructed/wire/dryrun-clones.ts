// Copyright (c) 2026 Garry Tan. MIT License.
// The clone re-fetch's dry-run case (PD-15, gstack-evals dc clones) and its fixture: invented repositories in a local
// folder fetched over file:// through the frame's fetchAt. One record entry matches, one names a commit whose tree
// differs from the record and one names a commit the repository never had; a fourth repository sits beside them unrecorded.
// Every owner, name and README here is made up.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PASSING_APP, writeTree } from "../frame/fixtures.ts";
import { fetchAt } from "../frame/git.ts";
import type { FrameSeams } from "../frame/run.ts";
import type { DryRunCase } from "../types.ts";
import { REFETCH_REASONS, refetchClones } from "./clones.ts";

/** One invented source repository: its name, its first commit and tree, and its second commit and tree. */
export interface SourceRepo {
  name: string;
  first: { oid: string; tree: string };
  second: { oid: string; tree: string };
}

export interface CloneFixture {
  /** Where the source repositories sit, as owner/name folders. */
  src: string;
  /** A scratch folder for records and outputs, outside the repository. */
  work: string;
  repos: Record<"match" | "moved" | "gone" | "bait", SourceRepo>;
  /** The frame's clone seam pointed at src over file://; every name it is asked for, in order. */
  clone: FrameSeams["clone"];
  asked: string[];
  /** Every string that must never reach a printed line or a thrown message. */
  secrets: string[];
  record: (entries: unknown[]) => string;
  dispose: () => void;
}

const NAMES = { match: "quillmarsh-studio/lantern-ledger", moved: "brindlewave-labs/copper-almanac", gone: "tidepool-guild/saffron-kiln", bait: "harrowgate-works/velvet-orrery" } as const;

function sourceRepo(src: string, name: string): SourceRepo {
  const dir = join(src, name);
  mkdirSync(dir, { recursive: true });
  const g = (...a: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", ...a], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
    if (r.status !== 0) throw new Error("fixture git " + a[0] + " failed");
    return r.stdout.trim();
  };
  g("init", "-q");
  writeTree({ ...PASSING_APP, "README.md": "# " + name.split("/")[1] + "\n\nAn invented app for the clone re-fetch fixture.\n" }, dir);
  g("add", "-A");
  g("commit", "-q", "-m", "one");
  const first = { oid: g("rev-parse", "HEAD"), tree: g("rev-parse", "HEAD^{tree}") };
  writeFileSync(join(dir, "src/styles/theme.ts"), "export const theme = { radius: 6 };\n");
  g("commit", "-q", "-am", "two");
  return { name, first, second: { oid: g("rev-parse", "HEAD"), tree: g("rev-parse", "HEAD^{tree}") } };
}

export function cloneFixture(): CloneFixture {
  const src = mkdtempSync(join(tmpdir(), "dc-clones-src-"));
  const work = mkdtempSync(join(tmpdir(), "dc-clones-work-"));
  const repos = Object.fromEntries(Object.entries(NAMES).map(([k, n]) => [k, sourceRepo(src, n)])) as CloneFixture["repos"];
  const asked: string[] = [];
  let n = 0;
  return {
    src,
    work,
    repos,
    asked,
    clone: (name, oid, dest) => {
      asked.push(name);
      fetchAt("file://" + join(src, name), oid, dest, ["file"]);
    },
    secrets: [src.split("/").at(-1)!, ...Object.values(repos).flatMap((r) => [...r.name.split("/"), r.first.oid, r.first.tree, r.second.oid, r.second.tree])],
    record: (entries) => {
      const p = join(work, "record-" + n++ + ".json");
      writeFileSync(p, JSON.stringify(entries, null, 2));
      return p;
    },
    dispose: () => {
      rmSync(src, { recursive: true, force: true });
      rmSync(work, { recursive: true, force: true });
    },
  };
}

/** The three-way record: position 3 matches, position 8 records the first commit with the second commit's tree, position 12 names a commit its repository never had. */
export const threeWay = (f: CloneFixture) => [
  { position: 12, nameWithOwner: f.repos.gone.name, oid: "e".repeat(40), tree: f.repos.gone.first.tree },
  { position: 3, nameWithOwner: f.repos.match.name, oid: f.repos.match.second.oid, tree: f.repos.match.second.tree },
  { position: 8, nameWithOwner: f.repos.moved.name, oid: f.repos.moved.first.oid, tree: f.repos.moved.second.tree },
];

/** The first secret a text holds, or null. */
export const leaked = (texts: readonly string[], secrets: readonly string[]): string | null => secrets.find((s) => texts.some((t) => t.includes(s))) ?? null;

export function cloneCases(): DryRunCase[] {
  return [
    {
      rule: "W-clones",
      name: "clones re-fetches each record entry by its commit over file://, drops a tree mismatch and an unfetchable commit with their reasons, swaps in nothing and prints no name",
      check: () => {
        const f = cloneFixture();
        try {
          const out = join(f.work, "out");
          const r = refetchClones(f.record(threeWay(f)), out, f.clone);
          const want = [
            "clones: 3 records, 1 matched, 2 dropped",
            "dropped: frame position 8: " + REFETCH_REASONS.tree + "; the base app drops and is never swapped for another",
            "dropped: frame position 12: " + REFETCH_REASONS.unfetchable + "; the base app drops and is never swapped for another",
            "file check passes: 1 of 1 matched",
          ];
          const missing = want.find((l) => !r.lines.includes(l));
          if (missing) return "no line " + JSON.stringify(missing) + " in " + JSON.stringify(r.lines);
          const asked = JSON.stringify(f.asked);
          if (asked !== JSON.stringify([f.repos.match.name, f.repos.moved.name, f.repos.gone.name])) return "fetched other than the record's entries in frame order";
          const kept = readdirSync(join(out, "clones"));
          if (JSON.stringify(kept) !== JSON.stringify(["c003"])) return "clones/ holds " + kept.length + " folders, want c003 only";
          const leak = leaked(r.lines, f.secrets);
          return leak === null ? null : "a printed line carries a name, path segment, commit or tree from the record";
        } finally {
          f.dispose();
        }
      },
    },
  ];
}
