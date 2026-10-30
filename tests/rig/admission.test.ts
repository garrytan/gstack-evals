import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admissionPath, admit, rigAdmission, writeAdmission, type AdmitInput, type ProofKind } from "../../src/rig/admission.ts";
import { workflowProbe } from "../../src/rig/probes.ts";
import { openLease, reconcileLease, recordApproval } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { failing, fakeGitHub, FP, fingerprint, git, greenProbes, greenTier, initItem, REPO, scratchRepo, type FakeRun } from "./helpers.ts";

const NOW = new Date("2026-11-02T12:00:00Z");
const MACHINE = "m-spender";
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
  return "no error";
};
const messageOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return "no error";
};

/** A scratch repo, a record with one required item, and admit and lease bound to them. */
function world(o: { proof?: ProofKind; admission?: "required" | "warn"; runs?: (r: ReturnType<typeof scratchRepo>) => FakeRun[] } = {}) {
  const proof = o.proof ?? "trial";
  const repo = scratchRepo();
  const record = mkdtempSync(join(tmpdir(), "gse-rig-record-"));
  dirs.push(repo.root, record);
  initItem(record, "u11-lanea", o.admission ?? "required");
  const runs = o.runs ? o.runs(repo) : [proof === "trial" ? { head_sha: repo.commit, tree: repo.tree, tier: greenTier(repo) } : { workflow: "ci.yml" as const, head_sha: repo.commit, tree: repo.tree }];
  const gh = fakeGitHub(runs);
  const input = (extra: Partial<AdmitInput> = {}): AdmitInput => ({ record, item: "u11-lanea", proof, prereg: repo.prereg, repo: REPO, machineId: MACHINE, gh, probes: () => greenProbes(proof), fingerprint: fingerprint(), root: repo.root, now: NOW, ...extra });
  const check = (extra: { now?: Date; fp?: typeof FP; proof?: ProofKind } = {}) => rigAdmission({ root: repo.root, now: () => extra.now ?? NOW, fingerprint: fingerprint(extra.fp), ...(extra.proof ? { proof: extra.proof } : {}) });
  const lease = (extra: { run?: string; machine?: string; now?: Date; fp?: typeof FP; proof?: ProofKind } = {}) => openLease(record, null, { item: "u11-lanea", run_id: extra.run ?? "run-1", machine_id: extra.machine ?? MACHINE, now: extra.now ?? NOW, requireAdmission: check(extra) });
  return { repo, record, gh, input, check, lease };
}

describe("rig admit (U20)", () => {
  test("a green trial admission is written once for the item's next slot, holds the machine, host and proof, and admits the lease", () => {
    const w = world();
    const r = admit(w.input());
    expect(r).toMatchObject({ written: true, path: join(w.record, "items", "u11-lanea", "admission-0001.json") });
    const a = JSON.parse(readFileSync(r.path, "utf8"));
    expect(a).toMatchObject({ schema: 1, kind: "admission", item: "u11-lanea", seq: 1, attempt: 1, run_id: null, machine_id: MACHINE, proof: "trial", repo: REPO, commit: w.repo.commit, tree: w.repo.tree, recipe_sha256: w.repo.recipe, host: FP, verdict: "green", problems: [], admitted_at: NOW.toISOString(), expires_at: "2026-11-03T12:00:00.000Z" });
    expect(a.checks).toEqual([expect.objectContaining({ workflow: "rig.yml", event: "push", conclusion: "success", tree: w.repo.tree, problems: [], tier: greenTier(w.repo) })]);
    expect(a.probes.map((p: { id: string }) => p.id)).toContain("r5.sockets");
    expect(admit(w.input())).toMatchObject({ written: false, path: r.path });
    expect(w.lease().line_item).toBe("u11-lanea");
  });

  test("a direct admission reads a green ci.yml push run at the tree and the replay probe", () => {
    const w = world({ proof: "direct" });
    const r = admit(w.input());
    expect(r.admission).toMatchObject({ verdict: "green", proof: "direct", recipe_sha256: null, checks: [expect.objectContaining({ workflow: "ci.yml", tier: null })] });
    expect(w.gh.asked.some((p) => p.includes("annotations"))).toBe(false);
    expect(w.lease({ proof: "direct" }).line_item).toBe("u11-lanea");
    expect(codeOf(() => world({ proof: "direct" }).lease({ proof: "trial" }))).toBe("E_RIG_UNPROVEN");
  });

  test("a missing record refuses a required lease with E_RIG_UNPROVEN and writes nothing; a warn item warns and leases", () => {
    const w = world();
    expect(messageOf(() => w.lease())).toContain("for slot 1;");
    expect(readItem(w.record, "u11-lanea").leases).toEqual([]);
    const warn = world({ admission: "warn" });
    const warnings: string[] = [];
    const lease = openLease(warn.record, null, { item: "u11-lanea", run_id: "run-1", machine_id: MACHINE, now: NOW, requireAdmission: warn.check(), warn: (code, m) => warnings.push(code + " " + m) });
    expect(lease.state).toBe("open");
    expect(warnings).toEqual([expect.stringMatching(/^RIG_UNPROVEN line item u11-lanea leased without admission: no admission record at .* for slot 1;/)]);
  });

  test("red proof writes a red record that refuses: a failing run, a red or skipped tier, the wrong tree or recipe, a pull request's ci.yml", () => {
    const cases: [string, Parameters<typeof world>[0], string][] = [
      ["failed run", { runs: (r) => [{ head_sha: r.commit, tree: r.tree, conclusion: "failure", tier: greenTier(r) }] }, "concluded failure"],
      ["red tier", { runs: (r) => [{ head_sha: r.commit, tree: r.tree, tier: { ...greenTier(r), verdict: "RED" } }] }, "tier summary of run 100 is RED"],
      ["no tier", { runs: (r) => [{ head_sha: r.commit, tree: r.tree, tier: null }] }, "has 0 gstack-evals-rig-tier annotations"],
      ["other tree", { runs: (r) => [{ head_sha: r.commit, tree: "f".repeat(40), tier: greenTier(r) }] }, "not this checkout's tree"],
      ["other recipe", { runs: (r) => [{ head_sha: r.commit, tree: r.tree, tier: { ...greenTier(r), recipe_sha256: "e".repeat(64) } }] }, "tested recipe eeeeeeeeeeee"],
      ["pull request ci", { proof: "direct", runs: (r) => [{ workflow: "ci.yml", event: "pull_request", head_sha: r.commit, tree: r.tree }] }, "no ci.yml run on push, workflow_dispatch"],
    ];
    for (const [name, o, why] of cases) {
      const w = world(o);
      if (name === "pull request ci") {
        expect([name, codeOf(() => admit(w.input()))]).toEqual([name, "E_RIG_PROOF"]);
        expect(messageOf(() => admit(w.input()))).toContain(why);
        continue;
      }
      const r = admit(w.input());
      expect([name, r.admission.verdict]).toEqual([name, "red"]);
      expect(codeOf(() => w.lease())).toBe("E_RIG_UNPROVEN");
      expect([name, messageOf(() => w.lease())]).toEqual([name, expect.stringContaining(why)]);
    }
  });

  test("open egress, a reachable management socket or a leaked key, seen by the probes, make a red record that refuses", () => {
    for (const id of ["r5.outside", "r5.sockets", "r5.keys", "r6.canary"]) {
      const w = world();
      expect(admit(w.input({ probes: () => failing(greenProbes("trial"), id) })).admission.verdict).toBe("red");
      expect(messageOf(() => w.lease())).toContain("probe " + id + " failed");
    }
    const w = world();
    expect(admit(w.input({ probes: () => greenProbes("trial").filter((p) => p.id !== "r5.gateway") })).admission.verdict).toBe("red");
    expect(messageOf(() => w.lease())).toContain("probe r5.gateway is missing");
  });

  test("a stale record refuses: the tree, the recipe or the host changed, or a day passed", () => {
    const w = world();
    admit(w.input());
    expect(messageOf(() => w.lease({ now: new Date(NOW.getTime() + 25 * 3600_000) }))).toContain("is stale: admitted at");
    expect(messageOf(() => w.lease({ fp: { ...FP, kernel: "6.1.0-other" } }))).toContain("this host changed since admission (kernel)");
    writeFileSync(join(w.repo.root, "src", "adapters", "index.ts"), "export const changed = 1;\n");
    expect(messageOf(() => w.lease())).toMatch(/is stale: it proves tree \w{12}, and this checkout runs tree \w{12} \(uncommitted changes included\)/);
    git(w.repo.root, "commit", "-qam", "change the adapters");
    expect(messageOf(() => w.lease())).toContain("is stale: it proves tree");
    const recipe = world();
    admit(recipe.input());
    writeFileSync(join(recipe.repo.root, "docker", "host-cli.json"), JSON.stringify({ claude: "2.1.999", codex: "0.166.0" }) + "\n");
    expect(messageOf(() => recipe.lease())).toContain("is stale");
  });

  test("a replaced machine refuses, and a new lease on a new machine after a reconcile writes its own record", () => {
    const w = world();
    admit(w.input());
    expect(messageOf(() => w.lease({ machine: "m-replacement" }))).toContain("was admitted on machine m-spender, not m-replacement");
    const first = w.lease();
    expect(codeOf(() => admit(w.input({ machineId: "m-new" })))).toBe("E_LEASE_UNSETTLED");
    reconcileLease(w.record, { lease_id: first.lease_id, spent_micros: 0, quotes: [{ words: "settle the lost machine's lease at $0", by: "owner", source: "usage export" }], source: w.repo.prereg, now: new Date(NOW.getTime() + 25 * 3600_000) });
    const later = new Date(NOW.getTime() + 26 * 3600_000);
    expect(messageOf(() => w.lease({ machine: "m-new", now: later }))).toContain("for slot 2;");
    const second = admit(w.input({ machineId: "m-new", now: later }));
    expect(second.path).toBe(join(w.record, "items", "u11-lanea", "admission-0002.json"));
    expect(second.admission).toMatchObject({ seq: 2, run_id: "run-1", machine_id: "m-new", verdict: "green" });
    expect(messageOf(() => w.lease({ machine: "m-new", now: later, run: "run-2" }))).toContain("so run run-2 cannot spend from it");
    expect(w.lease({ machine: "m-new", now: later }).machine_id).toBe("m-new");
  });

  test("records are write-once; a later attempt sits beside a red one and decides", () => {
    const w = world();
    const red = admit(w.input({ probes: () => failing(greenProbes("trial"), "r5.dns") }));
    expect(codeOf(() => writeAdmission(w.record, red.admission))).toBe("E_LEDGER_RECORD");
    expect(codeOf(() => w.lease())).toBe("E_RIG_UNPROVEN");
    const green = admit(w.input());
    expect(green.path).toBe(admissionPath(w.record, "u11-lanea", 1, 2));
    expect(readdirSync(join(w.record, "items", "u11-lanea")).filter((f) => f.startsWith("admission")).sort()).toEqual(["admission-0001.2.json", "admission-0001.json"]);
    expect(JSON.parse(readFileSync(red.path, "utf8")).verdict).toBe("red");
    expect(w.lease().state).toBe("open");
  });

  test("a record that does not parse, names another run or another proof set refuses", () => {
    const w = world();
    const r = admit(w.input({ runId: "run-9" }));
    expect(r.admission.run_id).toBe("run-9");
    expect(messageOf(() => w.lease())).toContain("admits run run-9, not run-1");
    expect(messageOf(() => w.lease({ run: "run-9", proof: "direct" }))).toContain("holds the trial proof set, and this entry point needs the direct one");
    const v = world();
    writeFileSync(admissionPath(v.record, "u11-lanea", 1, 1), "{ not json");
    expect(messageOf(() => v.lease())).toContain("does not parse as one");
  });

  test("admit refuses to prove a dirty checkout, a run that is missing or still going, and an item with no cap or an open lease", () => {
    const w = world();
    writeFileSync(join(w.repo.root, "new.txt"), "x\n");
    expect(messageOf(() => admit(w.input()))).toContain("this checkout has uncommitted changes");
    rmSync(join(w.repo.root, "new.txt"));
    const none = world({ runs: () => [] });
    expect(messageOf(() => admit(none.input()))).toContain("gh workflow run rig.yml");
    const going = world({ runs: (r) => [{ head_sha: r.commit, tree: r.tree, status: "in_progress", conclusion: null }] });
    expect(messageOf(() => admit(going.input()))).toContain("still running");
    expect(codeOf(() => admit(w.input({ item: "nothing-here" })))).toBe("E_LEDGER_MISSING");
    expect(existsSync(join(w.record, "items", "u11-lanea", "admission-0001.json"))).toBe(false);
  });

  test("the admission bit is fixed at init", () => {
    const w = world();
    expect(codeOf(() => recordApproval(w.record, { action: "raise", item: "u11-lanea", cap_micros: 30_000_000, quotes: [{ words: "more", by: "owner", source: "s" }], admission: "warn" }))).toBe("E_USAGE");
    expect(codeOf(() => recordApproval(w.record, { action: "init", item: "u11-lanea", cap_micros: 20_000_000, quotes: [{ words: "keyless rig test, no spend", by: "tests/rig", source: "tests/rig/helpers.ts" }], admission: "warn" }))).not.toBe("no error");
    expect(readItem(w.record, "u11-lanea").admission).toBe("required");
  });

  test("R6: no workflow reads a secret or names a sealed key", () => {
    expect(workflowProbe()).toMatchObject({ id: "r6.workflows", pass: true });
    const root = mkdtempSync(join(tmpdir(), "gse-wf-"));
    dirs.push(root);
    const dir = join(root, ".github", "workflows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.yml"), "env:\n  K: ${{ secrets.SEALED_STORE_KEY }}\n");
    expect(workflowProbe(root)).toMatchObject({ pass: false, detail: expect.stringContaining("bad.yml reads secrets.") });
  });
});
