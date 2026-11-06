import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { appendRow, Ledger, readRows, toMicros, type Row } from "../runner/ledger.ts";
import { armSpec, jobConfig } from "../runner/grid.ts";
import { stageArms } from "../runner/prepare-run.ts";
import { ARM_SPECS, blockShares, classify, extendsMirror, hostTtlHours, ITEMS, itemCheck, itemParts, L1, L1_ROUTE, plannedCells, relaunchRects, restoreRows, seeded, sessionRefs, sha256, splitJobs, startedCells, trialTasksFrom } from "../l1/l1.ts";

// L1's launcher logic without a host (l1/l1.ts), the tar sharing in grid.ts and prepare-run.ts, and vm-run.sh's
// multi-job loop. l1-host.test.ts drives the commands end to end on a fake host.
const LANEB = resolve(import.meta.dir, "..");
const REPO = resolve(LANEB, "../..");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const pilotText = () => readFileSync(join(REPO, L1.pilot.file), "utf8");
const fPartsText = () => readFileSync(join(REPO, L1.fParts.file), "utf8");
const tb2Text = (n = 37) => Array.from({ length: n }, (_, i) => (i < 19 ? "1" : "2") + " tb2-task-" + String(i).padStart(2, "0")).join("\n") + "\n";
const row = (r: Partial<Row> & { kind: Row["kind"]; id: string }): Row => ({ ts: "t", item: "pilot-opus", usd_micros: 0, ...r }) as Row;

describe("L1's frozen inputs and plans", () => {
  test("the frozen inputs hash to the prereg's digests, and the cells files carry section 9's session allowances and the 100-turn ceiling; cells.l1.json is 802c2e4's byte for byte and Sol's cell has its own file", () => {
    expect(sha256(fPartsText())).toBe(L1.fParts.sha256);
    expect(sha256(pilotText())).toBe(L1.pilot.sha256);
    const swe = JSON.parse(readFileSync(join(LANEB, "config/cells.l1.json"), "utf8"));
    const sol = JSON.parse(readFileSync(join(LANEB, "config/cells.l1-sol.json"), "utf8"));
    expect(sha256(readFileSync(join(LANEB, "config/cells.l1.json"), "utf8"))).toBe("80934de1f6ddcbc653130f1c709d471eba4ced7b0ea9a0c7d562c808385400fc");
    const tb2 = JSON.parse(readFileSync(join(LANEB, "config/cells.l1-tb2.json"), "utf8"));
    expect(swe.models).toEqual([{ id: "claude-opus-5-5", harbor_model: "anthropic/claude-opus-5-5", session_cap_usd: 5 }]);
    expect(sol.models).toEqual([{ id: "gpt-6.1-sol", harbor_model: "anthropic/gpt-6.1-sol", session_cap_usd: 5 }]);
    expect(JSON.parse(readFileSync(join(LANEB, "config/proxy.json"), "utf8")).models["gpt-6.1-sol"]).toMatchObject({ route: "openrouter", upstream_model: "openai/gpt-6.1-sol" });
    expect(tb2.models).toEqual([{ id: "claude-opus-5-5", harbor_model: "anthropic/claude-opus-5-5", session_cap_usd: 2.5 }]);
    for (const c of [swe, sol, tb2]) expect([c.sdk_max_turns, c.max_output_tokens, c.verifier_timeout_multiplier]).toEqual([100, 32000, 2]);
    expect(Object.entries(ITEMS).map(([k, v]) => [k, v.capUsd, v.cells, v.allowanceUsd, v.model, v.route?.item ?? null])).toEqual([
      ["pilot-opus", 80, "cells.l1.json", 5, "claude-opus-5-5", null], ["f1-opus", 680, "cells.l1.json", 5, "claude-opus-5-5", null], ["tb2-opus", 180, "cells.l1-tb2.json", 2.5, "claude-opus-5-5", null],
      ["pilot-sol", 100, "cells.l1-sol.json", 5, "gpt-6.1-sol", "l1-route-sol"], ["f1-sol", 730, "cells.l1-sol.json", 5, "gpt-6.1-sol", "l1-route-sol"],
    ]);
  });

  test("l1-route-sol: Sol's route check on its own $20 item, smoke on L1's none arm and told /investigate on L1's after arm, at cells.l1-sol.json's Sol cell", () => {
    expect(L1_ROUTE).toMatchObject({ id: "gpt-6.1-sol", item: "l1-route-sol", capUsd: 20, routePrefix: "l1-route-sol/", ledgerPort: "9918", cells: "cells.l1-sol.json", armManifests: "arms/manifests/l1" });
    expect(L1_ROUTE.routeArms).toEqual({ smoke: ARM_SPECS.none, told: ARM_SPECS["after-t"] });
    expect(armSpec(L1_ROUTE.routeArms.told)).toMatchObject({ name: "after-t", tar_name: "after", told: "investigate", system_prompt: "claude-code-preset", gstack_hooks: "copy" });
    expect(armSpec(L1_ROUTE.routeArms.smoke)).toMatchObject({ name: "none", system_prompt: "claude-code-preset", gstack_hooks: "copy" });
    expect(armSpec(L1_ROUTE.routeArms.smoke).told).toBeUndefined();
    expect(Object.keys(ITEMS)).not.toContain("l1-route-sol");
  });

  test("pilot-sol has pilot-opus's shape and order; f1-sol runs f-parts.txt's four parts on none, before-u, after-u, before-t and after-t", () => {
    const [p, ...rest] = itemParts("pilot-sol", { pilot: pilotText() });
    expect(rest).toEqual([]);
    expect([p!.name, p!.prefix]).toEqual(["pilot", "pilot-sol/pilot/"]);
    expect(p!.rects).toEqual(itemParts("pilot-opus", { pilot: pilotText() })[0]!.rects);
    expect([...plannedCells(p!).values()].reduce((a, b) => a + b, 0)).toBe(32);
    const sol = itemParts("f1-sol", { fParts: fPartsText() }), opus = itemParts("f1-opus", { fParts: fPartsText() });
    expect(sol.map((x) => [x.name, x.prefix])).toEqual([["f1-1", "f1-sol/f1-1/"], ["f1-2", "f1-sol/f1-2/"], ["f1-3", "f1-sol/f1-3/"], ["f1-4", "f1-sol/f1-4/"]]);
    for (const [i, x] of sol.entries()) {
      expect(x.rects.map((r) => [r.tasks.length, [...r.arms].sort().join(), r.attempts])).toEqual([[20, "after-t,after-u,before-t,before-u,none", 1]]);
      expect([...x.rects[0]!.tasks].sort()).toEqual([...opus[i]!.rects[0]!.tasks].sort());
    }
    expect(sol.reduce((n, x) => n + [...plannedCells(x).values()].reduce((a, b) => a + b, 0), 0)).toBe(400);
    expect(() => itemParts("f1-sol", { fParts: fPartsText().trim().split("\n").slice(1).join("\n") })).toThrow("parts 1 to 4 of 20");
  });

  test("pilot-opus: one part, the 10 pilot tasks on before-u and before-t, then the 3 smoke tasks on after-u, after-t, off-u and off-t", () => {
    const [p, ...rest] = itemParts("pilot-opus", { pilot: pilotText() });
    expect(rest).toEqual([]);
    expect([p!.name, p!.prefix]).toEqual(["pilot", "pilot-opus/pilot/"]);
    expect(p!.rects.map((x) => [x.tasks.length, [...x.arms].sort(), x.attempts])).toEqual([[10, ["before-t", "before-u"], 1], [3, ["after-t", "after-u", "off-t", "off-u"], 1]]);
    expect([...p!.rects[1]!.tasks].sort()).toEqual([...L1.smoke].sort());
    expect([...plannedCells(p!).values()].reduce((a, b) => a + b, 0)).toBe(32);
  });

  test("pilot-opus refuses a list that is not 10 distinct tasks or that leaves out a smoke task, and an unknown item is refused", () => {
    const lines = pilotText().trim().split("\n");
    expect(() => itemParts("pilot-opus", { pilot: lines.slice(1).join("\n") })).toThrow("10 distinct");
    expect(() => itemParts("pilot-opus", { pilot: [...lines.slice(1), lines[1]].join("\n") })).toThrow("10 distinct");
    expect(() => itemParts("pilot-opus", { pilot: lines.map((t) => (t === "BerriAI__litellm-16275" ? "other__task-1" : t)).join("\n") })).toThrow("every smoke task");
    expect(() => itemParts("pilot-2", {})).toThrow("unknown item");
  });

  test("f1-opus: four parts of 20 tasks, every task on all seven arms; a part out of shape or a task named twice is refused", () => {
    const parts = itemParts("f1-opus", { fParts: fPartsText() });
    expect(parts.map((p) => p.name)).toEqual(["f1-1", "f1-2", "f1-3", "f1-4"]);
    for (const p of parts) expect(p.rects.map((x) => [x.tasks.length, [...x.arms].sort().join(), x.attempts])).toEqual([[20, "after-t,after-u,before-t,before-u,none,off-t,off-u", 1]]);
    expect(new Set(parts.flatMap((p) => p.rects[0]!.tasks)).size).toBe(80);
    expect(() => itemParts("f1-opus", { fParts: fPartsText().trim().split("\n").slice(1).join("\n") })).toThrow("parts 1 to 4 of 20");
    expect(() => itemParts("f1-opus", { fParts: fPartsText() + "1 BerriAI__litellm-17027\n" })).toThrow("names a task twice");
  });

  test("tb2-opus: parts 1 and 2 holding the twin's 37 tasks, on five arms with two attempts; a split of another size is refused", () => {
    const parts = itemParts("tb2-opus", { tb2Parts: tb2Text() });
    expect(parts.map((p) => [p.name, p.rects[0]!.tasks.length, [...p.rects[0]!.arms].sort().join(), p.rects[0]!.attempts])).toEqual([
      ["tb2-1", 19, "after-t,after-u,before-t,before-u,none", 2], ["tb2-2", 18, "after-t,after-u,before-t,before-u,none", 2],
    ]);
    expect(() => itemParts("tb2-opus", { tb2Parts: tb2Text(36) })).toThrow("37 tasks");
  });

  test("the interleave is seeded by 20261102: the same tasks in any input order give the same order, and another seed gives another", () => {
    const tasks = itemParts("f1-opus", { fParts: fPartsText() })[0]!.rects[0]!.tasks;
    const a = seeded([{ tasks, arms: ["none", "before-u", "after-u"], attempts: 1 }]);
    const b = seeded([{ tasks: [...tasks].reverse(), arms: ["after-u", "none", "before-u"], attempts: 1 }]);
    expect(a).toEqual(b);
    expect([...a[0]!.tasks].sort()).toEqual([...tasks].sort());
    expect(seeded([{ tasks, arms: ["none"], attempts: 1 }], 1)[0]!.tasks).not.toEqual(a[0]!.tasks);
  });

  test("the awake host's TTL covers every part and one relaunch at 18 h each plus a day, and its reserve fits in each item's cap beside six open sessions and a VM block", () => {
    expect([1, 2, 4].map(hostTtlHours)).toEqual([60, 78, 114]);
    expect(L1.host.launchHours).toBe(L1.vm.ttlHours + 2);
    for (const [item, n] of [["pilot-opus", 1], ["tb2-opus", 2], ["f1-opus", 4], ["pilot-sol", 1], ["f1-sol", 4]] as const) {
      const def = ITEMS[item]!;
      expect(hostTtlHours(n) * L1.host.usdPerHour + L1.concurrent * def.allowanceUsd + Number(L1.vm.usdPerHour) * Number(L1.vm.reserveHours)).toBeLessThan(def.capUsd);
    }
  });

  test("splitJobs: each rectangle becomes its own job in order, with its tasks, arms and attempts; a task or arm outside job.json is refused", () => {
    const job = { job_name: "j", n_attempts: 2, tasks: ["a", "b", "c"].map((t) => ({ path: "/vm/run/tasks/" + t })), agents: ["x", "y"].map((arm) => ({ name: "laneb", kwargs: { arm } })) };
    const jobs = splitJobs(job, [{ tasks: ["b", "a"], arms: ["y"], attempts: 1 }, { tasks: ["c"], arms: ["x", "y"], attempts: 2 }]);
    expect(jobs.map((j) => [j.job_name, j.n_attempts, j.tasks.map((t: any) => t.path.split("/").at(-1)).join(), j.agents.map((a: any) => a.kwargs.arm).join()])).toEqual([["j", 1, "b,a", "y"], ["j-2", 2, "c", "x,y"]]);
    expect(() => splitJobs(job, [{ tasks: ["d"], arms: ["x"], attempts: 1 }])).toThrow("task d is not in job.json");
    expect(() => splitJobs(job, [{ tasks: ["a"], arms: ["z"], attempts: 1 }])).toThrow("arm z is not in job.json");
  });
});

describe("which cells started", () => {
  test("a cell starts once the item's ledger accepted a reserve for one of its sessions; VM blocks, settles and other parts' rows don't count", () => {
    const part = { rects: [{ tasks: ["t-one", "t-two"], arms: ["none", "before-u"], attempts: 1 }] };
    const rows = [
      row({ kind: "reserve", id: "pilot-opus/p/vm" }), row({ kind: "reserve", id: "pilot-opus/p/vm-2" }),
      row({ kind: "reserve", id: "pilot-opus/p/s1", trial: "t-one__abcdefg__env", arm: "none" } as any),
      row({ kind: "settle", id: "pilot-opus/p/s1", trial: "t-one__abcdefg__env", arm: "none" } as any),
      row({ kind: "reserve", id: "pilot-opus/q/s2", trial: "t-two__abcdefg__env", arm: "none" } as any),
    ];
    const refs = sessionRefs(rows, "pilot-opus/p/");
    expect(refs).toEqual([{ trial: "t-one__abcdefg__env", arm: "none" }]);
    expect(startedCells(part, refs).neverStarted.map((c) => c.task + ":" + c.arm).sort()).toEqual(["t-one:before-u", "t-two:before-u", "t-two:none"]);
    expect(sessionRefs([], "pilot-opus/p/", [{ trial: "t-two__1234567__env", meta: { arm: "before-u" } }])).toEqual([{ trial: "t-two__1234567__env", arm: "before-u" }]);
  });

  test("a trial whose 32-character stem fits two planned tasks starts both unless its config.json names the task, so a doubtful cell is never relaunched", () => {
    const t1 = "averyveryverylongorganization__project-101", t2 = "averyveryverylongorganization__project-202";
    const stem = t1.slice(0, 32).replace(/[_-]+$/, "");
    const part = { rects: [{ tasks: [t1, t2], arms: ["none"], attempts: 1 }] };
    const refs = [{ trial: stem + "__AbC1234__env", arm: "none" }];
    expect(startedCells(part, refs).neverStarted).toEqual([]);
    const jobs = tmp("l1-trials-");
    mkdirSync(join(jobs, "j", stem + "__AbC1234"), { recursive: true });
    writeFileSync(join(jobs, "j", stem + "__AbC1234", "config.json"), JSON.stringify({ trial_name: stem + "__AbC1234", task: { path: "/vm/run/tasks/" + t1 } }));
    expect(startedCells(part, refs, trialTasksFrom(jobs)).neverStarted).toEqual([{ task: t2, arm: "none", replicates: 1 }]);
    expect(startedCells(part, [{ trial: stem + "__AbC1234__env", arm: "after-u" }]).strays).toHaveLength(1);
  });

  test("two-attempt cells: each started trial takes one replicate, a trial seen twice counts once, and the relaunch groups never-started cells by replicates and arm set", () => {
    const part = { rects: [{ tasks: ["ta", "tb"], arms: ["none", "after-u"], attempts: 2 }] };
    const refs = [{ trial: "ta__aaaaaaa__env", arm: "none" }, { trial: "ta__bbbbbbb__env", arm: "none" }, { trial: "ta__ccccccc__env", arm: "after-u" }, { trial: "ta__ccccccc__env", arm: "after-u" }];
    const c = startedCells(part, refs);
    expect(c.neverStarted.map((x) => [x.task, x.arm, x.replicates].join()).sort()).toEqual(["ta,after-u,1", "tb,after-u,2", "tb,none,2"]);
    const rects = relaunchRects(c.neverStarted);
    expect(rects.map((x) => [x.tasks.join(), [...x.arms].sort().join(), x.attempts].join("|")).sort()).toEqual(["ta|after-u|1", "tb|after-u,none|2"]);
  });
});

describe("why a part ended", () => {
  const dir = (files: Record<string, string>) => {
    const d = tmp("l1-classify-");
    for (const [f, body] of Object.entries(files)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), body); }
    return d;
  };

  test("cap stops: a refused first VM block, a refused later block, cap-stop.json, a latched proxy cap stop, and an unreadable cap-stop.json", () => {
    expect(classify(dir({}), 9)).toMatchObject({ cap_stop: ["the ledger refused the part VM's first block"], loss: [] });
    expect(classify(dir({ "vm-cap-stop": "the ledger refused VM block 3 (p-vm-3, $2.4) for pilot-opus\n" }), 130)).toMatchObject({ cap_stop: ["VM block: the ledger refused VM block 3 (p-vm-3, $2.4) for pilot-opus"], loss: [] });
    expect(classify(dir({ "pulled/out/cap-stop.json": '{"cap_stop":"ledger refused"}' }), 130).cap_stop).toEqual(["cap-stop.json: ledger refused"]);
    expect(classify(dir({ "pulled/out/proxy-requests.jsonl": '{"event":"cap_stop"}\n' }), 0).cap_stop).toEqual(["the proxy latched a cap stop"]);
    expect(classify(dir({ "pulled/out/cap-stop.json": "{" }), 0).cap_stop[0]).toContain("unreadable");
  });

  test("losses: an unpulled VM (exit 7), a dropped connection (129), an unreachable ledger service, a ledger service with no answer for a block, a lost controller or host", () => {
    expect(classify(dir({}), 7).loss[0]).toContain("could not be pulled");
    expect(classify(dir({ "pulled/out/vm-run.exit": "129\n" }), 1).loss[0]).toContain("HUP");
    expect(classify(dir({}), 129)).toMatchObject({ cap_stop: [] });
    expect(classify(dir({ "pulled/out/proxy-requests.jsonl": '{"event":"reserve_failed"}\n{"event":"reserve_failed"}\n' }), 0).loss).toEqual(["2 session opens found the ledger service unreachable"]);
    expect(classify(dir({ "vm-cap-stop": "the ledger service gave no answer (HTTP 000) before VM block 1 ran out" }), 130)).toMatchObject({ cap_stop: [], loss: ["VM block: the ledger service gave no answer (HTTP 000) before VM block 1 ran out"] });
    expect(classify(dir({}), null, { controllerLost: true }).loss).toEqual(["the controller was lost before it recorded an exit"]);
    expect(classify(dir({}), null, { hostLost: true }).loss).toEqual(["the awake host was lost"]);
  });

  test("a clean batch, or one that ended early for another reason, is neither a cap stop nor a loss, so its unstarted cells are infra", () => {
    expect(classify(dir({ "pulled/out/vm-run.exit": "0\n", "pulled/jobs/j/.keep": "" }), 0)).toEqual({ launch_exit: 0, vm_run_exit: "0", pulled: true, cap_stop: [], loss: [], unclassified: [] });
    expect(classify(dir({ "pulled/out/vm-run.exit": "6\n", "pulled/jobs/j/.keep": "" }), 6)).toMatchObject({ cap_stop: [], loss: [] });
  });
});

describe("ledger arithmetic", () => {
  test("blockShares settles a VM's blocks as launch.sh does: in order, each capped at the block but the last, floored at 0", () => {
    const open = ["p/vm", "p/vm-2", "p/vm-3", "p/s1"];
    expect(blockShares(open, "p/vm", 2.4, 5).map((s) => [s.id, s.usd])).toEqual([["p/vm", 2.4], ["p/vm-2", 2.4], ["p/vm-3", 0.2]]);
    expect(blockShares(open, "p/vm", 2.4, 1).map((s) => s.usd)).toEqual([1, 0, 0]);
    expect(blockShares(open, "p/vm", 2.4, 9).map((s) => s.usd)).toEqual([2.4, 2.4, 4.2]);
  });

  test("restoreRows rebuilds only what the mirror lacks: closed sessions at their cap and spend, VM blocks up to its hours, and the host's hours, each marked recovered", () => {
    const rows = [
      row({ kind: "approval", id: "approval", usd_micros: toMicros(80) }), row({ kind: "reserve", id: "host-1", usd_micros: toMicros(4.8) }),
      row({ kind: "reserve", id: "p/vm", usd_micros: toMicros(2.4) }), row({ kind: "reserve", id: "p/s1", usd_micros: toMicros(5) }), row({ kind: "settle", id: "p/s1", usd_micros: 100 }),
    ];
    const sessions = [
      { id: "s1", trial: "a__1234567__env", closed_at: "x", spent_micros: 100, cap_micros: toMicros(5) },
      { id: "s2", trial: "b__1234567__env", closed_at: "x", spent_micros: 250, cap_micros: toMicros(5), meta: { arm: "none" } },
      { id: "s3", trial: "c__1234567__env", spent_micros: 0, cap_micros: toMicros(5) },
    ];
    const add = restoreRows(rows, { item: "pilot-opus", prefix: "p/", sessions, vm: { id: "p/vm", hours: 5 }, hostId: "host-1", hostHours: 10, at: "now" });
    expect(add.map((r) => [r.kind, r.id, r.usd_micros])).toEqual([
      ["reserve", "p/s2", toMicros(5)], ["settle", "p/s2", 250], ["reserve", "p/vm-2", toMicros(2.4)], ["settle", "p/vm", toMicros(2.4)], ["settle", "p/vm-2", toMicros(0.6)], ["settle", "host-1", toMicros(0.8)],
    ]);
    expect(add.every((r) => r.recovered === true)).toBe(true);
    expect(add[0]).toMatchObject({ arm: "none", trial: "b__1234567__env" });
  });

  test("itemCheck: the item's approval at its cap, no raise, and no rows but the awake hosts'", () => {
    const p = join(tmp("l1-item-"), "l.jsonl");
    const l = new Ledger(p, "pilot-opus");
    expect(() => itemCheck(readRows(p), "pilot-opus")).toThrow("no approval row");
    l.approve(80, {});
    l.reserve("host-1", toMicros(4.8));
    l.settle("host-1", toMicros(1));
    expect(() => itemCheck(readRows(p), "pilot-opus")).not.toThrow();
    expect(() => itemCheck(readRows(p), "f1-opus")).toThrow("no approval row for f1-opus");
    l.reserve("pilot-opus/pilot/s1", 1);
    expect(() => itemCheck(readRows(p), "pilot-opus")).toThrow("already holds 1 reserve");
    const q = join(tmp("l1-item-"), "l.jsonl");
    new Ledger(q, "pilot-opus").approve(81, {});
    expect(() => itemCheck(readRows(q), "pilot-opus")).toThrow("cap on the ledger is $81");
    const raise = join(tmp("l1-item-"), "l.jsonl");
    new Ledger(raise, "pilot-opus").approve(80, {});
    appendRow(raise, row({ kind: "approval", id: "raise", usd_micros: toMicros(90) }));
    expect(() => itemCheck(readRows(raise), "pilot-opus")).toThrow("cap raise");
  });

  test("the agent's mirror only grows: a copy that is shorter or differs in the old bytes is refused", () => {
    expect(() => extendsMirror(null, Buffer.from("a"))).not.toThrow();
    expect(() => extendsMirror(Buffer.from("ab"), Buffer.from("abc"))).not.toThrow();
    expect(() => extendsMirror(Buffer.from("abc"), Buffer.from("ab"))).toThrow("append-only");
    expect(() => extendsMirror(Buffer.from("abc"), Buffer.from("abXd"))).toThrow("append-only");
  });
});

describe("arms that share a tar", () => {
  test("L1's seven arms run on four tars, all on Claude Code's preset; told arms are told /investigate, and none sets a procedure line or session kind", () => {
    const specs = Object.values(ARM_SPECS).map(armSpec);
    expect(specs.map((s) => [s.name, s.tar_name ?? s.name, s.told ?? null])).toEqual([
      ["none", "none", null], ["before-u", "before", null], ["after-u", "after", null], ["off-u", "off", null],
      ["before-t", "before", "investigate"], ["after-t", "after", "investigate"], ["off-t", "off", "investigate"],
    ]);
    expect(specs.every((s) => s.system_prompt === "claude-code-preset" && !s.procedure_line && !s.session_kind)).toBe(true);
  });

  test("tar=<name> becomes tar_name, which the agent's kwargs never carry; a bad or repeated tar is refused; sdk_max_turns reaches the kwargs only when set", () => {
    expect(armSpec("before-u:tar=before:system_prompt=claude-code-preset")).toEqual({ name: "before-u", tar_name: "before", system_prompt: "claude-code-preset" });
    expect(() => armSpec("x:tar=Bad/Name")).toThrow("E_USAGE");
    expect(() => armSpec("x:tar=a:tar=b")).toThrow("set twice");
    const spec = (extra: object) => jobConfig({
      job_name: "j", tasks_dir: "/run/tasks", tasks: ["t"], attempts: 1, n_concurrent: 1, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://g:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2,
      models: [{ id: "claude-opus-5-5", harbor_model: "anthropic/claude-opus-5-5", session_cap_usd: 5 }] as any,
      arms: [{ ...armSpec(ARM_SPECS["before-t"]!), tar: "/run/arms/before.tar", sha256: "s" }], ...extra,
    });
    const job = spec({ sdk_max_turns: 100 });
    expect(job.agents[0]!.kwargs).toMatchObject({ arm: "before-t", arm_tar: "/run/arms/before.tar", told_skill: "investigate", sdk_max_turns: 100 });
    expect(JSON.stringify(job)).not.toContain("tar_name");
    expect(JSON.stringify(spec({}))).not.toContain("sdk_max_turns");
  });

  test("prepare-run copies a shared tar once, checks it against its one manifest, and records each label with its tar; a changed tar, a missing one or a label used twice is refused", () => {
    const root = tmp("l1-stage-");
    const armDir = join(root, "tars");
    for (const d of [armDir, join(root, "m")]) mkdirSync(d, { recursive: true });
    for (const n of ["none", "before"]) {
      writeFileSync(join(armDir, n + ".tar"), n + "-bytes");
      writeFileSync(join(root, "m", n + ".json"), JSON.stringify({ tar: { sha256: sha256(n + "-bytes") } }));
    }
    const runDir = () => { const r = join(tmp("l1-stage-run-"), "run"); mkdirSync(join(r, "arms"), { recursive: true }); return r; };
    const run = runDir();
    const o = (r: string) => ({ armDir, run: r, root, armManifests: "m", vm: "/vm" });
    const arms = stageArms([ARM_SPECS.none, ARM_SPECS["before-u"], ARM_SPECS["before-t"]].join(","), o(run));
    expect(readdirSync(join(run, "arms")).sort()).toEqual(["before.tar", "none.tar"]);
    expect(arms.map((a: any) => [a.name, a.tar, a.sha256, a.tar_name ?? null, a.options.told ?? null])).toEqual([
      ["none", "/vm/run/arms/none.tar", sha256("none-bytes"), null, null],
      ["before-u", "/vm/run/arms/before.tar", sha256("before-bytes"), "before", null],
      ["before-t", "/vm/run/arms/before.tar", sha256("before-bytes"), "before", "investigate"],
    ]);
    expect(() => stageArms([ARM_SPECS["before-u"], ARM_SPECS["before-u"]].join(","), o(runDir()))).toThrow("named twice");
    expect(() => stageArms(ARM_SPECS["after-u"]!, o(runDir()))).toThrow();
    writeFileSync(join(armDir, "before.tar"), "changed");
    expect(() => stageArms(ARM_SPECS["before-t"]!, o(runDir()))).toThrow("is not the preregistered");
  });
});

describe("vm-run.sh with more than one job", () => {
  // Fakes as in vm-run.test.ts: sg runs any harbor command, curl answers, the proxy never runs, and the fake harbor logs
  // each config it runs and, per job, exits with rc.<job>, writes STOP (stop.<job>) or latches a cap stop (cap.<job>).
  function vmRig(jobs: string[], o: { files?: string[]; rc?: Record<string, number>; manifest?: unknown; gz?: Record<string, string> } = {}) {
    const root = tmp("l1-vmrun-");
    const bin = join(root, "bin"), run = join(root, "run"), home = join(root, "home");
    for (const d of [bin, join(run, "arms"), home]) mkdirSync(d, { recursive: true });
    writeFileSync(join(home, ".laneb-keys"), "");
    const log = join(root, "harbor.log");
    const fakes: Record<string, string> = {
      sg: '#!/usr/bin/env bash\ncase "$3" in *"network inspect"*) echo 172.17.0.1 ;; *"harbor run"*) eval "$3" ;; esac\n',
      curl: "#!/usr/bin/env bash\necho '{}'\n",
      bun: "#!/usr/bin/env bash\nexit 1\n",
      sleep: "#!/usr/bin/env bash\nPATH=/usr/bin:/bin exec sleep 0.01\n",
      pkill: `#!/usr/bin/env bash\necho "pkill $*" >> "${root}/pkill.log"\n`,
      harbor: `#!/usr/bin/env bash
cfg=\${*: -1}
n=$(basename "$cfg" .resolved.json)
echo "$n $(jq -r .job_name "$cfg") $(grep -c __GATEWAY__ "$cfg")" >> "${log}"
[ ! -e "${root}/stop.$n" ] || touch "${run}/STOP"
[ ! -e "${root}/cap.$n" ] || echo '{"cap_stop":"test"}' > "${run}/out/cap-stop.json"
exit "$(cat "${root}/rc.$n" 2>/dev/null || echo 0)"
`,
    };
    for (const [name, body] of Object.entries(fakes)) writeFileSync(join(bin, name), body, { mode: 0o755 });
    writeFileSync(join(run, "manifest.json"), JSON.stringify(o.manifest ?? { arms: [] }));
    for (const j of jobs) writeFileSync(join(run, j + ".json"), JSON.stringify({ job_name: j, base: "http://__GATEWAY__:8787" }));
    for (const f of o.files ?? []) writeFileSync(join(root, f), "");
    for (const [j, rc] of Object.entries(o.rc ?? {})) writeFileSync(join(root, "rc." + j), String(rc));
    for (const [name, body] of Object.entries(o.gz ?? {})) writeFileSync(join(run, "arms", name + ".tar.gz"), Bun.gzipSync(Buffer.from(body)));
    const p = Bun.spawnSync(["bash", join(LANEB, "runner/vm-run.sh"), run, "p-", "5"], { env: { HOME: home, PATH: bin + ":" + process.env.PATH }, stdout: "pipe", stderr: "pipe" });
    return {
      code: p.exitCode, stderr: p.stderr.toString(),
      harbor: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
      exit: readFileSync(join(run, "out", "vm-run.exit"), "utf8").trim(),
      out: (f: string) => existsSync(join(run, "out", f)),
    };
  }

  test("job.json runs first, then job-2.json, job-3.json ... in numeric order, each resolved with the gateway and logged apart", () => {
    const v = vmRig(["job", "job-2", "job-10", "job-3"]);
    expect(v.harbor).toEqual(["job job 0", "job-2 job-2 0", "job-3 job-3 0", "job-10 job-10 0"]);
    expect(["harbor.log", "harbor-2.log", "harbor-3.log", "harbor-10.log"].every(v.out)).toBe(true);
    expect([v.exit, v.code]).toEqual(["0", 0]);
  });

  test("the exit code is the first job's that was not 0, and later jobs still run", () => {
    const v = vmRig(["job", "job-2", "job-3"], { rc: { "job-2": 3, "job-3": 4 } });
    expect(v.harbor.map((l) => l.split(" ")[0])).toEqual(["job", "job-2", "job-3"]);
    expect(v.exit).toBe("3");
  });

  test("a stop or a latched cap stop during one job keeps the next from starting, and a stop after a clean job exits 130, not 0", () => {
    const stop = vmRig(["job", "job-2"], { files: ["stop.job"] });
    expect([stop.harbor.map((l) => l.split(" ")[0]), stop.exit]).toEqual([["job"], "130"]);
    const cap = vmRig(["job", "job-2", "job-3"], { files: ["cap.job-2"] });
    expect([cap.harbor.map((l) => l.split(" ")[0]), cap.exit]).toEqual([["job", "job-2"], "130"]);
  });

  test("arms that share a tar are checked once against that tar's sha256 in the manifest, and a mismatch stops vm-run before Harbor", () => {
    const manifest = (sha: string) => ({ arms: [{ name: "before-u", tar_name: "before", sha256: sha }, { name: "before-t", tar_name: "before", sha256: sha }, { name: "none", sha256: sha256("n") }] });
    const ok = vmRig(["job"], { manifest: manifest(sha256("b")), gz: { before: "b", none: "n" } });
    expect([ok.exit, ok.harbor.length]).toEqual(["0", 1]);
    const bad = vmRig(["job"], { manifest: manifest(sha256("other")), gz: { before: "b" } });
    expect(bad.exit).toBe("5");
    expect(bad.stderr).toContain("arm before: tar sha256 " + sha256("b"));
    expect(bad.harbor).toEqual([]);
  });
});

describe("the TB2 twin's tasks (L1 Amendment C)", () => {
  // Value: protects=prepare-run accepts every task of the TB2 twin split Amendment C pins and checks each against a tasks.json digest; fails_when=a twin task from quick look 3's extension is refused as outside the tb2 set or has no digest; why_new=GEVA-294 (main's tasks.json lost the extension block); seam=runner/prepare-run.ts TASK_SET=tb2; no_claim=that the terminal-bench-2 checkout materializes, which needs the network
  const parts = readFileSync(join(LANEB, "../../wiki/plans/2026-11-05-geva-294-l1-amendment-c/tb2-parts.txt"), "utf8");
  const twin = parts.trim().split("\n").map((l) => l.split(" ")[1]!);
  const prep = (tasks: string) => Bun.spawnSync([process.execPath, join(LANEB, "runner/prepare-run.ts"), join(mkdtempSync(join(tmpdir(), "l1-tb2-")), "run"), "j", "claude-opus-5-5", "none", "/nonexistent", "1", "1"], { env: { ...process.env, TASK_SET: "tb2", TASKS: tasks, TB2: "/nonexistent-tb2" } }).stderr.toString();
  test("every twin task has one tasks.json digest, and the split is L1's two parts of 37", () => {
    expect(itemParts("tb2-opus", { tb2Parts: parts }).map((p) => p.rects[0]!.tasks.length)).toEqual([19, 18]);
    const sel = JSON.parse(readFileSync(join(LANEB, "tasks/tasks.json"), "utf8"));
    const digests = new Map<string, string>([...sel.main, ...sel.reserves, ...(sel.extension ?? [])].map((t: any) => [t.task_id, t.digest]));
    expect(twin.filter((t) => !/^sha256:[0-9a-f]{64}$/.test(digests.get(t) ?? ""))).toEqual([]);
  });
  test("prepare-run's tb2 set admits all 37 twin tasks and refuses an id in neither final.json nor the extension", () => {
    const all = prep(twin.join(","));
    expect(all).not.toContain("is not in the tb2 task set");
    expect(all).toContain("/nonexistent-tb2/");
    expect(prep("not-a-tb2-task")).toContain("E_USAGE task not-a-tb2-task is not in the tb2 task set");
  });
});

