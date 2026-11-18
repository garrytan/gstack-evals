// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ohr preflight: the no-model preflight of prereg section 12, step 1, for a fresh runner VM. It calls no
// model and needs no key: it refuses to run while any model key variable is set, so a key never reaches the host it
// checks. In order:
// - no model key variable is set in this process;
// - a git repository the rig reads (a gstack checkout, or one under the state directory's sources/) holds both pin
//   commits, and each pin's tree there holds the frozen VERSION and file hashes;
// - Docker answers;
// - the dry run (GSTACK_EVALS_DOCKER=1 is set for it) passes with no FAIL and no SKIP;
// - the keyless end to end and its scoring pass pass.
// It prints one PASS or FAIL line per step and exits 2 on any FAIL.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { stackSources } from "../../src/arms/install.ts";
import { stateRoot } from "../../src/trial/image.ts";
import { PINS } from "./frozen.ts";
import type { SkillArm } from "./types.ts";

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Env = Record<string, string | undefined>;

const KEY_VAR = /^(ANTHROPIC|OPENAI|OPENROUTER|GEMINI|GOOGLE|TYPESAFE|EXA)_API_KEY$/;
const git = (dir: string, args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });

/** The first source holding the pin's commit, with every frozen file's hash checked there; or why none does. */
export function pinSource(arm: SkillArm, sources: readonly string[]): { source: string | null; problems: string[] } {
  const pin = PINS[arm];
  if (!pin) return { source: null, problems: [arm + " has no pin"] };
  for (const src of sources) {
    if (git(src, ["cat-file", "-e", pin.sha + "^{commit}"]).status !== 0) continue;
    const problems: string[] = [];
    const version = git(src, ["show", pin.sha + ":VERSION"]).stdout.toString().trim();
    if (version !== pin.version) problems.push("VERSION " + (version || "missing") + ", not " + pin.version);
    for (const [path, sha] of Object.entries(pin.files)) {
      const r = git(src, ["show", pin.sha + ":" + path]);
      const got = r.status === 0 ? createHash("sha256").update(r.stdout).digest("hex") : "missing";
      if (got !== sha) problems.push(path + " " + got.slice(0, 12));
    }
    return { source: src, problems };
  }
  return { source: null, problems: ["no source holds " + pin.sha + " (looked in " + (sources.join(", ") || "nothing") + ")"] };
}

export async function run(argv: string[], io: Io, env: Env): Promise<number> {
  for (const a of argv) throw Object.assign(new Error("unknown argument " + JSON.stringify(a) + "; usage: gstack-evals ohr preflight"), { code: "E_USAGE" });
  const lines: { ok: boolean; name: string; detail: string }[] = [];
  const step = (ok: boolean, name: string, detail: string) => {
    lines.push({ ok, name, detail });
    io.out((ok ? "PASS " : "FAIL ") + name + (detail ? " (" + detail + ")" : ""));
    return ok;
  };
  const keys = Object.keys(env).filter((k) => KEY_VAR.test(k) && env[k]);
  if (!step(keys.length === 0, "no model key variable is set", keys.length ? "set: " + keys.join(", ") + "; the preflight runs only where no key is" : "")) {
    io.err("E_OHR_PREFLIGHT_FAIL ohr preflight: a model key is set; unset it and run again");
    return 2;
  }
  const sources = stackSources({ root: null, home: homedir(), state: stateRoot(env) });
  for (const arm of ["current", "new"] as const) {
    const p = pinSource(arm, sources);
    step(p.source !== null && p.problems.length === 0, arm + " pin " + PINS[arm]!.sha.slice(0, 7) + ": the commit, VERSION and every frozen file hash", p.source ? p.source + (p.problems.length ? ": " + p.problems.join("; ") : "") : p.problems.join("; "));
  }
  const docker = env.GSTACK_EVALS_DOCKER_BIN || "docker";
  const up = spawnSync(docker, ["info"], { stdio: "ignore" }).status === 0;
  step(up, "Docker answers", up ? "" : docker + " info failed");
  if (up) {
    const before = process.env.GSTACK_EVALS_DOCKER;
    process.env.GSTACK_EVALS_DOCKER = "1";
    try {
      const out: string[] = [];
      const code = await (await import("./dryrun.ts")).run([], { out: (t) => out.push(t), err: (t) => out.push(t) });
      step(code === 0, "the dry run passes with no FAIL and no SKIP", out.filter((l) => /^ohr dryrun:/.test(l) || /^(FAIL|SKIP) /.test(l)).join("; "));
    } finally {
      if (before === undefined) delete process.env.GSTACK_EVALS_DOCKER;
      else process.env.GSTACK_EVALS_DOCKER = before;
    }
    const out: string[] = [];
    const code = await (await import("./e2e-score.ts")).run([], { out: (t) => out.push(t), err: (t) => out.push(t) });
    step(code === 0, "the keyless end to end and its scoring pass pass", out.filter((l) => /^ohr e2e:|^E_OHR/.test(l)).join("; "));
  }
  const failed = lines.filter((l) => !l.ok);
  io.out("ohr preflight: " + (lines.length - failed.length) + " PASS, " + failed.length + " FAIL");
  if (failed.length) io.err("E_OHR_PREFLIGHT_FAIL ohr preflight: " + failed.map((l) => l.name).join("; "));
  return failed.length ? 2 : 0;
}
