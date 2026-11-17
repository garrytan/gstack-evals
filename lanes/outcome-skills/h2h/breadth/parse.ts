// Copyright (c) 2026 Garry Tan. MIT License.
// The report-parser rules on the harness side (plan section 6). parsers.py holds the parsers; a unit's parser.py is that
// file with its FORMAT line, which the state machines oracle and scorer run in their sandbox. This file builds that text,
// runs it keylessly with the host's python3 for checks and tests, writes the print command that frames each report file,
// and reads a test id back into its parts (context, file, name) so test discovery can tell which of the fix's test files
// a test belongs to.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h2hFail } from "../prereg.ts";

export const FORMATS = ["junit", "junit-playwright", "trx", "go-json", "cargo", "jest-json", "vitest-json"] as const;
export type ReportFormat = (typeof FORMATS)[number];
export const PARSERS_PY = join(import.meta.dir, "parsers.py");
/** Where every report goes, relative to the repository root. */
export const REPORT_DIR = ".h2h-reports";
export const REPO_ROOT_IN_IMAGE = "/testbed";

/** A unit's parser.py: parsers.py, its FORMAT, and parser(log). */
export function unitParser(format: ReportFormat): string {
  if (!FORMATS.includes(format)) h2hFail("E_H2H_B_REPORT", "no parser for format " + JSON.stringify(format));
  return readFileSync(PARSERS_PY, "utf8") + "\n\nFORMAT = " + JSON.stringify(format) + "\n\n\ndef parser(log):\n    return parse(FORMAT, log)\n";
}

/** Runs a unit's parser over a log with the host's python3 (no network is needed or used). Refuses (E_H2H_B_REPORT) on a
 *  parser error. */
export function parseLocal(format: ReportFormat, log: string): Record<string, string> {
  const prog = unitParser(format) + "\nimport sys\nprint('H2H_PARSED ' + json.dumps(parser(sys.stdin.read()), sort_keys=True))\n";
  const r = spawnSync("python3", ["-c", prog], { input: log, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120_000, env: { PATH: process.env.PATH ?? "" } });
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("H2H_PARSED "));
  if (r.status !== 0 || !line) return h2hFail("E_H2H_B_REPORT", format + " report did not parse: " + (r.stderr ?? "").trim().slice(-300));
  return JSON.parse(line.slice(11));
}

/** The print command: each report file under its marker line, in the order bash expands the globs. A glob that matches
 *  nothing prints its own marker and an empty report, which the parsers skip. A find root walks instead of a glob. */
export const printCommand = (globs: string[]): string => "for f in " + globs.join(" ") + "; do echo \"===H2H_REPORT $f===\"; cat \"$f\"; echo; done";
export const printFind = (root: string, path: string): string => "for f in $(find " + root + " -path " + JSON.stringify(path) + "); do echo \"===H2H_REPORT $f===\"; cat \"$f\"; echo; done";

/** The parts of a test id as parsers.py writes it. */
export interface IdParts { context: string; file: string; classname: string; name: string }
export function idParts(format: ReportFormat, id: string): IdParts {
  const p = id.split("::");
  const rest = (k: number) => p.slice(k).join("::");
  switch (format) {
    case "junit-playwright":
      return { context: (p[0] ?? "").replace(/^\[|\]$/g, "") + (p[1] ? " > " + p[1] : ""), classname: p[2] ?? "", file: p[3] || p[2] || "", name: rest(4) };
    case "junit":
      return { context: p[0] ?? "", classname: p[1] ?? "", file: p[2] ?? "", name: rest(3) };
    case "jest-json":
      return { context: "", classname: "", file: p[0] ?? "", name: rest(1) };
    case "vitest-json":
      return p[0]?.startsWith("[") ? { context: p[0].slice(1, -1), classname: "", file: p[1] ?? "", name: rest(2) } : { context: "", classname: "", file: p[0] ?? "", name: rest(1) };
    case "go-json":
      return { context: p[0] ?? "", classname: "", file: "", name: rest(1) };
    case "cargo":
      return { context: p[0] ?? "", classname: "", file: (p[0] ?? "").replace(/^(Running|Doc-tests)\s+(unittests\s+)?/, ""), name: rest(1) };
    case "trx":
      return { context: "", classname: p[0] ?? "", file: "", name: rest(1) };
  }
}

const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const stem = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.[^.]*$/, "");
const tail = (a: string, b: string) => !!a && !!b && (a === b || a.endsWith("/" + b) || b.endsWith("/" + a));

/** Which of the fix's test files a test id belongs to, by what its format names: a file path (Jest, Vitest, JUnit with a
 *  file or a file-named class, Playwright's spec path relative to its test dir), a Java class, a Go package, a cargo test
 *  target or a .NET class. Undefined when the format names nothing that can be matched (Karma's JUnit), so discovery
 *  cannot use it; null when it names something that matches none of the files. */
export function testFileOf(format: ReportFormat, id: string, files: readonly string[]): string | null | undefined {
  const x = idParts(format, id);
  if (format === "go-json") return files.find((f) => f.endsWith("_test.go") && (dir(f) === "" || tail(x.context, dir(f)))) ?? null;
  if (format === "trx") return files.find((f) => x.classname === stem(f) || x.classname.endsWith("." + stem(f))) ?? null;
  if (format === "cargo") return files.find((f) => tail(x.file, f)) ?? null;
  const named = [x.file, x.classname, ...x.context.split(" > ")].filter((s) => /\.[cm]?[jt]sx?$|\.(java|kt|cs|go|rs)$/.test(s));
  const javaClass = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(x.classname) && !/\.[cm]?[jt]sx?$/.test(x.classname) ? x.classname.replace(/\./g, "/") : "";
  if (!named.length && !javaClass) return undefined;
  return files.find((f) => named.some((n) => tail(n, f)) || (javaClass && /\.(java|kt)$/.test(f) && f.replace(/\.(java|kt)$/, "").endsWith(javaClass))) ?? null;
}
