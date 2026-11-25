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
//   change 6's second reading. Where the two people's review-level readings differ, the adjudication package goes to the
//   same two people with both readings and reasons side by side, unattributed. Nothing here writes a model summary.
// - importAdjudication reads the same two people's files for those reviews. A review they now read alike takes that
//   label; one they still read differently stays in the check as unresolved, read both ways by kappaCheck.
// Labels land in <post>/labels/final.json only once every review has one, so the readout waits on them until then.
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
export type DeskRound = "first" | "adjudication";
export type Version = "A" | "B";
const VERSIONS: readonly Version[] = ["A", "B"];
export const FORMAT = "labels-v1";
export const PAGE = "check-reviews";
export const KEY_SCHEMA = "rm-desk-key.v1";
const TITLE = "Check whether code reviews spotted a known bug";
const TEMPLATES = join(import.meta.dir, "desk");
/** Pay and time per seat (change 6, section 2): about 5 minutes a review screen, and $125 a seat for both parts. */
export const SEAT_USD = 125;
export const FEE = 0.18;
const MINUTES = { review: 5, finding: 8 } as const;
const ADJUDICATION_ITEMS = 10;
const REPEATS = 3;

export const packageName = (batch: string, round: DeskRound) => "geva590-review-labels-" + batch + (round === "adjudication" ? "-adjudication" : "");

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
  /** An adjudication screen's two readings, in the order shown. */
  readings?: [string, string];
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
  orders: Record<Version, string[]>;
  /** The adjudication round's two people, the first round's labeller codes. */
  labellers?: [string, string];
}

export const peopleDir = (post: string, batch: string) => join(post, "labels", "people", batch);
export const finalPath = (post: string) => join(post, "labels", "final.json");
const keyPath = (post: string, batch: string, round: DeskRound) => join(peopleDir(post, batch), round === "first" ? "key.json" : "adjudication-key.json");
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

function guide(round: DeskRound, shape: Shape, screens: number, hours: number): string {
  const rule = "**A finding names the bug only if it points at the same fault the fix repairs: the same wrong behaviour, in the code the fix changes or in the code that causes it.** A finding that uses similar words but points at different code doesn't name it. Severity doesn't matter, and the finding doesn't have to suggest the same fix.";
  const ask = shape === "review"
    ? "For each screen, pick **every finding that names the bug**, or **None names it**, or **Can't tell** (please use Can't tell rarely). Then write one line saying why. The line is required."
    : "For each finding on a screen, choose **Names the bug**, **Doesn't** or **Can't tell** (please use Can't tell rarely), and write one line saying why. Every line is required.";
  const L = round === "first"
    ? [
        "# How to check the code reviews",
        "",
        "Thank you for helping. There are " + screens + " screens, and this part takes about " + hoursText(hours) + " hours, in one go or several sittings. Your answers save in your browser as you go, so you can stop and come back in the same browser. A short second part, about " + ADJUDICATION_ITEMS + " screens, may follow within two days.",
        "",
        "**Please keep this page in English.** Don't use your browser's translate button: it changes the code and wording you are checking.",
        "",
        "## The one rule that matters",
        "",
        rule,
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
      ]
    : [
        "# A second look at a few code reviews",
        "",
        "Thank you for coming back. This is the short second part of the same task: " + screens + " screens, about " + hoursText(hours) + " hours. Your answers save in your browser as you go.",
        "",
        "**Please keep this page in English.** Don't use your browser's translate button.",
        "",
        "## The one rule that matters",
        "",
        rule,
        "",
        "## What's on each screen",
        "",
        "Each screen shows a review the same way as before: the bug, the change that fixed it and the numbered findings. Below them, a yellow box shows **two readings** of the review, each with its reason. The readings differ about whether a finding names the bug.",
        "",
        "Read the review again and give your own answer. You may pick what either reading says, or something else. " + ask,
      ];
  L.push(
    "",
    "## Practical points",
    "",
    "- Take the screens in order. Reading the fix first, then each finding, works well. About " + MINUTES[shape] + " minutes a screen is normal." + (shape === "review" ? " Keys 1 to 9 pick or unpick a finding, and Enter moves on." : " Enter moves on."),
    ...(round === "first" ? ["- A few screens appear twice. Label each as you see it."] : []),
    "- Some names in the findings are shown as [name], and severity words as [severity], on purpose. Ignore who wrote a finding.",
    "- Work on your own and don't use AI tools. We need a person's judgement.",
    "- Keep what you read private: don't copy, share or post it anywhere.",
    "- When you're done, press **Download my labels**. The file ends in .json, which RentAHuman's upload form refuses: **rename it to end in .txt** before uploading, or attach it in the chat.",
    "",
  );
  return L.join("\n");
}

function message(round: DeskRound, screens: number, hours: number): string {
  return [
    round === "first" ? "Hi, thanks for taking this on! Here's everything you need." : "Hi again, here's the short second part we mentioned.",
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
    "Please finish by <DUE TIME, 48 hours after this message, with time zone>. " + (round === "first" ? "This part takes" : "It takes") + " about " + hoursText(hours) + " hours. Please work on your own and don't use AI tools: we need your own judgement. If anything doesn't work or isn't clear, ask here and we'll get back to you.",
    "",
  ].join("\n");
}

function bounty(batch: string, screens: number, hours: number): Record<string, unknown> {
  return {
    dryRun: true,
    title: "Check whether " + screens + " code reviews spotted a known bug (about " + hoursText(hours) + " hours, on a computer)",
    description: "Help us check whether code reviews spotted a bug that was later found and fixed. On each screen you see the bug as it was reported, the change that fixed it (a code diff) and the review's numbered findings, and you decide which finding, if any, points at that bug. You need to be able to read code (any common language) and diffs.\n\nWhat you'll do (about " + hoursText(hours) + " hours in all, in one go or several sittings):\n- Open one web page we send you in the chat (any computer browser; no sign-in, nothing to install). A computer is needed; a phone screen is too small.\n- Read the short instructions and worked example, then answer each screen with a one-line reason. Your answers save in your browser as you go.\n- Press \"Download my labels\", rename the file so it ends in .txt (the upload form refuses .json), and upload it.\n- A short second part, about " + ADJUDICATION_ITEMS + " screens on a second page, may follow within two days. It is included in the pay.\n\nWho this suits: careful readers of code with fluent English. Please keep the page in English, work on your own and don't use AI tools; we need a person's judgement.\n\nPay: $" + SEAT_USD + " for complete, careful files for both parts. A few screens appear twice to check consistency, and the page records how long you work on each screen.\n\nUse of your answers: by taking this job you agree that we may use your answers to test and improve our own software, and keep them in our records without your name. We won't publish your name. The material is unpublished: please don't copy or share it.\n\nAfter we accept you, we'll send the page and steps here in the chat. Please finish the first part within 48 hours of being accepted. If anything doesn't work or isn't clear, ask in the chat.",
    completionCriteria: "Upload the labels file the page saves when you press \"Download my labels\" (named labels-<your code>-<letter>, renamed to end in .txt), with every one of the " + screens + " screens answered with a reason, and the same for the second part if we send one. A file with unfinished screens, or with the same answer everywhere, can't be accepted.",
    evidenceTypes: ["document", "link"],
    estimatedHours: hours,
    priceType: "fixed",
    price: SEAT_USD,
    bonuses: [],
    category: "computer-gigs",
    spotsAvailable: 2,
    location: { isRemoteAllowed: true },
    completionQuestions: [
      { id: "file", prompt: "Name of the labels file you uploaded (or a link to it that anyone can open), and the labeller code we gave you." },
      { id: "time", prompt: "Roughly how long did the task take you, in hours, and in how many sittings?" },
      { id: "hard", prompt: "Which screens were hardest to decide, and why? Was anything in the instructions unclear?" },
    ],
    responseWindowHours: 24,
    autoExpireGhosts: true,
    micCheckRequired: false,
    idempotencyKey: packageName(batch, "first") + "-a",
  };
}

const usd = (x: number) => "$" + x.toFixed(2);

function readme(key: DeskKey, screens: number, labelled: number, hours: number): string {
  const first = key.round === "first";
  const funded = 2 * SEAT_USD * (1 + FEE), seat = SEAT_USD * (1 + FEE);
  const L = [
    "# " + (first ? "Code-review labels, " + key.batch + " batch" : "Code-review labels, " + key.batch + " batch, second part") + ": package for the labelling desk",
    "",
    first
      ? "Two people each read the same " + labelled + " code reviews of changes with a known bug, plus " + REPEATS + " repeats and " + ATTENTION.length + " attention screens (" + screens + " screens). For each review they mark which numbered finding names the bug, or none, or can't tell, with a one-line reason" + (key.shape === "finding" ? " (this package asks it once per finding)" : "") + ". The labels check the review-models eval's automated reading (GEVA-590, pre-run changes 5 and 6). GEVA-590 built this package and owns everything that needs judgement about the task. The desk runs RentAHuman: pricing, posting, hiring, sending the page, collecting files and paying. Labeller questions the desk can't answer go to GEVA-590 by agent message, answered the same day."
      : "The second part of " + packageName(key.batch, "first") + ": the " + labelled + " reviews the two people read differently go back to the same two people, F-codes unchanged, with both readings and their reasons side by side and unattributed. It is part of the same job and the same pay; there is no new bounty.",
    "",
    "The bugs, fixes and reviews come from real public code but are unpublished answer keys until the eval reports: they stay in this folder and with the two hires. The privacy and blinding check result is in \x60privacy-check.md\x60.",
    "",
    "## What's in this folder",
    "",
    "| File | What it is | Who sees it |",
    "| --- | --- | --- |",
    ...(first ? ["| \x60bounty.json\x60 | The bounty, \x60dryRun: true\x60 as written. One job covers both parts. | posted |"] : []),
    "| \x60labeller/" + PAGE + "-A.html\x60, \x60-B.html\x60 | The labelling page, one self-contained file per labeller: the same screens in two orders. It opens offline in any computer browser, asks the browser not to translate it, saves answers as the labeller goes and downloads a labels file. | one page per labeller |",
    "| \x60guide.md\x60 | The instructions with the one rule and a worked example (the page's first tab). | labeller, inside the page |",
    "| \x60message-to-labeller.txt\x60 | The chat message that carries the page link. Fill in the three placeholders. | labeller |",
    "| \x60items.json\x60 | The screens, the two orders" + (first ? ", the repeats and the attention screens" : "") + ". **Desk only**: never send it to a labeller. | desk |",
    "| \x60check_return.py\x60 | Checks a returned file and prints \x60VERDICT: PASS / REDO / REJECT / ASK\x60. | desk |",
    "| \x60returns/\x60 | Put each returned file here unchanged, as \x60returns/labels-<code>-<A or B>.txt\x60 (or .json). | desk writes, GEVA-590 reads |",
    "| \x60privacy-check.md\x60, \x60privacy_check.py\x60 | The check and its result on exactly these files. | anyone |",
    ...(first ? ["| \x60host_pages.sh\x60 | Hosts this package's pages, and the second part's once it exists, at unguessable https paths, as gbev130-hosting does. Writes \x60links.txt\x60. | desk |"] : []),
    "",
    "## Hiring and delivery",
    "",
    ...(first
      ? [
          "1. Dry-run \x60bounty.json\x60, check the price against the pay plan below, and post. GEVA-590's posting line is the go.",
          "2. Hire the first two applicants who say they'll use a computer, read code and read English fluently. No mic check. Skip anyone on your exclude list.",
          "3. The first hire gets code **F1** and page **A**, the second **F2** and page **B**. A replacement takes **F3** and the page of the person it replaces; replacement seats go to the gstack-evals Captain first (change 6).",
          "4. Host the pages with \x60bash host_pages.sh up\x60 and send \x60message-to-labeller.txt\x60 as a chat message (never in the accept response), with the page link from \x60links.txt\x60. Read the conversation back once to confirm the link is there.",
          "5. Answer chat questions on every poll. Questions about how to label a screen go to GEVA-590, and the desk relays the answer word for word. Never tell a labeller anything about the other hire, any automated reading, which screens repeat or how the reviews were made.",
        ]
      : [
          "1. Send page A to the hire who had page A in the first part and page B to the other, with the same codes, after \x60bash ../" + packageName(key.batch, "first") + "/host_pages.sh refresh\x60.",
          "2. Same rules as the first part: answer every poll, relay GEVA-590's answers word for word, and say nothing about the other hire or where the readings came from.",
        ]),
    "",
    "## Accepting a submission",
    "",
    "Copy the returned file into \x60returns/\x60, then run \x60python3 check_return.py returns/labels-<code>-<A|B>.txt\x60.",
    "",
    "- **PASS**: accept the file. Release the pay once the second part has passed too, or once GEVA-590 says no second part is needed.",
    "- **REDO**: send \x60request_redo\x60 once, with the checker's reasons as the response. A second REDO on the same seat goes to GEVA-590.",
    "- **REJECT**: reject with the checker's reasons (too few active minutes, the same answer almost everywhere, or most attention screens answered another way). A replacement seat needs the Captain's go.",
    "- **ASK**: hold, and send the checker output to GEVA-590, which answers within a day with pay, redo or reject.",
    "",
    "Then tell GEVA-590 the file is in. GEVA-590 imports both files with \x60gstack-evals rm-post labels-import\x60, which checks them again and, where the two readings differ, writes the second part's package beside this one.",
    "",
  ];
  if (first)
    L.push(
      "## Pay plan (pre-run change 6)",
      "",
      "| Item | Amount |",
      "| --- | --- |",
      "| 2 seats × " + usd(SEAT_USD) + " fixed, plus the 18% fee, covering both parts | " + usd(funded) + " funded at posting |",
      "| A replacement seat, only after a REJECT and the Captain's go | " + usd(seat) + " |",
      "",
      "No bonuses. Don't raise the price or add seats without GEVA-590's go. Send GEVA-590 the real cost at close-out (from \x60GET /api/wallet/report\x60) and anything that went wrong.",
      "",
      "## Deadline and clean-up",
      "",
      "48 hours from accept for the first part, 48 hours from the second message for the second. One reminder at about 36 hours. When every file has a verdict and pay is released, settle every seat, cancel the bounty, claim unused funds and run \x60bash host_pages.sh down\x60.",
      "",
    );
  return L.join("\n");
}

const sha16 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])).sort();
}

/** Writes a package from its key and each review screen's material, runs the privacy check and records its result. */
function render(key: DeskKey, blocks: ReadonlyMap<string, Block[]>): { dir: string; screens: number } {
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
    if (s.readings) b = [...b, { label: "Two readings of this review", text: "Reading 1: " + s.readings[0] + "\n\nReading 2: " + s.readings[1], style: "readings" }];
    screens[s.sid] = { blocks: b, questions: qids(key.shape, s).map((id, i) => (key.shape === "review" ? { id, findings: s.findings } : { id, finding: i + 1 })) };
  }
  const n = key.screens.length;
  const part = hoursOf(n * (MINUTES[key.shape] + (first ? 0 : 1)));
  const hours = first ? hoursOf(n * MINUTES[key.shape] + ADJUDICATION_ITEMS * (MINUTES[key.shape] + 1)) : part;
  const q = QUESTION[key.shape];
  const minutes = n * MINUTES[key.shape];
  const items = {
    format: FORMAT, package: key.package, page_name: PAGE, title: TITLE, shape: key.shape, prompt: q.prompt, choices: q.choices, note_prompt: NOTE, note_required: true,
    screens, orders: key.orders, repeats, attention, screening,
    checks: { reject_minutes: Math.round(minutes * 0.3), ask_minutes: Math.round(minutes * 0.6), max_repeat_diff: 1, unsure_choices: ["cant"], max_unsure_share: 0.15, max_copied_reasons: 0.3 },
  };
  writeJson(join(dir, "items.json"), items);
  const g = guide(key.round, key.shape, n, part);
  writeFileSync(join(dir, "guide.md"), g);
  const template = readFileSync(join(TEMPLATES, "page.html"), "utf8");
  for (const v of VERSIONS) {
    const data = { format: FORMAT, package: key.package, version: v, shape: key.shape, prompt: q.prompt, choices: q.choices, note_prompt: NOTE, note_required: true, order: key.orders[v], screens: Object.fromEntries(key.orders[v].map((sid) => [sid, screens[sid]!])) };
    const page = template.replaceAll("{{TITLE}}", TITLE).replace("{{GUIDE}}", () => mdHtml(g)).replace("{{DATA}}", () => JSON.stringify(data).replaceAll("</", "<\\/").replaceAll("<!--", "<\\!--"));
    writeFileSync(join(dir, "labeller", PAGE + "-" + v + ".html"), page);
  }
  writeFileSync(join(dir, "message-to-labeller.txt"), message(key.round, n, part));
  if (first) writeJson(join(dir, "bounty.json"), bounty(key.batch, n, hours));
  writeFileSync(join(dir, "README.md"), readme(key, n, labelled, hours));
  writeJson(join(dir, ".meta.json"), { name: key.package, screens: n, questions: Object.values(screens).reduce((s, x) => s + x.questions.length, 0), shape: key.shape, price: SEAT_USD, funded: first ? 2 * SEAT_USD * (1 + FEE) : 0, codes: ["F1", "F2", "F3"], page: PAGE });
  for (const file of ["check_return.py", "privacy_check.py", ...(first ? ["host_pages.sh"] : [])]) copyFileSync(join(TEMPLATES, file), join(dir, file));
  const check = spawnSync("python3", [join(dir, "privacy_check.py"), dir], { encoding: "utf8" });
  if (check.error) rmFail("E_RM_POST_DESK", "python3 did not run the privacy check: " + check.error.message);
  const files = walk(dir).filter((p) => !p.endsWith("privacy-check.md") && !p.includes("/returns/"));
  const pass = check.status === 0;
  writeFileSync(join(dir, "privacy-check.md"), ["# Privacy check: " + key.package, "", "Run by gstack-evals rm-post " + (first ? "desk-package" : "labels-import") + " with privacy_check.py on the files in this folder.", "", "Result: " + (pass ? "BLOCKING HITS: 0." : "FAILED. Do not send any file from this folder until the package is rebuilt clean."), "", "## Raw output", "", "\x60\x60\x60", check.stdout.trim(), "\x60\x60\x60", "", "## File sha256 (first 16 hex)", "", ...files.map((p) => "- ./" + relative(dir, p) + " " + sha16(p)), ""].join("\n"));
  if (!pass) rmFail("E_RM_POST_DESK", key.package + " failed its privacy and blinding check; see " + join(dir, "privacy-check.md") + ":\n" + check.stdout.split("\n").filter((l) => /^  \S/.test(l) && !l.includes("bytes")).slice(0, 12).join("\n"));
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
  dir: string;
  key: DeskKey;
  screens: number;
  labelled: number;
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
    const reps: KeyScreen[] = shuffled(reviews).slice(0, Math.min(REPEATS, reviews.length)).map((r) => ({ sid: mint(), kind: "repeat", findings: r.findings, of: r.sid }));
    const base = [...reviews, ...att].map((s) => s.sid);
    key = {
      schema: KEY_SCHEMA, batch: o.batch, round: "first", shape, package: packageName(o.batch, "first"), desk: o.desk,
      screens: [...reviews, ...att, ...reps],
      auto_no: o.reviews.filter((r) => !r.findings.length).map((r) => ({ id: mint(), unit: r.unit, arm: r.arm, pool: r.pool })),
      orders: { A: withRepeats(shuffled(base), reps), B: withRepeats(shuffled(base), reps) },
    };
  }
  key.desk = o.desk;
  const { dir, screens } = render(key, materialOf(key, o.reviews));
  mkdirSync(peopleDir(o.post, o.batch), { recursive: true });
  writeJson(file, key);
  return { dir, key, screens, labelled: key.screens.filter((s) => s.kind === "review").length };
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
  if (!VERSIONS.includes(s.version)) return bad("names page " + JSON.stringify(s.version) + ", not A or B");
  if (typeof s.labeller !== "string" || !CODE.test(s.labeller)) return bad("has no labeller code");
  const problems: string[] = [];
  const order: string[] = key.orders[s.version as Version];
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

/** Two files from two different people, each complete; for adjudication, the first round's two people. */
export function readRound(files: ReadonlyArray<{ name: string; text: string }>, key: DeskKey): [LabelsFile, LabelsFile] {
  if (files.length !== 2) rmFail("E_RM_POST_LABELS", "pass exactly two labels files, one per person, not " + files.length);
  const read = files.map((x) => readLabelsFile(x.name, x.text, key));
  const problems = read.flatMap((r) => r.problems);
  const [a, b] = read.map((r) => r.file);
  if (a && b && a.labeller === b.labeller) problems.push("both files name labeller " + a.labeller + "; the check needs two different people");
  if (a && b && key.labellers && [a.labeller, b.labeller].sort().join(" ") !== [...key.labellers].sort().join(" ")) problems.push("the second part goes back to the same two people (" + [...key.labellers].sort().join(", ") + "), but these files name " + [a.labeller, b.labeller].sort().join(", "));
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

export interface ImportResult {
  reviews: number;
  agreed: number;
  disagreements: number;
  unresolved: number;
  /** True once final.json holds every review's label. */
  final: boolean;
  adjudication?: string;
}

const row = (s: KeyScreen, label: FinalLabel, cant: boolean): FinalRow => ({ id: s.sid, unit: s.unit!, arm: s.arm!, pool: s.pool!, label, ...(cant && label === false ? { cant_tell: true as const } : {}) });

/** Imports the first round. With no disagreement it writes final.json; otherwise it writes the second part's package. */
export function importFirst(o: { post: string; batch: string; files: ReadonlyArray<{ name: string; text: string }>; reviews: readonly BatchReview[] }): ImportResult {
  const file = keyPath(o.post, o.batch, "first");
  if (!existsSync(file)) rmFail("E_RM_POST_INPUT", "no packet key at " + file + "; run rm-post desk-package first");
  if (existsSync(join(peopleDir(o.post, o.batch), "adjudication.json"))) rmFail("E_RM_POST_INPUT", "the second part is already imported, so the first round is closed");
  const key = readJson<DeskKey>(file);
  const pair = readRound(o.files, key);
  writeJson(join(peopleDir(o.post, o.batch), "first.json"), pair);
  const reviews = key.screens.filter((s) => s.kind === "review");
  const read = reviews.map((s) => ({ s, r: pair.map((p) => readingOf(key.shape, p, s)) as [Reading, Reading] }));
  writeJson(join(peopleDir(o.post, o.batch), "readings-first.json"), read.map(({ s, r }) => ({ id: s.sid, [pair[0].labeller]: r[0], [pair[1].labeller]: r[1] })));
  const split = read.filter(({ r }) => r[0].names !== r[1].names);
  const total = reviews.length + key.auto_no.length;
  if (!split.length) {
    writeJson(finalPath(o.post), [...read.map(({ s, r }) => row(s, r[0].names, r[0].cant || r[1].cant)), ...key.auto_no.map((k) => ({ ...k, label: false }))]);
    return { reviews: total, agreed: total, disagreements: 0, unresolved: 0, final: true };
  }
  const taken = new Set(key.screens.map((s) => s.sid));
  const screens: KeyScreen[] = split.map(({ s, r }) => {
    const [x, y] = rand(2) ? [r[1], r[0]] : [r[0], r[1]];
    let sid: string;
    do sid = sidOf();
    while (taken.has(sid));
    taken.add(sid);
    return { ...s, sid, of: s.sid, readings: [x.text, y.text] };
  });
  const adj: DeskKey = { schema: KEY_SCHEMA, batch: key.batch, round: "adjudication", shape: key.shape, package: packageName(key.batch, "adjudication"), desk: key.desk, screens, auto_no: [], orders: { A: shuffled(screens.map((s) => s.sid)), B: shuffled(screens.map((s) => s.sid)) }, labellers: [pair[0].labeller, pair[1].labeller] };
  const blocks = materialOf(key, o.reviews);
  const { dir } = render(adj, new Map(screens.map((s) => [s.sid, blocks.get(s.of!)!])));
  writeJson(keyPath(o.post, o.batch, "adjudication"), adj);
  return { reviews: total, agreed: total - split.length, disagreements: split.length, unresolved: 0, final: false, adjudication: dir };
}

/** Imports the second part from the same two people and writes final.json. */
export function importAdjudication(o: { post: string; batch: string; files: ReadonlyArray<{ name: string; text: string }> }): ImportResult {
  const file = keyPath(o.post, o.batch, "adjudication");
  if (!existsSync(file)) rmFail("E_RM_POST_INPUT", "no second part is open for the " + o.batch + " batch; import the first round first");
  const key = readJson<DeskKey>(keyPath(o.post, o.batch, "first"));
  const adj = readJson<DeskKey>(file);
  const first = readJson<[LabelsFile, LabelsFile]>(join(peopleDir(o.post, o.batch), "first.json"));
  const pair = readRound(o.files, adj);
  writeJson(join(peopleDir(o.post, o.batch), "adjudication.json"), pair);
  const second = new Map(adj.screens.map((s) => [s.of!, s]));
  const final = key.screens.filter((s) => s.kind === "review").map((s) => {
    const again = second.get(s.sid);
    const r = again ? pair.map((p) => readingOf(adj.shape, p, again)) : first.map((p) => readingOf(key.shape, p, s));
    return row(s, r[0]!.names === r[1]!.names ? r[0]!.names : "unresolved", r[0]!.cant || r[1]!.cant);
  });
  writeJson(finalPath(o.post), [...final, ...key.auto_no.map((k) => ({ ...k, label: false }))]);
  const total = final.length + key.auto_no.length;
  return { reviews: total, agreed: total - adj.screens.length, disagreements: adj.screens.length, unresolved: final.filter((x) => x.label === "unresolved").length, final: true };
}
