// Copyright (c) 2026 Garry Tan. MIT License.
// The leak check of the eng-review build read (plan section 3). The real-outcome lane's L2 needles (lines the merge
// adds that appear nowhere at base) gain the lines each later fix adds to product files, and the scan runs on the
// exact image a builder uses, by image id, so a later published copy of the project in a dependency or module cache
// can't carry the fix in. Hits in installed third-party code that names no part of the project are not leaks, as in
// L2; a hit in the repository or in an installed copy of the project is, and refuses the image with E_EB_LEAK.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitRun } from "../real-outcome/mine/git.ts";
import { projectNames, sortHits } from "../real-outcome/task/check.ts";
import { dockerRun } from "../real-outcome/task/docker.ts";
import { REPO_DIR, type Runner } from "../real-outcome/task/format.ts";
import { fail } from "./errors.ts";
import { sessionImage } from "./session-image.ts";
import { ebProtected } from "./unit.ts";

/** Lines a diff adds, trimmed, at least 20 characters with a word in them: the shape L2 looks for. */
export function addedLines(patch: string): string[] {
  return [...new Set(patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1).trim()).filter((l) => l.length >= 20 && /[A-Za-z_]{3}/.test(l)))];
}

/** The needles: the merge's added lines and each fix's added product lines, keeping only lines found nowhere in the
 * base tree, longest first. */
export function leakNeedles(repo: string, base: string, merge: string, fixes: string[]): string[] {
  const product = (a: string, b: string) => {
    const paths = git(repo, ["diff", "--name-only", "-z", "--no-renames", a, b]).split("\0").filter((p) => p && !ebProtected(p));
    return paths.length ? git(repo, ["diff", "--no-renames", "--no-ext-diff", a, b, "--", ...paths]) : "";
  };
  const lines = [...new Set([...addedLines(git(repo, ["diff", "--no-renames", "--no-ext-diff", base, merge])), ...fixes.flatMap((f) => addedLines(product(f + "^1", f)))])];
  if (lines.length === 0) return [];
  const present = new Set(gitRun(repo, ["grep", "-h", "-o", "-F", ...lines.flatMap((l) => ["-e", l]), base]).stdout.split("\n").map((l) => l.trim()));
  return lines.filter((l) => !present.has(l)).sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export interface LeakResult {
  needles: number;
  leaks: string[];
  installed: number;
}

/** Scans an image by id for the needles. Throws E_EB_LEAK when any hit is a leak; returns counts otherwise. */
export function leakCheck(o: { unit: string; image: string; repo: string; runner: Runner; needles: string[] }): LeakResult {
  if (o.needles.length === 0) return { needles: 0, leaks: [], installed: 0 };
  const dir = mkdtempSync(join(tmpdir(), "eb-leak-"));
  try {
    writeFileSync(join(dir, "needles.txt"), o.needles.join("\n") + "\n");
    const scan = [
      "hits=$(grep -rIlF -f /eb/needles.txt / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev --exclude-dir=eb 2>/dev/null)",
      "echo '== hits'; printf '%s\\n' \"$hits\"",
      "echo '== tracked'; cd " + REPO_DIR + " && printf '%s\\n' \"$hits\" | sed -n 's|^" + REPO_DIR + "/||p' | tr '\\n' '\\0' | GIT_LITERAL_PATHSPECS=1 xargs -0r git -c safe.directory='*' ls-files -z -- | tr '\\0' '\\n'",
      "echo '== packages'; ls -d */__init__.py src/*/__init__.py 2>/dev/null",
      "echo '== manifests'; for f in pyproject.toml setup.cfg package.json; do [ -f \"$f\" ] && echo \"$f $(base64 -w0 \"$f\")\"; done",
      "echo '== end'",
    ].join("; ");
    const r = dockerRun("eb-leak-" + randomBytes(6).toString("hex"), ["--rm", "--network", "none", "--user", "0:0", "--label", "gstack-evals.eb=leak", "--entrypoint", "sh", "-v", dir + ":/eb:ro", o.image, "-c", scan], { timeoutMs: 1800000 });
    if (r.status !== 0) fail("E_EB_LEAK", o.unit + " step=leak class=scan_failed: the image scan did not finish (docker exited " + r.status + ")");
    const section = (name: string) => {
      const m = new RegExp("^== " + name + "\\n([\\s\\S]*?)(?=^== )", "m").exec(r.stdout);
      return m ? m[1].split("\n").filter(Boolean) : [];
    };
    const manifests = Object.fromEntries(section("manifests").map((l) => [l.slice(0, l.indexOf(" ")), Buffer.from(l.slice(l.indexOf(" ") + 1), "base64").toString("utf8")]));
    const { leaks, installed } = sortHits(section("hits").sort(), projectNames({ repo: o.repo, runner: o.runner }, section("packages"), manifests), section("tracked"));
    if (leaks.length > 0) fail("E_EB_LEAK", o.unit + " step=leak class=fix_or_merge_lines: " + leaks.length + " files in the image hold a later fix's or the merge's lines");
    return { needles: o.needles.length, leaks, installed: installed.length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The leak check on the session image a builder runs in: the unit image with the session layer on top and the
 * project's dependency folders copied under /work/repo, built (or reused) by id, so a needle the session layer brings in
 * refuses the unit the same way a needle in the unit image does. */
export function sessionLeakCheck(o: { unit: string; image: string; repo: string; runner: Runner; needles: string[]; docker?: string }): LeakResult {
  if (o.needles.length === 0) return { needles: 0, leaks: [], installed: 0 };
  return leakCheck({ ...o, image: sessionImage(o.image, { docker: o.docker }).id });
}
