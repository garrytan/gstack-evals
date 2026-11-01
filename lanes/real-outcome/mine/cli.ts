// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals real mine: repository sampling, per-repository mining and the per-repository panel cap. Keyless: no
// command calls a model; fetch-meta reads public GitHub metadata through gh.
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CODES, docAnchor, type ReasonCode } from "../../../src/errors/codes.ts";
import { CUTOFF } from "./exposure.ts";
import { fetchMeta } from "./fetch.ts";
import { MetaError, parseMeta } from "./meta.ts";
import { MineError, mineRepo, type Candidate, type MineResult } from "./mine.ts";
import { sampleRepos, type RepoCandidate } from "./sample.ts";
import { MAX_PER_REPO, selectPanel } from "./select.ts";

export const HELP = `Usage: gstack-evals real mine <command> [options]

  sample --from <repos.json> --mined-at <date> [--active-days <n>] [--min-window-commits <n>]
         [--exclude-packages <file>] [--out <file>]
      Filter candidate repositories (a JSON array of RepoCandidate, lanes/real-outcome/mine/sample.ts) by language,
      licence, activity, test runner, lockfile, Claude project config and the gstack-family rule. Prints the kept
      list, the dev pool, the dropped list with reasons and the kept list's digest.
  repo --repo-dir <full clone> --repo <owner/name> --mined-at <date> [--branch <ref>] [--meta <file>]
       [--window-start <date>] [--strict-start <date>] [--exclude-packages <file>] [--out <file>]
      Mine one repository: K2 and K3 candidates, SZZ and revert K1 pairs, exposure dates, strata and eligibility.
      Without --meta every exposure is incomplete and nothing is eligible. Window defaults: ${CUTOFF.window_start},
      strict stratum from ${CUTOFF.strict_start}.
  panel --from <mine.json> [--from <mine.json>]... --seed <text> [--per-repo <n>] [--out <file>]
      Keep at most --per-repo (default ${MAX_PER_REPO}) eligible tasks per repository, K1 first, no shared changes.
  fetch-meta --repo <owner/name> --since <date> --out <file>
      Write the metadata file for --meta from GitHub's GraphQL API through gh (public data, no model call).
`;

function fail(code: ReasonCode, message: string): number {
  const info = CODES[code];
  console.error([code + " " + message, code + " fix: " + info.fix, code + " docs: " + docAnchor(code)].join("\n"));
  return info.exit ?? 2;
}

const emit = (value: unknown, out: string | undefined) => {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
};

const isDate = (s: string | undefined): s is string => s !== undefined && !Number.isNaN(Date.parse(s));
const readList = (path: string | undefined): string[] => (path ? (JSON.parse(readFileSync(path, "utf8")) as string[]) : []);

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return cmd === undefined ? 2 : 0;
  }
  let v: Record<string, string | string[] | undefined>;
  try {
    v = parseArgs({
      args: rest,
      strict: true,
      options: {
        from: { type: "string", multiple: true },
        out: { type: "string" },
        "mined-at": { type: "string" },
        "active-days": { type: "string" },
        "min-window-commits": { type: "string" },
        "exclude-packages": { type: "string" },
        "repo-dir": { type: "string" },
        repo: { type: "string" },
        branch: { type: "string" },
        meta: { type: "string" },
        "window-start": { type: "string" },
        "strict-start": { type: "string" },
        seed: { type: "string" },
        "per-repo": { type: "string" },
        since: { type: "string" },
      },
    }).values as Record<string, string | string[] | undefined>;
  } catch (error) {
    return fail("E_USAGE", (error as Error).message);
  }
  const s = (k: string) => v[k] as string | undefined;
  const from = (v.from as string[] | undefined) ?? [];
  try {
    if (cmd === "sample") {
      if (from.length !== 1 || !isDate(s("mined-at"))) return fail("E_USAGE", "sample needs one --from and a --mined-at date");
      const cands = JSON.parse(readFileSync(from[0], "utf8")) as RepoCandidate[];
      if (!Array.isArray(cands)) return fail("E_REAL_MINE_INPUT", from[0] + " is not a JSON array of repositories");
      emit(sampleRepos(cands, { mined_at: s("mined-at")!, active_days: Number(s("active-days") ?? 30), min_window_commits: Number(s("min-window-commits") ?? 20), excluded_packages: readList(s("exclude-packages")) }), s("out"));
      return 0;
    }
    if (cmd === "repo") {
      if (!s("repo-dir") || !/^[\w.-]+\/[\w.-]+$/.test(s("repo") ?? "") || !isDate(s("mined-at"))) return fail("E_USAGE", "repo needs --repo-dir, --repo <owner/name> and a --mined-at date");
      const meta = s("meta") ? parseMeta(readFileSync(s("meta")!, "utf8")) : null;
      const window = { start: s("window-start") ?? CUTOFF.window_start, strict_start: s("strict-start") ?? CUTOFF.strict_start, mined_at: s("mined-at")! };
      if (!isDate(window.start) || !isDate(window.strict_start)) return fail("E_USAGE", "--window-start and --strict-start must be dates");
      emit(mineRepo({ repoDir: s("repo-dir")!, repo: s("repo")!, branch: s("branch") ?? "HEAD", meta, window, excludedPackages: readList(s("exclude-packages")) }), s("out"));
      return 0;
    }
    if (cmd === "panel") {
      if (from.length === 0 || !s("seed")) return fail("E_USAGE", "panel needs at least one --from and a --seed");
      const candidates: Candidate[] = from.flatMap((f) => (JSON.parse(readFileSync(f, "utf8")) as MineResult).candidates ?? []);
      emit(selectPanel(candidates, s("seed")!, Number(s("per-repo") ?? MAX_PER_REPO)), s("out"));
      return 0;
    }
    if (cmd === "fetch-meta") {
      if (!/^[\w.-]+\/[\w.-]+$/.test(s("repo") ?? "") || !isDate(s("since")) || !s("out")) return fail("E_USAGE", "fetch-meta needs --repo <owner/name>, a --since date and --out");
      try {
        emit(fetchMeta(s("repo")!, s("since")!), s("out"));
      } catch (error) {
        return fail("E_REAL_MINE_FETCH", (error as Error).message);
      }
      return 0;
    }
  } catch (error) {
    if (error instanceof MineError) return fail(error.code, error.message);
    if (error instanceof MetaError || error instanceof SyntaxError) return fail("E_REAL_MINE_INPUT", error.message);
    throw error;
  }
  return fail("E_USAGE", "unknown command " + JSON.stringify(cmd) + "; gstack-evals real mine --help lists them");
}
