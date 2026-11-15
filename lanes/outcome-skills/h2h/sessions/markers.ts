#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// Freezes the exposure detectors' markers (post section 8) from each pack's code at its prereg.json pin. Run once on
// clones checked out at the pins; it refuses a clone at any other commit, and writes markers.json: each pack's skill
// and command names, the marker strings the detectors look for (each one checked present in the pinned file it comes
// from), pstack's playbook steps as sha256 digests of their first six words (no step text is copied), and the sha256 of
// every file read. Usage: bun lanes/outcome-skills/h2h/sessions/markers.ts --packs <dir> [--out <markers.json>]
// <dir> holds gstack, superpowers, agent-skills, gsd, cursor-plugins, tstack and ponystack clones.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { h2hFail, readPrereg } from "../prereg.ts";

export const MARKERS_PATH = join(import.meta.dir, "markers.json");
export const CLONES: Record<string, string> = { gstack: "gstack", superpowers: "superpowers", "agent-skills": "agent-skills", gsd: "gsd", pstack: "cursor-plugins", tstack: "tstack", ponystack: "ponystack" };
const PSTACK_ROOT = "harness/pstack/claude-code";

export interface PackMarkers {
  pin: string;
  /** The plugin name a plugin pack's skills and commands are namespaced by, or null for a files pack. */
  plugin: string | null;
  skills: string[];
  commands: string[];
  /** Marker strings, each found in the pinned file named in sources. */
  strings: Record<string, string>;
  /** pstack only: per playbook, sha256 of the first six words (bare, lower case) of its first two numbered steps. */
  playbooks?: Record<string, string[]>;
}
export interface Markers { schema: "h2h-markers.v1"; packs: Record<string, PackMarkers>; sources: Record<string, string> }

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
/** A step's or a todo's lead: punctuation and symbols dropped, lower case, its first six words. */
export const lead = (text: string): string => text.replace(/[\p{P}\p{S}]/gu, " ").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6).join(" ");

export function freeze(dir: string): Markers {
  const p = readPrereg();
  const sources: Record<string, string> = {};
  const read = (pack: string, rel: string): string => {
    const file = join(dir, CLONES[pack]!, rel);
    if (!existsSync(file)) h2hFail("E_H2H_EXPOSURE", pack + " has no " + rel + " at its pin");
    const text = readFileSync(file, "utf8");
    sources[pack + ":" + rel] = sha(text);
    return text;
  };
  const has = (pack: string, rel: string, s: string): string => (read(pack, rel).includes(s) ? s : h2hFail("E_H2H_EXPOSURE", pack + "'s " + rel + " does not hold " + JSON.stringify(s)));
  const skillDirs = (pack: string, rel: string): string[] => readdirSync(join(dir, CLONES[pack]!, rel), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(dir, CLONES[pack]!, rel, e.name, "SKILL.md"))).map((e) => e.name).sort();
  const pin = (pack: string): string => {
    const head = spawnSync("git", ["-C", join(dir, CLONES[pack]!), "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    const want = p.pins[pack]?.sha;
    if (!want || head !== want) h2hFail("E_H2H_EXPOSURE", "the " + pack + " clone is at " + (head || "no commit") + ", not prereg.json's pin " + want);
    return head;
  };
  const pluginName = (pack: string, rel: string) => String(JSON.parse(read(pack, rel)).name);
  const playbooks: Record<string, string[]> = {};
  const pb = join(PSTACK_ROOT, "skills/poteto-mode/playbooks");
  for (const f of readdirSync(join(dir, CLONES.pstack!, pb)).filter((f) => f.endsWith(".md")).sort()) {
    const steps = read("pstack", join(pb, f)).split("\n").filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s+/, ""));
    if (steps.length) playbooks[basename(f, ".md")] = steps.slice(0, 2).map((s) => sha(lead(s)));
  }
  const packs: Record<string, PackMarkers> = {
    gstack: { pin: pin("gstack"), plugin: null, skills: [has("gstack", "SKILL.md", "name: gstack") && "gstack", ...skillDirs("gstack", ".")].sort(), commands: [], strings: { skill_start: has("gstack", "autoplan/SKILL.md", "gstack-skill-start --skill"), browse: has("gstack", "browse/SKILL.md", "browse/dist/browse"), verify_nudge: has("gstack", "verify/SKILL.md", "name: verify") } },
    superpowers: { pin: pin("superpowers"), plugin: pluginName("superpowers", ".claude-plugin/plugin.json"), skills: skillDirs("superpowers", "skills"), commands: [], strings: { banner: has("superpowers", "hooks/session-start", "You have superpowers."), announce: has("superpowers", "skills/using-superpowers/SKILL.md", "announce \"Using [skill] to [purpose]\"") } },
    "agent-skills": { pin: pin("agent-skills"), plugin: pluginName("agent-skills", ".claude-plugin/plugin.json"), skills: skillDirs("agent-skills", "skills"), commands: readdirSync(join(dir, CLONES["agent-skills"]!, ".claude/commands")).filter((f) => f.endsWith(".md")).map((f) => basename(f, ".md")).sort(), strings: { spec: has("agent-skills", "skills/spec-driven-development/SKILL.md", "SPEC.md"), plan: has("agent-skills", ".claude/commands/plan.md", "tasks/plan.md"), prove_it: has("agent-skills", ".claude/commands/test.md", "must FAIL") } },
    gsd: { pin: pin("gsd"), plugin: null, skills: skillDirs("gsd", "skills"), commands: [], strings: { run: has("gsd", "skills/gsd-quick/SKILL.md", "gsd_run"), tools: has("gsd", "gsd-core/workflows/debug.md", "gsd-tools"), quick_dir: has("gsd", "skills/gsd-quick/SKILL.md", ".planning/quick/"), debug_dir: has("gsd", "commands/gsd/debug.md", ".planning/debug") } },
    pstack: { pin: pin("pstack"), plugin: pluginName("pstack", join(PSTACK_ROOT, "plugin.json")), skills: skillDirs("pstack", join(PSTACK_ROOT, "skills")), commands: [], strings: { todo_rule: has("pstack", join(PSTACK_ROOT, "skills/poteto-mode/SKILL.md"), "Open a todolist whose first items are the matched playbook's steps") }, playbooks },
    tstack: { pin: pin("tstack"), plugin: null, skills: skillDirs("tstack", "skills"), commands: [], strings: { sol_loop: has("tstack", "skills/full-send/SKILL.md", "sol-loop"), file_pr: has("tstack", "skills/full-send/SKILL.md", "file-pr"), babysit_pr: has("tstack", "skills/full-send/SKILL.md", "babysit-pr") } },
    ponystack: { pin: pin("ponystack"), plugin: pluginName("ponystack", ".claude-plugin/plugin.json"), skills: skillDirs("ponystack", "skills"), commands: [], strings: { banner: has("ponystack", "hooks/ponystack-hook.js", "PONYSTACK ACTIVE"), phase: has("ponystack", "hooks/ponystack-hook.js", "PONYSTACK PHASE: ") } },
  };
  return { schema: "h2h-markers.v1", packs, sources };
}

/** Reads markers.json and refuses one whose pins are not prereg.json's. */
export function readMarkers(file = MARKERS_PATH): Markers {
  const m = JSON.parse(readFileSync(file, "utf8")) as Markers;
  if (m.schema !== "h2h-markers.v1") h2hFail("E_H2H_EXPOSURE", file + " is not h2h-markers.v1");
  const p = readPrereg();
  for (const [pack, pm] of Object.entries(m.packs)) if (p.pins[pack]?.sha !== pm.pin) h2hFail("E_H2H_EXPOSURE", file + " froze " + pack + " at " + pm.pin + ", not prereg.json's pin " + p.pins[pack]?.sha);
  return m;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const at = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const packs = at("--packs") ?? h2hFail("E_USAGE", "usage: markers.ts --packs <dir> [--out <file>]");
  writeFileSync(at("--out") ?? MARKERS_PATH, JSON.stringify(freeze(packs), null, 1) + "\n");
}
