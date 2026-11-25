// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the person-label packages follow the labelling desk's format with no recruiting source in them (one
// offline page per seat, repeats, attention screens, a return checker, a privacy and blinding check, job.json with no
// price, and the screening item as a stand-alone code task whose answer stays desk side), seat A takes every review,
// seat B a seeded 15-review subset spread over the arms, and seat C only the subset reviews A and B split on, blind;
// fails_when=a hire-facing file names a grader, model, arm, another labeller or a price, the subset is not 3 per arm or
// moves on a rerun, a return with an unanswered screen imports, seat A or B takes seat C, a review outside the subset
// gets any label but seat A's, a split gets a label no majority gave, or can't tell reads as naming; why_new=R125 and
// GEVA-590 pre-run changes 5 to 7 on the desk's bg1-dev-judge format; seam=desk.ts and the packages' own python checks
// on a fake 50-review batch; no_claim=that real engineers label the way personFile does
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARMS } from "../../../lanes/review-models/score/frozen.ts";
import type { ReviewFinding } from "../../../lanes/review-models/score/judge.ts";
import type { FinalRow } from "../../../lanes/review-models/score/labels.ts";
import { ATTENTION, deskPackage, drawSubset, importFirst, importThird, majority, readLabelsFile, type BatchReview, type DeskKey } from "../../../lanes/review-models/post/desk.ts";
import { personAgreement } from "../../../lanes/review-models/post/readout.ts";
import { personFile } from "./fixture.ts";

const finding = (id: string, path: string, line: number, severity: string, text: string): ReviewFinding => ({ id, source: id === "v" ? "voice" : "native", severity, path, line, text });

/** Ten made-up bugs, each reviewed by the five arms: 50 reviews, plus one review with no findings. */
function fakeBatch(tokens: Record<number, string> = {}): BatchReview[] {
  const out: BatchReview[] = [];
  for (let u = 0; u < 10; u++) {
    const unit = u < 5 ? "acme/shop" + u + "#" + (300 + u) : "acme/ledger" + u + "#0@" + "ab12cd34ef" + u + "0";
    const bug = { unit, pool: (u < 5 ? "P" : "B") as "P" | "B", evidence: "Orders over 100 items in shop " + u + " are charged for 100 only.", fix_diff: "--- a/src/order.ts\n+++ b/src/order.ts\n@@ -7,3 +7,3 @@\n-  const n = Math.min(items.length, 100);\n+  const n = items.length;\n" };
    ARMS.forEach((arm, k) => {
      const i = u * 5 + k;
      const caught = (u + k) % 3 !== 0;
      const tag = tokens[i] ? " " + tokens[i] : "";
      out.push({ unit, arm, pool: bug.pool, bug, findings: [finding("n", "src/order.ts", 8, "P1", (caught ? "BUGMARK the count is capped at 100." : "The order id is logged twice.") + tag), finding("v", "src/log.ts", 3, "MEDIUM", "[codex] The log line drops the request id.")] });
    });
  }
  out.push({ ...out[0]!, arm: "N", unit: "acme/empty#1", findings: [] });
  return out;
}

function build(o: { shape?: "review" | "finding"; tokens?: Record<number, string> } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rm-desk-"));
  const reviews = fakeBatch(o.tokens);
  const desk = join(root, "labelling"), post = join(root, "post");
  return { root, desk, post, reviews, pkg: deskPackage({ reviews, batch: "pilot", desk, post, shape: o.shape }) };
}
const py = (args: string[]) => spawnSync("python3", args, { encoding: "utf8" });
const items = (dir: string) => JSON.parse(readFileSync(join(dir, "items.json"), "utf8"));
const pageData = (html: string) => JSON.parse(/<script type="application\/json" id="data">(.*?)<\/script>/s.exec(html)![1]!.replaceAll("<\\/", "</"));

describe("the desk packages (keyless)", () => {
  test("seat A gets every review and seat B a seeded 15-review subset, each its own package with one page, and nothing names what the hire must not see", () => {
    const b = build();
    const { A, B } = b.pkg.dirs;
    expect([A, B]).toEqual([join(b.desk, "geva590-review-labels-pilot-a"), join(b.desk, "geva590-review-labels-pilot-b")]);
    const files = [".meta.json", "README.md", "check_return.py", "guide.md", "items.json", "job.json", "labeller", "message-to-labeller.txt", "privacy-check.md", "privacy_check.py", "returns"];
    expect(readdirSync(A).sort()).toEqual([...files, "host_pages.sh"].sort());
    expect(readdirSync(B).sort()).toEqual(files);
    expect(readdirSync(join(A, "labeller"))).toEqual(["check-reviews-A.html"]);
    expect(readdirSync(join(B, "labeller"))).toEqual(["check-reviews-B.html"]);
    expect([b.pkg.labelled, b.pkg.subset, b.pkg.screens.A, b.pkg.screens.B, b.pkg.key.auto_no.length, b.pkg.key.shape]).toEqual([50, 15, 55, 19, 1, "review"]);
    const key = JSON.parse(readFileSync(join(b.post, "labels", "people", "pilot", "key.json"), "utf8")) as DeskKey;
    expect(key.schema).toBe("rm-desk-key.v2");
    const byId = new Map(key.screens.map((s) => [s.sid, s]));
    expect(ARMS.map((a) => key.subset!.filter((sid) => byId.get(sid)!.arm === a).length)).toEqual([3, 3, 3, 3, 3]);
    const itA = items(A), itB = items(B);
    expect(Object.keys(itA.orders)).toEqual(["A"]);
    expect(Object.keys(itB.orders)).toEqual(["B"]);
    expect(itA.orders.A).toHaveLength(55);
    expect(itB.orders.B).toHaveLength(19);
    expect(itB.orders.B.filter((sid: string) => byId.get(sid)!.kind === "review").sort()).toEqual([...key.subset!].sort());
    expect(itA.orders.A.filter((sid: string) => byId.get(sid)!.kind === "review")).toHaveLength(50);
    for (const [it, v, reps] of [[itA, "A", 3], [itB, "B", 2]] as const) {
      expect(Object.keys(it.repeats)).toHaveLength(reps);
      for (const [rep, orig] of Object.entries(it.repeats) as Array<[string, string]>) {
        expect(it.screens[rep].blocks).toEqual(it.screens[orig].blocks);
        expect(it.orders[v].indexOf(rep)).toBeGreaterThan(it.orders[v].indexOf(orig));
      }
      expect(Object.keys(it.attention)).toHaveLength(2);
      expect(it.screening).toEqual([]);
      expect(Object.keys(it.screens).every((sid) => /^R[0-9a-f]{8}$/.test(sid))).toBe(true);
    }
    const sample = itA.screens[itA.orders.A.find((s: string) => !(s + "q" in itA.attention))];
    expect(sample.blocks.map((x: any) => x.label)).toEqual(["The bug, as the people who found or fixed it described it", "The change that fixed it (lines starting with - were removed, + were added)", "The review's findings"]);
    expect(sample.blocks[2].text).toMatch(/^1\. \[blocking\] src\/order\.ts:8\n   .*\n2\. \[non-blocking\] src\/log\.ts:3\n   The log line drops the request id\.$/);
    for (const [dir, v] of [[A, "A"], [B, "B"]] as const) {
      const html = readFileSync(join(dir, "labeller", "check-reviews-" + v + ".html"), "utf8");
      const data = pageData(html);
      expect(data).toMatchObject({ format: "labels-v1", package: "geva590-review-labels-pilot-" + v.toLowerCase(), version: v, shape: "review", note_required: true });
      expect(data.order).toEqual(items(dir).orders[v]);
      expect(Object.keys(data)).not.toContain("attention");
      expect(Object.keys(data)).not.toContain("repeats");
      const script = /<\/script><script>([\s\S]*?)<\/script>/.exec(html)![1]!;
      expect(() => new Function(script)).not.toThrow();
      expect(html).toContain('translate="no"');
      const outgoing = ["guide.md", "message-to-labeller.txt", "job.json", "items.json", "labeller/check-reviews-" + v + ".html"].map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
      for (const r of b.reviews) expect(outgoing).not.toContain(r.unit);
      expect(outgoing).not.toMatch(/\b(OS|OA|FS|FA)\b|gstack|carbon|\bjudge[sd]?\b|grader|\bmodels?\b|labellers|other labeller|codex|\[model\]|rentahuman|bounty|\$\d/i);
      expect(outgoing).not.toContain("applyCode() adds to cart.discounts");
      expect(readFileSync(join(dir, "privacy-check.md"), "utf8")).toContain("Result: BLOCKING HITS: 0.");
    }
    expect(JSON.parse(readFileSync(join(A, "job.json"), "utf8"))).toMatchObject({ package: "geva590-review-labels-pilot-a", seat: "A", seats: 1, price: null, deadline_hours: 48, items: { screens: 55, reviews: 50, repeats: 3, attention: 2 }, minutes: { per_screen: 5, total: 275 } });
    expect(JSON.parse(readFileSync(join(B, "job.json"), "utf8"))).toMatchObject({ seat: "B", seats: 1, price: null, items: { screens: 19, reviews: 15, repeats: 2, attention: 2 }, minutes: { total: 95 } });
    expect(readFileSync(join(B, "README.md"), "utf8")).toContain("**On hold.**");
    expect(existsSync(join(A, "key.json"))).toBe(false);
    const again = deskPackage({ reviews: b.reviews, batch: "pilot", desk: b.desk, post: b.post });
    expect([again.key.orders, again.key.subset]).toEqual([b.pkg.key.orders, b.pkg.key.subset]);
    expect(() => deskPackage({ reviews: b.reviews, batch: "pilot", desk: b.desk, post: b.post, shape: "finding" })).toThrow(/E_RM_POST_INPUT the pilot packet was built with the review question/);
    writeFileSync(join(b.post, "labels", "people", "pilot", "key.json"), JSON.stringify({ ...key, schema: "rm-desk-key.v1" }));
    expect(() => deskPackage({ reviews: b.reviews, batch: "pilot", desk: b.desk, post: b.post })).toThrow(/is not rm-desk-key\.v2/);
  });

  test("the code task is the screening item on its own, with its answer kept desk side", () => {
    const b = build();
    const dir = b.pkg.code_task;
    expect(dir).toBe(join(b.desk, "geva590-review-labels-code-task"));
    expect(readdirSync(dir).sort()).toEqual(["README.md", "answer.md", "code-task.html", "code-task.md"]);
    for (const f of ["code-task.html", "code-task.md"]) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text).toContain("About 10 minutes.");
      expect(text).toContain("applyCode() adds to cart.discounts without looking at cart.applied first");
      expect(text).not.toMatch(/expected|finding 2|answer\.md|rentahuman|gstack|\bmodels?\b|\bjudge/i);
    }
    expect(readFileSync(join(dir, "answer.md"), "utf8")).toContain("Expected: **finding 2**, and nothing else.");
  });

  test("seat B's subset is seeded within each arm over sorted ids, and spreads 15 as evenly as the arms allow", () => {
    const ids = (arm: string, n: number) => Array.from({ length: n }, (_, i) => ({ sid: "R" + arm.toLowerCase().padEnd(2, "x") + String(i).padStart(6, "0"), arm: arm as (typeof ARMS)[number] }));
    const five = ARMS.flatMap((a) => ids(a, 10));
    const drawn = drawSubset(five);
    expect(drawn).toHaveLength(15);
    expect(ARMS.map((a) => drawn.filter((s) => five.find((r) => r.sid === s)!.arm === a).length)).toEqual([3, 3, 3, 3, 3]);
    expect(drawSubset([...five].reverse())).toEqual(drawn);
    expect(drawSubset(five, 15, 7)).not.toEqual(drawn);
    const count = (rows: typeof five, d: string[]) => ARMS.map((a) => d.filter((s) => rows.find((r) => r.sid === s)!.arm === a).length);
    const three = ["OS", "FS", "N"].flatMap((a) => ids(a, 10));
    expect(count(three, drawSubset(three))).toEqual([5, 0, 5, 0, 5]);
    const four = ["OS", "OA", "FS", "FA"].flatMap((a) => ids(a, 10));
    expect(count(four, drawSubset(four))).toEqual([4, 4, 4, 3, 0]);
    const short = [...ids("OS", 1), ...["OA", "FS", "FA", "N"].flatMap((a) => ids(a, 10))];
    const c = count(short, drawSubset(short));
    expect([c[0], c.reduce((t, x) => t + x, 0), Math.max(...c.slice(1)) - Math.min(...c.slice(1))]).toEqual([1, 15, 1]);
    expect(drawSubset(ids("OS", 4))).toHaveLength(4);
  });

  test("the per-finding shape is one switch: a question per finding, attention answers per finding", () => {
    const b = build({ shape: "finding" });
    const it = items(b.pkg.dirs.A);
    expect(it.shape).toBe("finding");
    expect(it.choices.map((c: string[]) => c[0])).toEqual(["names", "doesnt", "cant"]);
    const q = Object.values(it.screens).flatMap((s: any) => s.questions);
    expect(q.length).toBe(50 * 2 + 3 * 2 + ATTENTION[1]!.findings.length + ATTENTION[2]!.findings.length);
    const first = importFirst({ post: b.post, batch: "pilot", reviews: b.reviews, files: [{ name: "a", text: personFile(b.pkg.dirs.A, "A1", "A") }, { name: "b", text: personFile(b.pkg.dirs.B, "B1", "B") }] });
    expect(first).toMatchObject({ reviews: 51, subset: 15, agreed: 15, disagreements: 0, final: true });
    const final: FinalRow[] = JSON.parse(readFileSync(join(b.post, "labels", "final.json"), "utf8"));
    expect(final.filter((f) => f.label === true)).toHaveLength(b.reviews.filter((r) => r.findings.some((x) => x.text.includes("BUGMARK"))).length);
  });

  test("the privacy and blinding check fails the build on a model name in the material and on the other person in the page's words", () => {
    const reviews = fakeBatch();
    reviews.forEach((r, i) => (reviews[i] = { ...r, bug: { ...r.bug, evidence: r.unit === reviews[3]!.unit ? "Reported by an OpenAI engineer: orders are capped." : r.bug.evidence } }));
    const root = mkdtempSync(join(tmpdir(), "rm-desk-"));
    expect(() => deskPackage({ reviews, batch: "pilot", desk: join(root, "d"), post: join(root, "p") })).toThrow(/E_RM_POST_DESK geva590-review-labels-pilot-a failed its privacy and blinding check[\s\S]*model or vendor name/);
    expect(readFileSync(join(root, "d", "geva590-review-labels-pilot-a", "privacy-check.md"), "utf8")).toContain("FAILED");
    const b = build();
    const copy = join(b.root, "copy");
    cpSync(b.pkg.dirs.B, copy, { recursive: true });
    for (const words of ["Compare with the other labeller.", "Your earlier answers are shown.", "An automated grader read these.", "Both arms ran the same model."]) {
      writeFileSync(join(copy, "guide.md"), readFileSync(join(b.pkg.dirs.B, "guide.md"), "utf8") + "\n" + words + "\n");
      const r = py([join(copy, "privacy_check.py"), copy]);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/BLOCKING HITS: [1-9]/);
    }
  });
});

describe("check_return.py on returned files (keyless)", () => {
  const b = build();
  const dir = b.pkg.dirs.A;
  const it = items(dir);
  const check = (text: string, name = "labels-A1-A.txt") => {
    const p = join(b.root, name);
    writeFileSync(p, text);
    const r = py([join(dir, "check_return.py"), p]);
    return { code: r.status, out: r.stdout, verdict: /VERDICT: (\w+)/.exec(r.stdout)?.[1] };
  };
  const edit = (f: (s: any) => void, o = {}) => {
    const s = JSON.parse(personFile(dir, "A1", "A", o));
    f(s);
    return JSON.stringify(s);
  };
  test("a careful file passes", () => expect(check(personFile(dir, "A1", "A"))).toMatchObject({ code: 0, verdict: "PASS" }));
  test("an unanswered screen or a missing reason asks for a redo, and so does the page itself", () => {
    expect(check(edit((s) => delete s.labels[Object.keys(s.labels)[4]!])).verdict).toBe("REDO");
    expect(check(edit((s) => (s.labels[Object.keys(s.labels)[7]!].note = " "))).out).toContain("one-line reason");
    expect(check(edit((s) => (s.labels[Object.keys(s.labels)[2]!].choice = "9"))).verdict).toBe("REDO");
    expect(check(readFileSync(join(dir, "labeller", "check-reviews-A.html"), "utf8")).out).toContain("you sent the labelling page itself");
    expect(check(edit((s) => (s.package = "other"))).verdict).toBe("REDO");
  });
  test("a rushed file with one answer everywhere is rejected", () => {
    const r = check(personFile(dir, "A1", "A", { same: "none", minutes: 20 }));
    expect(r.verdict).toBe("REJECT");
    expect(r.out).toContain("almost every screen got the same answer");
  });
  test("a missed attention screen or repeats answered differently go to the package owner", () => {
    const [att] = Object.keys(it.attention);
    const missed = check(edit((s) => (s.labels[att!].choice = s.labels[att!].choice === "none" ? "1" : "none")));
    expect(missed.verdict).toBe("ASK");
    expect(missed.out).toContain("attention screens marked another way");
    const flips = check(edit((s) => {
      for (const r of Object.keys(it.repeats)) s.labels[r + "q"].choice = s.labels[r + "q"].choice === "none" ? "1" : "none";
    }));
    expect(flips.verdict).toBe("ASK");
    expect(flips.out).toContain("repeated screens got a different answer");
  });
});

describe("importing the seats' labels (keyless)", () => {
  test("refuses a file from the wrong page, a missing answer, an extra answer, a missing reason, two files from one page and one person twice", () => {
    const b = build();
    const key = JSON.parse(readFileSync(join(b.post, "labels", "people", "pilot", "key.json"), "utf8")) as DeskKey;
    const good = personFile(b.pkg.dirs.A, "A1", "A");
    expect(readLabelsFile("a", good, key).problems).toEqual([]);
    expect(readLabelsFile("b", personFile(b.pkg.dirs.B, "B1", "B"), key).problems).toEqual([]);
    const s = JSON.parse(good);
    const ids = Object.keys(s.labels);
    delete s.labels[ids[0]!];
    s.labels[ids[1]!].note = "";
    s.labels["Rdeadbeefq"] = { choice: "none", note: "x" };
    expect(readLabelsFile("a", JSON.stringify(s), key).problems).toEqual([
      "a: screens " + (key.orders.A!.indexOf(ids[0]!.slice(0, -1)) + 1) + " have no valid answer",
      "a: screens " + (key.orders.A!.indexOf(ids[1]!.slice(0, -1)) + 1) + " have no reason",
      "a: answers 1 question not on page A (Rdeadbeefq)",
    ]);
    expect(readLabelsFile("a", "<!doctype html><html>", key).problems[0]).toContain("is the labelling page itself");
    expect(readLabelsFile("a", JSON.stringify({ ...JSON.parse(good), package: "facts-check" }), key).problems[0]).toContain("comes from another page");
    expect(readLabelsFile("a", JSON.stringify({ ...JSON.parse(good), version: "B" }), key).problems[0]).toContain("names page \"B\", not the page of geva590-review-labels-pilot-a");
    const imp = (files: Array<[string, string, "A" | "B"]>) => importFirst({ post: b.post, batch: "pilot", reviews: b.reviews, files: files.map(([code, dir, v], i) => ({ name: "f" + i, text: personFile(dir, code, v) })) });
    expect(() => imp([["A1", b.pkg.dirs.A, "A"], ["A1", b.pkg.dirs.B, "B"]])).toThrow(/E_RM_POST_LABELS 1 problem in the labels files, nothing imported:\n  both files name labeller A1/);
    expect(() => imp([["A1", b.pkg.dirs.A, "A"], ["A2", b.pkg.dirs.A, "A"]])).toThrow(/both files come from page A; pass seat A's file and seat B's file/);
    expect(() => imp([["A1", b.pkg.dirs.A, "A"]])).toThrow(/E_RM_POST_LABELS pass exactly two labels files/);
    expect(existsSync(join(b.post, "labels", "people", "pilot", "first.json"))).toBe(false);
  });

  test("reviews outside the subset take seat A's label; subset splits go to seat C blind and take the majority of three, and the subset keeps A's and B's readings", () => {
    const b = build();
    const key = b.pkg.key;
    const byId = new Map(key.screens.map((s) => [s.sid, s]));
    const caught = (sid: string) => b.reviews.find((r) => r.unit === byId.get(sid)!.unit && r.arm === byId.get(sid)!.arm)!.findings[0]!.text.includes("BUGMARK");
    const sub = key.subset!.filter(caught);
    expect(sub.length).toBeGreaterThanOrEqual(5);
    const [s1, s2, s3, s4, s5] = sub as [string, string, string, string, string];
    const outside = key.screens.find((s) => s.kind === "review" && !key.subset!.includes(s.sid) && caught(s.sid))!.sid;
    const a = personFile(b.pkg.dirs.A, "A1", "A", { choose: { [s4]: "cant", [s5]: "cant", [outside]: "none" } });
    const bf = personFile(b.pkg.dirs.B, "B1", "B", { choose: { [s1]: "none", [s2]: "none", [s3]: "none", [s5]: "cant" } });
    expect(() => importThird({ post: b.post, batch: "pilot", file: { name: "c", text: "{}" } })).toThrow(/E_RM_POST_INPUT no seat C package is open for the pilot batch/);
    const first = importFirst({ post: b.post, batch: "pilot", reviews: b.reviews, files: [{ name: "b", text: bf }, { name: "a", text: a }] });
    expect(first).toMatchObject({ reviews: 51, subset: 15, agreed: 11, disagreements: 4, final: false });
    expect(existsSync(join(b.post, "labels", "final.json"))).toBe(false);
    const third = first.third!;
    expect(third).toBe(join(b.desk, "geva590-review-labels-pilot-c"));
    expect(readdirSync(third).sort()).toEqual([".meta.json", "README.md", "check_return.py", "guide.md", "items.json", "job.json", "labeller", "message-to-labeller.txt", "privacy-check.md", "privacy_check.py", "returns"]);
    expect(readdirSync(join(third, "labeller"))).toEqual(["check-reviews-C.html"]);
    expect(readFileSync(join(third, "privacy-check.md"), "utf8")).toContain("Result: BLOCKING HITS: 0.");
    expect(JSON.parse(readFileSync(join(third, "job.json"), "utf8"))).toMatchObject({ seat: "C", seats: 1, price: null, items: { screens: 6, reviews: 4, repeats: 1, attention: 1 } });
    expect(readFileSync(join(third, "README.md"), "utf8")).toContain("codes A1 and B1");
    const it = items(third);
    expect(Object.keys(it.orders)).toEqual(["C"]);
    expect(it.orders.C.filter((s: string) => byId.has(s))).toEqual([]);
    const pages = ["labeller/check-reviews-C.html", "guide.md", "message-to-labeller.txt", "job.json"].map((f) => readFileSync(join(third, f), "utf8")).join("\n");
    expect(pages).not.toMatch(/\bA1\b|\bB1\b|planted reason|labellers|other labeller|earlier answers|rentahuman|\$\d/i);
    const thirdKey = JSON.parse(readFileSync(join(b.post, "labels", "people", "pilot", "third-key.json"), "utf8")) as DeskKey;
    expect(thirdKey).toMatchObject({ round: "third", exclude: ["A1", "B1"] });
    const c = (of: string) => thirdKey.screens.find((s) => s.of === of && s.kind === "review")!.sid;
    expect([s1, s2, s3, s4].map(c)).toHaveLength(4);
    expect(() => importFirst({ post: b.post, batch: "pilot", reviews: b.reviews, files: [] })).toThrow(/E_RM_POST_INPUT seats A and B of the pilot batch are already imported/);
    const cfile = personFile(third, "C1", "C", { choose: { [c(s2)]: "none", [c(s3)]: "cant", [c(s4)]: "cant" } });
    writeFileSync(join(third, "returns", "labels-C1-C.txt"), personFile(third, "C1", "C"));
    expect(py([join(third, "check_return.py"), join(third, "returns", "labels-C1-C.txt")]).stdout).toContain("VERDICT: PASS");
    expect(() => importThird({ post: b.post, batch: "pilot", file: { name: "c", text: personFile(third, "B1", "C") } })).toThrow(/E_RM_POST_LABELS 1 problem in seat C's file, nothing imported:\n  c names labeller B1, seat A's or seat B's \(A1, B1\)/);
    expect(() => importThird({ post: b.post, batch: "pilot", file: { name: "c", text: personFile(b.pkg.dirs.A, "C1", "A") } })).toThrow(/E_RM_POST_LABELS[\s\S]*comes from another page/);
    const done = importThird({ post: b.post, batch: "pilot", file: { name: "c", text: cfile } });
    expect(done).toMatchObject({ reviews: 51, subset: 15, agreed: 11, disagreements: 4, unresolved: 2, final: true });
    const final: FinalRow[] = JSON.parse(readFileSync(join(b.post, "labels", "final.json"), "utf8"));
    expect(final).toHaveLength(51);
    const at = (sid: string) => final.find((f) => f.id === sid)!;
    expect([s1, s2, s3, s4].map((s) => at(s).label)).toEqual([true, false, "unresolved", "unresolved"]);
    expect([at(s1).a_b, at(s2).a_b, at(s4).a_b]).toEqual([[true, false], [true, false], [false, true]]);
    expect(at(s5)).toMatchObject({ label: false, cant_tell: true, a_b: [false, false] });
    expect(at(outside)).toMatchObject({ label: false });
    expect(at(outside).a_b).toBeUndefined();
    expect(final.filter((f) => f.a_b)).toHaveLength(15);
    expect(final.find((f) => f.unit === "acme/empty#1")).toMatchObject({ label: false });
    const agreement = personAgreement(final)!;
    expect([agreement.reviews, agreement.agree]).toEqual([15, 11]);
    expect(agreement.kappa).toBeLessThan(1);
    expect(final.map((f) => f.id).sort()).toEqual([...key.screens.filter((s) => s.kind === "review").map((s) => s.sid), ...key.auto_no.map((k) => k.id)].sort());
  });

  test("majority of three", () => {
    const r = (names: boolean, cant = false) => ({ names, cant, matched: [], text: "" });
    expect(majority([r(true), r(false), r(true)])).toBe(true);
    expect(majority([r(true), r(false), r(false)])).toBe(false);
    expect(majority([r(true), r(false), r(false, true)])).toBe("unresolved");
    expect(majority([r(true), r(false, true), r(false, true)])).toBe("unresolved");
    expect(majority([r(false, true), r(false), r(false)])).toBe(false);
  });
});
