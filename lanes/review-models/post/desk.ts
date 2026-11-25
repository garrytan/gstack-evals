// Copyright (c) 2026 Garry Tan. MIT License.
// The judge check's person labels, as packages for the organisation's labelling desk (pre-run changes 5 and 6 of
// wiki/plans/2026-11-24-geva-590-review-models-prereg). Two people label every bug-unit review the check takes, fix-aware
// and blind to arm. No model makes, proposes or reads as a label here: this file writes what people read and reads the
// files their pages download. The package follows the desk's set format (handoffs/labelling/bg1-dev-judge/ in the org
// drive): self-contained offline pages, one per labeller in two orders, with a few repeats and attention screens, a
// checker for returned files, a privacy and blinding check, a bounty and a first message.
// - deskPackage: <desk>/geva590-review-labels-<batch>/ holds what the desk sends and checks. items.json there is desk only.
//   The key from each screen's opaque id (random bytes) back to unit and arm stays in <post>/labels/people/<batch>/,
//   outside the repository and outside the package. Each screen shows the bug's evidence, the fix diff and the review's
//   findings as the numbered list Carbon reads (score/judge.ts numberedFindings), with masked names shown as [name].
//   The question shape is one switch: "review" (change 6, the default) asks once per review which finding names the bug,
//   or none, or can't tell; "finding" asks change 5's question for every finding. Both carry a required one-line reason.
//   A review with no findings names nothing, so it is labelled no in the key and is not shown.
// - importFirst reads both people's labels files. A review names the bug for a person when they picked a finding (review
//   shape) or answered names for one (finding shape); can't tell reads as not naming, and the final row says so, for
//   change 6's second reading. Where the two people's review-level readings differ, those reviews go to a third person
//   in one small follow-up package built the same way (the desk's rule 4: nothing about earlier answers or other
//   labellers reaches a hire), with 1 repeat and 1 attention screen, priced by the minute at the same rate.
// - importThird reads the third person's file, from a labeller code that is neither of the first two. Each review's label
//   is the majority of the three readings (names, doesn't, can't tell); when all three differ or the majority is can't
//   tell, it is unresolved and stays in the check, read both ways by kappaCheck. Nothing here writes a model summary.
// Labels land in <post>/labels/final.json (final-<batch>.json for a batch other than the pilot) only once every review
// has one, so the readout waits on them until then.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { rmFail, type Arm } from "../score/frozen.ts";
import { numberedFindings, type Bug, type ReviewFinding } from "../score/judge.ts";
import type { FinalLabel, FinalRow, LabelKey } from "../score/labels.ts";
import type { Pilot } from "./pilot.ts";

export type Shape = "review" | "finding";
export const SHAPES: readonly Shape[] = ["review", "finding"];
export const DEFAULT_SHAPE: Shape = "review";
export type DeskRound = "first" | "third";
export type Version = "A" | "B";
export const FORMAT = "labels-v1";
export const PAGE = "check-reviews";
export const KEY_SCHEMA = "rm-desk-key.v1";
const TITLE = "Check whether code reviews spotted a known bug";
const TEMPLATES = join(import.meta.dir, "desk");
/** Pay and time (change 6, section 2): about 5 minutes a review screen at $25 an hour, $125 a seat for a batch. */
export const SEAT_USD = 125;
export const RATE_USD_PER_HOUR = 25;
export const FEE = 0.18;
const MINUTES = { review: 5, finding: 8 } as const;
const REPEATS = { first: 3, third: 1 } as const;
const SEATS = { first: 2, third: 1 } as const;
/** The third round's attention screen: the screening screen. */
const THIRD_ATTENTION = 0;

export const packageName = (batch: string, round: DeskRound) => "geva590-review-labels-" + batch + (round === "third" ? "-third" : "");

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
  package: string;
  /** The labelling root the package sits under. */
  desk: string;
  screens: KeyScreen[];
  /** Reviews with no findings: labelled no, not shown. */
  auto_no: LabelKey[];
  /** One order per page: A and B for the first round's two people, A alone for the third person. */
  orders: Partial<Record<Version, string[]>>;
  /** The third round: the first round's two labeller codes, which the third person's must not be. */
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
    "- When you're done, press **Download my labels**. The file ends in .json, which RentAHuman's upload form refuses: **rename it to end in .txt** before uploading, or attach it in the chat.",
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
    "5. When you're done, press \"Download my labels\". The file ends in .json, which RentAHuman's upload form refuses: rename it so it ends in .txt before uploading, or attach it here in the chat.",
    "",
    "Please finish by <DUE TIME, 48 hours after accept, with time zone>. It takes about " + hoursText(hours) + " hours. Please work on your own and don't use AI tools: we need your own judgement. If anything doesn't work or isn't clear, ask here and we'll get back to you.",
    "",
  ].join("\n");
}

/** A seat's price: change 6's $125 for a batch's first round, and the same hourly rate by the minute for the third. */
export const seatPrice = (round: DeskRound, minutes: number) => (round === "first" ? SEAT_USD : Math.max(5, Math.ceil((minutes / 60) * RATE_USD_PER_HOUR)));

function bounty(key: DeskKey, screens: number, hours: number, price: number): Record<string, unknown> {
  return {
    dryRun: true,
    title: "Check whether " + screens + " code reviews spotted a known bug (about " + hoursText(hours) + " hours, on a computer)",
    description: "Help us check whether code reviews spotted a bug that was later found and fixed. On each screen you see the bug as it was reported, the change that fixed it (a code diff) and the review's numbered findings, and you decide which finding, if any, points at that bug. You need to be able to read code (any common language) and diffs.\n\nWhat you'll do (about " + hoursText(hours) + " hours, in one go or several sittings):\n- Open one web page we send you in the chat (any computer browser; no sign-in, nothing to install). A computer is needed; a phone screen is too small.\n- Read the short instructions and worked example, then answer each screen with a one-line reason. Your answers save in your browser as you go.\n- Press \"Download my labels\", rename the file so it ends in .txt (the upload form refuses .json), and upload it.\n\nWho this suits: careful readers of code with fluent English. Please keep the page in English, work on your own and don't use AI tools; we need a person's judgement.\n\nPay: $" + price + " for a complete, careful file. A screen may appear twice to check consistency, and the page records how long you work on each screen.\n\nUse of your answers: by taking this job you agree that we may use your answers to test and improve our own software, and keep them in our records without your name. We won't publish your name. The material is unpublished: please don't copy or share it.\n\nAfter we accept you, we'll send the page and steps here in the chat. Please finish within 48 hours of being accepted. If anything doesn't work or isn't clear, ask in the chat.",
    completionCriteria: "Upload the labels file the page saves when you press \"Download my labels\" (named labels-<your code>-" + Object.keys(key.orders).join(" or -") + ", renamed to end in .txt), with every one of the " + screens + " screens answered with a reason. A file with unfinished screens, or with the same answer everywhere, can't be accepted.",
    evidenceTypes: ["document", "link"],
    estimatedHours: hours,
    priceType: "fixed",
    price,
    bonuses: [],
    category: "computer-gigs",
    spotsAvailable: SEATS[key.round],
    location: { isRemoteAllowed: true },
    completionQuestions: [
      { id: "file", prompt: "Name of the labels file you uploaded (or a link to it that anyone can open), and the labeller code we gave you." },
      { id: "time", prompt: "Roughly how long did the task take you, in hours, and in how many sittings?" },
      { id: "hard", prompt: "Which screens were hardest to decide, and why? Was anything in the instructions unclear?" },
    ],
    responseWindowHours: 24,
    autoExpireGhosts: true,
    micCheckRequired: false,
    idempotencyKey: key.package + "-a",
  };
}

const usd = (x: number) => "$" + x.toFixed(2);

function readme(key: DeskKey, screens: number, labelled: number, hours: number, price: number): string {
  const first = key.round === "first";
  const seats = SEATS[key.round];
  const pages = Object.keys(key.orders).map((v) => "\x60labeller/" + PAGE + "-" + v + ".html\x60").join(", ");
  const funded = seats * price * (1 + FEE);
  return [
    "# Code-review labels, " + key.batch + " batch" + (first ? "" : ", third reading") + ": package for the labelling desk",
    "",
    first
      ? "Two people each read the same " + labelled + " code reviews of changes with a known bug, plus " + REPEATS.first + " repeats and " + ATTENTION.length + " attention screens (" + screens + " screens). For each review they mark which numbered finding names the bug, or none, or can't tell, with a one-line reason" + (key.shape === "finding" ? " (this package asks it once per finding)" : "") + ". The labels check the review-models eval's automated reading (GEVA-590, pre-run changes 5 and 6). GEVA-590 built this package and owns everything that needs judgement about the task. The desk runs RentAHuman: pricing, posting, hiring, sending the page, collecting files and paying. Labeller questions the desk can't answer go to GEVA-590 by agent message, answered the same day."
      : "One new person reads the " + labelled + " reviews that the two hires of " + packageName(key.batch, "first") + " read differently, plus " + REPEATS.third + " repeat and 1 attention screen (" + screens + " screens), with the same question and page. Their answer settles each review by majority of three. They must not be either of the first two hires (codes " + key.exclude!.join(" and ") + "): check your exclude list and that package's seats. GEVA-590 built this package and owns everything that needs judgement about the task.",
    "",
    "The bugs, fixes and reviews come from real public code but are unpublished answer keys until the eval reports: they stay in this folder and with the hires. The privacy and blinding check result is in \x60privacy-check.md\x60.",
    "",
    "## What's in this folder",
    "",
    "| File | What it is | Who sees it |",
    "| --- | --- | --- |",
    "| \x60bounty.json\x60 | The bounty, \x60dryRun: true\x60 as written: " + seats + " seat" + (seats === 1 ? "" : "s") + " at " + usd(price) + " fixed. | posted |",
    "| " + pages + " | The labelling page" + (first ? ", one self-contained file per labeller: the same screens in two orders" : ", one self-contained file") + ". It opens offline in any computer browser, asks the browser not to translate it, saves answers as the labeller goes and downloads a labels file. | " + (first ? "one page per labeller" : "the hire") + " |",
    "| \x60guide.md\x60 | The instructions with the one rule and a worked example (the page's first tab). | labeller, inside the page |",
    "| \x60message-to-labeller.txt\x60 | The chat message that carries the page link. Fill in the three placeholders. | labeller |",
    "| \x60items.json\x60 | The screens, the order" + (first ? "s" : "") + ", the repeats and the attention screens. **Desk only**: never send it to a labeller. | desk |",
    "| \x60check_return.py\x60 | Checks a returned file and prints \x60VERDICT: PASS / REDO / REJECT / ASK\x60. | desk |",
    "| \x60returns/\x60 | Put each returned file here unchanged, as \x60returns/labels-<code>-<letter>.txt\x60 (or .json). | desk writes, GEVA-590 reads |",
    "| \x60privacy-check.md\x60, \x60privacy_check.py\x60 | The check and its result on exactly these files. | anyone |",
    ...(first ? ["| \x60host_pages.sh\x60 | Hosts this package's pages, and the third reading's once it exists, at unguessable https paths, as gbev130-hosting does. Writes \x60links.txt\x60. | desk |"] : []),
    "",
    "## Hiring and delivery",
    "",
    ...(first
      ? [
          "1. Dry-run \x60bounty.json\x60, check the price against the pay plan below, and post. GEVA-590's posting line is the go.",
          "2. Hire the first two applicants who say they'll use a computer, read code and read English fluently. No mic check. Skip anyone on your exclude list.",
          "3. The first hire gets code **F1** and page **A**, the second **F2** and page **B**. A replacement takes **F3** and the page of the person it replaces; replacement seats go to the gstack-evals Captain first (change 6).",
          "4. Host the pages with \x60bash host_pages.sh up\x60 and send \x60message-to-labeller.txt\x60 as a chat message (never in the accept response), with the page link from \x60links.txt\x60. Read the conversation back once to confirm the link is there.",
        ]
      : [
          "1. Dry-run \x60bounty.json\x60 and post it as a separate bounty. GEVA-590's posting line is the go.",
          "2. Hire one applicant who will use a computer, reads code and reads English fluently, and who is **not** " + key.exclude!.join(" or ") + " from the first package. Give them code **T1** (a replacement takes **T2**).",
          "3. Host the page with \x60bash ../" + packageName(key.batch, "first") + "/host_pages.sh refresh\x60, which serves this folder too, and send \x60message-to-labeller.txt\x60 with the link from \x60links.txt\x60.",
        ]),
    (first ? "5" : "4") + ". Answer chat questions on every poll. Questions about how to label a screen go to GEVA-590, and the desk relays the answer word for word. Never tell a labeller anything about another hire, any earlier or automated reading, which screens repeat or how the reviews were made.",
    "",
    "## Accepting a submission",
    "",
    "Copy the returned file into \x60returns/\x60, then run \x60python3 check_return.py returns/labels-<code>-<letter>.txt\x60.",
    "",
    "- **PASS**: approve and release the pay.",
    "- **REDO**: send \x60request_redo\x60 once, with the checker's reasons as the response. A second REDO on the same seat goes to GEVA-590.",
    "- **REJECT**: reject with the checker's reasons (too few active minutes, the same answer almost everywhere, or most attention screens answered another way). A replacement seat needs the Captain's go.",
    "- **ASK**: hold, and send the checker output to GEVA-590, which answers within a day with pay, redo or reject.",
    "",
    "Then tell GEVA-590 the file is in. GEVA-590 imports the files with \x60gstack-evals rm-post labels-import\x60, which checks them again" + (first ? " and, where the two readings differ, writes the third reading's package beside this one." : " and writes the labels."),
    "",
    "## Pay plan (pre-run change 6)",
    "",
    "| Item | Amount |",
    "| --- | --- |",
    "| " + seats + " seat" + (seats === 1 ? "" : "s") + " × " + usd(price) + " fixed" + (first ? "" : " (" + screens + " screens at about " + MINUTES[key.shape] + " minutes each, at $" + RATE_USD_PER_HOUR + " an hour)") + ", plus the 18% fee | " + usd(funded) + " funded at posting |",
    "| A replacement seat, only after a REJECT and the Captain's go | " + usd(price * (1 + FEE)) + " |",
    "",
    "No bonuses. Don't raise the price or add seats without GEVA-590's go. Send GEVA-590 the real cost at close-out (from \x60GET /api/wallet/report\x60) and anything that went wrong.",
    "",
    "## Deadline and clean-up",
    "",
    "48 hours from accept. One reminder at about 36 hours. When every file has a verdict and pay is released, settle every seat, cancel the bounty and claim unused funds. Run \x60bash host_pages.sh down\x60 in the first package once the last review window closes.",
    "",
  ].join("\n");
}

const sha16 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])).sort();
}

/** Writes a package from its key and each review screen's material, runs the privacy check and records its result. */
function render(key: DeskKey, blocks: ReadonlyMap<string, Block[]>): { dir: string; screens: number; price: number } {
  const dir = join(key.desk, key.package);
  mkdirSync(join(dir, "labeller"), { recursive: true });
  mkdirSync(join(dir, "returns"), { recursive: true });
  writeFileSync(join(dir, "returns", ".keep"), "");
  const first = key.round === "first";
  const labelled = key.screens.filter((s) => s.kind === "review").length;
  const screens: Record<string, { blocks: Block[]; questions: Array<{ id: string; findings?: number; finding?: number }> }> = {};
  const attention: Record<string, string> = {};
  const screening: string[] = [];
  const repeats: Record<string, string> = {};
  for (const s of key.screens) {
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
  const n = key.screens.length;
  const q = QUESTION[key.shape];
  const minutes = n * MINUTES[key.shape];
  const hours = hoursOf(minutes);
  const price = seatPrice(key.round, minutes);
  const items = {
    format: FORMAT, package: key.package, page_name: PAGE, title: TITLE, shape: key.shape, prompt: q.prompt, choices: q.choices, note_prompt: NOTE, note_required: true,
    screens, orders: key.orders, repeats, attention, screening,
    checks: { reject_minutes: Math.round(minutes * 0.3), ask_minutes: Math.round(minutes * 0.6), max_repeat_diff: 1, unsure_choices: ["cant"], max_unsure_share: 0.15, max_copied_reasons: 0.3 },
  };
  writeJson(join(dir, "items.json"), items);
  const g = guide(key.shape, n, hours);
  writeFileSync(join(dir, "guide.md"), g);
  const template = readFileSync(join(TEMPLATES, "page.html"), "utf8");
  for (const v of Object.keys(key.orders) as Version[]) {
    const data = { format: FORMAT, package: key.package, version: v, shape: key.shape, prompt: q.prompt, choices: q.choices, note_prompt: NOTE, note_required: true, order: key.orders[v]!, screens: Object.fromEntries(key.orders[v]!.map((sid) => [sid, screens[sid]!])) };
    const page = template.replaceAll("{{TITLE}}", TITLE).replace("{{GUIDE}}", () => mdHtml(g)).replace("{{DATA}}", () => JSON.stringify(data).replaceAll("</", "<\\/").replaceAll("<!--", "<\\!--"));
    writeFileSync(join(dir, "labeller", PAGE + "-" + v + ".html"), page);
  }
  writeFileSync(join(dir, "message-to-labeller.txt"), message(n, hours));
  writeJson(join(dir, "bounty.json"), bounty(key, n, hours, price));
  writeFileSync(join(dir, "README.md"), readme(key, n, labelled, hours, price));
  writeJson(join(dir, ".meta.json"), { name: key.package, screens: n, questions: Object.values(screens).reduce((s, x) => s + x.questions.length, 0), shape: key.shape, price, funded: Math.round(SEATS[key.round] * price * (1 + FEE) * 100) / 100, codes: first ? ["F1", "F2", "F3"] : ["T1", "T2"], page: PAGE });
  for (const file of ["check_return.py", "privacy_check.py", ...(first ? ["host_pages.sh"] : [])]) copyFileSync(join(TEMPLATES, file), join(dir, file));
  const check = spawnSync("python3", [join(dir, "privacy_check.py"), dir], { encoding: "utf8" });
  if (check.error) rmFail("E_RM_POST_DESK", "python3 did not run the privacy check: " + check.error.message);
  const files = walk(dir).filter((p) => !p.endsWith("privacy-check.md") && !p.includes("/returns/"));
  const pass = check.status === 0;
  writeFileSync(join(dir, "privacy-check.md"), ["# Privacy check: " + key.package, "", "Run by gstack-evals rm-post " + (first ? "desk-package" : "labels-import (first round)") + " with privacy_check.py on the files in this folder.", "", "Result: " + (pass ? "BLOCKING HITS: 0." : "FAILED. Do not send any file from this folder until the package is rebuilt clean."), "", "## Raw output", "", "\x60\x60\x60", check.stdout.trim(), "\x60\x60\x60", "", "## File sha256 (first 16 hex)", "", ...files.map((p) => "- ./" + relative(dir, p) + " " + sha16(p)), ""].join("\n"));
  if (!pass) rmFail("E_RM_POST_DESK", key.package + " failed its privacy and blinding check; see " + join(dir, "privacy-check.md") + ":\n" + check.stdout.split("\n").filter((l) => /^  \S/.test(l) && !l.includes("bytes")).slice(0, 12).join("\n"));
  return { dir, screens: n, price };
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
  dir: string;
  key: DeskKey;
  screens: number;
  labelled: number;
  price: number;
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

/** The first-round package for one batch. A rerun reuses the key in the post dir, so ids and orders never move. */
export function deskPackage(o: { reviews: readonly BatchReview[]; batch: string; desk: string; post: string; shape?: Shape }): Packaged {
  const file = keyPath(o.post, o.batch, "first");
  let key: DeskKey;
  if (existsSync(file)) {
    key = readJson<DeskKey>(file);
    if (key.schema !== KEY_SCHEMA) rmFail("E_RM_POST_INPUT", file + " is not " + KEY_SCHEMA);
    if (o.shape && o.shape !== key.shape) rmFail("E_RM_POST_INPUT", "the " + o.batch + " packet was built with the " + key.shape + " question; delete " + file + " before the desk posts it to rebuild it as " + o.shape);
  } else {
    const shape = o.shape ?? DEFAULT_SHAPE;
    const taken = new Set<string>();
    const mint = () => {
      let s: string;
      do s = sidOf();
      while (taken.has(s));
      taken.add(s);
      return s;
    };
    const shown = o.reviews.filter((r) => r.findings.length);
    const reviews: KeyScreen[] = shown.map((r) => ({ sid: mint(), kind: "review", findings: r.findings.length, unit: r.unit, arm: r.arm, pool: r.pool }));
    const att: KeyScreen[] = ATTENTION.map((a, i) => ({ sid: mint(), kind: "attention", findings: a.findings.length, attention: i }));
    const reps: KeyScreen[] = shuffled(reviews).slice(0, Math.min(REPEATS.first, reviews.length)).map((r) => ({ sid: mint(), kind: "repeat", findings: r.findings, of: r.sid }));
    const base = [...reviews, ...att].map((s) => s.sid);
    key = {
      schema: KEY_SCHEMA, batch: o.batch, round: "first", shape, package: packageName(o.batch, "first"), desk: o.desk,
      screens: [...reviews, ...att, ...reps],
      auto_no: o.reviews.filter((r) => !r.findings.length).map((r) => ({ id: mint(), unit: r.unit, arm: r.arm, pool: r.pool })),
      orders: { A: withRepeats(shuffled(base), reps), B: withRepeats(shuffled(base), reps) },
    };
  }
  key.desk = o.desk;
  const { dir, screens, price } = render(key, materialOf(key, o.reviews));
  mkdirSync(peopleDir(o.post, o.batch), { recursive: true });
  writeJson(file, key);
  return { dir, key, screens, labelled: key.screens.filter((s) => s.kind === "review").length, price };
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
  if (s?.format !== FORMAT || s?.package !== key.package) return bad("comes from another page (format " + JSON.stringify(s?.format) + ", package " + JSON.stringify(s?.package) + "), not " + key.package);
  const order = key.orders[s.version as Version];
  if (!order) return bad("names page " + JSON.stringify(s.version) + ", not " + Object.keys(key.orders).join(" or "));
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

/** The first round's two files, from two different people, each complete. */
export function readRound(files: ReadonlyArray<{ name: string; text: string }>, key: DeskKey): [LabelsFile, LabelsFile] {
  if (files.length !== 2) rmFail("E_RM_POST_LABELS", "pass exactly two labels files, one per person, not " + files.length);
  const read = files.map((x) => readLabelsFile(x.name, x.text, key));
  const problems = read.flatMap((r) => r.problems);
  const [a, b] = read.map((r) => r.file);
  if (a && b && a.labeller === b.labeller) problems.push("both files name labeller " + a.labeller + "; the check needs two different people");
  if (problems.length) rmFail("E_RM_POST_LABELS", problems.length + " problem" + (problems.length === 1 ? "" : "s") + " in the labels files, nothing imported:\n  " + problems.join("\n  "));
  return [a!, b!].sort((x, y) => (x.labeller < y.labeller ? -1 : 1)) as [LabelsFile, LabelsFile];
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
  agreed: number;
  disagreements: number;
  unresolved: number;
  /** True once final.json holds every review's label. */
  final: boolean;
  /** The third person's package, when the first two disagreed. */
  third?: string;
  price?: number;
}

const row = (s: KeyScreen, label: FinalLabel, cant: boolean): FinalRow => ({ id: s.sid, unit: s.unit!, arm: s.arm!, pool: s.pool!, label, ...(cant && label === false ? { cant_tell: true as const } : {}) });

/** Imports the first round. With no disagreement it writes final.json; otherwise it writes the third person's package. */
export function importFirst(o: { post: string; batch: string; files: ReadonlyArray<{ name: string; text: string }>; reviews: readonly BatchReview[] }): ImportResult {
  const file = keyPath(o.post, o.batch, "first");
  if (!existsSync(file)) rmFail("E_RM_POST_INPUT", "no packet key at " + file + "; run rm-post desk-package first");
  if (existsSync(keyPath(o.post, o.batch, "third"))) rmFail("E_RM_POST_INPUT", "the first round of the " + o.batch + " batch is already imported and its third package built; import the third person's file with --round third");
  const key = readJson<DeskKey>(file);
  const pair = readRound(o.files, key);
  writeJson(join(peopleDir(o.post, o.batch), "first.json"), pair);
  const reviews = key.screens.filter((s) => s.kind === "review");
  const read = reviews.map((s) => ({ s, r: pair.map((p) => readingOf(key.shape, p, s)) as [Reading, Reading] }));
  writeJson(join(peopleDir(o.post, o.batch), "readings-first.json"), read.map(({ s, r }) => ({ id: s.sid, [pair[0].labeller]: r[0], [pair[1].labeller]: r[1] })));
  const split = read.filter(({ r }) => r[0].names !== r[1].names);
  const total = reviews.length + key.auto_no.length;
  if (!split.length) {
    writeJson(finalPath(o.post, o.batch), [...read.map(({ s, r }) => row(s, r[0].names, r[0].cant || r[1].cant)), ...key.auto_no.map((k) => ({ ...k, label: false }))]);
    return { reviews: total, agreed: total, disagreements: 0, unresolved: 0, final: true };
  }
  const taken = new Set([...key.screens.map((s) => s.sid), ...key.auto_no.map((k) => k.id)]);
  const mint = () => {
    let sid: string;
    do sid = sidOf();
    while (taken.has(sid));
    taken.add(sid);
    return sid;
  };
  const again: KeyScreen[] = split.map(({ s }) => ({ sid: mint(), kind: "review", findings: s.findings, unit: s.unit, arm: s.arm, pool: s.pool, of: s.sid }));
  const att: KeyScreen = { sid: mint(), kind: "attention", findings: ATTENTION[THIRD_ATTENTION]!.findings.length, attention: THIRD_ATTENTION };
  const reps: KeyScreen[] = shuffled(again).slice(0, REPEATS.third).map((r) => ({ sid: mint(), kind: "repeat", findings: r.findings, of: r.sid }));
  const third: DeskKey = {
    schema: KEY_SCHEMA, batch: key.batch, round: "third", shape: key.shape, package: packageName(key.batch, "third"), desk: key.desk,
    screens: [...again, att, ...reps], auto_no: [],
    orders: { A: withRepeats(shuffled([...again, att].map((s) => s.sid)), reps) },
    exclude: [pair[0].labeller, pair[1].labeller],
  };
  const { dir, price } = render(third, materialOf(third, o.reviews));
  writeJson(keyPath(o.post, o.batch, "third"), third);
  return { reviews: total, agreed: total - split.length, disagreements: split.length, unresolved: 0, final: false, third: dir, price };
}

/** Imports the third person's file and writes final.json: each split review takes the majority of three. */
export function importThird(o: { post: string; batch: string; file: { name: string; text: string } }): ImportResult {
  const file = keyPath(o.post, o.batch, "third");
  if (!existsSync(file)) rmFail("E_RM_POST_INPUT", "no third package is open for the " + o.batch + " batch; import the first round first");
  const key = readJson<DeskKey>(keyPath(o.post, o.batch, "first"));
  const third = readJson<DeskKey>(file);
  const { file: t, problems } = readLabelsFile(o.file.name, o.file.text, third);
  if (t && third.exclude!.includes(t.labeller)) problems.push(o.file.name + " names labeller " + t.labeller + ", one of the first two people (" + third.exclude!.join(", ") + "); the third reading needs someone new");
  if (problems.length) rmFail("E_RM_POST_LABELS", problems.length + " problem" + (problems.length === 1 ? "" : "s") + " in the third person's file, nothing imported:\n  " + problems.join("\n  "));
  writeJson(join(peopleDir(o.post, o.batch), "third.json"), t);
  const first = readJson<[LabelsFile, LabelsFile]>(join(peopleDir(o.post, o.batch), "first.json"));
  const thirdOf = new Map(third.screens.filter((s) => s.kind === "review").map((s) => [s.of!, s]));
  writeJson(join(peopleDir(o.post, o.batch), "readings-third.json"), [...thirdOf].map(([of, s]) => ({ id: of, [t!.labeller]: readingOf(third.shape, t!, s) })));
  const final = key.screens.filter((s) => s.kind === "review").map((s) => {
    const r = first.map((p) => readingOf(key.shape, p, s));
    const x = thirdOf.get(s.sid);
    if (!x) return row(s, r[0]!.names, r[0]!.cant || r[1]!.cant);
    const all = [...r, readingOf(third.shape, t!, x)];
    return row(s, majority(all), all.some((a) => a.cant));
  });
  writeJson(finalPath(o.post, o.batch), [...final, ...key.auto_no.map((k) => ({ ...k, label: false }))]);
  const total = final.length + key.auto_no.length;
  return { reviews: total, agreed: total - thirdOf.size, disagreements: thirdOf.size, unresolved: final.filter((x) => x.label === "unresolved").length, final: true };
}
