// eng-build kit: the frozen recount (lanes/eng-build/recount.ts recountUnit, unchanged) over a units dir in N parallel
// worker processes, then one summary in recount.ts's own words. Counts only.
// usage: bun recount-par.ts --units <dir> --work <dir> --jobs <n> [--custody <id,id>] [--ids <file of ids to recount>]
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { recountUnit, type RecountRow } from "../gstack-evals/lanes/eng-build/recount.ts";
import { FROZEN } from "../gstack-evals/lanes/eng-build/frozen.ts";
const { values: v } = parseArgs({ options: { units: { type: "string" }, work: { type: "string" }, jobs: { type: "string" }, custody: { type: "string" }, ids: { type: "string" }, part: { type: "string" }, out: { type: "string" } } });
const custody = new Set((v.custody ?? "").split(",").filter(Boolean));
let dirs = readdirSync(v.units!).filter((d) => existsSync(join(v.units!, d, "eb.json"))).sort();
if (v.ids) { const keep = new Set(readFileSync(v.ids, "utf8").split(/\s+/).filter(Boolean)); dirs = dirs.filter((d) => keep.has(d)); }
if (v.part !== undefined) {
  const [i, n] = v.part.split("/").map(Number);
  const mine = dirs.filter((_, k) => k % n! === i);
  const work = join(v.work!, "p" + i);
  mkdirSync(work, { recursive: true });
  const rows = mine.map((d) => recountUnit(join(v.units!, d), { work, custody: custody.has(d) }));
  writeFileSync(v.out!, JSON.stringify(rows));
  process.exit(0);
}
const jobs = Number(v.jobs ?? "4");
const procs = Array.from({ length: jobs }, (_, i) => Bun.spawn(["bun", import.meta.path, "--units", v.units!, "--work", v.work!, "--part", i + "/" + jobs, "--out", join(v.work!, "rows-" + i + ".json"), ...(v.custody ? ["--custody", v.custody] : []), ...(v.ids ? ["--ids", v.ids] : [])], { stdout: "ignore", stderr: "ignore" }));
const codes = await Promise.all(procs.map((p) => p.exited));
if (codes.some((c) => c !== 0)) { console.error("E_INTERNAL recount worker exits " + codes.join(",")); process.exit(2); }
const rows: RecountRow[] = codes.flatMap((_, i) => JSON.parse(readFileSync(join(v.work!, "rows-" + i + ".json"), "utf8")));
writeFileSync(join(v.work!, "rows.json"), JSON.stringify(rows, null, 1) + "\n");
const clean = rows.filter((r) => r.clean).length;
const reasons = new Map<string, number>();
for (const r of rows) if (r.reason) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
console.log("recount: " + rows.length + " units read, " + clean + " clean, threshold " + FROZEN.recount.minClean);
for (const [reason, n] of [...reasons].sort()) console.log("  not clean, " + reason + ": " + n);
if (clean < FROZEN.recount.minClean) { console.error("E_EB_FEW_UNITS " + clean + " clean build-read units against " + FROZEN.recount.minClean + "; no lease opened. Take the clean count to the Captain."); process.exit(2); }
