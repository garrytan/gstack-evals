// Copyright (c) 2026 Garry Tan. MIT License.
// Runs inside a full clone of gstack (cwd), with gstack's own code: the newest first-parent commit of origin/main that
// gstack's release cut reads as gated green, found the way crew/scripts/release-cut.ts planRelease walks its candidates
// (the same window, the same gate verdict and the same train and release-gate evidence), stopping at stable. It never reads
// the cut's floor, notes, freeze or version checks, which decide whether a cut runs, not which commit is green. Prints one
// JSON object; lanes/weekly-stable/resolve.ts decides from it.
//
//   (cd <gstack clone> && bun <this file> <owner/name> <now-epoch-ms>)
import { join } from "node:path";

const [repo, nowArg] = process.argv.slice(2);
if (!repo || !/^\d+$/.test(nowArg ?? "")) { console.error("usage: resolve-shim.ts <owner/name> <now-epoch-ms>"); process.exit(2); }
const now = Number(nowArg), cwd = process.cwd();
const cut = await import(join(cwd, "crew/scripts/release-cut.ts"));
const need = ["gitIn", "runGh", "readTrainNotes", "gateVerdict", "WINDOW_DAYS", "WINDOW_COMMITS"].filter((k) => cut[k] === undefined);
if (need.length) { console.log(JSON.stringify({ schema: 1, error: "gstack's release-cut.ts no longer exports " + need.join(", ") })); process.exit(0); }
const git = cut.gitIn(cwd), gh = cut.runGh;
const rev = (ref: string) => { const r = git(["rev-parse", "--verify", "-q", ref + "^{commit}"]); return r.ok ? r.out : null; };
const main = rev("refs/remotes/origin/main"), stable = rev("refs/remotes/origin/stable");
const notes = cut.readTrainNotes(git);
const since = new Date(now - cut.WINDOW_DAYS * 86_400_000).toISOString();
const list = main ? git(["rev-list", "--first-parent", "--max-count=" + cut.WINDOW_COMMITS, "--since=" + since, "refs/remotes/origin/main"]) : { ok: false, out: "" };
const window = list.ok && list.out ? list.out.split("\n") : [];
const gate = { evidence: notes.evidence, treeOf: (sha: string) => { const t = git(["rev-parse", sha + "^{tree}"]); return t.ok ? t.out : null; } };
const rows: { sha: string; green: boolean; via?: string; why?: string; pending?: boolean }[] = [];
let candidate: string | null = null;
if (!notes.error) for (const sha of window) {
  const v = cut.gateVerdict(gh, repo, sha, gate);
  rows.push(v.green ? { sha, green: true, via: v.via } : { sha, green: false, why: v.why, pending: v.pending });
  if (v.green) { candidate = sha; break; }
  if (sha === stable) break;
}
const tags = stable ? git(["tag", "--points-at", stable, "-l", "v*"]).out.split("\n").filter(Boolean).sort() : [];
const facts = (sha: string | null) => {
  if (!sha) return null;
  const date = git(["show", "-s", "--format=%cI", sha]).out, version = git(["show", sha + ":VERSION"]);
  const desc = stable ? git(["merge-base", "--is-ancestor", stable, sha]).ok : null;
  const count = stable && desc ? Number(git(["rev-list", "--count", "--first-parent", stable + ".." + sha]).out) : null;
  return { sha, date, version: version.ok ? version.out.trim() : null, contains_stable: desc, first_parent_commits_since_stable: count };
};
console.log(JSON.stringify({
  schema: 1, repo, now: new Date(now).toISOString(), gstack_main: main, gstack_main_version: main ? git(["show", main + ":VERSION"]).out.trim() : null,
  stable, stable_tags: tags, stable_version: stable ? git(["show", stable + ":VERSION"]).out.trim() : null,
  window: { days: cut.WINDOW_DAYS, commits: window.length, since }, notes_error: notes.error, hold: notes.freeze,
  walked: rows, candidate: facts(candidate),
}));
