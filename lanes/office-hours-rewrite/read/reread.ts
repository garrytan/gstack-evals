// Copyright (c) 2026 Garry Tan. MIT License.
// Section 9's re-reading of the assumptions for the office-hours rewrite eval (prereg
// wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, section 9, and its attachment power.py). After stage 1,
// power.py reruns at the stage's observed control rates, at rho 0.5 and 0.843: the founder rows' MDD pooled and for one
// model alone, with current as the control (new minus current) and with none (the contrasts against no gstack), and the
// builder check's pass share when nothing changes at the observed kept-whole rate. power.py runs as committed and checked
// against its front-matter sha256: the rerun executes its imports, assignments and functions, skips its printed grid,
// then calls its mdd(), layout(), builder_pairs() and builder_interval(). The runner is injected, so tests spawn nothing.
// The second attempt keeps section 9 and power.py's model unchanged, so power.py stays the first preregistration's.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PREREG_1 } from "../frozen.ts";
import type { ObservedMdd } from "./report.ts";

export const POWER_PY = join(import.meta.dir, "..", "..", "..", PREREG_1, "..", "power.py");
export const POWER_SHA256 = createHash("sha256").update(readFileSync(POWER_PY)).digest("hex");
export const RHO = [0.5, 0.843] as const;

/** Runs a python program with stdin and returns stdout. Injected so tests make no subprocess call. */
export type Python = (program: string, stdin: string) => string;
/** power.py's own header command: uv with its pinned numpy and scipy. */
export const python: Python = (program, stdin) => {
  const r = spawnSync("uv", ["run", "--with", "numpy==2.3.4", "--with", "scipy==1.16.2", "python", "-c", program], { input: stdin, encoding: "utf8" });
  if (r.status !== 0) throw new Error("E_OHR_READ_POWER power.py's rerun exited " + r.status + ": " + (r.stderr || r.error?.message || "").trim().split("\n").slice(-1)[0]);
  return r.stdout;
};

export const rereadProgram = (path: string) => `import ast, json, sys
tree = ast.parse(open(${JSON.stringify(path)}).read())
tree.body = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.Assign, ast.FunctionDef))]
ns = {}
exec(compile(tree, ${JSON.stringify(path)}, "exec"), ns)
np = ns["np"]
req = json.load(sys.stdin)
ids, nclus = ns["layout"](5, 6, 2)
out = {"founder": [], "builder": []}
for f in req["founder"]:
    for rho in req["rho"]:
        row = {"control": f["control"], "p0": f["p0"], "rho": rho}
        for key, models in (("pooled", 2), ("one_model", 1)):
            if f["p0"] + ns["STEPS"][0] >= 0.95:
                row[key] = "no room"
                continue
            rng = np.random.default_rng(ns["SEED"])
            row[key] = ns["mdd"](f["p0"], rho, ids, nclus, 1, models, rng)
        out["founder"].append(row)
for b in req["builder"]:
    for rho in req["rho"]:
        rng = np.random.default_rng(ns["SEED"])
        y1, y0 = ns["builder_pairs"](b["p0"], rho, 0.0, 24, rng)
        d, lo, hi = ns["builder_interval"](y1, y0)
        out["builder"].append({"p0": b["p0"], "rho": rho, "pass_share": float((lo > -ns["MARGIN"]).mean())})
print(json.dumps(out))
`;

export interface Reread {
  founder: Array<{ control: "current" | "none"; p0: number; rho: number; pooled: string; one_model: string }>;
  builder: Array<{ p0: number; rho: number; pass_share: number }>;
}

/** power.py's Beta needs a rate strictly inside 0 and 1. */
const clip = (p: number) => Math.min(0.99, Math.max(0.01, p));

/** Section 9's rerun at stage 1's observed control rates: current's and none's right-call rates, and current's kept-whole rate. */
export function reread(observed: { current: number; none: number; kept: number }, run: Python = python): Reread {
  const frozen = readFileSync(join(import.meta.dir, "..", "..", "..", PREREG_1), "utf8").match(/^ {2}- ([0-9a-f]{64}) {2}power\.py$/m)?.[1];
  if (frozen !== POWER_SHA256) throw new Error("E_OHR_READ_POWER power.py's sha256 " + POWER_SHA256 + " is not the preregistration's attachment " + frozen);
  const stdin = JSON.stringify({ founder: [{ control: "current", p0: clip(observed.current) }, { control: "none", p0: clip(observed.none) }], builder: [{ p0: clip(observed.kept) }], rho: RHO });
  const text = run(rereadProgram(POWER_PY), stdin);
  try {
    return JSON.parse(text.trim().split("\n").slice(-1)[0] ?? "") as Reread;
  } catch {
    throw new Error("E_OHR_READ_POWER power.py's rerun printed no JSON result");
  }
}

/** The lead table's observed MDD column: the rho 0.5 figure with the rho 0.843 figure beside it, as section 9 prints them. */
export function observedMdd(r: Reread): ObservedMdd {
  const out: Record<string, string> = {};
  const pick = (control: "current" | "none", rho: number) => r.founder.find((f) => f.control === control && f.rho === rho);
  for (const [name, control] of [["new minus current", "current"], ["new minus none", "none"], ["current minus none", "none"]] as const) {
    const a = pick(control, RHO[0]), b = pick(control, RHO[1]);
    if (!a || !b) continue;
    out[name + "|pooled"] = a.pooled + " (" + b.pooled + " at rho 0.843)";
    for (const m of ["opus", "sol"]) out[name + "|" + m] = a.one_model + " (" + b.one_model + " at rho 0.843)";
  }
  return out;
}
