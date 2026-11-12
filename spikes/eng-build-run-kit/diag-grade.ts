// eng-build kit diagnostic: one verifier run of a unit's functional set on its merged tree; prints statuses, shapes and counts only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyTree } from "../gstack-evals/lanes/real-outcome/task/verify.ts";
import { readUnit, treePatch, treeGrid, inScope, goSubtest } from "../gstack-evals/lanes/eng-build/unit.ts";
const dir = process.argv[2]!, work = process.argv[3]!;
const { eb, task } = readUnit(dir);
const set = eb.sets[0]!;
const shape = (id: string) => id.replace(/[A-Za-z0-9_]+/g, "x");
const split = (id: string) => { const i = id.indexOf("::"); return i < 0 ? ["", id] : [id.slice(0, i), id.slice(i + 2)]; };
for (const sg of set.groups) {
  const g = eb.groups[sg.group]!;
  const k = g.runner.kind;
  console.log("group", sg.group, g.eco, k, "targets=" + sg.targets.length, "scopes=" + sg.scopes.length, "targetsInScope=" + sg.targets.filter((t) => inScope(k, t, sg.scopes)).length, "targetShapes=" + JSON.stringify([...new Set(sg.targets.map(shape))]), "scopeShapes=" + JSON.stringify([...new Set(sg.scopes.map(shape))]));
  const t = verifyTree({ taskDir: dir, task: { ...task, runner: g.runner }, image: eb.image.id, label: "diag-" + sg.group, patch: readFileSync(join(dir, treePatch("merged")), "utf8"), runs: 1, seed: 1, work, testsDir: join(dir, set.dir), ids: sg.targets, cold: true });
  console.log("  patch=" + t.prepare.patch, "error=" + (t.prepare.error ? "yes" : "none"));
  const spk = new Set(sg.scopes.map((s) => split(s)[0])), stn = new Set(sg.scopes.map((s) => split(s)[1]));
  for (const r of t.runs as any[]) {
    const grid = treeGrid({ ...t, runs: [r] }, k, sg.scopes, sg.targets);
    const hist: Record<string, number> = {};
    for (const v of Object.values(grid)) hist[String(v[0])] = (hist[String(v[0])] ?? 0) + 1;
    console.log("  run exit=" + r.exit, "timed_out=" + r.timed_out, "seen=" + r.parsed.seen.length, "results=" + Object.keys(r.parsed.results).length, "gridWithWant=" + JSON.stringify(hist));
    const agg: Record<string, number> = {}; const msgs = new Set<string>();
    for (const [id, st] of Object.entries(r.parsed.results)) {
      const [p, n] = split(id);
      const msg = String((st as any).msg ?? "");
      const pats = ["git ls-remote", "dial tcp", "missing go.sum entry", "no required module provides", "cannot find module", "undefined:", "updates to go.mod needed", "proxy.golang.org", "GOPROXY", "GOFLAGS", "-mod=vendor", "inconsistent vendoring", "not found", "permission denied", "read-only file system", "cannot find package", "is not in std", "build constraints exclude", "go.mod requires go", "toolchain", "too many errors", "imported and not used", "declared and not used", "cannot use", "has no field or method", "redeclared", "syntax error", "exec:", "cgo", "gcc", "terminal prompts disabled", "could not read Username", "unknown revision", "invalid version", "module lookup disabled", "GOFLAGS=-mod=mod", "malformed", "verifying", "checksum mismatch", "no such file or directory", "build failed", "[setup failed]"];
      const WL = new Set("error obtaining vcs status exit use buildvcs false true to disable stamping cannot find package module not found undefined git fatal detected dubious ownership in repository at safe directory permission denied build failed fail setup no such file or open read only system go mod requires toolchain download downloading lookup disabled by goproxy off goflags vendor vendoring inconsistent missing sum entry for provides imported used declared and too many errors invalid version unknown revision cgo gcc exec executable path signal killed panic test timed out after matching cache gocache home mkdir is a the of with as value type has field method assignment mismatch arguments call few syntax unexpected expected redeclared this block other declaration conflicting command main import cycle not allowed std goroot gopath could get set config global add exception run warning note see help file directory list ls remote https http dial tcp i o timeout network unreachable connection refused proxy verifying checksum malformed language newer older than than min max is required please upgrade switch available local run vet flag provided but defined usage of files pattern matching matched match embed stat lstat space left device host packages contain contains does exclude constraints all non-test tests testing tag tags compiler compile link linker ld asm writing creating removing loading parsing found required tool running loadinternal runtime gotip go1 vcs-status safe.directory owned someone else current user dubious-ownership internal use disallowed relative paths supported mode mod readonly updates needed tidy listed but present ambiguous multiple modules provide work workspace replaced replacement doesn't exist exists empty invalid char character illegal sources source line instance generic generics requires go1.18 or later".split(" "));
      const mask = msg.split(String.fromCharCode(10)).map((ln) => ln.split(/(\s+)/).map((tok) => /^\s+$/.test(tok) ? " " : tok.split(/([:;,()'"\[\]=])/).map((w) => w === "" || /^[:;,()'"\[\]=]$/.test(w) ? w : WL.has(w.toLowerCase().replace(/^-+/, "")) ? w : /^\d+$/.test(w) ? "N" : /[\/.]/.test(w) ? "<p>" : "x" + w.length).join("")).join("")).join(" | ");
      if (mask) msgs.add(mask.slice(0, 300));
      const key = ["shape=" + shape(id), "status=" + (st as any).status, "cls=" + (st as any).cls, "inScope=" + inScope(k, id, sg.scopes), "inTargets=" + sg.targets.includes(id), "collect=" + id.startsWith("collect:")].join(" ");
      agg[key] = (agg[key] ?? 0) + 1;
    }
    for (const [kk, n] of Object.entries(agg)) console.log("   " + n + "x " + kk);
    for (const mm of [...msgs].slice(0, 4)) console.log("    masked=" + mm);
    const keys = Object.keys(r.parsed).filter((x) => !["seen", "results"].includes(x));
    console.log("   parsed other keys=" + keys.join(","));
    const out = String(r.stdout ?? r.output ?? "");
    if (out) console.log("   outLen=" + out.length);
    console.log("   runKeys=" + Object.keys(r).join(","));
  }
}
