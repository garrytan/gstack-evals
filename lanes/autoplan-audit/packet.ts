// Copyright (c) 2026 Garry Tan. MIT License.
// Section 6: the panel packet and its fail-closed outbound check. A packet is the frozen question, the built text (a
// merged public wiki post at the recorded main commit, restatement sections removed) and the change text cut to 120
// words. Names, thread codes, run ids, dates, gstack versions, model ids, git shas and sha256 digests, the tool names and
// the form markers are replaced by neutral tokens, one map per packet over both texts. A packet over 160,000 bytes is
// not sent. Before sending, the check rebuilds the packet from its allowed sources (any difference is unknown
// provenance) and scans it for a replaced token class, a 6-word run of owner words, a secret pattern, an email address
// or a withheld task id; any hit stops the run with E_AR_PACKET_LEAK. The same scan runs on the reply cache and on every
// aggregate export.
import { words } from "./diff.ts";
import { fail } from "./errors.ts";
import { PROMPT_TAIL, PROMPT_HEAD } from "./prompt.ts";

export const MAX_PACKET_BYTES = 160_000;
export const MAX_CHANGE_WORDS = 120;

export interface Identity {
  runIds: readonly string[];
  /** People's names (any the records name as a person). */
  names: readonly string[];
  /** Owner replies and gate replies, for the 6-word runs. */
  ownerText: readonly string[];
  withheldIds: readonly string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const literal = (xs: readonly string[]) => (xs.filter((x) => x.trim().length >= 3).length ? new RegExp("(?<![A-Za-z0-9])(?:" + [...xs].filter((x) => x.trim().length >= 3).sort((a, b) => b.length - a.length).map(esc).join("|") + ")(?![A-Za-z0-9])", "gi") : null);

/** The replaced token classes, longest-reaching first. */
export function classes(id: Identity): Array<[string, RegExp]> {
  const out: Array<[string, RegExp | null]> = [
    ["run id", literal(id.runIds)],
    ["thread id", /\bjam_[0-9A-Za-z]{8,}\b/g],
    ["model id", /\b(?:anthropic|openai|google|openrouter|particle-ai|deepseek|xai|moonshotai|qwen|zai|meta)\/[\w.:-]+|\b(?:claude|gpt|gemini|grok|kimi|glm|particle)-[\w.-]*\w|\b(?:Opus|Sonnet|Haiku|Fable)\s+\d+(?:\.\d+)?\b|\b(?:Astra|Argon|Luna|Terra)\b|\bSol\b(?=\s|,|\.|\))/gi],
    ["digest", /\b(?=[0-9a-fA-F]*[0-9])(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{7,64}\b/g],
    ["date", /\b20\d\d-[01]\d-[0-3]\d(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d+)?)?Z?)?\b/g],
    ["version", /\bv?\d+\.\d+\.\d+\.\d+\b/g],
    ["thread code", /\b[A-Za-z]{2,5}-\d{1,5}\b(?!\.\d)/g],
    ["name", literal(id.names)],
    ["tool", /\b(?:gstack|autoplan)\b/gi],
    ["form", /\blean run\b|\bfeature kind\b|\bfull kind\b|--full\b|--kind\b/gi],
  ];
  return out.filter((c): c is [string, RegExp] => c[1] !== null);
}

/** The neutral token for the n-th distinct string: zq and lower case letters only, so a token never adds a digit, a capital or a class match. */
export const token = (n: number): string => {
  let s = "";
  let k = n;
  do {
    s = String.fromCharCode(97 + (k % 26)) + s;
    k = Math.floor(k / 26) - 1;
  } while (k >= 0);
  return "zq" + s;
};

/** Replaces every token class in both texts with one map: the same string gets the same token everywhere. */
export function scrub(texts: readonly string[], id: Identity): { texts: string[]; replaced: number } {
  const map = new Map<string, string>();
  let replaced = 0;
  const out = texts.map((t) => {
    let s = t;
    for (const [, re] of classes(id)) {
      s = s.replace(new RegExp(re.source, re.flags), (m) => {
        replaced++;
        const key = m.toLowerCase();
        if (!map.has(key)) map.set(key, token(map.size));
        return map.get(key)!;
      });
    }
    return s;
  });
  return { texts: out, replaced };
}

export const cutWords = (t: string, n: number): string => {
  const w = t.split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(" ") : w.slice(0, n).join(" ");
};

export interface PacketSource {
  unit: string;
  commit: string;
  path: string;
  /** The built text as read from git (restatement sections removed); an ablated gold item passes its ablated text. */
  built: string;
  change: string;
}

export interface Packet {
  unit: string;
  commit: string;
  path: string;
  body: string;
  /** The scrubbed built text, for the quote check. */
  built: string;
  bytes: number;
}

export function buildPacket(src: PacketSource, id: Identity): Packet | null {
  const s = scrub([src.built, cutWords(src.change, MAX_CHANGE_WORDS)], id);
  const [built, change] = s.texts as [string, string];
  const body = PROMPT_HEAD + "\n\n<change>\n" + cutWords(change, MAX_CHANGE_WORDS) + "\n</change>\n\n<built_plan>\n" + built + "\n</built_plan>\n\n" + PROMPT_TAIL;
  const bytes = Buffer.byteLength(body);
  return bytes > MAX_PACKET_BYTES ? null : { unit: src.unit, commit: src.commit, path: src.path, body, built, bytes };
}

// ---- the scan ----

const SECRET_PREFIX = /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,})|-----BEGIN [A-Z ]*PRIVATE KEY/;
const BEARER = /\bbearer\s+[A-Za-z0-9._~+\/-]{16,}/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

export function entropy(s: string): number {
  const c = new Map<string, number>();
  for (const ch of s) c.set(ch, (c.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of c.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

export const highEntropy = (text: string): boolean => (text.match(/[A-Za-z0-9+\/_-]{32,}/g) ?? []).some((r) => /[A-Z]/.test(r) && /[a-z]/.test(r) && /[0-9]/.test(r) && entropy(r) >= 4.5);

export const sixGrams = (texts: readonly string[]): Set<string> => {
  const out = new Set<string>();
  for (const t of texts) {
    const w = words(t);
    for (let i = 0; i + 6 <= w.length; i++) out.add(w.slice(i, i + 6).join(" "));
  }
  return out;
};

/** The reasons a text may not leave the run; empty when it passes. Names a class, never the matched text. */
export function scan(text: string, id: Identity, owner: Set<string> = sixGrams(id.ownerText)): string[] {
  const out: string[] = [];
  for (const [name, re] of classes(id)) if (new RegExp(re.source, re.flags.replace("g", "")).test(text)) out.push("token class " + name);
  const w = words(text);
  for (let i = 0; i + 6 <= w.length; i++) if (owner.has(w.slice(i, i + 6).join(" "))) {
    out.push("a 6-word run of owner words");
    break;
  }
  if (SECRET_PREFIX.test(text) || BEARER.test(text)) out.push("a secret pattern");
  if (highEntropy(text)) out.push("a high-entropy string");
  if (EMAIL.test(text)) out.push("an email address");
  const held = id.withheldIds.filter((x) => x.trim());
  if (held.length && new RegExp("(?<![A-Za-z0-9])(?:" + held.map(esc).join("|") + ")(?![A-Za-z0-9])", "i").test(text)) out.push("a withheld task id");
  return out;
}

/** The outbound check for one packet: it must rebuild byte for byte from its allowed sources, and the frame text around the two parts must scan clean. Throws E_AR_PACKET_LEAK. */
export function outbound(p: Packet, rebuild: () => PacketSource | null, id: Identity, owner?: Set<string>): void {
  const src = rebuild();
  const again = src ? buildPacket(src, id) : null;
  if (!again || again.body !== p.body || src!.commit !== p.commit || src!.path !== p.path) fail("E_AR_PACKET_LEAK", "a packet has a part with no allowed source (unit " + p.unit.length + " chars); nothing was sent");
  const reasons = scan(p.body, id, owner);
  if (reasons.length) fail("E_AR_PACKET_LEAK", "a packet holds " + reasons.join(", ") + "; nothing was sent");
}

/** The scan on a reply cache file or an aggregate export before it leaves the sink. */
export function exportCheck(text: string, id: Identity, what: string, owner?: Set<string>): void {
  const reasons = scan(text, id, owner);
  if (reasons.length) fail("E_AR_PACKET_LEAK", what + " holds " + reasons.join(", ") + "; it stays in the sink");
}
