// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's cross-cutting frozen values (prereg wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg).
// Every string here appears byte for byte in the prereg; tests/of/frozen.test.ts reads the prereg and checks each one.
// Module-specific frozen text (the simulator's prompt, the author prompts, the stock rows) lives in its own module and is
// checked the same way.
import { createHash } from "node:crypto";
import type { ArmId, ModelId } from "./types.ts";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** The prereg this lane implements, relative to the repository root. */
export const PREREG = "wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg/README.md";

/** Every seeded draw, bootstrap and sign-flip in the eval. */
export const SEED = 20261109;
export const DRAWS = 10_000;

/** Section 5: each arm's first line. */
export const FIRST_LINE: Readonly<Record<ArmId, string>> = {
  none: "Help me think through this startup idea.",
  lens: "Hold a YC office-hours session with me. Help me think through this startup idea.",
  "office-hours": "/office-hours Help me think through this startup idea.",
};

/** Section 10, smoke rule 4: the forced sentence, worded for an interactive arm; it replaces the office-hours first line after a parse or exposure failure. */
export const FORCED_LINE = "/office-hours Run its whole procedure, taking your recommended option at every decision. Help me think through this startup idea.";

/** Section 6's template, byte for byte. */
export const TEMPLATE = 'When you give your final advice, end that reply with one fenced block labelled first-move holding a JSON object with four fields. "first_move": the one thing this founder should build or sell first, and to whom, in at most 40 words. "next_action": one concrete thing the founder should do in the next seven days, in at most 30 words. "other_moves": at most two other first moves you weighed, each in at most 25 words. "doubt": the part of the founder\'s current plan you trust least, in at most 25 words. Write the block once, in your final reply. The conversation ends when you write it.';
export const TEMPLATE_SHA256 = sha256(TEMPLATE);

/** Section 5: sent instead of the simulator's reply after the 20th founder reply (and as the first founder reply in the pitch-only cell). */
export const CLOSING = "I need to stop here. Please give me your final advice now, ending with the first-move block I asked for at the start.";

/** Section 3 step 3: the frozen line the validator calls add after the template. */
export const ANSWER_NOW = "Answer now, in this one reply, with your best first move; don't ask me anything.";

/** Section 8: the full-information reference's header before the facts. */
export const EVERYTHING_ELSE = "Here is everything else I know:";

/** The fence label the template names. */
export const FENCE = "first-move";

/** Section 6's word cuts. */
export const CUTS = { first_move: 40, next_action: 30, other_move: 25, doubt: 25 } as const;
export const MAX_OTHER_MOVES = 2;

/** Section 5's limits. FOUNDER_REPLIES_REPAIRED is smoke rule 4's limit repair, for every arm. */
export const FOUNDER_REPLIES = 20;
export const FOUNDER_REPLIES_REPAIRED = 30;
/** The pitch-only cell's founder-reply limit (the Captain's AN-1 ruling): the closing message is the first founder reply. */
export const PITCH_FOUNDER_REPLIES = 0;
export const AGENT_TURNS_PER_REPLY = 60;
export const SESSION_MINUTES = 120;
/** Every session: a 200,000-token window and these tools denied (section 5). */
export const DENIED_TOOLS = ["WebSearch", "WebFetch", "AskUserQuestion"] as const;
export const SYSTEM_PROMPT = "claude-code-preset" as const;

/** Section 5: the office-hours arm's gstack, pinned whole. No pin moves once the prereg merged. */
export const GSTACK = { repo: "garrytan/gstack", sha: "b6155921a564ba9ec2470fd2cb3894c05e2c2d13", version: "1.98.0.0" } as const;

/** The models under test by their policy keys (R54), as the product-value eval names them. */
export const MODEL_KEYS: Readonly<Record<ModelId, string>> = { opus: "claude-opus-5-5", sol: "openai/gpt-6.1-sol", particle: "particle-ai/particle-1" };
export const MODELS: readonly ModelId[] = ["opus", "sol", "particle"];
export const ARMS: readonly ArmId[] = ["none", "lens", "office-hours"];

/** Section 13: session allowances in dollars until the smoke measures them. */
export const PRE_SMOKE_ALLOWANCE: Readonly<Record<ArmId, Readonly<Record<ModelId, number>>>> = {
  none: { opus: 3, sol: 2, particle: 1 },
  lens: { opus: 3, sol: 2, particle: 1 },
  "office-hours": { opus: 15, sol: 10, particle: 3 },
};
export const PRE_SMOKE_SIM_ALLOWANCE = 2;

/** Section 3's quotas. */
export const QUOTA = { calibration: 16, twins: 8, comparison: 64, reserve: 6, pilot: 4 } as const;

/** The first user message of every arm session (section 5): the arm's first line, a blank line, opening.md, a blank line and the template. */
export const firstMessage = (line: string, opening: string): string => line + "\n\n" + opening.trim() + "\n\n" + TEMPLATE;

/**
 * The full-information prompt (section 8, and section 3 step 3 with answerNow): the none arm's first line, opening.md,
 * the header and every fact in the given (seeded) order, one per line, then the template. Fact ids never appear.
 */
export const fullInformation = (opening: string, facts: readonly string[], answerNow: boolean): string =>
  FIRST_LINE.none + "\n\n" + opening.trim() + "\n\n" + EVERYTHING_ELSE + "\n" + facts.map((f) => "- " + f.trim()).join("\n") + "\n\n" + TEMPLATE + (answerNow ? "\n" + ANSWER_NOW : "");

/** Section 3 step 4's give-away prompt: the none arm's first line, opening.md and the template, with the frozen line. */
export const pitchOnly = (opening: string): string => firstMessage(FIRST_LINE.none, opening) + "\n" + ANSWER_NOW;

/** Section 8's three stock rows, judged in every packet as if they were sessions. Rows 1 and 2 also run the generic screen; row 3 never screens. */
export const STOCK_ROWS: readonly { row: 1 | 2 | 3; block: { first_move: string; next_action: string; other_moves: string[]; doubt: string } }[] = [
  { row: 1, block: { first_move: "Build a simple version of the core product and offer it free to small businesses in your market to get early users and feedback.", next_action: "Launch a landing page and share it in online communities where your target users spend time.", other_moves: ["Raise a small pre-seed round to build the full platform.", "Partner with an established company in your industry."], doubt: "Whether the market is big enough to support a venture-scale company." } },
  { row: 2, block: { first_move: "Interview twenty potential customers to validate the problem, then build a minimum viable product for the segment with the most pain.", next_action: "Book ten customer discovery calls this week through your network and LinkedIn.", other_moves: ["Run a smoke test with ads to measure demand.", "Build a no-code prototype and test it with five users."], doubt: "Whether customers will actually pay for it." } },
  { row: 3, block: { first_move: "Find the one person who needs this most and sell them the narrowest version you could ship in days, for real money, this week.", next_action: "Watch one real user try it without helping them, and write down what surprised you.", other_moves: ["Get a paid commitment before building anything else.", "Drop the platform and do the job by hand for your first customer."], doubt: "That the interest and praise you have heard are not yet demand." } },
];

