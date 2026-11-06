// Copyright (c) 2026 Garry Tan. MIT License.
// The real-CLI capture behind shape.test.ts's TBV_REAL_CLI=1 test: Claude Code 2.1.312 and gstack at 641d622 from
// ~/.capy/work, keyless against the stub provider. Captured text stays in ~/.capy/work/tbv-capture; this prints only
// sha256s, sizes, the per-family overhead and the cache_control blocks Claude Code sent.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { captureShape, type StubRequest } from "../../lanes/tbv/shape.ts";
import { captureSplice } from "../../lanes/tbv/splice.ts";

const PIN = "641d62291c510954d30d967b2c6fc0c785a6d37f";

/** Every cache_control in the first tool-bearing request, as where:ttl. */
const breakpoints = (reqs: StubRequest[]): string => {
  const body = reqs.find((r) => Array.isArray(r.body.tools) && (r.body.tools as unknown[]).length > 0)?.body ?? {};
  const found: string[] = [];
  const walk = (v: unknown, where: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, where + "[" + i + "]"));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "cache_control") found.push(where + ":" + ((x as { ttl?: string }).ttl ?? "5m"));
        else walk(x, where === "" ? k : where + "." + k);
      }
    }
  };
  walk({ system: body.system, tools: body.tools, messages: body.messages }, "");
  return found.length + " (" + found.join(", ") + ")";
};

export async function realCapture(): Promise<string> {
  const work = join(homedir(), ".capy/work");
  const claude = join(work, "cc/node_modules/.bin/claude");
  const gstack = join(work, "gstack-641d622");
  const out = join(work, "tbv-capture");
  mkdirSync(out, { recursive: true });
  const lines: string[] = [];
  let currentChars = 0;
  for (const arm of ["none", "current"] as const) {
    let reqs: StubRequest[] = [];
    const s = await captureShape({ arm, pin: arm === "none" ? null : PIN, claude, gstack: arm === "none" ? null : gstack, out, onRequests: (r) => (reqs = r) });
    const chars = JSON.stringify([s.system, s.tools]).length;
    if (arm === "current") currentChars = chars;
    lines.push("shape " + arm + " sha256 " + s.sha256 + " chars " + chars + " est " + Math.ceil(chars / 3) + " max_tokens " + s.max_tokens + " cache_control " + breakpoints(reqs));
  }
  for (const family of ["investigate", "ship", "capy"] as const) {
    let reqs: StubRequest[] = [];
    const sp = await captureSplice({ family, pin: PIN, claude, gstack, out, onRequests: (r) => (reqs = r) });
    const chars = JSON.stringify([sp.opening, sp.head, sp.tail]).length;
    lines.push(
      "splice " + family + " sha256 " + sp.sha256 + " chars " + chars + " est " + Math.ceil(chars / 3) + " overhead(system+tools+splice) " + Math.ceil((currentChars + chars) / 3) +
        " files " + sp.files.map((f) => f.path).join(",") + " skill start " + (sp.skillStart ? "clean" : "none (capy)") + " cache_control " + breakpoints(reqs),
    );
  }
  return lines.join("\n");
}
