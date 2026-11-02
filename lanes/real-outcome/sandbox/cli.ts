// gstack-evals real sandbox: the ship sandbox's sidecar (B4, plan 2026-11-01-geva-87 section 12 step 4).
//
//   gstack-evals real sandbox serve --root <dir> --agent-host <ip> [--agent-port 8790] [--control-port 8791]
//   gstack-evals real sandbox gh-surface <gstack tree>
//
// serve runs the evaluator-owned sidecar beside the metering proxy until it is stopped; it prints SIDECAR_READY with both
// URLs. gh-surface lists the gh calls a pinned gstack tree's /ship makes and whether the sandbox serves each one.
import { parseArgs } from "node:util";
import { CODES, docAnchor } from "../../../src/errors/codes.ts";
import { ghSurface } from "./gh-surface.ts";
import { startSidecar } from "./sidecar.ts";

const fail = (code: "E_USAGE" | "E_REAL_SANDBOX_SETUP", message: string): number => {
  console.error([code + " " + message, code + " fix: " + CODES[code].fix, code + " docs: " + docAnchor(code)].join("\n"));
  return 2;
};

export async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "serve") {
    let v;
    try {
      v = parseArgs({ args: rest, options: { root: { type: "string" }, "agent-host": { type: "string" }, "agent-port": { type: "string", default: "8790" }, "control-port": { type: "string", default: "8791" } } }).values;
    } catch (e) {
      return fail("E_USAGE", (e as Error).message);
    }
    if (!v.root || !v["agent-host"]) return fail("E_USAGE", "serve needs --root and --agent-host");
    for (const bin of ["git", "jq"]) if (Bun.spawnSync([bin, "--version"]).exitCode !== 0) return fail("E_REAL_SANDBOX_SETUP", bin + " is not on PATH; the sidecar needs git (with http-backend) and jq");
    let h;
    try {
      h = startSidecar({ root: v.root, agentHost: v["agent-host"], agentPort: Number(v["agent-port"]), controlPort: Number(v["control-port"]) });
    } catch (e) {
      return fail("E_REAL_SANDBOX_SETUP", "the sidecar could not listen: " + (e as Error).message);
    }
    console.log("SIDECAR_READY control=" + h.controlUrl + " agent=" + h.agentUrl);
    await new Promise<void>((done) => {
      for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => (h.stop(), done()));
    });
    return 0;
  }
  if (sub === "gh-surface") {
    if (!rest[0]) return fail("E_USAGE", "gh-surface needs the path of a gstack tree");
    const rows = ghSurface(rest[0]);
    for (const r of rows) console.log((r.served ? "served   " : "UNSERVED ") + r.shape + "\t" + r.files.join(","));
    console.log("SURFACE served=" + rows.filter((r) => r.served).length + " unserved=" + rows.filter((r) => !r.served).length + " (an unserved call is journaled as a rig error)");
    return 0;
  }
  return fail("E_USAGE", "gstack-evals real sandbox serve|gh-surface");
}
