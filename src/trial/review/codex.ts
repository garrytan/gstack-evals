// Review units on Codex (review-units --host codex; the Codex hooks eval's part C, wiki/plans/2026-11-19-geva-562-codex-
// hooks-prereg, sections 2 and 5.2). What a Codex arm adds to a review run, kept here so run.ts and cli.ts only wire it in.
//
// - The codex-arms file (schema_version 1) names the Codex CLI every session runs (bin, a path in the arm image; null runs
//   the image's default codex) and, per arm: effort (model_reasoning_effort), hook_trust (--dangerously-bypass-hook-trust),
//   settings (extra -c pairs), gstack_config (keys appended to the trial's gstack config, as a stack cell's are), switches
//   (the gstack-config keys init.json records), install (the stack's installer on codex; null keeps gstack's own
//   ./setup --host codex) and told_prefix (the prompt's prefix; on Codex a gstack arm's opens with $review). Every arm the
//   run names needs an entry and no entry names another arm. The file's sha256 rides in run.json.
// - Before the first session, each arm's model input is captured in the arm's own image with "<bin> debug prompt-input",
//   the arm's settings and its prompt for a unit on base branch main. It makes no model call. The text goes to
//   <out>/captures/<arm id>.txt, its sha256 into every session's init.json, and a capture that fails refuses the run
//   (E_CODEX_CAPTURE) before any session.
// - After each session the trial copies the state root's hooks/ (gstack's hook logs) and skill-contracts/ (the contract
//   hook's records) beside the session's records, as host/gstack-hooks and host/gstack-contracts; the driver copies the
//   rollouts to host/codex-sessions.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sessionRead } from "../../adapters/codex/driver.ts";
import type { Sandbox } from "../sandbox.ts";

export interface CodexArmSpec {
  effort: string | null;
  hook_trust: boolean;
  settings: Record<string, string | number | boolean>;
  gstack_config: Record<string, string>;
  switches: string[];
  install: string | null;
  told_prefix: string | null;
}

export interface CodexArms {
  bin: string | null;
  arms: Record<string, CodexArmSpec>;
  sha256: string;
}

/** The state root's folders a Codex session copies out, and where under the session's host/ dir. */
export const CODEX_COPY_DIRS: readonly { from: string; to: string }[] = [
  { from: "hooks", to: "gstack-hooks" },
  { from: "skill-contracts", to: "gstack-contracts" },
];

const isScalar = (v: unknown): v is string | number | boolean => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

/** The codex-arms file's arms, checked against the arms the run names; throws an Error whose message opens with E_USAGE. */
export function parseCodexArms(text: string, names: readonly string[]): CodexArms {
  const refuse = (why: string): never => {
    throw new Error("E_USAGE: --codex-arms " + why);
  };
  let v: any;
  try {
    v = JSON.parse(text);
  } catch {
    return refuse("is not JSON");
  }
  if (v?.schema_version !== 1) refuse("needs schema_version 1");
  if (v.bin !== null && (typeof v.bin !== "string" || !v.bin.startsWith("/"))) refuse("bin must be null or an absolute path in the arm image");
  if (typeof v.arms !== "object" || v.arms === null || Array.isArray(v.arms)) refuse("needs an arms object");
  const extra = Object.keys(v.arms).filter((n) => !names.includes(n));
  if (extra.length) refuse("names arms the run does not: " + extra.join(", "));
  const arms: Record<string, CodexArmSpec> = {};
  for (const name of names) {
    const a = v.arms[name];
    if (typeof a !== "object" || a === null) refuse("has no entry for arm " + name);
    const at = "arm " + name + ": ";
    if (a.effort !== null && (typeof a.effort !== "string" || !/^[a-z]+$/.test(a.effort))) refuse(at + "effort must be null or a level such as low");
    if (typeof a.hook_trust !== "boolean") refuse(at + "hook_trust must be true or false");
    if (typeof a.settings !== "object" || a.settings === null || Array.isArray(a.settings) || !Object.values(a.settings).every(isScalar)) refuse(at + "settings must map -c keys to strings, numbers or booleans");
    if (typeof a.gstack_config !== "object" || a.gstack_config === null || Array.isArray(a.gstack_config) || !Object.entries(a.gstack_config).every(([k, x]) => /^[a-z_]+$/.test(k) && typeof x === "string" && !/[\n\r]/.test(x))) refuse(at + "gstack_config must map config keys to one-line strings");
    if (!Array.isArray(a.switches) || !a.switches.every((k: unknown) => typeof k === "string" && /^[a-z_]+$/.test(k))) refuse(at + "switches must list gstack-config keys");
    if (a.install !== null && (typeof a.install !== "string" || !a.install.trim())) refuse(at + "install must be null or a command");
    if (a.told_prefix !== null && (typeof a.told_prefix !== "string" || /[\n\r]/.test(a.told_prefix) || !/^\$[a-z][a-z0-9-]*( |$)/.test(a.told_prefix))) refuse(at + "told_prefix must be null or one line that opens with a $skill mention, such as $review");
    arms[name] = { effort: a.effort, hook_trust: a.hook_trust, settings: { ...a.settings }, gstack_config: { ...a.gstack_config }, switches: [...a.switches], install: a.install, told_prefix: a.told_prefix };
  }
  return { bin: v.bin, arms, sha256: createHash("sha256").update(text).digest("hex") };
}

/** Reads and checks a codex-arms file. */
export const loadCodexArms = (file: string, names: readonly string[]): CodexArms => parseCodexArms(readFileSync(file, "utf8"), names);

/** The argv of an arm's keyless model-input capture: "<bin> debug prompt-input" with the model, bundled skills off, the arm's settings and its prompt. */
export function captureArgv(bin: string | null, model: string, spec: Pick<CodexArmSpec, "settings">, prompt: string): string[] {
  const pairs = Object.entries({ model, "skills.bundled.enabled": false, ...spec.settings }).flatMap(([k, x]) => ["-c", k + "=" + JSON.stringify(x)]);
  return [bin ?? "codex", "debug", "prompt-input", ...pairs, prompt];
}

/** Runs one arm's capture in its sandbox and writes it under dir; returns the file and its sha256, or why it failed. */
export async function captureArm(sandbox: Sandbox, o: { argv: string[]; dir: string; id: string; home: string }): Promise<{ file: string; sha256: string } | { problem: string }> {
  const work = join(o.dir, "work-" + o.id);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  let box;
  try {
    box = sandbox.agent("capture", { work, env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: o.home, LANG: "C.UTF-8", TERM: "dumb" }, network: null });
  } catch (e) {
    return { problem: "the arm's sandbox could not start: " + (e as Error).message };
  }
  try {
    const r = await sessionRead(box, o.argv, 120_000, 64 * 1024 * 1024);
    const shown = o.argv.slice(0, 3).join(" ");
    if (!r) return { problem: shown + " did not finish within 120 s or printed over 64 MiB" };
    if (r.code !== 0 || !r.out.length) return { problem: shown + " exited " + r.code + (r.out.length ? "" : " with no output") };
    const file = join(o.dir, o.id + ".txt");
    writeFileSync(file, r.out);
    return { file, sha256: createHash("sha256").update(r.out).digest("hex") };
  } finally {
    box.stop();
    rmSync(work, { recursive: true, force: true });
  }
}
