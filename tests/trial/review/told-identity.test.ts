import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { TOLD_SHA256 } from "../../../src/trial/review/told.ts";

// R56-1 (GST-1021): review-units runs gstack's /ship review panel as a gstack arm told through /ship. told-capture.ts drives
// the real command for each configuration (keyless: the Docker steps are replaced, the sessions run the real driver and
// the pinned Agent SDK against the stub CLI) and records what it resolved. fixtures/told-identity-176fdc7.json is that
// record for the /review configurations, made by told-capture.ts at main 176fdc75e046, before this change. Rewrite it only
// on purpose, with: CAPTURE_OUT=<file> CAPTURE_CONFIGS=stacks-r1,r2-none,r2-full,ceremony-cut
// GIT_AUTHOR_DATE=2026-11-02T00:00:00Z GIT_COMMITTER_DATE=2026-11-02T00:00:00Z bun test ./tests/trial/review/told-capture.ts

interface Session { arm: string; model: string; driver: { skill: { name: string; roots: string[]; home: string } | null }; prompt_sha256: string; termination: unknown; turns: number; parse: string }
interface Config { exit: number; errors: string[]; rig: { skills: Record<string, string> }; sessions: Session[]; told: Record<string, unknown> }
interface Capture { prompts: Record<string, string>; configs: Record<string, Config> }

const GOLDEN = join(REPO_ROOT, "tests", "trial", "review", "fixtures", "told-identity-176fdc7.json");
const SHIP = readFileSync(join(REPO_ROOT, "tests", "trial", "review", "fixtures", "told-ship-panel.txt"), "utf8").replace(/\n$/, "");

function capture(): Capture {
  const dir = mkdtempSync(join(tmpdir(), "gse-told-capture-"));
  try {
    const file = join(dir, "capture.json");
    const r = spawnSync(process.execPath, ["test", "./tests/trial/review/told-capture.ts"], { cwd: REPO_ROOT, env: { ...process.env, CAPTURE_OUT: file, CAPTURE_CONFIGS: "", GIT_AUTHOR_DATE: "2026-11-02T00:00:00Z", GIT_COMMITTER_DATE: "2026-11-02T00:00:00Z" }, encoding: "utf8", timeout: 300_000 });
    if (r.status !== 0) throw new Error("told-capture.ts exited " + r.status + ": " + (r.stderr || r.stdout).slice(-2000));
    return JSON.parse(readFileSync(file, "utf8")) as Capture;
  } finally {
    removeTree(dir);
  }
}

describe("R56-1: review-units through the real command (keyless)", () => {
  let captured: Capture;
  beforeAll(() => {
    captured = capture();
  }, 300_000);

  // Value: protects=nothing that already ran moves: for none, gstack-full and every stacks round 1, R2 and ceremony-cut configuration, the arm specs the rig gets, each arm's install target, the run settings, each session's driver options (skill, system prompt, turn cap, session kind), its prompt, its session key and arm.json's told block are byte-identical to main at 176fdc7; fails_when=the /ship change moves any /review arm's resolution, install target or prompt; why_new=GEVA-197 step 3; seam=main in cli.ts through runReviewUnits and hostDriver; no_claim=the Docker rig and installArms, which this change does not touch
  test("every /review configuration resolves as it did at main 176fdc7, byte for byte", () => {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Capture;
    expect(Object.keys(golden.configs)).toEqual(["stacks-r1", "r2-none", "r2-full", "ceremony-cut"]);
    for (const name of Object.keys(golden.configs)) expect([name, JSON.stringify(captured.configs[name], null, 2)]).toEqual([name, JSON.stringify(golden.configs[name], null, 2)]);
    for (const [sha, text] of Object.entries(golden.prompts)) expect(captured.prompts[sha]).toBe(text);
  });

  // Value: protects=R56-1's arm on the real command: a gstack arm whose prefix opens with /ship is accepted, its install target in the rig and its session's skill are both ship, its prompt is the prefix then the frozen template, its session reaches its first turn and is parsed, and the none arm beside it is R2's none arm byte for byte; fails_when=the command refuses the prefix, or the rig installs review while the session opens ship (the mismatch at 176fdc7 between cli.ts and run.ts); why_new=GEVA-197 steps 2 and 4; seam=main in cli.ts through runReviewUnits and hostDriver; no_claim=a real model, the Docker rig, or what /ship does in the sandbox
  test("a ship-panel arm is told /ship, installs ship, opens ship and reaches its first turn", () => {
    const c = captured.configs["ship-panel"]!;
    expect([c.exit, c.errors]).toEqual([0, []]);
    const ship = c.sessions.find((s) => s.arm === "ship-panel")!;
    expect([c.rig.skills["ship-panel"], ship.driver.skill?.name]).toEqual(["ship", "ship"]);
    expect(ship.driver.skill?.roots).toEqual([ship.driver.skill!.home + "/.claude/skills/ship"]);
    expect(captured.prompts[ship.prompt_sha256]!.startsWith(SHIP + " Review the changes on this branch against the base branch main")).toBe(true);
    expect([ship.termination, ship.turns, ship.parse]).toEqual([{ kind: "completed" }, 1, "findings"]);
    expect(c.told["ship-panel-opus"]).toEqual({ arm: "gstack", prefix: SHIP, prefix_sha256: new Bun.CryptoHasher("sha256").update(SHIP).digest("hex"), template_sha256: TOLD_SHA256 });
    expect(c.sessions.find((s) => s.arm === "none")).toEqual(captured.configs["r2-none"]!.sessions[0]!);
  });
});
