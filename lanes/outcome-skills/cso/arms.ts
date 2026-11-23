// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 2 and 4 (harness plan 15.2): the arms. none takes the head-to-head's clean-room recipe (no install); cso
// and untold share the head-to-head's gstack recipe (gstack's README clone and ./setup, then its CLAUDE.md section) at
// prereg.json's gstack pin, so both see one home. Each installed tree is hashed, checked against the pin's files_sha256,
// and scanned for every candidate's ids and fixed dependencies (deviations (a) and (c)); a hit in any arm drops the unit
// from every cell. The Codex arms of the conditional Sol stage are a typed stub over src/adapters/codex/driver.ts that
// takes its model and CLI version from the session record.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { codexArgs, type CodexProvider } from "../../../src/adapters/codex/driver.ts";
import { homeTreeSha256 } from "../h2h/arms/hash.ts";
import { installHome, type InstallRecord } from "../h2h/arms/install.ts";
import { recipe, type Recipe } from "../h2h/arms/recipes.ts";
import { readPrereg, type H2hPrereg } from "../h2h/prereg.ts";
import { csoFail, type CsoPrereg } from "./prereg.ts";
import type { CsoArm, SessionRecord } from "./types.ts";
import { containDeps, type DepContain, type UnitAffected } from "./units/deps.ts";
import type { UnitIds } from "./units/ids.ts";
import { containInstall, type InstallContain } from "./units/install-contain.ts";

/** The head-to-head home each arm installs: cso and untold share gstack's. */
export const CSO_HOME: Record<CsoArm, "none" | "gstack"> = { none: "none", cso: "gstack", untold: "gstack" };
/** Where gstack's README clone lands under the arm's HOME. */
export const GSTACK_DIR = ".claude/skills/gstack";

/** The head-to-head prereg with its gstack pin replaced by this plan's, so h2h's recipe and install run at this pin. The
 *  CLAUDE.md section is h2h's frozen text: this plan freezes none of its own (a gap named in the report). */
export function csoH2hPrereg(p: CsoPrereg, h: H2hPrereg = readPrereg()): H2hPrereg {
  const g = p.pins.gstack;
  if (!g.sha || !/^[0-9a-f]{40}$/.test(g.sha)) csoFail("E_CSO_ARM", "prereg.json's gstack pin has no 40-hex sha");
  return { ...h, pins: { ...h.pins, gstack: { repo: g.repo, sha: g.sha!, version: g.version } } };
}

/** The install recipe for an arm's home at this plan's pin. */
export const csoRecipe = (arm: CsoArm, p: CsoPrereg, h?: H2hPrereg): Recipe => recipe(CSO_HOME[arm], csoH2hPrereg(p, h));

/** Checks an installed home against the pin: a gstack home holds every pinned file at its sha256, and a none home holds no
 *  gstack checkout (E_CSO_ARM otherwise). Returns the file hashes read. */
export function checkPinnedFiles(arm: CsoArm, home: string, pins: Record<string, string>): Record<string, string> {
  const dir = join(resolve(home), GSTACK_DIR);
  if (CSO_HOME[arm] === "none") {
    if (existsSync(dir)) csoFail("E_CSO_ARM", arm + ": the clean-room home holds " + GSTACK_DIR);
    return {};
  }
  const out: Record<string, string> = {};
  for (const [f, want] of Object.entries(pins)) {
    const at = join(dir, f);
    if (!existsSync(at)) csoFail("E_CSO_ARM", arm + ": " + GSTACK_DIR + "/" + f + " is missing");
    out[f] = createHash("sha256").update(readFileSync(at)).digest("hex");
    if (out[f] !== want) csoFail("E_CSO_ARM", arm + ": " + GSTACK_DIR + "/" + f + " has sha256 " + out[f] + ", not the pinned " + want);
  }
  return out;
}

export interface CsoArmRecord {
  schema: "cso-arm.v1";
  arm: CsoArm;
  home: "none" | "gstack";
  home_tree_sha256: string;
  files_sha256: Record<string, string>;
  install: InstallRecord | null;
  contain_ids: InstallContain;
  contain_deps: DepContain;
}

/** Verifies an installed home and scans it for every candidate (deviations (a) and (c)). */
export function verifyArm(arm: CsoArm, home: string, p: CsoPrereg, units: { ids: readonly UnitIds[]; affected: readonly UnitAffected[] }, install: InstallRecord | null = null): CsoArmRecord {
  const files = checkPinnedFiles(arm, home, p.pins.gstack.files_sha256);
  const sha = homeTreeSha256(resolve(home));
  if (install?.home_tree_sha256 && install.home_tree_sha256 !== sha) csoFail("E_CSO_ARM", arm + ": the home's tree hash " + sha + " differs from its install record's " + install.home_tree_sha256);
  return { schema: "cso-arm.v1", arm, home: CSO_HOME[arm], home_tree_sha256: sha, files_sha256: files, install, contain_ids: containInstall({ arm, root: home, units: units.ids }), contain_deps: containDeps({ arm, root: home, units: units.affected }) };
}

/** Installs an arm's home with h2h's recipe at this pin (Docker, network for the clone only), then verifies it. */
export function installArm(arm: CsoArm, o: { home: string; sources: string; p: CsoPrereg; units: { ids: readonly UnitIds[]; affected: readonly UnitAffected[] } }): CsoArmRecord {
  const rec = installHome(CSO_HOME[arm], { home: o.home, sources: o.sources, prereg: csoH2hPrereg(o.p) });
  return verifyArm(arm, o.home, o.p, o.units, rec);
}

/** The units that drop from every cell: the union over every arm of its id hits and its fixed-dependency hits. */
export function everyCellDrops(records: readonly CsoArmRecord[]): { id: string[]; dep: string[] } {
  return { id: [...new Set(records.flatMap((r) => r.contain_ids.dropped))].sort(), dep: [...new Set(records.flatMap((r) => r.contain_deps.dropped))].sort() };
}

/** The conditional Sol stage's Codex arm: gstack's README clone to ~/gstack at the pin and ./setup --host codex for cso,
 *  nothing for none,
 *  and the arm's entry before T. The model and CLI version come from the session record; @latest and an empty value are
 *  refused (E_CSO_ARM). Reasoning effort is Codex's default (no override). */
export interface CodexArmSpec { arm: "none" | "cso"; driver: "src/adapters/codex/driver.ts"; setup: string[]; entry: string; model: string; cli_version: string; argv: string[] }

export function codexArm(arm: "none" | "cso", rec: Pick<SessionRecord, "model_id" | "harness_version">, p: CsoPrereg, proxy: { baseUrl: string; slot: string; token: string }, provider: CodexProvider = "openai"): CodexArmSpec {
  for (const [k, v] of [["model_id", rec.model_id], ["harness_version", rec.harness_version]] as const)
    if (!v || /latest/i.test(v)) csoFail("E_CSO_ARM", "the Codex arm's " + k + " is " + JSON.stringify(v) + "; it must be the version the session recorded, never latest");
  const arms = (p.arms as { codex: Record<string, { gstack: boolean; entry: string }> }).codex;
  const a = arms[arm] ?? csoFail("E_CSO_ARM", "prereg.json has no Codex arm " + arm);
  const sha = p.pins.gstack.sha!;
  const setup = a.gstack ? ["git init -q -b main $HOME/gstack", "git -C $HOME/gstack fetch -q --depth 1 https://github.com/garrytan/gstack.git " + sha, "git -C $HOME/gstack reset -q --hard " + sha, "(cd $HOME/gstack && ./setup --host codex)"] : [];
  return { arm, driver: "src/adapters/codex/driver.ts", setup, entry: a.entry, model: rec.model_id, cli_version: rec.harness_version, argv: codexArgs({ model: rec.model_id, provider, proxy, effort: null }) };
}
