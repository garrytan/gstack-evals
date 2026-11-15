// Copyright (c) 2026 Garry Tan. MIT License.
// The arm homes as part S reads them (post section 3). Part A builds each pack's installed HOME and writes arms-pins.json
// (ArmInstall records). Part S's contract, until part A's lands: a homes dir holds one installed HOME per arm that owns
// one, at <homes>/<arm>/, laid out as the session's /root; an arm whose record names home_of (gstack-oneline and gstack-qa
// reuse gstack's) uses that arm's dir; the none arm has no home to copy. The session agent copies the dir over /root with
// docker cp, and h2h_turns' check refuses a home its rule does not allow: none holds no pack path, a pack arm no gstack,
// and only gstack's arms (gstack, gstack-oneline, gstack-qa, gstack-pony) may hold gstack.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkHome } from "../arms/layer.ts";
import { h2hFail } from "../prereg.ts";
import type { ArmInstall, H2hArm } from "../types.ts";

export type HomeRule = "none" | "pack" | "gstack";
export interface ArmHome { arm: H2hArm; dir: string | null; home_rule: HomeRule; home_tree_sha256: string | null }

export const homeRule = (arm: H2hArm): HomeRule => (arm === "none" ? "none" : arm.startsWith("gstack") ? "gstack" : "pack");

/** The home an arm's sessions copy: from part A's install records and homes dir, or a dir given for the arm (fixtures and
 *  the dry run). A pack arm with no dir refuses. */
export function armHome(arm: H2hArm, o: { installs?: ArmInstall[]; homes?: string; dir?: string | null }): ArmHome {
  const rule = homeRule(arm);
  if (arm === "none") return { arm, dir: null, home_rule: rule, home_tree_sha256: o.installs?.find((a) => a.arm === arm)?.home_tree_sha256 ?? null };
  if (o.dir !== undefined) {
    if (o.dir === null || !existsSync(o.dir) || !statSync(o.dir).isDirectory()) h2hFail("E_H2H_SESSION_INPUT", "arm " + arm + "'s home " + o.dir + " is not a directory");
    return { arm, dir: o.dir, home_rule: rule, home_tree_sha256: null };
  }
  const rec = o.installs?.find((a) => a.arm === arm) ?? h2hFail("E_H2H_SESSION_INPUT", "arms-pins.json has no record for arm " + arm);
  const owner = rec.home_of ?? arm;
  const dir = o.homes ? join(o.homes, owner) : h2hFail("E_H2H_SESSION_INPUT", "arm " + arm + " needs the homes dir part A built");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) h2hFail("E_H2H_SESSION_INPUT", "arm " + arm + "'s home " + dir + " is not a directory");
  return { arm, dir, home_rule: rule, home_tree_sha256: (o.installs?.find((a) => a.arm === owner) ?? rec).home_tree_sha256 };
}

/** Hashes a pinned home's installed bytes and refuses one that is not its pin (E_H2H_HOME_DRIFT). A home with no dir (none)
 *  or no pin (a dir given for the arm) has nothing to check, and its record keeps a null hash. */
export function checkArmHome(h: ArmHome): void {
  if (h.dir && h.home_tree_sha256 !== null) checkHome(h.dir, { arm: h.arm, home_tree_sha256: h.home_tree_sha256 });
}
