// eng-build kit: the leak needles before and after the -f change, on a synthetic repo. Prints counts only.
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// usage: bun needles-both.ts <label old|new> <added lines> <path to that checkout's lanes/eng-build/leak.ts>
const which = process.argv[2]!;
const n = Number(process.argv[3]!);
const { leakNeedles } = await import(process.argv[4]!);
const repo = mkdtempSync(join(tmpdir(), "needles-fx-"));
const g = (...a: string[]) => { const r = spawnSync("git", ["-C", repo, "-c", "user.name=fx", "-c", "user.email=fx@example.invalid", ...a], { encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
g("init", "-q", "-b", "main");
mkdirSync(join(repo, "src"));
const keep = Array.from({ length: 50 }, (_, i) => "const existing_value_" + i + " = compute_something(" + i + ");");
writeFileSync(join(repo, "src/a.go"), keep.join("\n") + "\n");
g("add", "-A"); g("commit", "-q", "-m", "base"); const base = g("rev-parse", "HEAD");
const added = Array.from({ length: n }, (_, i) => "const added_line_number_" + i + " = another_function_call(" + i + ", \"-e\");");
writeFileSync(join(repo, "src/a.go"), keep.join("\n") + "\n" + keep.slice(0, 10).join("\n") + "\n" + added.join("\n") + "\n");
g("add", "-A"); g("commit", "-q", "-m", "merge"); const merge = g("rev-parse", "HEAD");
writeFileSync(join(repo, "src/b.go"), "const fix_line_added_by_the_fix = repair(1, 2, 3);\n" + keep[3] + "\n");
g("add", "-A"); g("commit", "-q", "-m", "fix"); const fix = g("rev-parse", "HEAD");
try {
  const out = leakNeedles(repo, base, merge, [fix]) as string[];
  const h = spawnSync("sha256sum", { input: out.join("\n"), encoding: "utf8" }).stdout.slice(0, 16);
  console.log(which, "n=" + n, "needles=" + out.length, "digest=" + h);
} catch (e) { console.log(which, "n=" + n, "threw=" + String((e as Error).message).slice(0, 90)); }
