// Untested arms downstream (panel v3 plan, section 5, N1; GEVA-203). review-units marks an arm its read audit found
// contaminated with an untested block and status stopped. judge-packet and both joins refuse it by name
// with E_ARM_CONTAMINATED (refuseUntested, over untestedProblem); noloss derive never flips it to complete, even when every coverage gap it has names a dropped unit;
// and noloss secondary gives it no new-blocker reading, through the stopped status the block comes with.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArm, untestedProblem } from "../../lanes/review-noloss/contract.ts";
import { snapshot } from "../../lanes/review-noloss/ingest.ts";
import { newBlockers } from "../../lanes/review-noloss/secondary.ts";
import { loadSuite, REPO_ROOT } from "../../lanes/review-noloss/suite.ts";
import { cleanup, editArm, run, tmp, writeArm } from "./helpers.ts";

afterAll(cleanup);
const arm = (json: unknown) => new Map([["arm.json", Buffer.from(JSON.stringify(json))]]);
const example = snapshot(join(REPO_ROOT, "lanes/review-noloss/example/arm-example"));
const U3593 = "garrytan/gstack#3593@89156431975e";
/** An untested block as review-units writes it; its path is a unit path, since ingest's publication scan refuses a ~/ path as a machine path. */
const UNTESTED = { code: "E_ARM_CONTAMINATED", reason: "the read audit found a contaminated read in 1 session", sessions: [{ session: U3593 + " pass 1", paths: ["<unit>/.claude/skills/gstack/SKILL.md"] }], audit_sha256: "0".repeat(64), paid_usd: 0.25 };
/** The example arm as id, with no coverage gaps unless edit sets some. */
const exampleArm = (id: string, edit: (a: Record<string, unknown>) => void = () => {}) =>
  editArm(example, (a) => {
    a.id = id;
    a.label = id + " arm (synthetic)";
    delete a.coverage_gaps;
    edit(a);
  });

describe("untested arms get no judge packet, join or score (GEVA-203)", () => {
  // Value: protects=an arm the read audit marked untested is refused by name before judge-packet or judge-join reads it; fails_when=an untested arm passes, or a clean or stopped arm is refused; seam=untestedProblem, which judge.ts calls after each parseArm; no_claim=score.ts, which refuses it as a stopped arm
  test("an untested block refuses with E_ARM_CONTAMINATED naming the arm; a clean or stopped arm passes", () => {
    const untested = { code: "E_ARM_CONTAMINATED", reason: "the read audit found a contaminated read in 1 session", sessions: [{ session: "u pass 1", paths: ["~/.capy/drive/x/SKILL.md"] }], paid_usd: 0.5 };
    expect(untestedProblem(arm({ id: "none-opus", status: "stopped", untested }))).toBe("E_ARM_CONTAMINATED arm none-opus is untested (the read audit found a contaminated read in 1 session), so it gets no judge packet, join or score; rerun the arm clean");
    expect([untestedProblem(arm({ id: "none-opus", status: "complete" })), untestedProblem(arm({ id: "none-opus", status: "stopped", coverage_gaps: ["u pass 1"] })), untestedProblem(new Map())]).toEqual([null, null, null]);
  });

  // Value: protects=judge-packet refuses an untested arm under its own code before it writes a packet or a key, so no judge reads the arm; fails_when=judge-packet packets an untested arm, or the refusal surfaces as E_INTERNAL; why_new=panel v3 section 5 (judge-packet and judge-join refuse an untested arm); seam=judge-packet through the noloss CLI, ingest included; no_claim=the two joins, which call the same refuseUntested after they parse each arm
  test("judge-packet refuses an untested arm with E_ARM_CONTAMINATED before it writes a packet or a key", async () => {
    const dir = tmp("noloss-untested-packet-");
    const root = join(dir, "arms");
    const arms: [string, Map<string, Buffer>][] = [["alpha", exampleArm("alpha")], ["beta", exampleArm("beta", (a) => Object.assign(a, { status: "stopped", untested: UNTESTED }))]];
    for (const [id, files] of arms) expect([id, (await run(["ingest", writeArm(join(dir, "src", id), files), "--suite", "gsta167-14pr", "--root", root])).code]).toEqual([id, 0]);
    const r = await run(["judge-packet", "--suite", "gsta167-14pr", "--arm", join(root, "gsta167-14pr", "alpha"), "--arm", join(root, "gsta167-14pr", "beta"), "--seed", "7", "--out", join(dir, "packets"), "--key", join(dir, "key.json")]);
    expect([r.code, r.err.split("\n")[0]!.startsWith("E_ARM_CONTAMINATED"), r.err.includes("arm beta is untested"), existsSync(join(dir, "packets")), existsSync(join(dir, "key.json"))]).toEqual([2, true, true, false, false]);
  });
});

describe("untested arms in noloss derive and secondary (GEVA-203)", () => {
  // Value: protects=derive keeps an untested arm stopped with its untested block, even when every coverage gap names a unit --drop-gaps drops and no session went unrun, while a stopped arm with the same gaps and no block flips to complete; fails_when=a derived reading clears an untested arm and scores it; why_new=panel v3 section 5 (every reading that depends on an untested arm is invalidated); seam=derive through the noloss CLI, ingest included; no_claim=--drop and --drop-file, which take the same status rule
  test("derive never flips an untested arm to complete", async () => {
    const dir = tmp("noloss-untested-derive-");
    const root = join(dir, "arms");
    writeFileSync(join(dir, "comparisons.json"), JSON.stringify({ schema_version: 1, suite: "gsta167-14pr", decision_rule: "test rule", seed: 1, draws: 1000, comparisons: [{ id: "beta-vs-alpha", variant: "beta", reference: "alpha", margin_points: 10, margin_reason: "test", post_hoc: false, frozen_bar: null, false_blocker_drop: 0.5 }], loss_family: { order: ["beta-vs-alpha"], null: "zero", reason: "test" } }));
    const gapped = (extra: Record<string, unknown>) => (a: Record<string, unknown>) => Object.assign(a, { status: "stopped", coverage_gaps: [U3593 + " pass 1: incomplete, the session timed out"], parse_outcomes: { findings: 13, incomplete: 1, not_run: 0 } }, extra);
    const arms: [string, Map<string, Buffer>][] = [["alpha", exampleArm("alpha", gapped({}))], ["beta", exampleArm("beta", gapped({ untested: UNTESTED }))], ["gamma", exampleArm("gamma", (a) => Object.assign(a, { status: "stopped", untested: UNTESTED }))]];
    for (const [id, files] of arms) expect([id, (await run(["ingest", writeArm(join(dir, "src", id), files), "--suite", "gsta167-14pr", "--root", root])).code]).toEqual([id, 0]);
    const d = await run(["derive", "--suite", "gsta167-14pr", "--comparisons", join(dir, "comparisons.json"), "--root", root, "--id", "gsta167-untested", "--out", join(dir, "out"), "--drop-gaps"]);
    expect([d.code, d.out.includes("arm alpha: stopped -> complete"), d.out.includes("arm beta: stopped -> complete"), d.out.includes("arm gamma: stopped -> complete")]).toEqual([0, true, false, false]);
    const derived = (id: string) => JSON.parse(readFileSync(join(dir, "out", "arms", "gsta167-untested", id, "arm.json"), "utf8"));
    expect(["alpha", "beta", "gamma"].map((id) => [id, derived(id).status, derived(id).untested ?? null, derived(id).coverage_gaps ?? null, derived(id).derived.status_before])).toEqual([["alpha", "complete", null, null, "stopped"], ["beta", "stopped", UNTESTED, null, "stopped"], ["gamma", "stopped", UNTESTED, null, "stopped"]]);
  });

  // Value: protects=secondary gives an untested arm no new-blocker reading, whichever side it is on, and the refusal names the arm as stopped, the status its untested block comes with; fails_when=an untested arm gets a complete new-blocker reading; why_new=panel v3 section 5 (the secondaries refuse to score an untested arm); seam=newBlockers on parsed arms; no_claim=the E_ARM_CONTAMINATED wording, which reaches judge-packet and judge-join through untestedProblem but not this refusal, and idea-card wins, which check no status
  test("secondary refuses an untested arm through its stopped status", () => {
    const { suite, sha256 } = loadSuite("gsta167-14pr");
    const clean = parseArm(exampleArm("alpha"), suite, sha256);
    const untested = parseArm(exampleArm("beta", (a) => Object.assign(a, { status: "stopped", untested: UNTESTED })), suite, sha256);
    expect(newBlockers(suite, clean, parseArm(exampleArm("beta"), suite, sha256), { seed: 1, draws: 2000 }).complete).toBe(true);
    for (const [v, r] of [[untested, clean], [clean, untested]]) {
      const nb = newBlockers(suite, v, r, { seed: 1, draws: 2000 });
      expect([nb.complete, nb.reasons]).toEqual([false, ["arm beta stopped"]]);
    }
    expect(untestedProblem(exampleArm("beta", (a) => Object.assign(a, { status: "stopped", untested: UNTESTED })))).toMatch(/^E_ARM_CONTAMINATED arm beta is untested \(the read audit found a contaminated read in 1 session\)/);
  });
});
