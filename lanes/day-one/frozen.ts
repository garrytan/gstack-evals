// Copyright (c) 2026 Garry Tan. MIT License.
// The day-one usefulness eval's frozen values (prereg wiki/plans/2026-11-17-geva-546-day-one-usefulness-prereg). Every
// string here appears byte for byte in the prereg, and tests/day-one/frozen.test.ts checks each one against it.
//
// - Arms: n writes the base plan from the brief; d and the gstack arms review that same base plan. Every planning arm
//   gets the same owner notice and the same owner channel. The builder and the checker get no channel.
// - The gstack arms run /autoplan --full on gstack at their pins, unattended (as the factory runs it), with GPT-6 Astra
//   as autoplan's second voice through the Codex CLI on its own proxy slot (C2). GSTACK_CODEX_NO_SANDBOX=1 is set in
//   their sessions only, because Codex's own sandbox cannot start inside the trial container (no bubblewrap, no user
//   namespaces) and the container is the sandbox.
// - Models: planners and the builder run on Claude Opus 5.5; the checker on GPT-6.1 Sol in Claude Code; the owner
//   responder on GPT-6.1 Sol; the plan judge on GPT-6 Astra.
import { createHash } from "node:crypto";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** The prereg this lane implements, relative to the repository root. */
export const PREREG = "wiki/plans/2026-11-17-geva-546-day-one-usefulness-prereg/README.md";

/** Every seeded draw, shuffle and bootstrap. */
export const SEED = 20261117;
export const DRAWS = 10_000;

/** The arm texts, frozen before any owner reaction was read (draft sha256 67ecf231...). */
export const COMMON_ASK = "The brief is in brief.md. Write a plan for this brief in plan.md.";
export const REVIEW_ASK = "Review the plan in plan.md for the brief in brief.md and improve it.";
export const DAY_ONE_PASS =
  "Before you finish, do a day-one product pass. Picture the owner opening what you plan for the first time. Name the first five things they will try to do on day one, in the order they will try them. For each one, check that your plan makes it work on day one, from the first screen to the result, with nothing missing, hidden or left for later, and change the plan wherever one would not work.";
export const AUTOPLAN_LINE = "/autoplan --full plan.md";
export const OWNER_NOTICE = "The owner is available to answer questions while you plan.";

/** The planning arms. n writes the base plan; the rest review it. */
export const PLAN_ARMS = ["n", "d", "a", "s-full", "s-dayone"] as const;
export type PlanArm = (typeof PLAN_ARMS)[number];
export const REVIEW_ARMS: readonly PlanArm[] = ["d", "a", "s-full", "s-dayone"];
export const GSTACK_ARMS: readonly PlanArm[] = ["a", "s-full", "s-dayone"];

/** Each planning arm's whole first message. */
export function armPrompt(arm: PlanArm): string {
  if (arm === "n") return COMMON_ASK + "\n\n" + OWNER_NOTICE;
  if (arm === "d") return REVIEW_ASK + "\n\n" + DAY_ONE_PASS + "\n\n" + OWNER_NOTICE;
  return AUTOPLAN_LINE + "\n\n" + REVIEW_ASK + "\n\n" + OWNER_NOTICE;
}

/** The platform paragraph appended to every category 2 brief, after a blank line; planners and the builder see it. */
export const PLATFORM =
  "Platform: version 1 is a web app the owner opens in a browser on their own computer. It runs on Node 24 with only its standard library and plain browser HTML, CSS and JavaScript, with no package installs and no outside services, accounts or keys. ./start.sh starts it, serving on the port in the PORT environment variable.";

/** The builder's first message, the same for every arm. */
export const BUILD_PROMPT =
  "Build version 1 of the app that the plan in plan.md describes, in this directory. " +
  "Follow the plan; where it leaves a choice open, choose what serves the owner. " +
  "Use Node 24 (node is on your PATH) with only its standard library and plain browser HTML, CSS and JavaScript: no package installs, no outside services, accounts or keys. " +
  "When you finish, ./start.sh must start the app from this directory and serve it on the port in the PORT environment variable, and anything the app saves must live under this directory. " +
  "Start it and try it yourself before you finish. Nobody will answer questions, so make your own choices.";

/** The checker's first message: the frozen header, then one block per task, then the frozen footer. */
export const CHECK_HEADER =
  "You are checking version 1 of a web app the way its owner would use it the first time. The app is running at http://localhost:3000 in the browser your tools control, and the browser is the only thing you can use. " +
  "Work through the owner's tasks below one at a time, in order, without skipping any. For each task, try to do it as the owner would, through the app's own pages: look at the page, click, type, choose, upload, reload, open a second tab. " +
  "Only use what the app shows or tells you; never guess a hidden address. Files the owner brings are in /samples/; upload them with the file upload tool when a task needs one. " +
  "A task is done only when you saw its success condition yourself in the browser. If you cannot find a way to do it within 25 browser actions, it is not done. Later tasks may use what earlier ones created.";
export const CHECK_FOOTER =
  'When you have tried every task, end your reply with one fenced block labelled verdicts that holds a JSON object {"tasks": [{"id": "t1", "done": true, "why": "at most 30 words on what you saw"}, ...]} with every task id exactly once. Only this block is scored.';
export const VERDICT_FENCE = "verdicts";

/** The owner responder (H1): the profile, then these rules; usersim's persona prompt wraps the whole text per question. */
export const OWNER_RULES =
  "Rules for your answers: answer only what was asked, and only from what you wrote above about yourself. If that doesn't cover the question, say \"I don't know.\" " +
  "When the question offers options, pick the one your own words above support; if they don't decide it, pick the option marked recommended, and if none is marked, say \"I don't know, use your judgment.\" " +
  "Never offer features, tasks or wishes you weren't asked about. " +
  "After your answer, on a last line of its own, write SOURCE: profile, SOURCE: recommended or SOURCE: unknown, for where your answer came from. That line is removed before the assistant sees your reply.";
export const OWNER_HEAD = "You are the owner of the project the assistant is planning. In your own words, this is you:";
/** Sent instead of the responder's answer once a session has had OWNER_REPLIES answers; the reply to it ends the session. */
export const OWNER_CLOSING = "I need to stop answering questions now. Please finish the plan with what you have.";
export const OWNER_REPLIES = 30;

/** The session limits per stage: minutes, agent turns per user message, and the allowance in dollars per slot. */
export const LIMITS = {
  n: { minutes: 40, turns: 150, usd: 6 },
  d: { minutes: 40, turns: 150, usd: 6 },
  gstack: { minutes: 180, turns: 600, usd: 60, voice_usd: 15 },
  build: { minutes: 120, turns: 600, usd: 15 },
  check: { minutes: 60, turns: 400, usd: 8 },
  owner: { usd: 1 },
} as const;

/** The models, by the policy keys the rig routes. */
export const MODELS = {
  planner: "claude-opus-5-5",
  builder: "claude-opus-5-5",
  checker: "openai/gpt-6.1-sol",
  voice: "gpt-6-astra",
  owner: "sol",
  judge: "astra",
} as const;

/** Every session: the claude-code-preset system prompt and a 200,000-token window. */
export const SYSTEM_PROMPT = "claude-code-preset" as const;

/** The gstack arms' pins. s-full and s-dayone pin commits on the strengthened branch when it lands. */
export const GSTACK_PINS: Readonly<Record<"a" | "s-full" | "s-dayone", { repo: string; sha: string | null; version: string | null }>> = {
  a: { repo: "garrytan/gstack", sha: "5b4fa9ea335e3ba743a36e3269da95980b77b32d", version: "1.99.5.0" },
  "s-full": { repo: "garrytan/gstack", sha: null, version: null },
  "s-dayone": { repo: "garrytan/gstack", sha: null, version: null },
};

/** The app and browser container: Playwright's MCP server image, pinned by digest, serving MCP over HTTP. */
export const BROWSER_IMAGE = "mcr.microsoft.com/playwright/mcp@sha256:8ca417ff2a3660b770d7dd4a293bd179d0f3c29d0d5fb5bc43d3be617b1566a2";
export const APP_PORT = 3000;
export const MCP_PORT = 8931;
/** Seconds the app gets to answer on its port after ./start.sh before the build counts as not starting. */
export const APP_START_S = 60;

/** The sealed unit sets (custody day-one-geva546: cat2-frozen-r1 and cat1-frozen-r1): labels minted from random bytes,
 *  and each split's units digest (units.ts unitsDigest, pv's rule over every file). A stage or judge run refuses a units
 *  dir whose split does not read back its digest. */
export const UNIT_SETS = {
  set: { labels: ["2y3gmr5w", "5ot0udw1", "5v114qvs", "5znd40o7", "8yulj3nw", "ac4e9kq5", "bws1no38", "bxiyw7sv", "i4w8io8d", "j3ss8n04", "p3u7o8nk", "pdq7hbat", "t7g3hawp", "u2pg3s93", "xd8xqv6n"], digest: "315da04405dd98fceb1013b7a5942feaf065177d5964945a1f2422d0aa57c162", files: 51 },
  spares: { labels: ["8zv6x4we", "jdjoa4ho", "zq2o9q72"], digest: "a2911e35586de29ffc62abfe8a963391e32bf2238b3d809dabc0b9b6d06d37cc", files: 10 },
  practice: { labels: ["jvbqmveo", "rxnfgh2s", "zt06iguz"], digest: "32bd8f8065df1f0d61dfa6d813d79476dc51677d3236b774c6788c4ebaab743f", files: 10 },
  cat1: { labels: ["pjdddo7s", "qzjwfkdk"], digest: "9b73dedb3b37d6dca3cc401f4601db23bd4cd302009aca01968c7aa50db89225", files: 1855 },
} as const;
export type UnitSet = keyof typeof UNIT_SETS;

export const PROMPTS_SHA256 = sha256(JSON.stringify([COMMON_ASK, REVIEW_ASK, DAY_ONE_PASS, AUTOPLAN_LINE, OWNER_NOTICE, PLATFORM, BUILD_PROMPT, CHECK_HEADER, CHECK_FOOTER, OWNER_HEAD, OWNER_RULES, OWNER_CLOSING]));
