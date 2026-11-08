// Copyright (c) 2026 Garry Tan. MIT License.
// Held-out source B's build (amendment 2 section 4, items 3 and 4): gstack's task and cluster ids carry the repository,
// held-out eligibility adds the crew-author rule, the accrual close and the principle build's pull requests and files,
// assemble-b drops a history the outside-rules check or the org rules' wording refuses instead of stopping, and split
// pools both repositories' records with per-repository counts. Synthetic records only; no key and no network.
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleB, clustersOf, heldOutEligible, type HeldBRules, idPrefix, type PrRecord, run as sourceB } from "../../lanes/tbv/history/source-b.ts";
import { run as split } from "../../lanes/tbv/split.ts";
import { codeOf, pr } from "./history-helpers.ts";

const P = "2026-11-08T10:28:37Z";
const at = (s: number) => new Date(Date.parse(P) + s * 1000).toISOString().replace(".000Z", "Z");
const DAY = 86400;
const PRINCIPLE_FILE = "scripts/resolvers/preamble.ts";
const rules = (o: Partial<HeldBRules> = {}): HeldBRules => ({ author: "garrytan", closesAt: at(21 * DAY), principleFiles: new Set([PRINCIPLE_FILE]), principlePrs: new Set<number>(), ...o });
const crew = (o: Partial<PrRecord> = {}): PrRecord => pr({ author: "garrytan", headRefName: "b/" + (o.number ?? 12), ...o });
const why = (p: PrRecord, r: HeldBRules | undefined = rules(), cluster: PrRecord[] = [p]) => {
  const e = heldOutEligible(p, cluster, P, r);
  return e.ok ? "ok" : e.reason;
};
const WORDING = "Before you call work done, check each claim against the record and name what you did not verify.";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const disk = () => {
  const d = mkdtempSync(join(tmpdir(), "tbv-heldb-"));
  dirs.push(d);
  return d;
};
const shm = () => {
  const d = mkdtempSync(join("/dev/shm", "tbv-heldb-"));
  dirs.push(d);
  return d;
};
const io = () => {
  const out: string[] = [];
  return { out, io: { out: (t: string) => out.push(...t.split("\n")), err: (t: string) => out.push(...t.split("\n")) } };
};
const acode = async (f: () => unknown) => {
  try {
    await f();
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};
const refusal = async (f: () => unknown) => {
  try {
    await f();
    return { code: "ok", message: "" };
  } catch (e) {
    return { code: (e as { code?: string }).code ?? String(e), message: String((e as Error).message) };
  }
};

test("gstack's task and cluster ids carry the repository; this repo's stay pr-N, byte for byte", () => {
  expect([idPrefix("garrytan/gstack"), idPrefix("garrytan/gstack-evals"), idPrefix(undefined)]).toEqual(["gstack-pr-", "pr-", "pr-"]);
  expect(codeOf(() => idPrefix("someone/else"))).toBe("E_TBV_INPUT");
  const here = assembleB(pr(), "pr-12");
  expect(here.ok && [here.history.task, here.history.sha256]).toEqual(["pr-12", "dfb4c4851760981ed20274b39a142ca5232f75a464f9f3b104946452b6d0d862"]);
  const g = assembleB(pr(), "gstack-pr-12", "gstack-pr-");
  expect(g.ok && g.history.task).toBe("gstack-pr-12");
  expect(g.ok && g.history.cluster).toBe("gstack-pr-12");
  expect(g.ok && g.history.events.filter((e) => e.kind === "tool-use").map((e) => (e as { id: string }).id)).toEqual([2, 4, 6, 8, 10, 12].map((n) => "toolu_gstackpr12_" + n));
  expect(Object.fromEntries(clustersOf([pr(), pr({ number: 13 })], "gstack-pr-"))).toEqual({ 12: "gstack-pr-12", 13: "gstack-pr-12" });
  expect(Object.fromEntries(clustersOf([pr(), pr({ number: 13 })]))).toEqual({ 12: "pr-12", 13: "pr-12" });
});

test("held-out source B under amendment 2: a crew pull request passes; another author, no author, the principle build or a principle file is out", () => {
  expect(heldOutEligible(crew(), [crew()], P, rules())).toEqual({ ok: true });
  expect(why(crew({ author: "outside-dev" }))).toBe("not crew");
  expect(why(crew({ author: null }))).toBe("not crew");
  expect(why(pr())).toBe("not crew");
  expect(why(crew(), rules({ principlePrs: new Set([12]) }))).toBe("principle build");
  expect(why(crew(), rules({ principlePrs: new Set([13]) }))).toBe("ok");
  expect(why(crew({ files: [{ path: "src/widget.ts", additions: 1, deletions: 0 }, { path: PRINCIPLE_FILE, additions: 0, deletions: 3 }] }))).toBe("principle file");
  expect(why(crew({ files: [{ path: "src/" + PRINCIPLE_FILE, additions: 1, deletions: 0 }] }))).toBe("ok");
  expect(why(crew({ files: [{ path: PRINCIPLE_FILE, additions: 1, deletions: 0 }] }), rules({ principleFiles: new Set() }))).toBe("ok");
});

test("accrual's close bounds the window: merged at the close counts, a second later is out; amendment 1's reasons are named", () => {
  expect(why(crew({ mergedAt: at(21 * DAY), closedAt: at(21 * DAY) }))).toBe("ok");
  expect(why(crew({ mergedAt: at(21 * DAY + 1), closedAt: at(21 * DAY + 1) }))).toBe("merged after close");
  expect(why(crew({ mergedAt: at(2 * DAY + 1) }), rules({ closesAt: at(2 * DAY) }))).toBe("merged after close");
  expect(why(crew({ state: "CLOSED", mergedAt: null }))).toBe("not merged");
  expect(why(crew({ mergedAt: P }))).toBe("merged before P");
  expect(why(crew({ createdAt: P }))).toBe("opened before P");
  expect(why(crew({ commits: [{ ...pr().commits[0]!, authoredDate: at(-1) }] }))).toBe("commit before P");
  const sib = crew({ number: 9, createdAt: at(-60), headRefName: "b/12" });
  expect(why(crew(), rules(), [sib, crew()])).toBe("cluster before P");
  expect(heldOutEligible(pr(), [pr()], P).ok).toBe(true);
});

test("assemble-b drops a history the outside-rules check refuses and counts it, where it used to stop", async () => {
  const d = disk();
  const drive = ["", "home", "ada", ".capy", "drive", ""].join("/");
  writeFileSync(join(d, "prs.json"), JSON.stringify({ schema: "tbv-prs.v1", prs: [pr(), pr({ number: 13, headRefName: "b/13", title: "notes from " + drive + "plan.md" })] }));
  const p = io();
  expect(await sourceB(["assemble-b", "--records", join(d, "prs.json"), "--out-dir", join(d, "h")], p.io)).toBe(0);
  expect(readdirSync(join(d, "h"))).toEqual(["pr-12.json"]);
  expect(p.out.join("\n")).toContain('"outside rules":1');
  expect(p.out.join("\n")).not.toContain("pr-13");
});

test("a window's records need --wording; with it, a history sharing an 8-word run with the org rules' wording is dropped, and gstack's files carry the repository", async () => {
  const d = disk();
  const said = crew({ number: 13, commits: [{ ...pr().commits[1]!, message: "notes: " + WORDING.toLowerCase() + " (from a rules file)" }] });
  writeFileSync(join(d, "prs.json"), JSON.stringify({ schema: "tbv-prs.v1", repo: "garrytan/gstack", window: { mergedAfter: P, mergedBefore: null }, prs: [crew(), said], skipped: [], lineage: [] }));
  writeFileSync(join(d, "wording.txt"), WORDING + "\n");
  writeFileSync(join(d, "short.txt"), "check each claim\n");
  expect(await acode(() => sourceB(["assemble-b", "--records", join(d, "prs.json"), "--out-dir", join(d, "h0")], io().io))).toBe("E_USAGE");
  expect(existsSync(join(d, "h0"))).toBe(false);
  expect(await acode(() => sourceB(["assemble-b", "--records", join(d, "prs.json"), "--out-dir", join(d, "h1"), "--wording", join(d, "short.txt")], io().io))).toBe("E_TBV_INPUT");
  const p = io();
  expect(await sourceB(["assemble-b", "--records", join(d, "prs.json"), "--out-dir", join(d, "h"), "--wording", join(d, "wording.txt")], p.io)).toBe(0);
  expect(readdirSync(join(d, "h"))).toEqual(["gstack-pr-12.json"]);
  expect(p.out.join("\n")).toContain('"rules wording":1');
});

test("assemble-b refuses an out dir that already holds a history, so a rerun's drop cannot leave an earlier history beside it; held-step's work dir, holding only .held-step, is taken", async () => {
  const d = disk();
  const said = pr({ number: 13, headRefName: "b/13", commits: [{ ...pr().commits[1]!, message: "notes: " + WORDING.toLowerCase() + " (from a rules file)" }] });
  writeFileSync(join(d, "prs.json"), JSON.stringify({ schema: "tbv-prs.v1", prs: [said] }));
  writeFileSync(join(d, "wording.txt"), WORDING + "\n");
  expect(await sourceB(["assemble-b", "--records", join(d, "prs.json"), "--out-dir", join(d, "h")], io().io)).toBe(0);
  expect(readdirSync(join(d, "h"))).toEqual(["pr-13.json"]);
  const r = await refusal(() => sourceB(["assemble-b", "--records", join(d, "prs.json"), "--out-dir", join(d, "h"), "--wording", join(d, "wording.txt")], io().io));
  expect([r.code, r.message.includes("pr-13")]).toEqual(["E_TBV_INPUT", false]);
  mkdirSync(join(d, "w", ".held-step"), { recursive: true });
  const p = io();
  expect(await sourceB(["assemble-b", "--records", join(d, "prs.json"), "--out-dir", join(d, "w"), "--wording", join(d, "wording.txt")], p.io)).toBe(0);
  expect(readdirSync(join(d, "w"))).toEqual([".held-step"]);
  expect(p.out.join("\n")).toContain('"rules wording":1');
});

// ---------- split over both repositories ----------

const ROWS = "path\thunks\tclass\tin a splice set\n" + PRINCIPLE_FILE + "\t3\tsource\tyes\nbin/gstack-config\t1\tsource\tno\n";
function world(o: { evalsWindow?: unknown; gstackWindow?: unknown; gstackRepo?: string } = {}) {
  const s = shm(), d = disk();
  const evals = { schema: "tbv-prs.v1", repo: "garrytan/gstack-evals", window: o.evalsWindow ?? { mergedAfter: P, mergedBefore: null }, prs: [crew({ number: 30, files: [{ path: PRINCIPLE_FILE, additions: 1, deletions: 0 }, ...pr().files] })], skipped: [], lineage: [] };
  const stack = crew({ number: 104, baseRefName: "stack/a" });
  const gstack = {
    schema: "tbv-prs.v1",
    repo: o.gstackRepo ?? "garrytan/gstack",
    window: o.gstackWindow ?? { mergedAfter: P, mergedBefore: null },
    prs: [crew({ number: 100 }), crew({ number: 101, author: "outside-dev" }), crew({ number: 102, files: [{ path: PRINCIPLE_FILE, additions: 2, deletions: 0 }, ...pr().files] }), crew({ number: 103 }), stack, crew({ number: 105, mergedAt: at(4 * DAY), closedAt: at(4 * DAY) })],
    skipped: [],
    lineage: [{ number: 90, createdAt: at(-DAY), title: "Start the stack", baseRefName: "main", headRefName: "stack/a", closingIssues: [] }],
  };
  writeFileSync(join(d, "evals.json"), JSON.stringify(evals));
  writeFileSync(join(d, "gstack.json"), JSON.stringify(gstack));
  writeFileSync(join(d, "wording.txt"), WORDING + "\n");
  writeFileSync(join(d, "principle-files.tsv"), ROWS);
  writeFileSync(join(d, "principle-prs.json"), JSON.stringify(["gstack-pr-103"]));
  writeFileSync(join(d, "dev-clusters.json"), JSON.stringify({ schema: "tbv-dev-clusters.v1", A: [], B: ["pr-12"] }));
  mkdirSync(join(s, "seed"));
  writeFileSync(join(s, "seed", "seed-b.hex"), "5e".repeat(32) + "\n");
  const flags: Record<string, string> = {
    "--mode": "held-b", "--b": join(s, "b"), "--prs": join(d, "evals.json") + "," + join(d, "gstack.json"), "--seed-file": join(s, "seed", "seed-b.hex"), "--p-merged-at": P, "--dev-clusters": join(d, "dev-clusters.json"),
    "--principle-files": join(d, "principle-files.tsv"), "--principle-prs": join(d, "principle-prs.json"), "--closes-at": at(3 * DAY), "--held": join(d, "sealed"), "--seal-cmd": "base64", "--batch": join(s, "batch"),
  };
  const argv = (over: Record<string, string | null> = {}) => Object.entries({ ...flags, ...over }).flatMap(([k, v]) => (v === null ? [] : [k, v]));
  return { s, d, argv };
}
/** Each repository's records assembled into a fresh out dir, as each held-step gets one, then pooled into --b. */
async function assembled(w: ReturnType<typeof world>) {
  mkdirSync(join(w.s, "b"));
  for (const f of ["evals.json", "gstack.json"]) {
    const out = join(w.s, "b-" + f);
    expect(await sourceB(["assemble-b", "--records", join(w.d, f), "--out-dir", out, "--wording", join(w.d, "wording.txt")], io().io)).toBe(0);
    for (const n of readdirSync(out)) copyFileSync(join(out, n), join(w.s, "b", n));
  }
  return w;
}

test("split pools both repositories' crew records, drops each ineligible one under its named reason, and prints the pool per repository", async () => {
  const w = await assembled(world());
  expect(readdirSync(join(w.s, "b")).sort()).toEqual(["gstack-pr-100.json", "gstack-pr-101.json", "gstack-pr-102.json", "gstack-pr-103.json", "gstack-pr-104.json", "gstack-pr-105.json", "pr-30.json"]);
  const p = io();
  expect(await split(["split", "plan", ...w.argv()], p.io)).toBe(0);
  const text = p.out.join("\n");
  for (const reason of ["not crew", "principle file", "principle build", "cluster before P", "merged after close"]) expect(text).toContain('"not held-out eligible: ' + reason + '":1');
  const per = (repo: string) => p.out.find((l) => l.startsWith("split pool B " + repo + ": "))!;
  const total = (l: string) => [...l.matchAll(/(long|short|other|clean) (\d+)/g)].reduce((a, m) => a + Number(m[2]), 0);
  expect([total(per("garrytan/gstack-evals")), total(per("garrytan/gstack"))]).toEqual([1, 1]);
  expect(text).toContain("split batch held: 2 histories (A 0, B 2)");
  expect(p.out.filter((l) => l.startsWith("split prs sha256 ")).map((l) => l.split(" ")[3])).toEqual(["garrytan/gstack-evals", "garrytan/gstack"]);
  expect(text).not.toMatch(/gstack-pr-1\d\d|pr-30/);
});

test("split refuses held-out source B inputs that would let an ineligible or unmined pull request through, before anything is written", async () => {
  const w = await assembled(world());
  const refusals: Array<Record<string, string | null>> = [
    { "--principle-files": null },
    { "--principle-prs": null },
    { "--closes-at": at(21 * DAY + 1) },
    { "--closes-at": P },
    { "--closes-at": "soon" },
    { "--prs": join(w.d, "evals.json") + "," + join(w.d, "evals.json") },
  ];
  writeFileSync(join(w.d, "bad.tsv"), PRINCIPLE_FILE + "\n");
  writeFileSync(join(w.d, "bad-prs.json"), JSON.stringify([103]));
  refusals.push({ "--principle-files": join(w.d, "bad.tsv") }, { "--principle-prs": join(w.d, "bad-prs.json") });
  for (const over of refusals) {
    expect(await acode(() => split(["split", "plan", ...w.argv(over)], io().io))).toBe("E_TBV_INPUT");
    expect(existsSync(join(w.s, "batch"))).toBe(false);
  }
  for (const [name, win] of [["late-start", { mergedAfter: at(1), mergedBefore: null }], ["early-end", { mergedAfter: P, mergedBefore: at(DAY) }]] as const) {
    const v = await assembled(world({ gstackWindow: win }));
    expect([name, await acode(() => split(["split", "plan", ...v.argv()], io().io))]).toEqual([name, "E_TBV_INPUT"]);
    expect(existsSync(join(v.s, "batch"))).toBe(false);
  }
  const ok = await assembled(world({ gstackWindow: { mergedAfter: at(-DAY), mergedBefore: at(3 * DAY) } }));
  expect(await split(["split", "plan", ...ok.argv()], io().io)).toBe(0);
});

test("split refuses a windowed --prs file with no lineage list, and a lineage or skipped stub missing any of its six keys, before anything is written and naming no pull request", async () => {
  const changes: Array<(g: Record<string, any>) => void> = [
    (g) => delete g.lineage,
    (g) => (g.lineage = null),
    (g) => delete g.lineage[0].title,
    (g) => delete g.lineage[0].headRefName,
    (g) => delete g.lineage[0].createdAt,
    (g) => delete g.lineage[0].closingIssues,
    (g) => (g.lineage[0].title = 7),
    (g) => (g.skipped = [{ number: 91, createdAt: at(DAY), title: "Change 91", baseRefName: "main", headRefName: "b/91" }]),
    (g) => (g.skipped = null),
  ];
  for (const change of changes) {
    const w = await assembled(world());
    const g = JSON.parse(readFileSync(join(w.d, "gstack.json"), "utf8"));
    change(g);
    writeFileSync(join(w.d, "gstack.json"), JSON.stringify(g));
    const r = await refusal(() => split(["split", "plan", ...w.argv()], io().io));
    expect([String(change), r.code, /gstack-pr-|#\d|\b9[01]\b/.test(r.message)]).toEqual([String(change), "E_TBV_INPUT", false]);
    expect(existsSync(join(w.s, "batch"))).toBe(false);
  }
});

test("b2 mode keeps one --prs file and takes none of held-out source B's flags", async () => {
  const w = await assembled(world());
  const b2 = ["--mode", "b2", "--a", join(w.s, "seed"), "--b", join(w.s, "b"), "--seed-file", join(w.s, "seed", "seed-b.hex"), "--batch", join(w.d, "dev-1")];
  expect(await acode(() => split(["split", "plan", ...b2, "--prs", join(w.d, "evals.json") + "," + join(w.d, "gstack.json")], io().io))).toBe("E_TBV_INPUT");
  for (const [flag, value] of [["--closes-at", at(DAY)], ["--principle-files", join(w.d, "principle-files.tsv")], ["--principle-prs", join(w.d, "principle-prs.json")]] as const) {
    expect(await acode(() => split(["split", "plan", ...b2, "--prs", join(w.d, "evals.json"), flag, value], io().io))).toBe("E_TBV_INPUT");
  }
  expect(existsSync(join(w.d, "dev-1"))).toBe(false);
});
