import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { AgentOutcome } from "../../../src/trial/trial.ts";
import { main } from "../../../src/trial/review/cli.ts";
import { PARSER_SHA256 } from "../../../src/trial/review/findings.ts";
import { runReviewUnits, type PreparedUnit, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { TOLD_PR_SHA256, TOLD_PR_TEMPLATE, TOLD_SHA256, TOLD_TEMPLATE, toldPrompt } from "../../../src/trial/review/told.ts";
import { buildUnitRepo, unitTaskId } from "../../../src/trial/review/unit.ts";
import { harness, localSandbox } from "../../adapters/harness.ts";
import { collect } from "../../cli/helpers.ts";
import { sourceRepo } from "./helpers.ts";

const OPUS = "claude-opus-5-5";
const R2 = "/review Run the full review procedure: dispatch the Review Army specialists your plan selects and run the adversarial pass. Do not make Fix-First edits; report findings only.";
const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));

/** A run of arms none, gstack and r2 (gstack with R2's prefix) on one unit whose key fields are fixed, so its keys and records are the same on every machine. */
async function fixedRun(pr?: string) {
  const h = harness(() => [{ type: "text", text: "ok" }]);
  roots.push(h.dir);
  const s = sourceRepo();
  const unit = { id: "garrytan/gstack#7@" + "a".repeat(12), repo: "garrytan/gstack", pr: 7, head: "a".repeat(40), base: "b".repeat(40) };
  const repoDir = join(mkdtempSync(join(tmpdir(), "gse-prctx-")), "repo");
  roots.push(repoDir);
  buildUnitRepo({ unit: { ...unit, head: s.head, base: s.base }, source: s.root, dest: repoDir });
  const prepared: PreparedUnit = { unit, task: unitTaskId(unit), base_branch: "main", merge_base: "c".repeat(40), tree: repoDir, tree_sha256: "d".repeat(64), instructions: {}, ...(pr !== undefined ? { pr_text: pr } : {}) };
  const seen: { arm: string; prompt: string }[] = [];
  const slots = new Map<string, string>();
  const rig: HostRig = {
    baseUrl: h.baseUrl, network: null, imageDigest: null,
    bind: async (request) => {
      const b = h.proxy.bind(request);
      slots.set(b.slot, request.cell.arm);
      return b;
    },
    finalize: (m) => h.proxy.finalize(m),
    arms: { none: { tree_sha256: "none-tree", skill: null, gstack: null, plugins: [] }, gstack: { tree_sha256: "gstack-tree", skill: null, gstack: null, plugins: [] }, r2: { tree_sha256: "gstack-tree", skill: null, gstack: null, plugins: [] } },
    sandbox: () => localSandbox(() => {}),
    judgeSandbox: () => localSandbox(() => {}),
    egress: () => ({ open: false, detail: "test rig" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
    driver: (o) => ({
      async run(_session, task): Promise<AgentOutcome> {
        seen.push({ arm: slots.get(o.proxy.slot)!, prompt: task.prompt });
        return { turns: ["```json\n[]\n```"], termination: { kind: "completed" }, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: 1, loaded_bytes: null };
      },
    }),
  };
  const out = mkdtempSync(join(REPO_ROOT, ".review-units-test-"));
  roots.push(out);
  const input: ReviewRunInput = { host: "claude", suite: { id: "review-test", sha256: null }, units: [prepared], arms: [{ name: "none", told: "none" }, { name: "gstack", told: "gstack" }, { name: "r2", told: "gstack", toldPrefix: R2 }], models: [OPUS], passes: 1, parallel: 1, timeoutS: 120, cap: 50_000_000, runId: "review-prctx", out, date: "2026-11-14", policy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, env: {} };
  try {
    await runReviewUnits(input, rig);
  } finally {
    h.proxy.stop();
  }
  const cells = readFileSync(join(out, "cells.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { cell: { arm: string }; key: { parts: Record<string, string> } });
  const told = (id: string) => JSON.stringify(JSON.parse(readFileSync(join(out, "arms", id, "arm.json"), "utf8")).told);
  return { seen, prompt: (arm: string) => seen.find((x) => x.arm === arm)!.prompt, task: (arm: string) => cells.find((c) => c.cell.arm === arm)!.key.parts.task, told, units: readFileSync(join(out, "units.json"), "utf8") };
}

const PR = "# Cache the parsed config\n\nThe loader re-read {base} config on every call; this keeps one copy.\n\n- costs $& nothing\n\tindented\n";
const BLOCK = "The pull request's title and description, as its author first wrote them:\n\n" + PR.trimEnd() + "\n\n";

// Value: protects=the frozen PR-context template: TOLD_TEMPLATE with only the PR block added after its first paragraph, pinned by its own sha256, and the PR text placed verbatim (never rewritten by {base} or a $ pattern, its trailing newline cut); fails_when=the template's text changes without this pin moving on purpose, TOLD_TEMPLATE changes beside it, or PR text is rewritten on the way in; why_new=the PR-context change (spec item 1); seam=told.ts; no_claim=how an arm reads the block
describe("the PR-context told template", () => {
  test("TOLD_PR_SHA256 is pinned, the block sits after the first paragraph, and the PR text is placed verbatim", () => {
    expect(TOLD_PR_SHA256).toBe("f52ecea76a934596833e535d314b14ce696d4e6ed40926eea532542cdf876a79");
    expect(TOLD_SHA256).toBe("16862a34212cd2eddbcedbc5654b26cb92b0dad50e3d501686770e6bc3d088ad");
    const [first, ...rest] = TOLD_TEMPLATE.split("\n\n");
    expect(TOLD_PR_TEMPLATE).toBe([first, "The pull request's title and description, as its author first wrote them:", "{pr}", ...rest].join("\n\n"));
    const [head, tail] = TOLD_TEMPLATE.replaceAll("{base}", "main").split(/(?<=shows them\.\n\n)/);
    expect(toldPrompt("gstack", "main", undefined, PR)).toBe("/review " + head + BLOCK + tail);
    expect(toldPrompt("none", "main", undefined, PR)).toBe(head + BLOCK + tail);
    expect(toldPrompt("none", "main", undefined, PR)).toContain("re-read {base} config");
    expect(toldPrompt("none", "main", undefined, PR)).toContain("costs $& nothing\n\tindented\n\nYou may write");
  });
});

// Value: protects=a run with no PR context keeps main's bytes: the told prompt, each session key's task part, arm.json's told record and units.json, which other runs key their sessions and records on; fails_when=adding the PR block moves any of them for a run that gives no PR text; why_new=the PR-context change's binding requirement 1, values computed at main 91d76421 before the change; seam=toldPrompt and runReviewUnits' keyOf, arm.json and units.json; no_claim=run.json, which the change does not touch
describe("no PR context keeps main's bytes", () => {
  test("toldPrompt, the session key task part, arm.json's told record and units.json match main", async () => {
    expect([sha(toldPrompt("none", "main")), sha(toldPrompt("gstack", "main")), sha(toldPrompt("gstack", "master", R2)), sha(toldPrompt("tstack", "dev"))]).toEqual(["d11fe86001b2285c61a85e4cb3a786baabe92ca974a2c3a5b2b55aa94edb8596", "f5731b91727d7e723b2b0601b68e82df5acbacb4874e095c53b0a74fda0b8d3c", "a4e117b177c9f33b3af66d5806f4436ace4b3ccf8813ac40debab41c6a9850f8", "235accef5ddb9d129323556db716243a212ed0058a15757a3899cdc0a3eaf541"]);
    const r = await fixedRun();
    expect([r.task("none"), r.task("gstack"), r.task("r2")]).toEqual(["06295475e0f4a03889bac4b7b96def45264bdbeb2e5beebf173da982c8dc1d70", "9f44dc0982a112b560acef3647605098ea71f82d6f9b7d1e26ebe4629525f603", "292575568d010e1418d2236d1a05b8c9c9bcec432516305e9f63ea97bc5839d7"]);
    expect([sha(r.told("none-opus")), sha(r.told("gstack-opus")), sha(r.told("r2-opus"))]).toEqual(["624c4f0e6eee30975561b0b5a119b4a33c1a697668b8775927a113adcbe45ada", "6cf7858141f80f9461ef83212c3a539c5321401f8c9c244350d0feb3f46755f4", "8415223fa10264a6970fa47798b4bdb093c254e4446d6c04ee662ec03a4efc03"]);
    const unit = { id: "garrytan/gstack#7@aaaaaaaaaaaa", repo: "garrytan/gstack", pr: 7, task: "gstack-7-aaaaaaaa", head: "a".repeat(40), base: "b".repeat(40), base_branch: "main", merge_base: "c".repeat(40), tree_sha256: "d".repeat(64), retained: null, instructions: {}, check: null };
    expect(r.units).toBe(JSON.stringify({ schema_version: 1, suite: { id: "review-test", sha256: null }, told_sha256: "16862a34212cd2eddbcedbc5654b26cb92b0dad50e3d501686770e6bc3d088ad", parser_sha256: PARSER_SHA256, units: [unit] }, null, 2) + "\n");
  }, 120_000);
});

// Value: protects=every arm on a unit gets byte-identical PR blocks after its own prefix, so arms differ only by their command; the PR run's key, arm.json told record and units.json carry TOLD_PR_SHA256 and the pr.md's sha256; fails_when=an arm's prefix or setting leaks into the block, the block differs between arms, or a PR run reuses a no-PR key or records today's template; why_new=the PR-context change (spec items 3 and 4); seam=runReviewUnits' taskOf, keyOf, arm.json and units.json; no_claim=the CLI's reading of pr.md, tested below
describe("PR context in the run loop (keyless)", () => {
  test("two arms on one unit get byte-identical PR blocks, and the records carry the PR's sha256", async () => {
    const r = await fixedRun(PR);
    const [none, gstack, r2] = [r.prompt("none"), r.prompt("gstack"), r.prompt("r2")];
    expect([gstack.startsWith("/review "), r2.startsWith(R2 + " ")]).toEqual([true, true]);
    expect(gstack.slice("/review ".length)).toBe(none);
    expect(r2.slice(R2.length + 1)).toBe(none);
    const block = (p: string) => p.slice(p.indexOf("The pull request's title"), p.indexOf("You may write"));
    expect(block(none)).toBe(BLOCK);
    expect([block(gstack), block(r2)]).toEqual([block(none), block(none)]);
    expect(none).toBe(toldPrompt("none", "main", undefined, PR));
    const plain = await fixedRun();
    for (const arm of ["none", "gstack", "r2"]) expect(r.task(arm)).not.toBe(plain.task(arm));
    const pr_sha256 = { "garrytan/gstack#7@aaaaaaaaaaaa": sha(PR) };
    expect(JSON.parse(r.told("none-opus"))).toEqual({ arm: "none", prefix: "", template_sha256: TOLD_PR_SHA256, pr_sha256 });
    expect(JSON.parse(r.told("r2-opus"))).toEqual({ arm: "gstack", prefix: R2, prefix_sha256: sha(R2), template_sha256: TOLD_PR_SHA256, pr_sha256 });
    const units = JSON.parse(r.units);
    expect([units.told_sha256, units.units[0].pr_sha256]).toEqual([TOLD_PR_SHA256, sha(PR)]);
  }, 120_000);

  // Value: protects=PR text goes to every code unit or none even when runReviewUnits is called directly; fails_when=a run with PR text on some units only starts; why_new=the PR-context change (all or none); seam=runReviewUnits' guard; no_claim=the CLI's own refusal, tested below
  test("a run with PR text on only some units is refused before any session", async () => {
    const unit = (n: number) => ({ unit: { id: "garrytan/gstack#" + n + "@" + "a".repeat(12), repo: "garrytan/gstack", pr: n, head: "a".repeat(40), base: "b".repeat(40) }, task: "gstack-" + n + "-aaaaaaaa", base_branch: "main", merge_base: "c".repeat(40), tree: "/nowhere", tree_sha256: "d".repeat(64), instructions: {} });
    const out = mkdtempSync(join(REPO_ROOT, ".review-units-test-"));
    roots.push(out);
    const input: ReviewRunInput = { host: "claude", suite: { id: "review-test", sha256: null }, units: [{ ...unit(1), pr_text: PR }, unit(2)], arms: [{ name: "none", told: "none" }], models: [OPUS], passes: 1, parallel: 1, timeoutS: 120, cap: 0, runId: "review-prctx-mixed", out, date: "2026-11-14", policy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, env: {} };
    await expect(runReviewUnits(input, {} as HostRig)).rejects.toThrow("E_USAGE: PR text goes to every code unit or to none, and this run gives it to only some units");
  });
});

// Value: protects=--pr-context is all or none at the command: a selected unit with no pr.md, an empty one or one with a control character (a CR included) refuses the run before anything is built and lists each such unit, and a full set passes the dry run and names the template's sha256; fails_when=a run starts with some units missing their PR text, a CR reaches the prompt, or a full set is refused; why_new=the PR-context change (spec items 2 and 4); seam=main's --pr-context check; no_claim=build-unit.ts's own output, which harness-evals tests
describe("review-units --pr-context (keyless)", () => {
  test("every selected unit needs a readable plain pr.md, or the run is refused", async () => {
    const root = mkdtempSync(join(REPO_ROOT, ".review-units-cli-"));
    roots.push(root);
    const out = join(root, "out");
    const dir = join(root, "units");
    const put = (id: string, text: string) => {
      mkdirSync(join(dir, id.replace(/[/#@]/g, "_")), { recursive: true });
      writeFileSync(join(dir, id.replace(/[/#@]/g, "_"), "pr.md"), text);
    };
    const run = async (...extra: string[]) => {
      const io = collect();
      const code = await main(["--suite", "gsta167-14pr", "--units", "3593", "3596", "--models", OPUS, "--out", out, "--source", "garrytan/gstack=/nowhere", "--arms", "none", "--pr-context", dir, "--dry-run", ...extra], io, {});
      return { code, ...io.text() };
    };
    const [a, b] = ["garrytan/gstack#3593@89156431975e", "garrytan/gstack#3596@0be7c3d44339"];
    put(a, PR);
    const missing = await run();
    expect([missing.code, missing.err.split("\n")[0], missing.err.split("\n")[1]!.startsWith("  " + b + ": ENOENT")]).toEqual([2, "E_USAGE review-units: --pr-context " + dir + " gives every selected unit its PR text or none, and 1 of 2 units cannot take it:", true]);
    put(b, "# Title\r\n\r\nbody\r\n");
    const crlf = await run();
    expect([crlf.code, crlf.err.split("\n")[1]]).toEqual([2, "  " + b + ": " + join(dir, "garrytan_gstack_3596_0be7c3d44339", "pr.md") + ": it has a control character (U+000D) at character 8; only line feeds and tabs may appear"]);
    put(a, " \n");
    expect((await run()).err.split("\n").slice(0, 3)).toEqual(["E_USAGE review-units: --pr-context " + dir + " gives every selected unit its PR text or none, and 2 of 2 units cannot take it:", "  " + a + ": " + join(dir, "garrytan_gstack_3593_89156431975e", "pr.md") + ": it is empty", "  " + b + ": " + join(dir, "garrytan_gstack_3596_0be7c3d44339", "pr.md") + ": it has a control character (U+000D) at character 8; only line feeds and tabs may appear"]);
    put(a, PR);
    put(b, "# Title\n\nbody with a\ttab\n");
    const ok = await run();
    expect([ok.code, ok.err]).toEqual([0, ""]);
    expect(ok.out).toContain("pr context " + dir + ": each unit's pr.md after the told prompt's first paragraph; told pr template sha256 " + TOLD_PR_SHA256);
    expect(existsSync(out)).toBe(false);
  });
});
