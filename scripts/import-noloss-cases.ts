// Copyright (c) 2026 Garry Tan. MIT License.
// Imports GSTA-167's no-loss blockers as review replay cases (wiki/plans/2026-10-30-gsta-40-review-noloss-plan, section 2)
// and writes the suite that groups them. Inputs are committed beside the cases: mining/cohort.json (the 14 pass-1 ranges,
// groups, exclusions and frozen bars, restated) and mining/hand.json (each blocker's file, line, fix and a summary in our
// own words). GSTA-167's documents stay in the org drive; only their digests are committed (the Captain's ruling).
//
//   bun scripts/import-noloss-cases.ts --clone <gstack clone> --gstack <gstack checkout> --cache <dir> [--prereg <file>] [--check]
//
// Every line is checked in git: it exists at the pass-1 head, and the fix rewrites it or inserts right after it. A fix
// that is not a child of the pass-1 head is followed back through the commits in between (its lineage), and a line those
// commits changed is refused rather than guessed. No command here calls a model.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ReplayCase } from "../lanes/review-replay/catalog/catalog.ts";
import { loadCatalog } from "../lanes/review-replay/catalog/catalog.ts";
import { scanText } from "../lanes/review-noloss/scan.ts";
import { clusterId, type Blocker, type FrozenBar, type Location, type Suite, unitId } from "../lanes/review-noloss/suite.ts";
import { addedLines, countsForSize, Git, ghApi, gstackScope, mapLine, mentions, reviewSection, type Api, type MineOptions } from "./mine-review-cases.ts";
import { selectSpecialists, type Scope } from "../quick/replay/lib.ts";

const ROOT = resolve(import.meta.dir, "..");
export const NOLOSS_CATALOG = join(ROOT, "lanes", "review-replay", "catalog", "noloss");
export const SUITES = join(ROOT, "lanes", "review-noloss", "suites");
export const IMPORTER = "scripts/import-noloss-cases.ts (GSTA-43)";

export interface HandBlocker {
  pr: number;
  blocker: string;
  case_id: string;
  paths: string[];
  fix_paths: string[];
  file: string;
  window: [number, number] | null;
  line: number;
  fix: string;
  intermediate: string[];
  line_text: string;
  check: "rewritten" | "insertion-adjacent";
  summary: string;
  deserved: "CRITICAL" | "INFORMATIONAL" | null;
  basis: string;
  in_history: Array<{ by: string; rated: string }>;
  pick_note: string;
  /** When commits between the pass-1 head and the fix rewrote the line: how the defect carried through them. */
  carried?: string;
}

export interface Hand {
  auditor: string;
  at: string;
  blockers: HandBlocker[];
}

export interface Cohort {
  suite: string;
  title: string;
  purpose: string;
  repo: string;
  credit: string;
  groups: Record<string, string>;
  units: Array<{ pr: number; head: string; base: string; group: string; note?: string }>;
  sources: Suite["sources"];
  prereg_freezes: Suite["prereg_freezes"];
  judging_rule: string;
  ineligible: Suite["ineligible"];
  excluded: Suite["excluded"];
  frozen_bars: FrozenBar[];
}

export class ImportError extends Error {
  constructor(
    readonly code: "E_NOLOSS_SOURCE" | "E_NOLOSS_SUITE",
    message: string,
  ) {
    super(message);
  }
}

export interface Located {
  check: "rewritten" | "insertion-adjacent";
  lineage: string[];
  mapped: number;
  text: string;
  /** The commits in between rewrote the pass-1 line, and the fix rewrites what they made of it. */
  carried: boolean;
}

const short = (s: string) => s.slice(0, 12);

/**
 * Where a fix touches a pass-1 line. The line is moved from the pass-1 head to the fix's parent through the commits in
 * between. A line they rewrote is refused unless the hand audit says how the defect carried through; then the fix must
 * touch the lines that rewrite produced. The fix must rewrite the line, or insert right after it.
 */
export function locate(git: Git, head: string, fix: string, file: string, line: number, carried: string | null = null): Located | string {
  if (!git.isAncestor(head, fix)) return "fix " + short(fix) + " does not descend from the pass-1 head " + short(head);
  const parent = git.parents(fix)[0];
  if (!parent) return "fix " + short(fix) + " has no parent";
  if (!git.exists(head, file)) return file + " does not exist at the pass-1 head " + short(head);
  const text = git.run(["show", head + ":" + file]).split("\n")[line - 1];
  if (text === undefined) return file + ":" + line + " is past the end of the file at " + short(head);
  const lineage = parent === head ? [] : git.run(["rev-list", "--ancestry-path", "--reverse", head + ".." + parent, "--", file]).split("\n").filter(Boolean);
  const between = lineage.length === 0 ? [] : git.fileDiff(head, parent, file);
  const at = mapLine(between, line, "old");
  let range: [number, number] = [at ?? 0, at ?? 0];
  if (at === null) {
    const h = between.find((x) => x.oldCount > 0 && line >= x.oldStart && line < x.oldStart + x.oldCount)!;
    if (!carried) return file + ":" + line + " was rewritten between the pass-1 head and the fix's parent by " + lineage.map(short).join(", ") + ", so the fix's lines are not pass-1 lines; a hand audit that shows the defect carried through may say so in carried";
    if (h.newCount === 0) return file + ":" + line + " was deleted by " + lineage.map(short).join(", ") + " before the fix";
    range = [h.newStart, h.newStart + h.newCount - 1];
  } else if (git.run(["show", parent + ":" + file]).split("\n")[at - 1] !== text) return file + ":" + line + " maps to line " + at + " of the fix's parent, whose text differs";
  for (const h of git.fileDiff(parent, fix, file)) {
    const hit = h.oldCount > 0 ? Math.max(range[0], h.oldStart) : h.oldStart >= range[0] && h.oldStart <= range[1] ? h.oldStart : 0;
    if (h.oldCount > 0 && hit <= Math.min(range[1], h.oldStart + h.oldCount - 1)) return { check: "rewritten", lineage, mapped: hit, text, carried: at === null };
    if (h.oldCount === 0 && hit) return { check: "insertion-adjacent", lineage, mapped: hit, text, carried: at === null };
  }
  return "fix " + short(fix) + " neither rewrites " + file + ":" + line + " (" + (range[0] === range[1] ? "line " + range[0] : "lines " + range.join("-")) + " of its parent) nor inserts right after it";
}

/** added: the line is an added line of base..head. context: its file is in the diff but the line is not added. outside: the file is not in the diff. */
export function locationOf(git: Git, base: string, head: string, file: string, line: number): Location {
  if (!git.changed(base, head).some((c) => c.new === file)) return "outside";
  return addedLines(git.fileDiff(base, head, file)).has(line) ? "added" : "context";
}

/** The reviewer roles the replayed range calls for, computed as the miner does: gstack's diff scope and its specialist selection, plus red-team. */
export function rolesOf(git: Git, scope: MineOptions["scope"], base: string, head: string): { roles: ReplayCase["roles"]; note: string } {
  const paths = git.changed(base, head).map((c) => c.new ?? c.old!).filter((p) => countsForSize(p, git.head(head, p)));
  const lines = paths.length ? git.numstat(base, head, paths) : 0;
  const { text, sha } = scope(git, base, head);
  const flag = (k: string) => new RegExp("^SCOPE_" + k + "=true$", "m").test(text);
  const s: Scope = { BACKEND: flag("BACKEND"), FRONTEND: flag("FRONTEND"), AUTH: flag("AUTH"), MIGRATIONS: flag("MIGRATIONS"), API: flag("API"), STATE_MACHINE: "unknown" };
  const scopes = text.split("\n").filter((l) => /^SCOPE_[A-Z_]+=true$/.test(l)).map((l) => l.slice(6, -5));
  return {
    roles: [...selectSpecialists(lines, s).map((checklist) => ({ role: "specialist" as const, checklist })), { role: "red-team" as const }],
    note: "roles from gstack-diff-scope at " + (sha ? short(sha) : "an unknown revision") + " on " + lines + " filtered changed lines (" + (scopes.length ? scopes.join(", ") : "no scope flags") + "), selected as scripts/mine-review-cases.ts does",
  };
}

/** Lowercased word runs of length n, to show a summary is restated rather than copied. */
export function sharedRuns(text: string, source: string, n = 8): string[] {
  const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9.\-_/]+/g, " ").trim().split(/\s+/);
  const runs = (w: string[]) => new Set(w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n).join(" ")));
  const src = runs(words(source));
  return [...runs(words(text))].filter((r) => src.has(r));
}

export interface Imported {
  files: Map<string, string>;
  suite: Suite;
}

/** Builds every case file and the suite from the committed inputs, git and the GitHub API. Throws ImportError on the first problem. */
export async function importCases(o: { cohort: Cohort; hand: Hand; git: Git; api: Api; scope: MineOptions["scope"]; reuse: Map<string, ReplayCase>; prereg: string | null }): Promise<Imported> {
  const { cohort, hand, git, api } = o;
  const fail = (code: ImportError["code"], m: string): never => {
    throw new ImportError(code, m);
  };
  const meta = await api.get("repos/" + cohort.repo).catch((e: Error) => fail("E_NOLOSS_SOURCE", "could not confirm " + cohort.repo + " is public (unverified, not known private): GET repos/" + cohort.repo + " failed: " + e.message));
  if (!meta) fail("E_NOLOSS_SOURCE", "GET repos/" + cohort.repo + " answered 404, so its visibility is unverified; import only from a repo the API shows public");
  if (meta.visibility !== "public") fail("E_NOLOSS_SOURCE", cohort.repo + " is " + meta.visibility + ", not public; cases import only from public repos");
  const files = new Map<string, string>();
  const units: Suite["units"] = [];
  const seen = new Set<string>();
  for (const u of cohort.units) {
    for (const sha of [u.head, u.base]) if (!git.has(sha)) fail("E_NOLOSS_SOURCE", "commit " + sha + " of #" + u.pr + " is not in the clone " + git.dir + "; git fetch origin +refs/pull/" + u.pr + "/head and run again");
    const pr = await api.get("repos/" + cohort.repo + "/pulls/" + u.pr).catch((e: Error) => fail("E_NOLOSS_SOURCE", "GET pulls/" + u.pr + " failed: " + e.message));
    if (!pr) fail("E_NOLOSS_SOURCE", "GET pulls/" + u.pr + " answered 404");
    const roles = rolesOf(git, o.scope, u.base, u.head);
    const section = reviewSection(pr.body ?? null);
    const blockers: Blocker[] = [];
    for (const h of hand.blockers.filter((b) => b.pr === u.pr)) {
      const at = "#" + u.pr + " " + h.blocker;
      if (seen.has(h.case_id)) fail("E_NOLOSS_SUITE", at + ": case " + h.case_id + " is used twice");
      seen.add(h.case_id);
      if (h.window && (h.line < h.window[0] || h.line > h.window[1])) fail("E_NOLOSS_SUITE", at + ": line " + h.line + " is outside its window " + h.window.join("-"));
      const fix = git.try(["rev-parse", "--verify", "-q", h.fix + "^{commit}"])?.trim() ?? fail("E_NOLOSS_SOURCE", at + ": fix " + h.fix + " is not in the clone");
      const located = locate(git, u.head, fix, h.file, h.line, h.carried ?? null);
      if (typeof located === "string") fail("E_NOLOSS_SUITE", at + ": " + located);
      const loc = located as Located;
      if (loc.text !== h.line_text) fail("E_NOLOSS_SUITE", at + ": the hand audit's line text differs from " + h.file + ":" + h.line + " at the pass-1 head");
      const missing = h.intermediate.filter((s) => !loc.lineage.some((l) => l.startsWith(s)));
      if (missing.length || h.intermediate.length !== loc.lineage.length) fail("E_NOLOSS_SUITE", at + ": the hand audit lists lineage " + (h.intermediate.map(short).join(", ") || "none") + " but git finds " + (loc.lineage.map(short).join(", ") || "none"));
      if (o.prereg) {
        const runs = sharedRuns(h.summary + " " + h.basis + " " + h.in_history.map((x) => x.by).join(" "), o.prereg);
        if (runs.length) fail("E_NOLOSS_SUITE", at + ": the summary repeats " + runs.length + " eight-word run(s) of the prereg; restate it in our own words");
      }
      const location = locationOf(git, u.base, u.head, h.file, h.line);
      blockers.push({ id: h.blocker, case: h.case_id, paths: [...new Set([h.file, ...h.paths, ...h.fix_paths])], file: h.file, line: h.line, location, counts: "blocking" });
      const reused = o.reuse.get(h.case_id);
      if (reused) {
        if (reused.reviewed_head !== u.head || reused.merge_base !== u.base || reused.defect.file !== h.file || reused.defect.line !== h.line || reused.fix.commit !== fix) fail("E_NOLOSS_SUITE", at + ": existing case " + h.case_id + " does not match the blocker's range, file, line and fix");
        continue;
      }
      if (!/^[a-z0-9-]+-noloss-b\d+$/.test(h.case_id)) fail("E_NOLOSS_SUITE", at + ": a new case id is gstack-<pr>-noloss-b<n>, not " + h.case_id);
      const parent = git.parents(fix)[0]!;
      const subject = git.run(["log", "-1", "--format=%s", fix]).trim();
      const review = mentions(section, [h.file, h.file.split("/").pop()!]).map((s) => "#" + u.pr + " Pre-Landing Review: " + s);
      const c: ReplayCase = {
        schema_version: 1,
        id: h.case_id,
        visibility: "public",
        repo: cohort.repo,
        pr: u.pr,
        reviewed_head: u.head,
        merge_base: u.base,
        diff_range: { from: u.base, to: u.head, note: "#" + u.pr + "'s pass-1 range: the head its first review read." + (u.note ? " " + u.note : "") },
        roles: roles.roles,
        defect: { file: h.file, line: h.line, summary: h.summary },
        severity: { deserved: h.deserved, basis: h.basis, in_history: h.in_history },
        fix: { commit: fix, pr: u.pr },
        decoys: [{ kind: "fix-commit", repo: cohort.repo, pr: u.pr, range: { from: parent, to: fix }, audit: null }],
        receipt: {
          source: cohort.repo + " #" + u.pr + ", blocker " + h.blocker + " of GSTA-167's no-loss cohort, fixed by " + short(fix),
          evidence: [
            "commit " + short(fix) + " subject: " + subject,
            h.file + ":" + h.line + " at " + short(u.head) + " is a" + (location === "added" ? "n added" : location === "context" ? " context" : "n outside-the-diff") + " line of " + short(u.base) + ".." + short(u.head),
            "git diff -U0 " + short(parent) + ".." + short(fix) + " -- " + h.file + (loc.check === "rewritten" ? " rewrites" : " inserts right after") + " line " + loc.mapped + (loc.carried ? ", which " + loc.lineage.map(short).join(", ") + " made from line " + h.line + " of the pass-1 head: " + h.carried : loc.lineage.length ? ", which is line " + h.line + " at the pass-1 head through " + loc.lineage.map(short).join(", ") : ""),
            roles.note,
            ...review,
          ],
        },
        answer_key_audit: { by: hand.auditor, at: hand.at, verdict: "confirmed", notes: h.pick_note + " Checked by " + IMPORTER + ": the line exists at the pass-1 head and the fix " + (loc.check === "rewritten" ? "rewrites it" : "inserts right after it") + ". The fix-commit decoy is unaudited (null), so it is never scored as clean." },
        shelf_life: { first_appeared: String(pr.created_at).slice(0, 10), source: "GitHub API: " + cohort.repo + "#" + u.pr + " created_at " + pr.created_at, short: true },
        credit: "Caught in " + cohort.repo + "#" + u.pr + "'s own review and fixed in " + short(fix) + "; #" + u.pr + " by @" + (pr.user?.login ?? "unknown") + ". " + cohort.credit,
      };
      const text = JSON.stringify(c, null, 2) + "\n";
      const hits = scanText(text);
      if (hits.length) fail("E_NOLOSS_SUITE", at + ": the case text breaks the publication scan (" + hits.join(", ") + "); restate the named field");
      files.set(join(NOLOSS_CATALOG, h.case_id + ".json"), text);
    }
    if (blockers.length === 0) fail("E_NOLOSS_SUITE", "#" + u.pr + " has no blocker in hand.json");
    units.push({ id: unitId(cohort.repo, u.pr, u.head), repo: cohort.repo, pr: u.pr, head: u.head, base: u.base, cluster: clusterId(cohort.repo, u.pr), group: u.group, ...(u.note ? { note: u.note } : {}), blockers });
  }
  const stray = hand.blockers.filter((b) => !cohort.units.some((u) => u.pr === b.pr));
  if (stray.length) fail("E_NOLOSS_SUITE", "hand.json audits PRs outside the cohort: " + stray.map((b) => b.pr).join(", "));
  const suite: Suite = {
    schema_version: 1,
    id: cohort.suite,
    title: cohort.title,
    kind: "noloss",
    development_only: true,
    purpose: cohort.purpose,
    sealed: false,
    catalogs: ["lanes/review-replay/catalog/noloss", "lanes/review-replay/catalog/public"],
    sources: cohort.sources,
    prereg_freezes: cohort.prereg_freezes,
    judging_rule: cohort.judging_rule,
    shelf_life: { rule: "Not applied: every comparison on this suite pairs arms run on the same models, and the source prereg froze no release rule.", released: null },
    groups: cohort.groups,
    units,
    ineligible: cohort.ineligible,
    excluded: cohort.excluded,
    frozen_bars: cohort.frozen_bars,
  };
  files.set(join(SUITES, cohort.suite + ".json"), JSON.stringify(suite, null, 2) + "\n");
  return { files, suite };
}

const USAGE = "usage: bun scripts/import-noloss-cases.ts --clone <gstack clone> --gstack <gstack checkout> --cache <dir> [--prereg <file>] [--check]";

export async function main(argv: string[]): Promise<number> {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i < 0 ? null : (argv[i + 1] ?? null);
  };
  const clone = flag("--clone");
  const gstack = flag("--gstack");
  const cache = flag("--cache");
  if (!clone || !gstack || !cache) {
    console.error("E_USAGE " + USAGE);
    return 2;
  }
  const mining = join(NOLOSS_CATALOG, "mining");
  try {
    if (!existsSync(join(clone, ".git"))) throw new ImportError("E_NOLOSS_SOURCE", "no git clone at " + clone + "; git clone --filter=blob:limit=2m https://github.com/garrytan/gstack.git there and fetch the cohort's PR refs");
    if (!existsSync(join(gstack, "bin", "gstack-diff-scope"))) throw new ImportError("E_NOLOSS_SOURCE", "no bin/gstack-diff-scope under " + gstack);
    const prereg = flag("--prereg");
    const reuse = new Map(loadCatalog(join(ROOT, "lanes", "review-replay", "catalog", "public")).cases.map((c) => [c.id, c]));
    const { files } = await importCases({
      cohort: JSON.parse(readFileSync(join(mining, "cohort.json"), "utf8")),
      hand: JSON.parse(readFileSync(join(mining, "hand.json"), "utf8")),
      git: new Git(clone),
      api: ghApi(cache),
      scope: gstackScope(gstack),
      reuse,
      prereg: prereg ? readFileSync(prereg, "utf8") : null,
    });
    const stale = [...files].filter(([path, text]) => !existsSync(path) || readFileSync(path, "utf8") !== text).map(([path]) => path);
    const extra = readdirSync(NOLOSS_CATALOG).filter((f) => f.endsWith(".json") && !files.has(join(NOLOSS_CATALOG, f)));
    if (argv.includes("--check")) {
      if (stale.length || extra.length) {
        console.error(["E_NOLOSS_SUITE generated files differ from what import computes:", ...stale, ...extra.map((f) => join(NOLOSS_CATALOG, f) + " (not generated)")].map((l, i) => (i ? "E_NOLOSS_SUITE " + l : l)).join("\n"));
        return 2;
      }
      console.log("import --check: " + files.size + " files match");
      return 0;
    }
    if (extra.length) throw new ImportError("E_NOLOSS_SUITE", "the catalog holds cases import does not write: " + extra.join(", ") + "; remove them by hand if they are stale");
    for (const [path, text] of files) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path + ".tmp", text);
      renameSync(path + ".tmp", path);
    }
    console.log("import: wrote " + files.size + " files (" + stale.length + " changed)");
    return 0;
  } catch (error) {
    if (!(error instanceof ImportError)) throw error;
    console.error(error.message.split("\n").map((l) => error.code + " " + l).join("\n"));
    return 2;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
