// Copyright (c) 2026 Garry Tan. MIT License.
// Part A's commands, which the lead wires into lanes/outcome-skills/h2h/cli.ts: install (one arm's home, in a throwaway
// container), pins (arms-pins.json from every installed home) and contain-home (containment over one arm's home for one
// unit). Every refusal prints its reason code first. contain-home exits 12 on a confirmed hit (the unit drops for every
// arm) and 3 when the scan cannot finish (it fails closed: the unit stays dropped until a scan passes).
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runName } from "../../statemachines/testrun.ts";
import { readUnit } from "../../statemachines/unit.ts";
import { H2hError } from "../prereg.ts";
import { ALL_ARMS, type H2hArm } from "../types.ts";
import { assertHomeContained, containHome, readFrame } from "./contain.ts";
import { installHome } from "./install.ts";
import { homeArm } from "./layer.ts";
import { buildArmsPins } from "./pins.ts";

const USAGE = {
  install: "install --arm <arm> --home <dir> [--sources <dir>]",
  pins: "pins --out <file> --homes <dir> [--sources <dir>]",
  "contain-home": "contain-home --arm <arm> --home <dir> --unit <unit dir> (--tree <base tree dir> | --volume <tree volume> --image <image>) [--frame <file of unit dirs>] [--out <file>]",
};
const EXIT: Record<string, number> = { E_H2H_HOME_LEAK: 12, E_H2H_HOME_SCAN: 3 };

/** The local clones directory: --sources, else $H2H_SOURCES, else <dir>/sources beside the homes. */
const sourcesDir = (v: string | undefined, beside: string) => resolve(v ?? process.env.H2H_SOURCES ?? join(beside, "sources"));

function arm(v: string | undefined, usage: string): H2hArm {
  if (!v || !(ALL_ARMS as readonly string[]).includes(v)) throw new H2hError("E_H2H_INSTALL", "--arm must be one of " + ALL_ARMS.join(", ") + "; usage: " + usage);
  return v as H2hArm;
}

const guard = (f: (argv: string[]) => Promise<number>) => async (argv: string[]): Promise<number> => {
  try {
    return await f(argv);
  } catch (e) {
    if (e instanceof H2hError) {
      process.stderr.write(e.message + "\n");
      return EXIT[e.code] ?? 2;
    }
    if (e instanceof TypeError && /option|argument/i.test(e.message)) {
      process.stderr.write("E_USAGE " + e.message + "\n");
      return 2;
    }
    throw e;
  }
};

export const commands: Record<string, (argv: string[]) => Promise<number>> = {
  install: guard(async (argv) => {
    const { values: v } = parseArgs({ args: argv, options: { arm: { type: "string" }, home: { type: "string" }, sources: { type: "string" } }, strict: true });
    const a = arm(v.arm, USAGE.install);
    if (!v.home) throw new H2hError("E_H2H_INSTALL", "--home is required; usage: " + USAGE.install);
    const rec = installHome(a, { home: v.home, sources: sourcesDir(v.sources, dirname(resolve(v.home))) });
    process.stdout.write(JSON.stringify({ arm: a, home: rec.home, home_tree_sha256: rec.home_tree_sha256, roots: rec.roots.length, claude_code_version: rec.claude_code_version }) + "\n");
    return 0;
  }),
  pins: guard(async (argv) => {
    const { values: v } = parseArgs({ args: argv, options: { out: { type: "string" }, homes: { type: "string" }, sources: { type: "string" } }, strict: true });
    if (!v.out || !v.homes) throw new H2hError("E_H2H_PIN", "--out and --homes are required; usage: " + USAGE.pins);
    const j = await buildArmsPins(v.homes, { sources: sourcesDir(v.sources, resolve(v.homes)) });
    writeFileSync(v.out, JSON.stringify(j, null, 2) + "\n");
    const bad = j.arms.flatMap((a) => a.pin_checks.filter((c) => !c.matched).map((c) => a.arm + " " + c.repo));
    for (const a of j.arms) process.stdout.write(a.arm + " " + a.home_tree_sha256 + " " + a.pin_checks.map((c) => c.repo + "=" + (c.matched ? "match" : "MISMATCH")).join(" ") + "\n");
    if (bad.length) throw new H2hError("E_H2H_PIN", v.out + " written, but " + bad.length + " pin check(s) did not match: " + bad.join("; "));
    return 0;
  }),
  "contain-home": guard(async (argv) => {
    const { values: v } = parseArgs({ args: argv, options: { arm: { type: "string" }, home: { type: "string" }, unit: { type: "string" }, tree: { type: "string" }, volume: { type: "string" }, image: { type: "string" }, frame: { type: "string" }, out: { type: "string" } }, strict: true });
    const a = arm(v.arm, USAGE["contain-home"]);
    if (!v.home || !v.unit) throw new H2hError("E_H2H_HOME_SCAN", "--home and --unit are required; usage: " + USAGE["contain-home"]);
    if (!v.tree && !(v.volume && v.image)) throw new H2hError("E_H2H_HOME_SCAN", "the unit's base tree is required, as --tree or --volume with --image; usage: " + USAGE["contain-home"]);
    if (v.tree && !existsSync(join(v.tree, ".git"))) throw new H2hError("E_H2H_HOME_SCAN", v.tree + " is not the unit's prepared base tree (no .git)");
    const u = readUnit(v.unit);
    const where = v.tree ? { kind: "host" as const, dir: resolve(v.tree) } : { kind: "docker" as const, image: v.image!, volume: v.volume!, repoDir: u.repo_dir, name: runName("h2h-contain-home") };
    const rec = containHome({ arm: a, home: v.home, unitDir: v.unit, where, ...(v.frame ? { frame: readFrame(v.frame) } : {}) });
    const text = JSON.stringify(rec, null, 2) + "\n";
    if (v.out) writeFileSync(v.out, text);
    else process.stdout.write(text);
    process.stderr.write(u.id + " " + homeArm(a) + ": " + rec.hits.length + " hit(s), " + rec.confirmed + " confirmed, " + rec.idioms + " idiom(s)\n");
    assertHomeContained(rec);
    return 0;
  }),
};
