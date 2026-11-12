// eng-build run kit: review units (base tree, plan, engphase opening) for the units in specs.json. Counts only.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderEngPhase } from "../gstack-evals/lanes/eng-review/render.ts";
const out = "/dev/shm/eb525/run";
const specs = JSON.parse(readFileSync(join(out, "specs.json"), "utf8")) as { spec: { id: string; set: string } }[];
const ck = "/dev/shm/eb525/ck/units";
const units: unknown[] = [];
const errs: Record<string, number> = {};
for (const { spec } of specs) {
  const u = JSON.parse(readFileSync(join(ck, spec.id, "unit.json"), "utf8"));
  try {
    const o = renderEngPhase({ gstack: join(out, "gstack-engphase"), plan: readFileSync(join(out, "plans", spec.id + ".md"), "utf8"), out: join(out, "openings", spec.id) });
    units.push({ id: spec.id, set: spec.set, rank: u.rank, repo: join(out, "trees", spec.id), plan: join(out, "plans", spec.id + ".md"), opening: { text: o.text, methodology: o.methodology, readRanges: o.readRanges, mounts: o.files.map((f) => ({ host: f.host, path: f.mount })) } });
  } catch (e) {
    const m = String((e as Error).message);
    writeFileSync(join(out, "render-errors.log"), spec.id + " " + m + "\n", { flag: "a" });
    const cat = m.replace(/\/[^\s"']+/g, "<path>").replace(/[0-9a-f]{7,}/g, "<hex>").replace(/"[^"]*"/g, "<q>").slice(0, 140);
    errs[cat] = (errs[cat] ?? 0) + 1;
  }
}
writeFileSync(join(out, "review-units.json"), JSON.stringify(units, null, 1) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ rendered: units.length, errors: errs }));
