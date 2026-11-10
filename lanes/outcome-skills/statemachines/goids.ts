// Copyright (c) 2026 Garry Tan. MIT License.
// Bare Go test ids (B3, post section 3). A dataset parser that keys a Go test by its bare name lets one package's result
// overwrite another's when two packages define that name. The oracle drops such ids from the fail-to-pass and stable
// sets; an id with a package path before the test name is never touched.
import { runBash, type Where } from "./history.ts";
import { smFail } from "./unit.ts";

const TOP = /^(Test|Benchmark|Example|Fuzz)/;
const DEF = /^func ((?:Test|Benchmark|Example|Fuzz)[A-Za-z0-9_]*)\(/;
const SCAN = `cd "$1" || exit 2; grep -rE --include='*_test.go' '^func (Test|Benchmark|Example|Fuzz)[A-Za-z0-9_]*\\(' .; echo "DEFSEXIT $?" >&2`;

/** Each top-level test func name and the package dirs that define it: grep lines (./path:source) over the tree's
 *  *_test.go files, plus the funcs the base patches add to *_test.go files. Dirs the go tool skips (vendor, testdata, a
 *  part starting with . or _) are left out, and a method never matches. */
export function goTestDefs(grep: string, patches: string[]): Map<string, Set<string>> {
  const defs = new Map<string, Set<string>>();
  const add = (path: string, src: string) => {
    const m = src.match(DEF);
    const dir = path.replace(/^\.\//, "").split("/").slice(0, -1).join("/") || ".";
    if (!m || !path.endsWith("_test.go") || dir.split("/").some((p) => p === "vendor" || p === "testdata" || (p !== "." && /^[._]/.test(p)))) return;
    defs.set(m[1]!, (defs.get(m[1]!) ?? new Set<string>()).add(dir));
  };
  for (const line of grep.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) add(line.slice(0, i), line.slice(i + 1));
  }
  for (const p of patches) {
    let file = "";
    for (const line of p.split("\n")) {
      if (line.startsWith("+++ ")) file = line.slice(4).replace(/^b\//, "");
      else if (line.startsWith("+")) add(file, line.slice(1));
    }
  }
  return defs;
}

/** The drop rule: a bare id (its first part is the test name, so a subtest counts as its top-level test) whose name more
 *  than one package dir defines. */
export function goAmbiguous(defs: Map<string, Set<string>>): (id: string) => boolean {
  return (id) => {
    const top = id.split("/")[0]!;
    return TOP.test(top) && (defs.get(top)?.size ?? 0) > 1;
  };
}

/** goTestDefs over the tree in where, with the base patches' new funcs. A scan that does not finish fails closed: the
 *  unit drops as E_SM_AMBIGUOUS_TEST. */
export function goDefsIn(where: Where, patches: string[]): Map<string, Set<string>> {
  const r = runBash(where, SCAN);
  const exit = (r.stderr.match(/DEFSEXIT (\d+)/) ?? [])[1];
  if (exit !== "0" && exit !== "1") smFail("E_SM_AMBIGUOUS_TEST", "the Go test func scan did not finish (grep exit " + (exit ?? "none") + "); the unit drops, fail closed");
  return goTestDefs(r.stdout, patches);
}
