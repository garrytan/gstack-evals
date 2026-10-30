// Refusal before any experimental call through each funded entry point (CI plan v5, U20 "Done means"): a direct-API arm
// leasing through gstack-evals ledger lease, the replay arm (lanes/review-replay), and Lane A with its judge calibration,
// which run only after dockerRig's lease (Docker tier). A missing, red or stale record, or one for the other proof set,
// refuses with E_RIG_UNPROVEN and nothing reaches the provider; a warn item warns and proceeds.
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReplay } from "../../lanes/review-replay/run.ts";
import { ledgerCli } from "../../src/runner/ledger/cli.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { dockerRig } from "../../src/skill-eval/cli/run-host.ts";
import type { Call } from "../../src/skill-eval/cli/call.ts";
import { buildTrialImage, stateRoot } from "../../src/trial/image.ts";
import { admitThisCheckout, initItem } from "./helpers.ts";

const KEYS = { ANTHROPIC_API_KEY: "fake-anthropic-value-for-rig-tests", OPENAI_API_KEY: "fake-openai-value-for-rig-tests", OPENROUTER_API_KEY: "fake-openrouter-value-for-rig-tests" };
const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
const temp = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), "gse-entry-" + name + "-"));
  dirs.push(d);
  return d;
};
const item = (record: string, name: string) => join(record, "items", name);
const redden = (path: string) => {
  const a = JSON.parse(readFileSync(path, "utf8"));
  rmSync(path);
  writeFileSync(path, JSON.stringify({ ...a, verdict: "red", problems: ["a red test record"] }));
};
const staleTree = (path: string) => {
  const a = JSON.parse(readFileSync(path, "utf8"));
  rmSync(path);
  writeFileSync(path, JSON.stringify({ ...a, tree: "f".repeat(40) }));
};

describe("a direct-API arm leasing through gstack-evals ledger lease", () => {
  test("refuses a missing, red or stale record before any lease, and leases on a green one", async () => {
    const dir = temp("cli");
    const record = join(dir, "record");
    const env = { GSTACK_EVALS_LEDGER_RECORD: record, GSTACK_EVALS_LEDGER: join(dir, "ledger.sqlite"), GSTACK_EVALS_APPROVALS_BIN: "/bin/true" };
    initItem(record, "direct-arm", "required");
    const lease = async () => {
      const err: string[] = [];
      const code = await ledgerCli(["lease", "--item", "direct-arm", "--run", "run-1"], { out: () => {}, err: (s) => err.push(s) }, env);
      return { code, err: err.join("\n") };
    };
    expect(await lease()).toMatchObject({ code: 2, err: expect.stringMatching(/^E_RIG_UNPROVEN line item direct-arm requires admission: no admission record at .* for slot 1;/) });
    const path = admitThisCheckout(record, { item: "direct-arm", proof: "direct" });
    redden(path);
    expect((await lease()).err).toContain("is red: a red test record");
    rmSync(path);
    staleTree(admitThisCheckout(record, { item: "direct-arm", proof: "direct" }));
    expect((await lease()).err).toContain("is stale: it proves tree ffffffffffff");
    expect(readItem(record, "direct-arm").leases).toEqual([]);
    rmSync(path);
    admitThisCheckout(record, { item: "direct-arm", proof: "direct" });
    expect(await lease()).toMatchObject({ code: 0, err: "" });
  });
});

describe("the replay arm (lanes/review-replay)", () => {
  function replay(admission: "required" | "warn") {
    const dir = temp("replay");
    cpSync(join(import.meta.dir, "..", "replay", "fixtures", "run"), join(dir, "plan"), { recursive: true });
    const record = join(dir, "record");
    initItem(record, "replay", admission, 1_000_000);
    const sent: string[] = [];
    const err: string[] = [];
    const run = () =>
      runReplay({
        plan: join(dir, "plan", "plan.json"), out: join(dir, "out-" + sent.length + "-" + err.length), item: "replay", ledger: join(dir, "ledger.sqlite"), ledgerRecord: record, env: KEYS, concurrency: 1,
        io: { out: () => {}, err: (l) => err.push(l) },
        fetch: async (_url, init) => {
          sent.push(String(init.body).slice(0, 20));
          return Response.json({ id: "msg", type: "message", content: [{ type: "text", text: "Finding: none." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } });
        },
      });
    return { record, sent, err, run };
  }

  test("refuses a missing record, a red one and one for the trial proof set before it sends anything", async () => {
    const r = replay("required");
    expect(await r.run()).not.toBe(0);
    expect(r.err.some((l) => l.startsWith("E_RIG_UNPROVEN ") && l.includes("for slot 1;"))).toBe(true);
    const path = admitThisCheckout(r.record, { item: "replay", proof: "direct" });
    redden(path);
    expect(await r.run()).not.toBe(0);
    expect(r.err.some((l) => l.includes("is red: a red test record"))).toBe(true);
    expect(r.sent).toEqual([]);
    expect(readItem(r.record, "replay").leases).toEqual([]);
  });

  test("runs on a green direct record, and a warn item warns and runs", async () => {
    const r = replay("required");
    admitThisCheckout(r.record, { item: "replay", proof: "direct" });
    expect(await r.run()).toBe(0);
    expect(r.sent.length).toBeGreaterThan(0);
    const w = replay("warn");
    expect(await w.run()).toBe(0);
    expect(w.sent.length).toBeGreaterThan(0);
    expect(w.err.some((l) => l.startsWith("RIG_UNPROVEN: "))).toBe(true);
  });
});

describe.skipIf(!DOCKER)("Lane A and its judge calibration, at dockerRig's lease (Docker tier, GSTACK_EVALS_DOCKER=1)", () => {
  test("a required item with no record refuses before the trial network or the proxy exists", () => {
    const root = temp("lanea");
    const arm = join(root, "arms", "after");
    mkdirSync(arm, { recursive: true });
    writeFileSync(join(arm, "SKILL.md"), "---\nname: demo\ndescription: Demo skill.\n---\n# Demo\n");
    mkdirSync(join(root, "tasks"));
    writeFileSync(join(root, "tasks", "tasks.json"), "[]\n");
    const record = join(root, "record");
    initItem(record, "lanea", "required", 5_000_000);
    const call = { host: "claude", tasks: join(root, "tasks", "tasks.json"), arms: { arms: [{ name: "after", kind: "overlay", base: null, skill: "demo", dir: arm }, { name: "none", kind: "overlay", base: null, skill: "demo", dir: null }], base: null, skill: null, notes: [] }, out: { path: join(root, "out"), rule: "test" }, ledger: { path: join(root, "ledger.sqlite"), rule: "test" }, record: { path: record, rule: "test" }, item: "lanea", runId: "lanea-run", spendCap: 1_000_000 } as unknown as Call;
    expect(buildTrialImage({ state: stateRoot() }).ok).toBe(true);
    const networks = () => spawnSync("docker", ["network", "ls", "-q"], { encoding: "utf8" }).stdout.trim().split("\n").length;
    const before = networks();
    let code = "no error";
    try {
      dockerRig(call, { env: process.env, skill: "demo", nonce: "n0nce42", cap: 1_000_000 });
    } catch (error) {
      code = (error as { code?: string }).code ?? (error as Error).message;
    }
    expect(code).toBe("E_RIG_UNPROVEN");
    expect(networks()).toBe(before);
    expect(readItem(record, "lanea").leases).toEqual([]);
  }, 600_000);
});
