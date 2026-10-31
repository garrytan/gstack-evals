// Per-cell settings for a stack arm (plan 2026-10-30-geva-59-stacks-round-1-plan, section 5): what an arm's install
// holds or runs differently with the cell's model, so arms.json and the session key can record a tree per arm and cell.
//
// - A cell is the session's model and the cross-family voice it admits: gpt-6.1-sol in the Opus cells, none in a cheap
//   cell, where every role and reader runs on the cell's model.
// - pstack: ~/.claude/rules/pstack-models.md, the rule pstack's setup-pstack writes. It is derived at build time from the
//   rule shape in the pinned tree's setup-pstack SKILL.md (its step 5) and mapped as pstack's Claude Code adapter says:
//   in a voice cell each Claude slug becomes "<family> <effort>" and every other slug inherit-parent, so pstack's Grok
//   seats run on the session model; in a cheap cell every value is inherit-parent, list lengths kept, since a panel's
//   length sets its fan-out. The shape is read from the installed tree, so no pstack text is stored in this repo.
// - gstack: config keys for the trial's state root, appended after the seed (seedStateRoot's extra): agent_model host,
//   so its readers run on the parent model, and codex_reviews enabled only in a voice cell.
// - Codex: in a voice cell, an arm whose stack keeps a voice (gstack's outside voice, tstack's Sol reviewer) gets the
//   Claude Code driver's codex option, which writes the session's ~/.codex/config.toml with no credential in it.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dirTreeSha256 } from "../trial/cache.ts";
import { canonicalize, InstallError, type ArmInstall, type Layer } from "./install.ts";
import { stackKind } from "./stacks.ts";
import type { StackRef } from "../types.ts";

export interface Cell {
  model: string;
  /** The cross-family voice the cell's proxy allowlist admits, or null when every role runs on model. */
  voice: string | null;
}

export interface CellSettings {
  cell: Cell;
  /** Files the cell adds under HOME on top of the arm's layers, or null. */
  layer: Layer | null;
  /** Keys the trial appends to the gstack state root's config.yaml; empty for an arm without gstack. */
  gstack_config: Record<string, string>;
  /** The Claude Code driver's codex option for this cell, or null. */
  codex: { model: string } | null;
  /** The arm's tree for this cell: the session key's arm tree when cells differ. */
  tree_sha256: string;
}

export const PSTACK_RULE = ".claude/rules/pstack-models.md";
const SLUG = /^claude-([a-z]+)-(?:\d+-)*\d+-(max|xhigh|high|medium|low)(?:-fast)?$/;
/** A Grok slug as pstack's rule writes one. Its seats run on the session model under Claude Code. */
const GROK = /^grok-\d+(?:\.\d+)*-(?:max|xhigh|high|medium|low)(?:-fast)?$/;

/** The cross-family voice each model's cell keeps (plan section 5): gpt-6.1-sol in the Opus 5.5 cells. Every other model's cell runs every role on the model. */
export const VOICES: Readonly<Record<string, string>> = { "claude-opus-5-5": "gpt-6.1-sol" };

export const cellFor = (model: string): Cell => ({ model, voice: VOICES[model] ?? null });

/**
 * pstack's model rule for a cell, from setup-pstack's SKILL.md; null when the file holds no rule shape with role lines.
 * A value that is not a Claude slug, a Grok slug, auto or inherit-parent refuses with E_CELL_RULE, since the cell could
 * not say which model that role would run on.
 */
export function pstackModelsRule(setupSkill: string, cell: Cell): string | null {
  const lines = setupSkill.split("\n");
  const step = lines.findIndex((l) => /^#{2,4}\s*5\.\s/.test(l));
  const open = step < 0 ? -1 : lines.findIndex((l, i) => i > step && l.startsWith("```"));
  const close = open < 0 ? -1 : lines.findIndex((l, i) => i > open && l.startsWith("```"));
  if (close < 0) return null;
  let body = lines.slice(open + 1, close);
  if (body[0] === "---") body = body.slice(body.indexOf("---", 1) + 1);
  const map = (role: string, v: string): string => {
    if (v === "auto" || v === "inherit-parent") return cell.voice ? v : "inherit-parent";
    const m = SLUG.exec(v);
    if (m) return cell.voice ? m[1] + " " + m[2] : "inherit-parent";
    if (GROK.test(v)) return "inherit-parent";
    throw new InstallError("E_CELL_RULE", "setup-pstack's rule gives the role " + JSON.stringify(role) + " the value " + JSON.stringify(v) + ", which is not a Claude slug, a Grok slug, auto or inherit-parent, so the cell cannot say which model that role runs on");
  };
  let roles = 0;
  const out = body.map((l) => {
    const m = /^([^#:][^:]*):\s*(.+)$/.exec(l);
    if (!m) return l;
    roles++;
    return m[1] + ": " + m[2]!.split(",").map((v) => map(m[1]!, v.trim())).join(", ");
  });
  return roles ? out.join("\n").trim() + "\n" : null;
}

/**
 * The settings of one arm in one cell. A cell that adds files writes its layer under dir, in a folder named by its
 * content, so cells may share dir. The folder is written beside its final name and renamed into place, so a concurrent
 * build on the same dir never sees half a layer; a folder already there with other bytes is replaced the same way.
 */
export function cellSettings(install: ArmInstall, cell: Cell, dir: string): CellSettings {
  const kind = install.provenance.kind === "stack" ? stackKind(install.provenance.stack as StackRef) : null;
  let layer: Layer | null = null;
  if (kind?.plugin && install.plugins.length) {
    const root = join(install.layers[0]!.src, install.plugins[0]!);
    const file = join(root, "skills", "setup-pstack", "SKILL.md");
    const inside = existsSync(file) && realpathSync(file).startsWith(realpathSync(root) + "/") && statSync(file).isFile();
    let rule: string | null;
    try {
      rule = inside ? pstackModelsRule(readFileSync(file, "utf8"), cell) : null;
    } catch (error) {
      if (error instanceof InstallError) throw new InstallError(error.code, "arm " + install.name + ": " + error.detail, error.fix);
      throw error;
    }
    if (rule === null) throw new InstallError("E_CELL_RULE", "arm " + install.name + ": " + install.plugins[0] + "/skills/setup-pstack/SKILL.md is missing, leaves the plugin, or holds no rule shape with role lines in its step 5, so the cell's " + PSTACK_RULE + " cannot be derived");
    const at = join(dir, createHash("sha256").update(rule).digest("hex").slice(0, 16));
    const holds = () => existsSync(join(at, PSTACK_RULE)) && readFileSync(join(at, PSTACK_RULE), "utf8") === rule;
    if (!holds()) {
      const tmp = at + ".tmp-" + process.pid + "-" + randomBytes(4).toString("hex");
      mkdirSync(join(tmp, ".claude", "rules"), { recursive: true });
      writeFileSync(join(tmp, PSTACK_RULE), rule);
      canonicalize(tmp, null);
      if (existsSync(at)) renameSync(at, tmp + ".old");
      try {
        renameSync(tmp, at);
      } catch (error) {
        if (!holds()) throw error;
      } finally {
        rmSync(tmp, { recursive: true, force: true });
        rmSync(tmp + ".old", { recursive: true, force: true });
      }
    }
    layer = { src: at, dest: "" };
  }
  const gstack_config: Record<string, string> = install.gstack ? { agent_model: "host", codex_reviews: cell.voice ? "enabled" : "disabled" } : {};
  const codex = cell.voice && (install.gstack || kind?.voice) ? { model: cell.voice } : null;
  const parts = [install.tree_sha256, layer ? PSTACK_RULE + " " + dirTreeSha256(layer.src) : "", JSON.stringify(gstack_config), JSON.stringify(codex)];
  return { cell, layer, gstack_config, codex, tree_sha256: createHash("sha256").update(parts.join("\n")).digest("hex") };
}
