// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the person-label package follows the labelling desk's format (two offline pages in two orders, repeats,
// attention screens with a code-reading screening screen, a return checker, a privacy and blinding check), names no unit,
// arm, model or grader to the hire, keeps the screen key in the post dir, and reads two people's downloaded files into the
// judge check's labels, with the second part going back to the same two people; fails_when=a hire-facing file names a
// grader, model, arm or the other person, a return with an unanswered screen or a third person's file imports, a split
// review gets a label nobody gave, or can't tell reads as naming; why_new=GEVA-590 pre-run changes 5 and 6 and the
// desk's bg1-dev-judge format; seam=desk.ts and the package's own python checks on a fake 50-review batch;
// no_claim=that real people label the way personFile does
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARMS } from "../../../lanes/review-models/score/frozen.ts";
import type { ReviewFinding } from "../../../lanes/review-models/score/judge.ts";
import type { FinalRow } from "../../../lanes/review-models/score/labels.ts";
import { ATTENTION, deskPackage, importAdjudication, importFirst, readLabelsFile, type BatchReview, type DeskKey } from "../../../lanes/review-models/post/desk.ts";
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

describe("the desk package (keyless)", () => {
  test("follows the desk's layout, in two orders with repeats and attention screens, and names nothing the hire must not see", () => {
    const b = build();
    const dir = b.pkg.dir;
    expect(dir).toBe(join(b.desk, "geva590-review-labels-pilot"));
    expect(readdirSync(dir).sort()).toEqual([".meta.json", "README.md", "bounty.json", "check_return.py", "guide.md", "host_pages.sh", "items.json", "labeller", "message-to-labeller.txt", "privacy-check.md", "privacy_check.py", "returns"]);
    expect(readdirSync(join(dir, "labeller")).sort()).toEqual(["check-reviews-A.html", "check-reviews-B.html"]);
    expect([b.pkg.labelled, b.pkg.screens, b.pkg.key.auto_no.length, b.pkg.key.shape]).toEqual([50, 56, 1, "review"]);
    const it = items(dir);
    expect(it.orders.A).toHaveLength(56);
    expect([...it.orders.A].sort()).toEqual([...it.orders.B].sort());
    expect(it.orders.A).not.toEqual(it.orders.B);
    expect(Object.keys(it.repeats)).toHaveLength(3);
    for (const [rep, orig] of Object.entries(it.repeats) as Array<[string, string]>) {
      expect(it.screens[rep].blocks).toEqual(it.screens[orig].blocks);
      for (const v of ["A", "B"]) expect(it.orders[v].indexOf(rep)).toBeGreaterThan(it.orders[v].indexOf(orig));
    }
    expect(Object.keys(it.attention)).toHaveLength(3);
    expect(it.screening).toHaveLength(1);
    expect(it.attention[it.screening[0]]).toBe("2");
    const screening = Object.values(it.screens).find((s: any) => s.questions[0].id === it.screening[0]) as any;
    expect(screening.blocks[2].text).toContain("2. [blocking] src/cart/discounts.ts:38");
    expect(Object.values(it.screens).every((s: any) => s.questions.length === 1 && s.questions[0].findings >= 1)).toBe(true);
    expect(Object.keys(it.screens).every((sid) => /^R[0-9a-f]{8}$/.test(sid))).toBe(true);
    const sample = it.screens[it.orders.A.find((s: string) => !(s + "q" in it.attention))];
    expect(sample.blocks.map((x: any) => x.label)).toEqual(["The bug, as the people who found or fixed it described it", "The change that fixed it (lines starting with - were removed, + were added)", "The review's findings"]);
    expect(sample.blocks[2].text).toMatch(/^1\. \[blocking\] src\/order\.ts:8\n   .*\n2\. \[non-blocking\] src\/log\.ts:3\n   The log line drops the request id\.$/);
    for (const v of ["A", "B"]) {
      const html = readFileSync(join(dir, "labeller", "check-reviews-" + v + ".html"), "utf8");
      const data = pageData(html);
      expect(data).toMatchObject({ format: "labels-v1", package: "geva590-review-labels-pilot", version: v, shape: "review", note_required: true });
      expect(data.order).toEqual(it.orders[v]);
      expect(Object.keys(data)).not.toContain("attention");
      expect(Object.keys(data)).not.toContain("repeats");
      const script = /<\/script><script>([\s\S]*?)<\/script>/.exec(html)![1]!;
      expect(() => new Function(script)).not.toThrow();
      expect(html).toContain('translate="no"');
    }
    const outgoing = ["guide.md", "message-to-labeller.txt", "bounty.json", "items.json", "labeller/check-reviews-A.html", "labeller/check-reviews-B.html"].map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    for (const r of b.reviews) expect(outgoing).not.toContain(r.unit);
    expect(outgoing).not.toMatch(/\b(OS|OA|FS|FA)\b|gstack|carbon|\bjudge[sd]?\b|grader|\bmodels?\b|labellers|other labeller|codex|\[model\]/i);
    expect(readFileSync(join(dir, "privacy-check.md"), "utf8")).toContain("Result: BLOCKING HITS: 0.");
    expect(JSON.parse(readFileSync(join(dir, "bounty.json"), "utf8"))).toMatchObject({ dryRun: true, price: 125, spotsAvailable: 2, evidenceTypes: ["document", "link"] });
    const key = JSON.parse(readFileSync(join(b.post, "labels", "people", "pilot", "key.json"), "utf8")) as DeskKey;
    expect(key.screens.filter((s) => s.kind === "review").map((s) => s.unit + " " + s.arm).sort()).toEqual(b.reviews.filter((r) => r.findings.length).map((r) => r.unit + " " + r.arm).sort());
    expect(existsSync(join(dir, "key.json"))).toBe(false);
    const again = deskPackage({ reviews: b.reviews, batch: "pilot", desk: b.desk, post: b.post });
    expect(again.key.orders).toEqual(b.pkg.key.orders);
    expect(() => deskPackage({ reviews: b.reviews, batch: "pilot", desk: b.desk, post: b.post, shape: "finding" })).toThrow(/E_RM_POST_INPUT the pilot packet was built with the review question/);
  });

  test("the per-finding shape is one switch: a question per finding, attention answers per finding", () => {
    const b = build({ shape: "finding" });
    const it = items(b.pkg.dir);
    expect(it.shape).toBe("finding");
    expect(it.choices.map((c: string[]) => c[0])).toEqual(["names", "doesnt", "cant"]);
    const q = Object.values(it.screens).flatMap((s: any) => s.questions);
    expect(q.length).toBe(50 * 2 + 3 * 2 + ATTENTION.reduce((n, a) => n + a.findings.length, 0));
    expect(it.screening.map((id: string) => it.attention[id])).toEqual(["doesnt", "names", "doesnt"]);
    const first = importFirst({ post: b.post, batch: "pilot", reviews: b.reviews, files: [{ name: "a", text: personFile(b.pkg.dir, "F1", "A") }, { name: "b", text: personFile(b.pkg.dir, "F2", "B") }] });
    expect(first).toMatchObject({ reviews: 51, disagreements: 0, final: true });
    const final: FinalRow[] = JSON.parse(readFileSync(join(b.post, "labels", "final.json"), "utf8"));
    expect(final.filter((f) => f.label === true)).toHaveLength(b.reviews.filter((r) => r.findings.some((x) => x.text.includes("BUGMARK"))).length);
  });

  test("the privacy and blinding check fails the build on a model name in the material and on the other person in the page's words", () => {
    const reviews = fakeBatch();
    reviews[3] = { ...reviews[3]!, bug: { ...reviews[3]!.bug, evidence: "Reported by an OpenAI engineer: orders are capped." } };
    const root = mkdtempSync(join(tmpdir(), "rm-desk-"));
    expect(() => deskPackage({ reviews, batch: "pilot", desk: join(root, "d"), post: join(root, "p") })).toThrow(/E_RM_POST_DESK geva590-review-labels-pilot failed its privacy and blinding check[\s\S]*model or vendor name/);
    expect(readFileSync(join(root, "d", "geva590-review-labels-pilot", "privacy-check.md"), "utf8")).toContain("FAILED");
    const b = build();
    const copy = join(b.root, "copy");
    cpSync(b.pkg.dir, copy, { recursive: true });
    for (const words of ["Compare with the other labeller.", "Your earlier answers are shown.", "An automated grader read these.", "Both arms ran the same model."]) {
      writeFileSync(join(copy, "guide.md"), readFileSync(join(b.pkg.dir, "guide.md"), "utf8") + "\n" + words + "\n");
      const r = py([join(copy, "privacy_check.py"), copy]);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/BLOCKING HITS: [1-9]/);
    }
  });
});

describe("check_return.py on returned files (keyless)", () => {
  const b = build();
  const dir = b.pkg.dir;
  const it = items(dir);
  const check = (text: string, name = "labels-F1-A.txt") => {
    const p = join(b.root, name);
    writeFileSync(p, text);
    const r = py([join(dir, "check_return.py"), p]);
    return { code: r.status, out: r.stdout, verdict: /VERDICT: (\w+)/.exec(r.stdout)?.[1] };
  };
  const edit = (f: (s: any) => void, o = {}) => {
    const s = JSON.parse(personFile(dir, "F1", "A", o));
    f(s);
    return JSON.stringify(s);
  };
  test("a careful file passes", () => expect(check(personFile(dir, "F1", "A"))).toMatchObject({ code: 0, verdict: "PASS" }));
  test("an unanswered screen or a missing reason asks for a redo, and so does the page itself", () => {
    expect(check(edit((s) => delete s.labels[Object.keys(s.labels)[4]!])).verdict).toBe("REDO");
    expect(check(edit((s) => (s.labels[Object.keys(s.labels)[7]!].note = " "))).out).toContain("one-line reason");
    expect(check(edit((s) => (s.labels[Object.keys(s.labels)[2]!].choice = "9"))).verdict).toBe("REDO");
    expect(check(readFileSync(join(dir, "labeller", "check-reviews-A.html"), "utf8")).out).toContain("you sent the labelling page itself");
    expect(check(edit((s) => (s.package = "other"))).verdict).toBe("REDO");
  });
  test("a rushed file with one answer everywhere is rejected", () => {
    const r = check(personFile(dir, "F1", "A", { same: "none", minutes: 20 }));
    expect(r.verdict).toBe("REJECT");
    expect(r.out).toContain("almost every screen got the same answer");
  });
  test("a missed screening screen or repeats answered differently go to the package owner", () => {
    const screen = it.screening[0];
    const missed = check(edit((s) => (s.labels[screen].choice = "1")));
    expect(missed.verdict).toBe("ASK");
    expect(missed.out).toContain("including the code-reading screen");
    const [rep] = Object.keys(it.repeats);
    const flips = check(edit((s) => {
      for (const r of Object.keys(it.repeats)) s.labels[r + "q"].choice = s.labels[r + "q"].choice === "none" ? "1" : "none";
    }));
    expect(flips.verdict).toBe("ASK");
    expect(flips.out).toContain("repeated screens got a different answer");
    expect(rep).toBeDefined();
  });
});

describe("importing two people's labels (keyless)", () => {
  test("refuses a file from the wrong page, a missing answer, an extra answer, a missing reason and one person twice", () => {
    const b = build();
    const dir = b.pkg.dir;
    const key = JSON.parse(readFileSync(join(b.post, "labels", "people", "pilot", "key.json"), "utf8")) as DeskKey;
    const good = personFile(dir, "F1", "A");
    expect(readLabelsFile("a", good, key).problems).toEqual([]);
    const s = JSON.parse(good);
    const ids = Object.keys(s.labels);
    delete s.labels[ids[0]!];
    s.labels[ids[1]!].note = "";
    s.labels["Rdeadbeefq"] = { choice: "none", note: "x" };
    expect(readLabelsFile("a", JSON.stringify(s), key).problems).toEqual([
      "a: screens " + (key.orders.A.indexOf(ids[0]!.slice(0, -1)) + 1) + " have no valid answer",
      "a: screens " + (key.orders.A.indexOf(ids[1]!.slice(0, -1)) + 1) + " have no reason",
      "a: answers 1 question not on page A (Rdeadbeefq)",
    ]);
    expect(readLabelsFile("a", "<!doctype html><html>", key).problems[0]).toContain("is the labelling page itself");
    expect(readLabelsFile("a", JSON.stringify({ ...JSON.parse(good), package: "facts-check" }), key).problems[0]).toContain("comes from another page");
    const files = (x: string, y: string) => [{ name: "a", text: personFile(dir, x, "A") }, { name: "b", text: personFile(dir, y, "B") }];
    expect(() => importFirst({ post: b.post, batch: "pilot", reviews: b.reviews, files: files("F1", "F1") })).toThrow(/E_RM_POST_LABELS 1 problem in the labels files, nothing imported:\n  both files name labeller F1/);
    expect(() => importFirst({ post: b.post, batch: "pilot", reviews: b.reviews, files: files("F1", "F2").slice(0, 1) })).toThrow(/E_RM_POST_LABELS pass exactly two labels files/);
    expect(existsSync(join(b.post, "labels", "people", "pilot", "first.json"))).toBe(false);
  });

  test("disagreements go back to the same two people unattributed; a split that stays split is unresolved; can't tell reads as no", () => {
    const b = build({ tokens: { 1: "SPLITME", 2: "SPLITME", 4: "SPLITTWO", 3: "UNSURE" } });
    const dir = b.pkg.dir;
    const split = b.reviews.filter((r) => r.findings.some((f) => /SPLIT/.test(f.text)));
    expect(split.every((r) => r.findings[0]!.text.includes("BUGMARK"))).toBe(true);
    expect(b.reviews[3]!.findings[0]!.text).not.toContain("BUGMARK");
    const first = importFirst({ post: b.post, batch: "pilot", reviews: b.reviews, files: [{ name: "a", text: personFile(dir, "F1", "A", { cant_on: "UNSURE" }) }, { name: "b", text: personFile(dir, "F2", "B", { none_on: "SPLIT" }) }] });
    expect(first).toMatchObject({ reviews: 51, agreed: 48, disagreements: 3, final: false });
    expect(existsSync(join(b.post, "labels", "final.json"))).toBe(false);
    const adj = first.adjudication!;
    expect(adj).toBe(join(b.desk, "geva590-review-labels-pilot-adjudication"));
    expect(readdirSync(adj)).not.toContain("bounty.json");
    expect(readFileSync(join(adj, "privacy-check.md"), "utf8")).toContain("Result: BLOCKING HITS: 0.");
    const it = items(adj);
    expect(it.orders.A).toHaveLength(3);
    const readings = Object.values(it.screens).map((s: any) => s.blocks.at(-1));
    for (const r of readings) {
      expect(r.label).toBe("Two readings of this review");
      expect(r.text).toMatch(/^Reading 1: (Finding 1 names the bug\.|No finding names the bug\.) Why: planted reason for \S+\n\nReading 2: (Finding 1 names the bug\.|No finding names the bug\.) Why: planted reason for \S+$/);
    }
    const pages = readdirSync(join(adj, "labeller")).map((f) => readFileSync(join(adj, "labeller", f), "utf8")).join("\n") + readFileSync(join(adj, "guide.md"), "utf8");
    expect(pages).not.toMatch(/\bF1\b|\bF2\b|labellers|other labeller|earlier answers/);
    const pair = (x: string, y: string, o = {}) => [{ name: "a", text: personFile(adj, x, "A") }, { name: "b", text: personFile(adj, y, "B", o) }];
    expect(() => importAdjudication({ post: b.post, batch: "pilot", files: pair("F1", "F3") })).toThrow(/E_RM_POST_LABELS[\s\S]*the second part goes back to the same two people \(F1, F2\), but these files name F1, F3/);
    const done = importAdjudication({ post: b.post, batch: "pilot", files: pair("F1", "F2", { none_on: "SPLITTWO" }) });
    expect(done).toMatchObject({ reviews: 51, disagreements: 3, unresolved: 1, final: true });
    const final: FinalRow[] = JSON.parse(readFileSync(join(b.post, "labels", "final.json"), "utf8"));
    expect(final).toHaveLength(51);
    const at = (i: number) => final.find((f) => f.unit === b.reviews[i]!.unit && f.arm === b.reviews[i]!.arm)!;
    expect([at(1).label, at(2).label, at(4).label]).toEqual([true, true, "unresolved"]);
    expect(at(3)).toMatchObject({ label: false, cant_tell: true });
    expect(final.find((f) => f.unit === "acme/empty#1")).toMatchObject({ label: false });
    expect(() => importFirst({ post: b.post, batch: "pilot", reviews: b.reviews, files: [] })).toThrow(/E_RM_POST_INPUT the second part is already imported/);
  });
});
