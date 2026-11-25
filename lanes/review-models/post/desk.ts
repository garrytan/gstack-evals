// Copyright (c) 2026 Garry Tan. MIT License.
// The judge check's person labels, as packages for the organisation's labelling desk (pre-run changes 5 to 7 of
// wiki/plans/2026-11-24-geva-590-review-models-prereg, as R125 amends them: labels for code come from engineers). Three
// seats per batch, each its own package with one offline page: seat A labels every bug-unit review the check takes,
// seat B a seeded subset of 15 (3 per arm), and seat C the subset reviews A and B read differently. All are fix-aware
// and blind to arm. No model makes, proposes or reads as a label here: this file writes what people read and reads the
// files their pages download. The packages follow the desk's format (handoffs/labelling/bg1-dev-judge/ in the org
// drive) with no recruiting source in them: an offline page with a few repeats and attention screens, a checker for
// returned files, a privacy and blinding check, a first message and job.json (seat, screens, minutes, deadline, no price).
// - deskPackage: <desk>/geva590-review-labels-<batch>-a/ and -b/ hold what the desk sends and checks, and
//   <desk>/geva590-review-labels-code-task/ the screening item as a stand-alone task with its answer kept desk side.
//   items.json is desk only. The key from each screen's opaque id (random bytes) back to unit and arm, and the subset,
//   stay in <post>/labels/people/<batch>/, outside the repository and outside the packages. Each screen shows the bug's
//   evidence, the fix diff and the review's findings as the numbered list Carbon reads (score/judge.ts
//   numberedFindings), with masked names shown as [name]. The question shape is one switch: "review" (change 6, the
//   default) asks once per review which finding names the bug, or none, or can't tell; "finding" asks change 5's
//   question for every finding. Both carry a required one-line reason. A review with no findings names nothing, so it
//   is labelled no in the key and is not shown.
// - importFirst reads seat A's and seat B's files. A review names the bug for a person when they picked a finding
//   (review shape) or answered names for one (finding shape); can't tell reads as not naming, and the final row says
//   so, for change 6's second reading. Reviews outside the subset take seat A's label. Subset reviews A and B read
//   differently go to seat C's package (the desk's rule 4: nothing about earlier answers or other labellers reaches a
//   hire), with 1 repeat and 1 attention screen.
// - importThird reads seat C's file, from a labeller code that is neither A's nor B's. Each split review's label is the
//   majority of the three readings (names, doesn't, can't tell); when all three differ or the majority is can't tell,
//   it is unresolved and stays in the check, read both ways by kappaCheck. Subset rows keep A's and B's readings for
//   the readout's person agreement. Nothing here writes a model summary.
// Labels land in <post>/labels/final.json (final-<batch>.json for a batch other than the pilot) only once every review
// has one, so the readout waits on them until then.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { seededShuffle } from "../../../src/trial/review/supply/b-units.ts";
import { ARMS, rmFail, type Arm } from "../score/frozen.ts";
import { numberedFindings, type Bug, type ReviewFinding } from "../score/judge.ts";
import type { FinalLabel, FinalRow, LabelKey } from "../score/labels.ts";
import type { Pilot } from "./pilot.ts";

export type Shape = "review" | "finding";
export const SHAPES: readonly Shape[] = ["review", "finding"];
export const DEFAULT_SHAPE: Shape = "review";
export type DeskRound = "first" | "third";
/** One page per seat: A labels every review of a batch, B a seeded subset of them, C the subset reviews A and B read differently (R125). */
export type Version = "A" | "B" | "C";
export const FORMAT = "labels-v1";
export const PAGE = "check-reviews";
export const KEY_SCHEMA = "rm-desk-key.v2";
const TITLE = "Check whether code reviews spotted a known bug";
const TEMPLATES = join(import.meta.dir, "desk");
/** About 5 minutes a review screen (change 6). Who recruits and what a seat pays are not set, so packages carry time and no price. */
const MINUTES = { review: 5, finding: 8 } as const;
const DEADLINE_HOURS = 48;
/** Repeats and attention screens (indices into ATTENTION) per seat. The screening item is the stand-alone code task instead. */
const SEAT = { A: { repeats: 3, attention: [1, 2] }, B: { repeats: 2, attention: [1, 2] }, C: { repeats: 1, attention: [1] } } as const;
/** Seat B's subset per batch: 15 reviews, 3 per arm when five arms ran, drawn with the supply draw's seed. */
export const SUBSET = 15;
export const SUBSET_SEED = 1872089902;
export const CODE_TASK = "geva590-review-labels-code-task";
const CODE_TASK_MINUTES = 10;

export const packageName = (batch: string, v: Version) => "geva590-review-labels-" + batch + "-" + v.toLowerCase();

/** One review to label: the batch's own review with its bug, from the pilot now and the validation batch later. */
export interface BatchReview {
  unit: string;
  arm: Arm;
  pool: "P" | "B";
  bug: Bug;
  findings: readonly ReviewFinding[];
}

interface KeyScreen {
  sid: string;
  kind: "review" | "repeat" | "attention";
  findings: number;
  unit?: string;
  arm?: Arm;
  pool?: "P" | "B";
  /** A repeat's original screen. */
  of?: string;
  /** An attention screen's index in ATTENTION. */
  attention?: number;
}
export interface DeskKey {
  schema: typeof KEY_SCHEMA;
  batch: string;
  round: DeskRound;
  shape: Shape;
  /** The labelling root the packages sit under. */
  desk: string;
  screens: KeyScreen[];
  /** Reviews with no findings: labelled no, not shown. */
  auto_no: LabelKey[];
  /** The first round: page A over every review and page B over the subset. The third round: page C alone. */
  orders: Partial<Record<Version, string[]>>;
  /** The first round: the review screens seat B labels too. */
  subset?: string[];
  /** The third round: seat A's and seat B's labeller codes, which seat C's must not be. */
  exclude?: [string, string];
}

export const peopleDir = (post: string, batch: string) => join(post, "labels", "people", batch);
/** The final labels: final.json for the pilot, final-<batch>.json for a later batch, so batches never overwrite each other. */
export const finalPath = (post: string, batch = "pilot") => join(post, "labels", batch === "pilot" ? "final.json" : "final-" + batch + ".json");
const keyPath = (post: string, batch: string, round: DeskRound) => join(peopleDir(post, batch), round === "first" ? "key.json" : "third-key.json");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const writeJson = (path: string, v: unknown) => writeFileSync(path, JSON.stringify(v, null, 1) + "\n");
const qids = (shape: Shape, s: { sid: string; findings: number }) => (shape === "review" ? [s.sid + "q"] : Array.from({ length: s.findings }, (_, i) => s.sid + "f" + (i + 1)));
const sidOf = () => "R" + randomBytes(4).toString("hex");
const rand = (n: number) => randomBytes(4).readUInt32BE() % n;
function shuffled<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Seat B's subset: within each arm, the review screens' opaque ids sorted, shuffled with the seed and taken from the
 * front, one arm at a time in the frozen arm order, so 15 over five arms is 3 each and over three arms 5 each.
 */
export function drawSubset(reviews: ReadonlyArray<{ sid: string; arm?: Arm }>, n = SUBSET, seed = SUBSET_SEED): string[] {
  const byArm = ARMS.map((a) => seededShuffle(reviews.filter((r) => r.arm === a).map((r) => r.sid).sort(), seed)).filter((l) => l.length);
  const take = byArm.map(() => 0);
  let left = Math.min(n, byArm.reduce((t, l) => t + l.length, 0));
  while (left > 0)
    for (let i = 0; i < byArm.length && left > 0; i++)
      if (take[i]! < byArm[i]!.length) {
        take[i] = take[i]! + 1;
        left--;
      }
  return byArm.flatMap((l, i) => l.slice(0, take[i]));
}

/** The reviews the check takes, as labels.ts always took them: bug units whose session ended ok, not contaminated. */
export function pilotBatch(pilot: Pilot): BatchReview[] {
  if (!pilot.contamination.read) rmFail("E_RM_POST_INPUT", "no contamination report in the post dir; run rm-post contamination first, since the check leaves contaminated reviews out");
  if (pilot.contamination.pending_cases) rmFail("E_RM_POST_INPUT", pilot.contamination.pending_cases + " doubtful search cases still wait on the second read; run rm-post second-read-send first");
  return pilot.reviews.filter((r) => r.pool !== "decoy" && r.outcome === "ok" && !r.contaminated).map((r) => ({ unit: r.unit, arm: r.arm, pool: r.pool as "P" | "B", bug: pilot.bugs.get(r.unit) ?? rmFail("E_RM_POST_INPUT", "no bug in the key for unit " + r.label), findings: r.findings }));
}

const f = (n: number, path: string, line: number, severity: string, text: string): ReviewFinding => ({ id: "a" + n, source: "native", severity, path, line, text });
/**
 * Attention screens, made up for this package. The first is the screening screen: its matching finding never repeats the
 * bug's words, and a decoy finding does, so only reading the code gets it right. Expected answers are per question.
 */
export const ATTENTION: ReadonlyArray<{ evidence: string; fix_diff: string; findings: ReviewFinding[]; names: number[]; screening: boolean }> = [
  {
    screening: true,
    evidence: "Refreshing the cart page applies the same discount code a second time, so the total drops twice.",
    fix_diff: "--- a/src/cart/discounts.ts\n+++ b/src/cart/discounts.ts\n@@ -36,6 +36,7 @@ export function applyCode(cart: Cart, code: DiscountCode): Cart {\n   const amount = discountFor(cart, code);\n+  if (cart.applied.has(code.id)) return cart;\n   cart.applied.add(code.id);\n   cart.discounts.push({ id: code.id, amount });\n   return cart;\n",
    findings: [
      f(1, "src/analytics/track.ts", 20, "P2", "Refreshing the cart page sends the discount_applied event again, so the weekly report counts the same discount code twice and its totals drop twice."),
      f(2, "src/cart/discounts.ts", 38, "P1", "applyCode() adds to cart.discounts without looking at cart.applied first, so calling it again with a code that is already there adds the amount a second time."),
      f(3, "src/cart/total.ts", 12, "P3", "formatTotal() rounds with toFixed(2), which can show a total one cent off for some currencies."),
    ],
    names: [2],
  },
  {
    screening: false,
    evidence: "Dates typed as 03/04/2026 are read as 3 April for people who chose US date order, so their invoices fall due a month late.",
    fix_diff: "--- a/src/invoice/dates.ts\n+++ b/src/invoice/dates.ts\n@@ -8,3 +8,3 @@ export function parseDate(text: string, prefs: Prefs): Date {\n   const [a, b, y] = text.split(\"/\").map(Number);\n-  return new Date(y, b - 1, a);\n+  return prefs.order === \"MDY\" ? new Date(y, a - 1, b) : new Date(y, b - 1, a);\n }\n",
    findings: [
      f(1, "src/invoice/pdf.ts", 88, "P2", "The PDF footer prints the company address twice."),
      f(2, "src/invoice/email.ts", 14, "P3", "The reminder email's subject line misspells invoice as \"invocie\"."),
    ],
    names: [],
  },
  {
    screening: false,
    evidence: "Uploading a file larger than 10 MB freezes the upload page instead of showing an error.",
    fix_diff: "--- a/src/upload/limit.ts\n+++ b/src/upload/limit.ts\n@@ -20,4 +20,4 @@ export async function checkSize(file: File): Promise<void> {\n-  while (file.size > MAX_BYTES) await wait(100);\n+  if (file.size > MAX_BYTES) return fail(\"This file is over 10 MB.\");\n   return ok();\n }\n",
    findings: [
      f(1, "src/upload/limit.ts", 21, "P1", "This loop never ends for a file over MAX_BYTES: file.size never changes while it waits, so the page hangs."),
      f(2, "src/upload/progress.ts", 5, "P3", "The progress bar's colour is hard to read in dark mode."),
    ],
    names: [1],
  },
];

const expected = (shape: Shape, a: (typeof ATTENTION)[number]): string[] => (shape === "review" ? [a.names.length ? a.names.join(",") : "none"] : a.findings.map((_, i) => (a.names.includes(i + 1) ? "names" : "doesnt")));

interface Block {
  label: string;
  text: string;
  style?: string;
}
const hire = (s: string) => s.replaceAll("[model]", "[name]");
const material = (bug: { evidence: string; fix_diff: string }, findings: readonly ReviewFinding[]): Block[] => [
  { label: "The bug, as the people who found or fixed it described it", text: hire(bug.evidence.trim()) },
  { label: "The change that fixed it (lines starting with - were removed, + were added)", text: bug.fix_diff.replace(/\n$/, ""), style: "code" },
  { label: "The review's findings", text: hire(numberedFindings(findings)), style: "findings" },
];

const QUESTION = {
  review: { prompt: "Which finding names the bug? Pick every finding that does, or one of the two answers below.", choices: [["none", "None names it"], ["cant", "Can't tell"]] },
  finding: { prompt: "does it name the bug?", choices: [["names", "Names the bug"], ["doesnt", "Doesn't"], ["cant", "Can't tell"]] },
} as const;
const NOTE = "Why, in one line (required)";

/** A small Markdown subset (headings, paragraphs, lists, bold, code) as HTML, for the guide inside the page. */
export function mdHtml(md: string): string {
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const inline = (s: string) => esc(s).replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push("</" + list + ">");
    list = null;
  };
  for (const line of md.split("\n")) {
    const h = /^(#{1,3}) (.*)$/.exec(line), ul = /^- (.*)$/.exec(line), ol = /^\d+\. (.*)$/.exec(line);
    if (h) close(), out.push("<h" + (h[1]!.length + 1) + ">" + inline(h[2]!) + "</h" + (h[1]!.length + 1) + ">");
    else if (ul || ol) {
      const want = ul ? "ul" : "ol";
      if (list !== want) close(), out.push("<" + want + ">"), (list = want);
      out.push("<li>" + inline((ul ?? ol)![1]!) + "</li>");
    } else if (line.trim()) close(), out.push("<p>" + inline(line) + "</p>");
    else close();
  }
  close();
  return out.join("\n");
}

const hoursOf = (minutes: number) => Math.round((minutes / 60) * 4) / 4;
const hoursText = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0$/, ""));

function guide(shape: Shape, screens: number, hours: number): string {
  const ask = shape === "review"
    ? "For each screen, pick **every finding that names the bug**, or **None names it**, or **Can't tell** (please use Can't tell rarely). Then write one line saying why. The line is required."
    : "For each finding on a screen, choose **Names the bug**, **Doesn't** or **Can't tell** (please use Can't tell rarely), and write one line saying why. Every line is required.";
  return [
    "# How to check the code reviews",
    "",
    "Thank you for helping. There are " + screens + " screens, and the task takes about " + hoursText(hours) + " hours, in one go or several sittings. Your answers save in your browser as you go, so you can stop and come back in the same browser.",
    "",
    "**Please keep this page in English.** Don't use your browser's translate button: it changes the code and wording you are checking.",
    "",
    "## The one rule that matters",
    "",
    "**A finding names the bug only if it points at the same fault the fix repairs: the same wrong behaviour, in the code the fix changes or in the code that causes it.** A finding that uses similar words but points at different code doesn't name it. Severity doesn't matter, and the finding doesn't have to suggest the same fix.",
    "",
    "## What you're looking at",
    "",
    "Each screen is one code review of a change that had a known bug in it. The review was written before anyone fixed the bug. Every screen shows:",
    "",
    "- the **bug**, as the people who found or fixed it described it;",
    "- the **change that fixed it**, as a diff: lines starting with - were removed and lines starting with + were added;",
    "- the review's **findings**, numbered. Each shows whether it was marked blocking, the file and line it points at, and what it says.",
    "",
    ask,
    "",
    "## A worked example",
    "",
    "Bug: \"Saving a profile with an empty nickname crashes the settings page.\" Fix: in \x60profile.ts\x60, \x60nickname.trim()\x60 becomes \x60(nickname ?? \"\").trim()\x60. Findings: 1. \"settings.css: the save button overlaps the footer on small screens.\" 2. \"profile.ts:14 calls trim() on nickname, which is undefined when the field is left empty.\" 3. \"avatar.ts:30: the settings page crashes in Safari when the avatar image is very large.\" The answer is **finding 2**: it points at the line the fix changes, for the same fault. Finding 3 also mentions a crash on the settings page, but in different code, so it doesn't name this bug. (This example is made up for this guide.)",
    "",
    "## Practical points",
    "",
    "- Take the screens in order. Reading the fix first, then each finding, works well. About " + MINUTES[shape] + " minutes a screen is normal." + (shape === "review" ? " Keys 1 to 9 pick or unpick a finding, and Enter moves on." : " Enter moves on."),
    "- A screen may appear twice. Label each as you see it.",
    "- Some names in the findings are shown as [name], and severity words as [severity], on purpose. Ignore who wrote a finding.",
    "- Work on your own and don't use AI tools. We need a person's judgement.",
    "- Keep what you read private: don't copy, share or post it anywhere.",
    "- When you're done, press **Download my labels** and send us the file it saves. If an upload form refuses a .json file, **rename it to end in .txt** first.",
    "",
  ].join("\n");
}

function message(screens: number, hours: number): string {
  return [
    "Hi, thanks for taking this on! Here's everything you need.",
    "",
    "Your labeller code: <CODE>",
    "Your page: <LINK>",
    "",
    "The one rule that matters: a finding names the bug only if it points at the same fault the fix repairs, in the code the fix changes or the code that causes it. Similar words about different code don't count.",
    "",
    "1. Open the page on a computer (Chrome, Firefox, Safari or Edge). If the link downloads a file, open that file in your browser. Nothing to install, no sign-in.",
    "2. Please keep the page in English. Don't use your browser's translate button: it changes the text you're checking.",
    "3. Read the \"Instructions\" tab first (it has a worked example), type your labeller code and press Start.",
    "4. Answer every screen (" + screens + " in all), each with a one-line reason. Your answers save in your browser as you go. Press \"Download my labels\" now and then to be safe.",
    "5. When you're done, press \"Download my labels\" and send us the file it saves. If an upload form refuses a .json file, rename it so it ends in .txt first.",
    "",
    "Please finish by <DUE TIME, " + DEADLINE_HOURS + " hours after you start, with time zone>. It takes about " + hoursText(hours) + " hours. Please work on your own and don't use AI tools: we need your own judgement. If anything doesn't work or isn't clear, ask us and we'll get back to you.",
    "",
  ].join("\n");
}

/** The seat as a recruiter needs it, from any source: who, how much work, by when. No price is set yet. */
function job(key: DeskKey, v: Version, screens: number, labelled: number, minutes: number): Record<string, unknown> {
  return {
    title: "Check whether " + screens + " code reviews spotted a known bug (about " + hoursText(hoursOf(minutes)) + " hours, on a computer)",
    package: packageName(key.batch, v),
    seat: v,
    seats: 1,
    who: "An engineer who reads code (any common language) and diffs as part of their work, with fluent English, who has passed the code task.",
    code_task: { page: "../" + CODE_TASK + "/code-task.html", minutes: CODE_TASK_MINUTES },
    items: { screens, reviews: labelled, repeats: SEAT[v].repeats, attention: SEAT[v].attention.length },
    minutes: { per_screen: MINUTES[key.shape], total: minutes },
    deadline_hours: DEADLINE_HOURS,
    price: null,
    returns: "the labels file the page saves (labels-<code>-" + v + ".json, or renamed to .txt), checked with check_return.py",
    status: "on hold",
  };
}

const SEAT_TEXT: Record<Version, (labelled: number) => string> = {
  A: (n) => "Seat A: one engineer labels every one of the " + n + " reviews in this batch",
  B: (n) => "Seat B: a second engineer labels a seeded subset of " + n + " of the batch's reviews, about evenly over the arms, so the eval can report how often two engineers agree",
  C: (n) => "Seat C: a third engineer labels the " + n + " subset reviews that seat A and seat B read differently; the answer at least two of the three give settles each one",
};

function readme(key: DeskKey, v: Version, screens: number, labelled: number, minutes: number): string {
  const plural = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
  const host = v === "A" ? "bash host_pages.sh up" : "bash ../" + packageName(key.batch, "A") + "/host_pages.sh " + (v === "B" ? "up" : "refresh");
  const who = v === "C" ? "They must not be seat A's or seat B's labeller (codes " + key.exclude!.join(" and ") + "): check your exclude list and those seats." : "Seat A and seat B must be two different people.";
  return [
    "# Code-review labels, " + key.batch + " batch, seat " + v + ": package for the labelling desk",
    "",
    "**On hold.** Recruit nobody and send nothing until GEVA-590 says go. Under R125 the labellers are engineers. Where they come from and what a seat pays are not settled, so \x60job.json\x60 carries the seat, the screens, the minutes and the deadline, and no price.",
    "",
    SEAT_TEXT[v](labelled) + ". The page adds " + plural(SEAT[v].repeats, "repeat") + " and " + plural(SEAT[v].attention.length, "attention screen") + " (" + screens + " screens, about " + minutes + " minutes). For each review they mark which numbered finding names the bug, or none, or can't tell, with a one-line reason" + (key.shape === "finding" ? " (this package asks it once per finding)" : "") + ". The labels check the review-models eval's automated reading (GEVA-590, pre-run changes 5 to 7 and R125). GEVA-590 built this package and owns everything that needs judgement about the task.",
    "",
    "The bugs, fixes and reviews come from real public code but are unpublished answer keys until the eval reports: they stay in this folder and with the labeller. The privacy and blinding check result is in \x60privacy-check.md\x60.",
    "",
    "## What's in this folder",
    "",
    "| File | What it is | Who sees it |",
    "| --- | --- | --- |",
    "| \x60job.json\x60 | The seat for whoever recruits: who, screens, minutes, deadline, no price. | recruiter |",
    "| \x60labeller/" + PAGE + "-" + v + ".html\x60 | The labelling page, one self-contained file. It opens offline in any computer browser, asks the browser not to translate it, saves answers as the labeller goes and downloads a labels file. | the labeller |",
    "| \x60guide.md\x60 | The instructions with the one rule and a worked example (the page's first tab). | labeller, inside the page |",
    "| \x60message-to-labeller.txt\x60 | The message that carries the page link. Fill in the three placeholders. | labeller |",
    "| \x60items.json\x60 | The screens, the order, the repeats and the attention screens. **Desk only**: never send it to a labeller. | desk |",
    "| \x60check_return.py\x60 | Checks a returned file and prints \x60VERDICT: PASS / REDO / REJECT / ASK\x60. | desk |",
    "| \x60returns/\x60 | Put each returned file here unchanged, as \x60returns/labels-<code>-" + v + ".txt\x60 (or .json). | desk writes, GEVA-590 reads |",
    "| \x60privacy-check.md\x60, \x60privacy_check.py\x60 | The check and its result on exactly these files. | anyone |",
    ...(v === "A" ? ["| \x60host_pages.sh\x60 | Hosts every seat's page for this batch at unguessable https paths, as gbev130-hosting does. Writes \x60links.txt\x60 into each seat's folder. | desk |"] : []),
    "",
    "## The seat",
    "",
    "1. Before anyone takes the seat, they do the code task in \x60../" + CODE_TASK + "/\x60 (about " + CODE_TASK_MINUTES + " minutes). Its \x60answer.md\x60, desk only, says how to check it. Only someone who passes it gets the page.",
    "2. The labeller gets code **" + v + "1** (a replacement takes **" + v + "2**) and \x60labeller/" + PAGE + "-" + v + ".html\x60. " + who,
    "3. Host the page with \x60" + host + "\x60 and send \x60message-to-labeller.txt\x60 with the link from \x60links.txt\x60.",
    "4. Questions about how to label a screen go to GEVA-590, and the desk relays the answer word for word. Never tell a labeller anything about another seat, any earlier or automated reading, which screens repeat or how the reviews were made.",
    "",
    "## Accepting a return",
    "",
    "Copy the returned file into \x60returns/\x60, then run \x60python3 check_return.py returns/labels-<code>-" + v + ".txt\x60.",
    "",
    "- **PASS**: accept it.",
    "- **REDO**: ask once for a redo, with the checker's reasons. A second REDO on the same seat goes to GEVA-590.",
    "- **REJECT**: turn it down with the checker's reasons (too few active minutes, the same answer almost everywhere, or most attention screens answered another way). A replacement needs the Captain's go.",
    "- **ASK**: hold, and send the checker output to GEVA-590, which answers within a day.",
    "",
    "Then tell GEVA-590 the file is in. " + (v === "C" ? "GEVA-590 imports it with \x60gstack-evals rm-post labels-import --round third\x60, which checks it again and writes the labels." : "GEVA-590 imports seat A's and seat B's files together with \x60gstack-evals rm-post labels-import\x60, which checks them again and, where the two read a subset review differently, writes seat C's package beside these."),
    "",
    "## Deadline and clean-up",
    "",
    DEADLINE_HOURS + " hours from the start, with one reminder at about 36 hours. Run \x60bash host_pages.sh down\x60 in seat A's folder once the last seat closes.",
    "",
  ].join("\n");
}

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The screening item as a stand-alone task a recruiter can give anyone first; its answer stays in answer.md, desk side. */
export function codeTask(desk: string): string {
  const dir = join(desk, CODE_TASK);
  mkdirSync(dir, { recursive: true });
  const item = ATTENTION.find((a) => a.screening)!;
  const [bug, fix, found] = material(item, item.findings);
  const intro = "About " + CODE_TASK_MINUTES + " minutes. A code review was written for a change before anyone knew it had a bug. Below are the bug as it was reported, the change that later fixed it (a diff: lines starting with - were removed, + were added) and the review's numbered findings.";
  const rule = "A finding names the bug only if it points at the same fault the fix repairs: the same wrong behaviour, in the code the fix changes or in the code that causes it. A finding with similar words about different code doesn't name it.";
  const ask = "Reply with the number of every finding that names this bug, or \"none\", and one or two lines saying why. Please work on your own and don't use AI tools.";
  writeFileSync(join(dir, "code-task.html"), ["<!doctype html><html lang=\"en\" translate=\"no\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex,nofollow\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">", "<title>Code task: did a review spot the bug?</title><style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#1d1d1f}pre{background:#f4f4f6;border:1px solid #ddd;border-radius:6px;padding:10px;overflow:auto;white-space:pre-wrap}</style></head><body>", "<h1>Code task: did a review spot the bug?</h1>", "<p>" + esc(intro) + "</p>", "<p><b>" + esc(rule) + "</b></p>", "<h2>The bug</h2><pre>" + esc(bug!.text) + "</pre>", "<h2>The change that fixed it</h2><pre>" + esc(fix!.text) + "</pre>", "<h2>The review's findings</h2><pre>" + esc(found!.text) + "</pre>", "<h2>Your answer</h2><p>" + esc(ask) + "</p>", "</body></html>", ""].join("\n"));
  writeFileSync(join(dir, "code-task.md"), ["# Code task: did a review spot the bug?", "", intro, "", "**" + rule + "**", "", "## The bug", "", bug!.text, "", "## The change that fixed it", "", "\x60\x60\x60diff", fix!.text, "\x60\x60\x60", "", "## The review's findings", "", "\x60\x60\x60", found!.text, "\x60\x60\x60", "", "## Your answer", "", ask, ""].join("\n"));
  writeFileSync(join(dir, "answer.md"), ["# Code task: the answer (desk only, never send it)", "", "Expected: **finding " + item.names.join(" and ") + "**, and nothing else.", "", "- Finding 2 points at the line the fix changes (src/cart/discounts.ts:38) and says the same fault: applyCode adds the amount again because it never checks cart.applied. The fix adds exactly that check.", "- Finding 1 repeats the bug's words (refreshing, the same discount code twice, totals drop twice) but is about the analytics event in other code. Picking it means matching words, not reading code.", "- Finding 3 is an unrelated rounding issue.", "", "Pass: finding 2 alone, with a reason that names the missing check or the double add. Anything else (1, 1 and 2, none, can't tell) fails. A pass with a muddled reason goes to GEVA-590.", ""].join("\n"));
  writeFileSync(join(dir, "README.md"), ["# Code task for the review-labels seats", "", "Every labeller of a geva590-review-labels package does this task first and passes it (R125: labels for code come from engineers). It takes about " + CODE_TASK_MINUTES + " minutes and needs no page set-up.", "", "| File | Who sees it |", "| --- | --- |", "| \x60code-task.html\x60, \x60code-task.md\x60 | the candidate (the same task as a page or as text) |", "| \x60answer.md\x60 | **desk only**: the expected answer and how to check a reply |", "", "The item is made up for this check. It is not used as a screen in any package, so a labeller never meets it twice.", ""].join("\n"));
  return dir;
}

const sha16 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])).sort();
}

/** Writes one seat's package from the key and each review screen's material, runs the privacy check and records its result. */
function render(key: DeskKey, v: Version, blocks: ReadonlyMap<string, Block[]>): { dir: string; screens: number } {
  const dir = join(key.desk, packageName(key.batch, v));
  mkdirSync(join(dir, "labeller"), { recursive: true });
  mkdirSync(join(dir, "returns"), { recursive: true });
  writeFileSync(join(dir, "returns", ".keep"), "");
  const order = key.orders[v] ?? rmFail("E_RM_POST_INPUT", "the key has no page " + v);
  const byId = new Map(key.screens.map((s) => [s.sid, s]));
  const shown = order.map((sid) => byId.get(sid) ?? rmFail("E_RM_POST_INPUT", "page " + v + " lists screen " + sid + ", which the key does not hold"));
  const labelled = shown.filter((s) => s.kind === "review").length;
  const screens: Record<string, { blocks: Block[]; questions: Array<{ id: string; findings?: number; finding?: number }> }> = {};
  const attention: Record<string, string> = {};
  const screening: string[] = [];
  const repeats: Record<string, string> = {};
  for (const s of shown) {
    let b: Block[];
    if (s.kind === "attention") {
      const a = ATTENTION[s.attention!]!;
      b = material(a, a.findings);
      qids(key.shape, s).forEach((q, i) => (attention[q] = expected(key.shape, a)[i]!));
      if (a.screening) screening.push(...qids(key.shape, s));
    } else b = blocks.get(s.kind === "repeat" ? s.of! : s.sid) ?? rmFail("E_RM_POST_INPUT", "no material for screen " + s.sid);
    if (s.kind === "repeat") repeats[s.sid] = s.of!;
    screens[s.sid] = { blocks: b, questions: qids(key.shape, s).map((id, i) => (key.shape === "review" ? { id, findings: s.findings } : { id, finding: i + 1 })) };
  }
  const n = order.length;
  const q = QUESTION[key.shape];
  const minutes = n * MINUTES[key.shape];
  const hours = hoursOf(minutes);
  const pkg = packageName(key.batch, v);
  const items = {
    format: FORMAT, package: pkg, page_name: PAGE, title: TITLE, shape: key.shape, prompt: q.prompt, choices: q.choices, note_prompt: NOTE, note_required: true,
    screens, orders: { [v]: order }, repeats, attention, screening,
    checks: { reject_minutes: Math.round(minutes * 0.3), ask_minutes: Math.round(minutes * 0.6), max_repeat_diff: 1, unsure_choices: ["cant"], max_unsure_share: 0.15, max_copied_reasons: 0.3 },
  };
  writeJson(join(dir, "items.json"), items);
  const g = guide(key.shape, n, hours);
  writeFileSync(join(dir, "guide.md"), g);
  const template = readFileSync(join(TEMPLATES, "page.html"), "utf8");
  const data = { format: FORMAT, package: pkg, version: v, shape: key.shape, prompt: q.prompt, choices: q.choices, note_prompt: NOTE, note_required: true, order, screens };
  const page = template.replaceAll("{{TITLE}}", TITLE).replace("{{GUIDE}}", () => mdHtml(g)).replace("{{DATA}}", () => JSON.stringify(data).replaceAll("</", "<\\/").replaceAll("<!--", "<\\!--"));
  writeFileSync(join(dir, "labeller", PAGE + "-" + v + ".html"), page);
  writeFileSync(join(dir, "message-to-labeller.txt"), message(n, hours));
  writeJson(join(dir, "job.json"), job(key, v, n, labelled, minutes));
  writeFileSync(join(dir, "README.md"), readme(key, v, n, labelled, minutes));
  writeJson(join(dir, ".meta.json"), { name: pkg, seat: v, screens: n, questions: Object.values(screens).reduce((t, x) => t + x.questions.length, 0), shape: key.shape, minutes, codes: [v + "1", v + "2"], page: PAGE });
  for (const file of ["check_return.py", "privacy_check.py", ...(v === "A" ? ["host_pages.sh"] : [])]) copyFileSync(join(TEMPLATES, file), join(dir, file));
  const check = spawnSync("python3", [join(dir, "privacy_check.py"), dir], { encoding: "utf8" });
  if (check.error) rmFail("E_RM_POST_DESK", "python3 did not run the privacy check: " + check.error.message);
  const files = walk(dir).filter((p) => !p.endsWith("privacy-check.md") && !p.includes("/returns/"));
  const pass = check.status === 0;
  writeFileSync(join(dir, "privacy-check.md"), ["# Privacy check: " + pkg, "", "Run by gstack-evals rm-post " + (key.round === "first" ? "desk-package" : "labels-import (first round)") + " with privacy_check.py on the files in this folder.", "", "Result: " + (pass ? "BLOCKING HITS: 0." : "FAILED. Do not send any file from this folder until the package is rebuilt clean."), "", "## Raw output", "", "\x60\x60\x60", check.stdout.trim(), "\x60\x60\x60", "", "## File sha256 (first 16 hex)", "", ...files.map((p) => "- ./" + relative(dir, p) + " " + sha16(p)), ""].join("\n"));
  if (!pass) rmFail("E_RM_POST_DESK", pkg + " failed its privacy and blinding check; see " + join(dir, "privacy-check.md") + ":\n" + check.stdout.split("\n").filter((l) => /^  \S/.test(l) && !l.includes("bytes")).slice(0, 12).join("\n"));
  return { dir, screens: n };
}

/** Puts each repeat at least 10 screens after its original, where the order allows. */
function withRepeats(order: string[], repeats: readonly KeyScreen[]): string[] {
  const o = [...order];
  for (const r of repeats) {
    const lo = Math.min(o.indexOf(r.of!) + 10, o.length);
    o.splice(lo + rand(o.length - lo + 1), 0, r.sid);
  }
  return o;
}

export interface Packaged {
  key: DeskKey;
  dirs: { A: string; B: string };
  screens: { A: number; B: number };
  labelled: number;
  subset: number;
  code_task: string;
}

const materialOf = (key: DeskKey, reviews: readonly BatchReview[]) => {
  const m = new Map<string, Block[]>();
  for (const s of key.screens) {
    if (s.kind !== "review") continue;
    const r = reviews.find((x) => x.unit === s.unit && x.arm === s.arm) ?? rmFail("E_RM_POST_INPUT", "screen " + s.sid + " names a review this batch does not hold");
    m.set(s.sid, material(r.bug, r.findings));
  }
  return m;
};

const minter = (taken: Set<string>) => () => {
  let s: string;
  do s = sidOf();
  while (taken.has(s));
  taken.add(s);
  return s;
};
const repeatsOf = (reviews: readonly KeyScreen[], n: number, mint: () => string): KeyScreen[] => shuffled(reviews).slice(0, Math.min(n, reviews.length)).map((r) => ({ sid: mint(), kind: "repeat", findings: r.findings, of: r.sid }));

/** Seat A's and seat B's packages for one batch, and the code task. A rerun reuses the key in the post dir, so ids, the subset and the orders never move. */
export function deskPackage(o: { reviews: readonly BatchReview[]; batch: string; desk: string; post: string; shape?: Shape }): Packaged {
  const file = keyPath(o.post, o.batch, "first");
  let key: DeskKey;
  if (existsSync(file)) {
    key = readJson<DeskKey>(file);
    if (key.schema !== KEY_SCHEMA) rmFail("E_RM_POST_INPUT", file + " is not " + KEY_SCHEMA + " (a key from before the seats of R125); delete it before the desk sends anything, then rerun desk-package");
    if (o.shape && o.shape !== key.shape) rmFail("E_RM_POST_INPUT", "the " + o.batch + " packet was built with the " + key.shape + " question; delete " + file + " before the desk sends it to rebuild it as " + o.shape);
  } else {
    const shape = o.shape ?? DEFAULT_SHAPE;
    const mint = minter(new Set());
    const reviews: KeyScreen[] = o.reviews.filter((r) => r.findings.length).map((r) => ({ sid: mint(), kind: "review", findings: r.findings.length, unit: r.unit, arm: r.arm, pool: r.pool }));
    const att = new Map([...new Set([...SEAT.A.attention, ...SEAT.B.attention])].map((i): [number, KeyScreen] => [i, { sid: mint(), kind: "attention", findings: ATTENTION[i]!.findings.length, attention: i }]));
    const subset = drawSubset(reviews);
    const repA = repeatsOf(reviews, SEAT.A.repeats, mint);
    const repB = repeatsOf(reviews.filter((r) => subset.includes(r.sid)), SEAT.B.repeats, mint);
    const page = (sids: readonly string[], seat: "A" | "B", reps: readonly KeyScreen[]) => withRepeats(shuffled([...sids, ...SEAT[seat].attention.map((i) => att.get(i)!.sid)]), reps);
    key = {
      schema: KEY_SCHEMA, batch: o.batch, round: "first", shape, desk: o.desk,
      screens: [...reviews, ...att.values(), ...repA, ...repB],
      auto_no: o.reviews.filter((r) => !r.findings.length).map((r) => ({ id: mint(), unit: r.unit, arm: r.arm, pool: r.pool })),
      orders: { A: page(reviews.map((r) => r.sid), "A", repA), B: page(subset, "B", repB) },
      subset,
    };
  }
  key.desk = o.desk;
  const blocks = materialOf(key, o.reviews);
  const a = render(key, "A", blocks), b = render(key, "B", blocks);
  const code_task = codeTask(o.desk);
  mkdirSync(peopleDir(o.post, o.batch), { recursive: true });
  writeJson(file, key);
  return { key, dirs: { A: a.dir, B: b.dir }, screens: { A: a.screens, B: b.screens }, labelled: key.screens.filter((s) => s.kind === "review").length, subset: key.subset!.length, code_task };
}

export interface LabelsFile {
  name: string;
  labeller: string;
  version: Version;
  active_seconds: number;
  labels: Record<string, { choice: string; note: string }>;
}

const CODE = /^[A-Z0-9-]{2,12}$/;
const fixedChoices = (shape: Shape): readonly string[] => QUESTION[shape].choices.map((c) => c[0]);

/** One returned labels file read against its package key; every problem is listed, written for the package owner. */
export function readLabelsFile(name: string, text: string, key: DeskKey): { file: LabelsFile | null; problems: string[] } {
  const bad = (p: string) => ({ file: null, problems: [name + ": " + p] });
  if (/^\s*<(!doctype|html)/i.test(text)) return bad("is the labelling page itself, not the labels file it downloads");
  let s: any;
  try {
    s = JSON.parse(text);
  } catch {
    return bad("is not a labels file the page downloads (it does not read as JSON)");
  }
  const pages = Object.keys(key.orders) as Version[];
  if (s?.format !== FORMAT || !pages.some((v) => packageName(key.batch, v) === s?.package)) return bad("comes from another page (format " + JSON.stringify(s?.format) + ", package " + JSON.stringify(s?.package) + "), not " + pages.map((v) => packageName(key.batch, v)).join(" or "));
  const order = key.orders[s.version as Version];
  if (!order || s.package !== packageName(key.batch, s.version)) return bad("names page " + JSON.stringify(s.version) + ", not the page of " + s.package);
  if (typeof s.labeller !== "string" || !CODE.test(s.labeller)) return bad("has no labeller code");
  const problems: string[] = [];
  const byId = new Map(key.screens.map((x) => [x.sid, x]));
  const want = new Map<string, number>();
  for (const sid of order) for (const q of qids(key.shape, byId.get(sid)!)) want.set(q, byId.get(sid)!.findings);
  const labels = s.labels && typeof s.labels === "object" ? s.labels : {};
  const fixed = fixedChoices(key.shape);
  const out: LabelsFile["labels"] = {};
  const valid = (c: unknown, n: number) => typeof c === "string" && (fixed.includes(c) || (key.shape === "review" && /^\d+(,\d+)*$/.test(c) && ((ns) => new Set(ns).size === ns.length && ns.every((x) => x >= 1 && x <= n))(c.split(",").map(Number))));
  const missing: number[] = [], noReason: number[] = [];
  order.forEach((sid, i) => {
    for (const q of qids(key.shape, byId.get(sid)!)) {
      const e = labels[q];
      if (!e || !valid(e.choice, want.get(q)!)) missing.push(i + 1);
      else if (typeof e.note !== "string" || !e.note.trim()) noReason.push(i + 1);
      else out[q] = { choice: e.choice, note: e.note.trim() };
    }
  });
  const list = (xs: number[]) => [...new Set(xs)].slice(0, 25).join(", ") + (new Set(xs).size > 25 ? " ..." : "");
  if (missing.length) problems.push(name + ": screens " + list(missing) + " have no valid answer");
  if (noReason.length) problems.push(name + ": screens " + list(noReason) + " have no reason");
  const extra = Object.keys(labels).filter((q) => !want.has(q));
  if (extra.length) problems.push(name + ": answers " + extra.length + " question" + (extra.length === 1 ? "" : "s") + " not on page " + s.version + " (" + extra.slice(0, 5).join(", ") + ")");
  return { file: problems.length ? null : { name, labeller: s.labeller, version: s.version, active_seconds: Number(s.activeSeconds) || 0, labels: out }, problems };
}

/** Seat A's and seat B's files, from two different people, each complete. */
export function readRound(files: ReadonlyArray<{ name: string; text: string }>, key: DeskKey): { A: LabelsFile; B: LabelsFile } {
  if (files.length !== 2) rmFail("E_RM_POST_LABELS", "pass exactly two labels files, seat A's and seat B's, not " + files.length);
  const read = files.map((x) => readLabelsFile(x.name, x.text, key));
  const problems = read.flatMap((r) => r.problems);
  const got = read.flatMap((r) => (r.file ? [r.file] : []));
  const A = got.find((f) => f.version === "A"), B = got.find((f) => f.version === "B");
  if (got.length === 2 && (!A || !B)) problems.push("both files come from page " + got[0]!.version + "; pass seat A's file and seat B's file");
  if (A && B && A.labeller === B.labeller) problems.push("both files name labeller " + A.labeller + "; seats A and B need two different people");
  if (problems.length) rmFail("E_RM_POST_LABELS", problems.length + " problem" + (problems.length === 1 ? "" : "s") + " in the labels files, nothing imported:\n  " + problems.join("\n  "));
  return { A: A!, B: B! };
}

/** One person's review-level reading of one screen. */
export interface Reading {
  names: boolean;
  cant: boolean;
  matched: number[];
  text: string;
}

const SAY: Record<string, string> = { names: "names the bug", doesnt: "doesn't", cant: "can't tell" };
export function readingOf(shape: Shape, file: LabelsFile, s: { sid: string; findings: number }): Reading {
  const answers = qids(shape, s).map((q) => file.labels[q]!);
  if (shape === "review") {
    const a = answers[0]!;
    const matched = /^\d/.test(a.choice) ? a.choice.split(",").map(Number) : [];
    const head = matched.length ? (matched.length === 1 ? "Finding " + matched[0] + " names the bug." : "Findings " + matched.slice(0, -1).join(", ") + " and " + matched.at(-1) + " name the bug.") : a.choice === "none" ? "No finding names the bug." : "Can't tell.";
    return { names: matched.length > 0, cant: a.choice === "cant", matched, text: head + " Why: " + a.note };
  }
  const matched = answers.flatMap((a, i) => (a.choice === "names" ? [i + 1] : []));
  return { names: matched.length > 0, cant: !matched.length && answers.some((a) => a.choice === "cant"), matched, text: answers.map((a, i) => "Finding " + (i + 1) + ": " + SAY[a.choice] + ". Why: " + a.note).join("\n") };
}

/** Majority of three readings: yes, no or can't tell. No majority, or a majority of can't tell, leaves the review unresolved. */
export function majority(rs: readonly Reading[]): FinalLabel {
  const vote = (r: Reading) => (r.names ? "yes" : r.cant ? "cant" : "no");
  const count = new Map<string, number>();
  for (const r of rs) count.set(vote(r), (count.get(vote(r)) ?? 0) + 1);
  const top = [...count].find(([, n]) => n >= 2)?.[0];
  return top === "yes" ? true : top === "no" ? false : "unresolved";
}

export interface ImportResult {
  reviews: number;
  /** Reviews seat B labelled too, and how many of them seat A and seat B read alike. */
  subset: number;
  agreed: number;
  disagreements: number;
  unresolved: number;
  /** True once final.json holds every review's label. */
  final: boolean;
  /** Seat C's package, when seat A and seat B read some subset reviews differently. */
  third?: string;
}

const row = (s: KeyScreen, label: FinalLabel, cant: boolean, a_b?: [boolean, boolean]): FinalRow => ({ id: s.sid, unit: s.unit!, arm: s.arm!, pool: s.pool!, label, ...(cant && label === false ? { cant_tell: true as const } : {}), ...(a_b ? { a_b } : {}) });

/**
 * Imports seat A's and seat B's files. Every review takes seat A's reading, except subset reviews B reads differently:
 * with none, it writes final.json; otherwise it writes seat C's package for them.
 */
export function importFirst(o: { post: string; batch: string; files: ReadonlyArray<{ name: string; text: string }>; reviews: readonly BatchReview[] }): ImportResult {
  const file = keyPath(o.post, o.batch, "first");
  if (!existsSync(file)) rmFail("E_RM_POST_INPUT", "no packet key at " + file + "; run rm-post desk-package first");
  if (existsSync(keyPath(o.post, o.batch, "third"))) rmFail("E_RM_POST_INPUT", "seats A and B of the " + o.batch + " batch are already imported and seat C's package built; import seat C's file with --round third");
  const key = readJson<DeskKey>(file);
  if (key.schema !== KEY_SCHEMA) rmFail("E_RM_POST_INPUT", file + " is not " + KEY_SCHEMA + "; rebuild the packages with rm-post desk-package");
  const { A, B } = readRound(o.files, key);
  writeJson(join(peopleDir(o.post, o.batch), "first.json"), { A, B });
  const subset = new Set(key.subset);
  const reviews = key.screens.filter((s) => s.kind === "review");
  const read = reviews.map((s) => ({ s, a: readingOf(key.shape, A, s), b: subset.has(s.sid) ? readingOf(key.shape, B, s) : null }));
  writeJson(join(peopleDir(o.post, o.batch), "readings-first.json"), read.map(({ s, a, b }) => ({ id: s.sid, [A.labeller]: a, ...(b ? { [B.labeller]: b } : {}) })));
  const split = read.filter(({ a, b }) => b && a.names !== b.names);
  const done = { reviews: reviews.length + key.auto_no.length, subset: subset.size, agreed: subset.size - split.length, disagreements: split.length };
  if (!split.length) {
    writeJson(finalPath(o.post, o.batch), [...read.map(({ s, a, b }) => row(s, a.names, a.cant || !!b?.cant, b ? [a.names, b.names] : undefined)), ...key.auto_no.map((k) => ({ ...k, label: false }))]);
    return { ...done, unresolved: 0, final: true };
  }
  const mint = minter(new Set([...key.screens.map((s) => s.sid), ...key.auto_no.map((k) => k.id)]));
  const again: KeyScreen[] = split.map(({ s }) => ({ sid: mint(), kind: "review", findings: s.findings, unit: s.unit, arm: s.arm, pool: s.pool, of: s.sid }));
  const att: KeyScreen[] = SEAT.C.attention.map((i) => ({ sid: mint(), kind: "attention", findings: ATTENTION[i]!.findings.length, attention: i }));
  const reps = repeatsOf(again, SEAT.C.repeats, mint);
  const third: DeskKey = {
    schema: KEY_SCHEMA, batch: key.batch, round: "third", shape: key.shape, desk: key.desk,
    screens: [...again, ...att, ...reps], auto_no: [],
    orders: { C: withRepeats(shuffled([...again, ...att].map((s) => s.sid)), reps) },
    exclude: [A.labeller, B.labeller],
  };
  const { dir } = render(third, "C", materialOf(third, o.reviews));
  writeJson(keyPath(o.post, o.batch, "third"), third);
  return { ...done, unresolved: 0, final: false, third: dir };
}

/** Imports seat C's file and writes final.json: each review A and B split on takes the majority of three. */
export function importThird(o: { post: string; batch: string; file: { name: string; text: string } }): ImportResult {
  const file = keyPath(o.post, o.batch, "third");
  if (!existsSync(file)) rmFail("E_RM_POST_INPUT", "no seat C package is open for the " + o.batch + " batch; import seats A and B first");
  const key = readJson<DeskKey>(keyPath(o.post, o.batch, "first"));
  const third = readJson<DeskKey>(file);
  const { file: t, problems } = readLabelsFile(o.file.name, o.file.text, third);
  if (t && third.exclude!.includes(t.labeller)) problems.push(o.file.name + " names labeller " + t.labeller + ", seat A's or seat B's (" + third.exclude!.join(", ") + "); seat C needs someone new");
  if (problems.length) rmFail("E_RM_POST_LABELS", problems.length + " problem" + (problems.length === 1 ? "" : "s") + " in seat C's file, nothing imported:\n  " + problems.join("\n  "));
  writeJson(join(peopleDir(o.post, o.batch), "third.json"), t);
  const first = readJson<{ A: LabelsFile; B: LabelsFile }>(join(peopleDir(o.post, o.batch), "first.json"));
  const subset = new Set(key.subset);
  const thirdOf = new Map(third.screens.filter((s) => s.kind === "review").map((s) => [s.of!, s]));
  writeJson(join(peopleDir(o.post, o.batch), "readings-third.json"), [...thirdOf].map(([of, s]) => ({ id: of, [t!.labeller]: readingOf(third.shape, t!, s) })));
  const final = key.screens.filter((s) => s.kind === "review").map((s) => {
    const a = readingOf(key.shape, first.A, s);
    if (!subset.has(s.sid)) return row(s, a.names, a.cant);
    const b = readingOf(key.shape, first.B, s);
    const x = thirdOf.get(s.sid);
    if (!x) return row(s, a.names, a.cant || b.cant, [a.names, b.names]);
    const all = [a, b, readingOf(third.shape, t!, x)];
    return row(s, majority(all), all.some((r) => r.cant), [a.names, b.names]);
  });
  writeJson(finalPath(o.post, o.batch), [...final, ...key.auto_no.map((k) => ({ ...k, label: false }))]);
  return { reviews: final.length + key.auto_no.length, subset: subset.size, agreed: subset.size - thirdOf.size, disagreements: thirdOf.size, unresolved: final.filter((x) => x.label === "unresolved").length, final: true };
}
