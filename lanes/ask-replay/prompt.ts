// Copyright (c) 2026 Garry Tan. MIT License.
// The arm prompts (prereg section 3), in one frozen component order: harness, arm text, capability block, standing
// rules, conversation (each message with its date and time), ledger view (arms c and d only), draft. The harness,
// arm text and capability block are the system text, the same for every item of an arm, so it is the cached prefix;
// the rest is the user message. Arm a is the harness and the item. Arm b adds three whole gstack files read with git show
// at the frozen commit, each checked against frozen.json's sha256 (E_ASK_PIN). Arm c is b plus the ledger parts: the
// rule-11 addendum line, the two reply fields and the ledger view. Arm d is a plus exactly those parts. No prompt holds
// a label, an item id, a thread code or after_reply.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fail, FROZEN } from "./frozen.ts";
import { ledgerView } from "./ledger.ts";
import type { Arm, AskItem, Message } from "./types.ts";

export const HARNESS = [
  "You are a coordinating agent. You work for one owner and run several pieces of work for them at once. You message the owner when you need something only they can give. Every message you send takes the owner time to read and answer.",
  "",
  "Below is your conversation with the owner in one thread, up to this moment, the owner's standing rules, and an ask you drafted and are about to send. Decide what to do with the draft. You have three choices:",
  "",
  "- SEND: send the ask to the owner now.",
  '- FOLD: do not send it now. Carry it as one line under "Waiting on you" in your next digest, which reaches the owner at the next scheduled digest.',
  "- DROP: do not ask. Carry on with your work.",
  "",
  'Reply with one JSON object and nothing else: {"action": "SEND" or "FOLD" or "DROP", "reason": "at most 40 words"}.',
].join("\n");

export const CAPABILITY = [
  "## What you can check yourself",
  "",
  "Without asking the owner, you can read the repositories you work in, their branches, pull requests, CI checks and review comments; the issue tracker; your own threads, notes and earlier messages; and the files on your machines. You can run commands on your machines and read what they print. You cannot see the owner's private accounts, inbox or devices, and you cannot spend above a cap the owner set.",
].join("\n");

export const LEDGER_ADDENDUM = FROZEN.ledger.addendum;

export const LEDGER_FIELDS = 'Your JSON object also carries two more fields: "repeats", the id of the ledger row this ask repeats, or "new"; and "reask_reason", what has changed since that row was answered when you are asking it again, or an empty string.';

export type ComponentName = "harness" | "arm" | "capability" | "rules" | "conversation" | "ledger" | "draft";
export const ORDER: readonly ComponentName[] = ["harness", "arm", "capability", "rules", "conversation", "ledger", "draft"];

export interface Component {
  name: ComponentName;
  text: string;
}

export interface BuiltPrompt {
  system: string;
  user: string;
  components: Component[];
}

export interface GstackText {
  commit: string;
  text: string;
}

/** The three gstack files at the frozen commit, read with git show from a clone and checked by sha256. */
export function loadGstack(clone: string, g: { commit: string; files: ReadonlyArray<{ path: string; sha256: string }> } = FROZEN.gstack): GstackText {
  const parts: string[] = [];
  for (const f of g.files) {
    const r = spawnSync("git", ["-C", clone, "show", g.commit + ":" + f.path], { encoding: "buffer", maxBuffer: 1 << 24 });
    if (r.status !== 0) fail("E_ASK_PIN", "git show " + g.commit.slice(0, 12) + ":" + f.path + " failed in " + clone + " (exit " + r.status + ")");
    const actual = createHash("sha256").update(r.stdout).digest("hex");
    if (actual !== f.sha256) fail("E_ASK_PIN", f.path + " at " + g.commit.slice(0, 12) + " has sha256 " + actual + ", expected " + f.sha256);
    parts.push("# " + f.path + "\n\n" + r.stdout.toString("utf8").trimEnd());
  }
  return { commit: g.commit, text: parts.join("\n\n") };
}

/** "2026-10-12 14:03 UTC" */
export const stamp = (iso: string): string => new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";

const SPEAKER: Record<Message["from"], string> = { agent: "You", owner: "Owner", crew: "Crew report" };

function conversationText(item: AskItem): string {
  return [
    "## Your conversation with the owner in this thread, oldest first",
    "",
    ...(item.cut ? [FROZEN.window.cut_note, ""] : []),
    ...(item.conversation.length ? item.conversation.map((m) => "[" + stamp(m.at) + "] " + SPEAKER[m.from] + ": " + m.text) : ["(no earlier messages)"]),
  ].join("\n");
}

function rulesText(item: AskItem): string {
  return ["## The owner's standing rules in force on " + item.at.slice(0, 10), "", ...(item.rules.length ? item.rules.map((r) => "- " + r.text) : ["- none recorded"])].join("\n");
}

const hasGstack = (arm: Arm) => arm === "b" || arm === "c";
const hasLedger = (arm: Arm) => arm === "c" || arm === "d";

/** The arm text: gstack's three files in b and c, then the ledger addendum in c and d; null in a. */
export function armText(arm: Arm, gstack: GstackText | null): string | null {
  if (hasGstack(arm) && !gstack) return fail("E_ASK_PIN", "arm " + arm + " needs the pinned gstack files");
  const parts = [...(hasGstack(arm) ? [gstack!.text] : []), ...(hasLedger(arm) ? [LEDGER_ADDENDUM] : [])];
  return parts.length ? parts.join("\n\n") : null;
}

/** The components of one arm's prompt for one item, in the frozen order, with absent ones left out. */
export function components(item: AskItem, arm: Arm, gstack: GstackText | null): Component[] {
  const arms = armText(arm, gstack);
  const out: Component[] = [{ name: "harness", text: HARNESS }];
  if (arms !== null) out.push({ name: "arm", text: arms });
  out.push({ name: "capability", text: CAPABILITY }, { name: "rules", text: rulesText(item) }, { name: "conversation", text: conversationText(item) });
  if (hasLedger(arm)) out.push({ name: "ledger", text: ["## Ask ledger at " + stamp(item.at), "", LEDGER_FIELDS, "", ledgerView(item)].join("\n") });
  out.push({ name: "draft", text: ["## The ask you are about to send, drafted at " + stamp(item.at), "", item.draft].join("\n") });
  return out;
}

export function buildPrompt(item: AskItem, arm: Arm, gstack: GstackText | null): BuiltPrompt {
  const parts = components(item, arm, gstack);
  const join = (names: ComponentName[]) => parts.filter((p) => names.includes(p.name)).map((p) => p.text).join("\n\n");
  return { system: join(["harness", "arm", "capability"]), user: join(["rules", "conversation", "ledger", "draft"]), components: parts };
}

/** The reply schema sent in JSON schema mode: every field required, as strict mode asks. */
export function replySchema(arm: Arm): Record<string, unknown> {
  const props: Record<string, unknown> = { action: { type: "string", enum: ["SEND", "FOLD", "DROP"] }, reason: { type: "string" } };
  if (hasLedger(arm)) Object.assign(props, { repeats: { type: "string" }, reask_reason: { type: "string" } });
  return { type: "object", properties: props, required: Object.keys(props), additionalProperties: false };
}

/** Lines of 40 or more characters from the gstack text that appear in text: the arm cleanliness check. */
export function gstackLines(text: string, gstack: GstackText): number {
  const lines = new Set(gstack.text.split("\n").map((l) => l.trim()).filter((l) => l.length >= 40));
  return text.split("\n").filter((l) => lines.has(l.trim())).length;
}
