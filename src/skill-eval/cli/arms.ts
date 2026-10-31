// The arm grammar (interface v0.4, "Call"), one grammar on every command: name=<dir>, name=<repo>@<sha>,
// name=<loadout.json>, none, placebo and bare. Each resolves to an ArmSpec (src/types.ts).
//
// - before and after are required and take a value; none, placebo and bare are bare words. before2 is the noise floor,
//   a second copy of before that the call adds on its own (--no-noise-floor drops it).
// - A <dir> arm holds a SKILL.md. A <repo>@<sha> arm names a full 40-character sha and needs --skill. A <file>.json arm
//   is a loadout manifest (plan Amendment A1, unreviewed).
// - Base: --base gstack@<sha> with --skill overlays before and after on that tree, makes none the base minus the target
//   skill, and allows bare (no gstack). Without --base, a rendered gstack skill folder (<root>/<skill>/SKILL.md beside
//   <root>/bin/gstack-skill-start) infers --base gstack@<git -C <root> rev-parse HEAD> --skill <basename>. before's
//   folder is read first, so the base is the tree as it was before the edit and only the target skill differs between
//   before and after; an explicit --base overrides.
// - With no base, arms are loose folders, as in skill-diet. A loose folder that calls gstack bins is refused with
//   E_LOOSE_GSTACK, since it would measure gstack's degraded mode. Its fix line carries resolved values: the skill name
//   and the sha of a gstack checkout found on this machine, or the clone command when there is none.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ArmSpec, LoadoutManifest, StackRef } from "../../types.ts";
import { stackKind } from "../../arms/stacks.ts";

export const ARM_ORDER = ["before", "before2", "after", "none", "placebo", "bare"];
const VALUE_ARMS = ["before", "after"];
const WORD_ARMS = ["none", "placebo", "bare"];

const REPO = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/;
const SHA = /^[0-9a-f]{40}$/;
/** An arm or skill name. It holds no slash or dot, so it is safe as one path segment. */
export const NAME = /^[a-z][a-z0-9_-]*$/;
/** A call to a gstack bin, as rendered skills write it (~/.claude/skills/gstack/bin/gstack-learnings-search). */
export const GSTACK_BIN_CALL = /\bbin\/gstack-[a-z0-9][a-z0-9-]*/;

export interface Base {
  ref: StackRef;
  /** "--base", or the arm it was inferred from. */
  source: string;
  /** The checkout the base was read from, when inferred. */
  root: string | null;
}

export interface ResolvedArms {
  arms: ArmSpec[];
  base: Base | null;
  skill: { name: string; source: string } | null;
  /** Notes for the effective defaults block. */
  notes: string[];
}

export type ArmsResult = ResolvedArms | { code: "E_USAGE" | "E_LOOSE_GSTACK"; message: string; fix?: string };

const git = (cwd: string, args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });

function headOf(root: string): string | null {
  const r = git(root, ["rev-parse", "HEAD"]);
  return r.status === 0 && SHA.test(r.stdout.trim()) ? r.stdout.trim() : null;
}

/** The checkout that holds a rendered gstack skill folder, or null when the folder is not one. */
export function renderedRoot(dir: string): string | null {
  const root = dirname(resolve(dir));
  return existsSync(join(dir, "SKILL.md")) && existsSync(join(root, "bin", "gstack-skill-start")) ? root : null;
}

/** A subtree path: plain names joined by slashes, with no . or .. part. */
const SUBTREE = /^(?!(.*\/)?\.\.?(\/|$))[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/** Parses gstack@<sha> or <owner>/<repo>@<sha>, either with :<path> for one folder of the commit. */
export function parseStackRef(text: string): StackRef | string {
  const at = text.lastIndexOf("@");
  const repo = text.slice(0, at);
  const colon = text.indexOf(":", at + 1);
  const sha = colon < 0 ? text.slice(at + 1) : text.slice(at + 1, colon);
  const path = colon < 0 ? null : text.slice(colon + 1);
  if (at < 1 || !REPO.test(repo)) return JSON.stringify(text) + " is not <repo>@<sha>[:<path>]";
  if (!SHA.test(sha)) return JSON.stringify(text) + " needs the full 40-character commit sha (git rev-parse " + (sha || "HEAD") + ")";
  if (path !== null && !SUBTREE.test(path)) return JSON.stringify(text) + ": the subtree path must be relative, made of plain names, such as harness/pstack/claude-code";
  return path === null ? { repo, sha } : { repo, sha, path };
}

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat?.isDirectory() && depth < 3 && !name.startsWith(".")) walk(path, depth + 1);
      else if (stat?.isFile() && name.endsWith(".md")) out.push(path);
    }
  };
  walk(dir, 0);
  return out;
}

/** A loose folder's skill name: its SKILL.md front matter name, else the folder's name. */
export function skillName(dir: string): string {
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(dir, "SKILL.md"), "utf8"))?.[1] ?? "";
  return /^name:\s*["']?([A-Za-z0-9_.-]+)["']?\s*$/m.exec(front)?.[1] ?? basename(dir);
}

export const callsGstackBins = (dir: string): boolean => markdownFiles(dir).some((f) => GSTACK_BIN_CALL.test(readFileSync(f, "utf8")));

/** gstack checkouts on this machine, as the fix line for a loose folder names them: [root, sha]. */
export function gstackCheckouts(home = homedir()): [string, string][] {
  const roots = [join(home, ".claude", "skills", "gstack"), join(home, ".codex", "skills", "gstack"), join(home, ".local", "share", "gstack")];
  const seen = new Set<string>();
  return roots.flatMap((root): [string, string][] => {
    if (!existsSync(join(root, "bin", "gstack-skill-start"))) return [];
    const sha = headOf(root);
    if (!sha || seen.has(sha)) return [];
    seen.add(sha);
    return [[root, sha]];
  });
}

function loadout(path: string): LoadoutManifest | string {
  let v: any;
  try {
    v = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return path + " is not a loadout manifest: " + (error as Error).message;
  }
  const kinds = ["skill", "section", "overlay", "preamble-tier"];
  const ok =
    typeof v === "object" && v !== null && Object.keys(v).every((k) => ["name", "base", "modules"].includes(k)) &&
    typeof v.name === "string" && NAME.test(v.name) && typeof v.base === "string" && typeof parseStackRef(v.base) === "object" &&
    Array.isArray(v.modules) && v.modules.length > 0 && v.modules.every((m: any) => typeof m === "object" && m && Object.keys(m).every((k) => k === "kind" || k === "id") && kinds.includes(m.kind) && typeof m.id === "string" && m.id.length > 0);
  return ok ? (v as LoadoutManifest) : path + " is not a loadout manifest {name, base: \"gstack@<sha>\", modules: [{kind, id}]} (schema/arms.schema.json#/$defs/loadout)";
}

type Raw = { name: string; dir?: string; stack?: StackRef; loadout?: LoadoutManifest };

export function resolveArms(spec: readonly string[], flags: { base?: string; skill?: string }, home = homedir()): ArmsResult {
  const usage = (message: string) => ({ code: "E_USAGE" as const, message: "--arms: " + message });
  const raws: Raw[] = [];
  for (const token of spec) {
    const eq = token.indexOf("=");
    const name = eq < 0 ? token : token.slice(0, eq);
    if (raws.some((r) => r.name === name)) return usage(name + " given twice");
    if (name === "before2") return usage("before2 is the noise floor, a second copy of before that is added by default (--no-noise-floor drops it)");
    if (WORD_ARMS.includes(name)) {
      if (eq >= 0) return usage(name + " takes no value");
      raws.push({ name });
      continue;
    }
    if (!VALUE_ARMS.includes(name)) return usage("unknown arm " + JSON.stringify(name) + "; arms are before=<spec>, after=<spec>, none, placebo and bare");
    const value = eq < 0 ? "" : token.slice(eq + 1);
    if (!value) return usage(name + " needs a value: <dir>, <repo>@<sha> or <loadout.json>");
    const stat = statSync(value, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      if (!existsSync(join(value, "SKILL.md"))) return usage(name + "=" + value + " holds no SKILL.md");
      raws.push({ name, dir: resolve(value) });
    } else if (stat?.isFile() && value.endsWith(".json")) {
      const manifest = loadout(value);
      if (typeof manifest === "string") return usage(manifest);
      raws.push({ name, loadout: manifest });
    } else if (value.includes("@") && !stat) {
      const ref = parseStackRef(value);
      if (typeof ref === "string") return usage(name + ": " + ref);
      raws.push({ name, stack: ref });
    } else return usage(name + "=" + value + " is not a skill folder, a <repo>@<sha> or a loadout .json file");
  }
  for (const name of VALUE_ARMS) if (!raws.some((r) => r.name === name)) return usage(name + "=<spec> is required");

  const notes: string[] = [];
  let base: Base | null = null;
  if (flags.skill && !NAME.test(flags.skill)) return { code: "E_USAGE", message: "--skill " + JSON.stringify(flags.skill) + " is not a skill name: a lowercase letter, then lowercase letters, digits, - or _" };
  let skill: ResolvedArms["skill"] = flags.skill ? { name: flags.skill, source: "--skill" } : null;
  if (flags.base) {
    const ref = parseStackRef(flags.base);
    if (typeof ref === "string") return { code: "E_USAGE", message: "--base: " + ref };
    if (!skill) return { code: "E_USAGE", message: "--base needs --skill <name>, the target skill inside the base" };
    base = { ref, source: "--base", root: null };
  } else {
    for (const r of ["before", "after"].map((n) => raws.find((x) => x.name === n)!)) {
      const root = r.dir ? renderedRoot(r.dir) : null;
      if (!root) continue;
      const sha = headOf(root);
      if (!sha) return { code: "E_LOOSE_GSTACK", message: r.name + "=" + r.dir + " is a rendered gstack skill folder, but " + root + " has no git commit, so its base cannot be pinned", fix: "Commit the gstack checkout at " + root + ", or pass --base gstack@<its full sha> --skill " + basename(r.dir!) + " for a checkout that has one. Do not --resume." };
      const name = basename(r.dir!);
      if (!base) {
        base = { ref: { repo: "gstack", sha }, source: "inferred from " + r.name + " (" + root + ")", root };
        if (skill && skill.name !== name) return { code: "E_USAGE", message: "--skill " + skill.name + " does not match the rendered skill folder " + r.dir + " (" + name + ")" };
        skill ??= { name, source: "inferred from " + r.name };
      } else if (sha !== base.ref.sha) notes.push(r.name + " comes from " + root + " at " + sha.slice(0, 12) + ": it is overlaid on the base, so only its " + name + "/ folder is measured");
      if (skill && name !== skill.name) return { code: "E_USAGE", message: r.name + "=" + r.dir + " is the skill " + name + ", not " + skill.name };
    }
  }
  const needsSkill = raws.some((r) => r.stack);
  if (needsSkill && !skill) return { code: "E_USAGE", message: "a <repo>@<sha> arm needs --skill <name>, the target skill inside that tree" };
  if (raws.some((r) => r.name === "bare") && !base) return usage("bare (no gstack) needs a base; without --base it is the same as none");

  if (!base) {
    const loose = raws.find((r) => r.dir && callsGstackBins(r.dir));
    if (loose) {
      const name = flags.skill ?? skillName(loose.dir!);
      const found = gstackCheckouts(home);
      const fix = found.length
        ? "Pass --base gstack@" + found[0]![1] + " --skill " + name + " (the gstack checkout at " + found[0]![0] + ")" + (found.length > 1 ? ", or --base gstack@" + found[1]![1] + " for " + found[1]![0] : "") + ", or point the arm at a rendered gstack skill folder. Do not --resume."
        : "Clone gstack (git clone https://github.com/garrytan/gstack.git ~/.local/share/gstack), then pass --base gstack@$(git -C ~/.local/share/gstack rev-parse HEAD) --skill " + name + ", or point the arm at a rendered gstack skill folder. Do not --resume.";
      return { code: "E_LOOSE_GSTACK", message: loose.name + "=" + loose.dir + " calls gstack bins, but no gstack root holds it: it is not <root>/" + name + "/ beside <root>/bin/gstack-skill-start, and no --base was given", fix };
    }
  }

  const ordered = ARM_ORDER.flatMap((n) => raws.filter((r) => r.name === n));
  const arms = ordered.map((r): ArmSpec => {
    if (r.name === "none") return base ? { name: "none", kind: "overlay", base: base.ref, skill: skill!.name, dir: null } : { name: "none", kind: "bare" };
    if (r.name === "bare") return { name: "bare", kind: "bare" };
    if (r.name === "placebo") return { name: "placebo", kind: "placebo", of: "before" };
    if (r.loadout) return { name: r.name, kind: "loadout", manifest: r.loadout };
    if (r.stack) return { name: r.name, kind: "stack", stack: r.stack, install: { ...stackKind(r.stack)?.install } };
    return { name: r.name, kind: "overlay", base: base?.ref ?? null, skill: skill?.name ?? skillName(r.dir!), dir: r.dir! };
  });
  return { arms, base, skill, notes };
}
