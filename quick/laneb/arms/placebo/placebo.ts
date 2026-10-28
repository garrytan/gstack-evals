// Seeded placebo generator for gstack's installed Claude Code skills.
//
// For each skill folder it keeps SKILL.md's YAML frontmatter byte for byte
// except for the hooks key, which it removes (the hooks point at gstack
// scripts this arm does not ship), keeps the router's routing section byte for
// byte, and replaces the rest of the body with descriptive prose built from the
// skill's own name and description. The prose is sized to the original body's o200k_base token
// count. Nothing here reads a clock or Math.random, so one seed and one input
// tree always give the same bytes.

import { createHash } from "node:crypto";
import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

export const DEFAULT_SEED = "gstack-evals/laneb/placebo/v1";

// The router skill's routing text, kept verbatim: from this heading line to the
// end of SKILL.md. Setup installs the router twice, as the gstack checkout's own
// SKILL.md (folder "gstack") and as an alias (folder "_gstack-command").
export const ROUTING_HEADING = "## Route first";
export const ROUTER_FOLDERS = ["gstack", "_gstack-command"];

const encoder = new Tiktoken(o200k_base);
export const countTokens = (text: string): number => encoder.encode(text, [], []).length;

export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

export type SkillParts = { frontmatter: string; body: string };

// Frontmatter is everything from the opening "---" line through the closing
// "---" line and its newline. The body is the rest of the file.
export function splitSkill(text: string): SkillParts {
  if (!text.startsWith("---\n")) throw new Error("SKILL.md does not start with a --- frontmatter line");
  const close = text.indexOf("\n---\n", 3);
  if (close < 0) throw new Error("SKILL.md frontmatter has no closing --- line");
  const end = close + "\n---\n".length;
  return { frontmatter: text.slice(0, end), body: text.slice(end) };
}

// The routing section of a router body: the ROUTING_HEADING line to the end.
export function routingSection(body: string): string | null {
  if (body.startsWith(ROUTING_HEADING + "\n")) return body;
  const at = body.indexOf("\n" + ROUTING_HEADING + "\n");
  return at < 0 ? null : body.slice(at + 1);
}

// The frontmatter with its top-level hooks key removed: the "hooks:" line and
// every indented line under it. Blank lines inside the block go with it; a
// blank line before the next top-level line stays. Every other byte is kept.
export function stripHooks(frontmatter: string): string {
  const lines = frontmatter.split("\n");
  const start = lines.findIndex((l) => /^hooks:(\s|$)/.test(l));
  if (start < 0) return frontmatter;
  const indented = (l: string | undefined) => l !== undefined && /^[ \t]/.test(l);
  let end = start + 1;
  while (end < lines.length) {
    if (indented(lines[end])) end++;
    else if (lines[end] === "" && indented(lines.slice(end).find((l) => l !== ""))) end++;
    else break;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

export function frontmatterFields(frontmatter: string): { name: string; description: string } {
  const data = Bun.YAML.parse(frontmatter.slice(4, -4)) as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name : "";
  const description = typeof data.description === "string" ? data.description : "";
  if (!name) throw new Error("frontmatter has no name");
  return { name, description };
}

// sfc32, seeded from sha256(seed, skill folder). Each skill gets its own
// stream, so output does not depend on the order skills are processed in.
export function prng(seed: string, key: string): () => number {
  const h = createHash("sha256").update(seed).update("\0").update(key).digest();
  let a = h.readUInt32LE(0), b = h.readUInt32LE(4), c = h.readUInt32LE(8), d = h.readUInt32LE(12);
  const next = () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 16; i++) next();
  return next;
}

const STOPWORDS = new Set(
  ("a an and are as at be been but by for from has have in into is it its of on or that the their them then this " +
    "to was were which while with without your you our we all any each every one two three four five six also " +
    "than so such not no only own same other more most very can will just about over under again further once " +
    "here there when where why how what who whom both few some nor too out off up down before after above below " +
    "between through during like via per vs etc they whether onto against using still exist whose already " +
    "earlier never always should must may might could would").split(" "),
);

// Lowercased words that read as instructions or name a command; they end a
// phrase and never become part of a topic term.
const BLOCKED = new Set(
  ("add allow allowing animate apply ask bake baked bring bump call capture check clear click codify collect " +
    "commit configure create decide detect do drive enter execute find fix fixes generate generates go import " +
    "improve initialize install invoke iterate keep keeps launch let make manage merge merges open proposes pull " +
    "push read reads refresh register regenerate relays remove report reproduce researches restore restrict " +
    "run runs save send sends set start stop take turn understands update use write " +
    "git gh npm npx bun bunx curl wget docker pip python node bash sh sudo apt").split(" "),
);

// Case-sensitive: Claude Code tool names and file names.
const BLOCKED_EXACT = new Set(
  ("Bash Read Write Edit MultiEdit Grep Glob WebSearch WebFetch AskUserQuestion Skill Task Agent NotebookEdit " +
    "TodoWrite VERSION CHANGELOG README TODOS CLAUDE AGENTS").split(" "),
);

// Topic terms: the skill's name as a label, plus the phrases of its
// description, where a phrase is a run of up to three content words with no
// punctuation, stopword or blocked word between them. Tokens that look like
// paths, commands, flags or code end a phrase and are dropped.
export function topicTerms(name: string, description: string): string[] {
  const terms: string[] = [];
  const add = (t: string) => {
    if (t && !terms.includes(t)) terms.push(t);
  };
  add(name.replace(/^_+/, "").split(/[-_]+/).filter(Boolean).join(" "));
  const raw = description.replace(/\(gstack\)/g, " ").split(/\s+/).filter(Boolean);
  let run: string[] = [];
  const flush = () => {
    if (run.length) add(run.join(" "));
    run = [];
  };
  raw.forEach((token, i) => {
    if (/^[(\["']/.test(token)) flush();
    const word = token.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    const lower = word.toLowerCase();
    const bad =
      /[\/\\~`$=#@<>{}\[\]|*+\d]/.test(token) ||
      /\.[A-Za-z]/.test(token) ||
      !word ||
      /[^A-Za-z'-]/.test(word) ||
      word.length < 2 ||
      STOPWORDS.has(lower) ||
      BLOCKED.has(lower) ||
      BLOCKED_EXACT.has(word);
    if (bad) return flush();
    const properNoun = i > 0 && /^[A-Z]/.test(word) && !/[.:!?]$/.test(raw[i - 1]!);
    run.push(/[A-Z]/.test(word.slice(1)) || properNoun ? word : lower);
    if (run.length === 3 || /[,.;:!?)\]"']$/.test(token)) flush();
  });
  flush();
  return terms;
}

// Declarative sentence templates: definition, history, comparison and
// commentary. None starts with a slot, so no sentence starts with a topic word.
const TEMPLATES = [
  "The idea of {a} has a long history in software work.",
  "In most accounts, {a} is described as closely tied to {b}.",
  "Writers on engineering practice have often treated {a} and {b} as parts of one larger subject.",
  "The word {a} has carried slightly different meanings from one team to the next.",
  "Over the years, discussions of {a} have moved from informal notes to a more settled vocabulary.",
  "Much of what is written about {a} concerns its relation to {b} and {c}.",
  "A common definition places {a} somewhere between {b} and everyday routine.",
  "Historically, {a} was a concern of small teams before it became a general topic.",
  "The literature on {a} is uneven, with periods of close attention and periods of neglect.",
  "Among practitioners, {a} is usually understood as a matter of judgment as much as of rules.",
  "Early descriptions of {a} were brief and focused on {b}.",
  "Later descriptions of {a} gave more room to {b} and to the people involved.",
  "Some observers have argued that {a} is less a single activity than a family of related habits.",
  "Others have seen {a} as a fairly stable idea whose details change with tools and fashion.",
  "The relationship between {a} and {b} has been described in many different ways.",
  "In this sense, {a} belongs to the broader history of how software is made and maintained.",
  "There is no single agreed origin for the term {a}.",
  "Accounts from different decades describe {a} with noticeably different emphasis.",
  "For many teams, {a} was once an occasional concern and later a regular one.",
  "The vocabulary around {a} overlaps with the vocabulary around {b}.",
  "Textbooks that mention {a} tend to place it near {b} in their tables of contents.",
  "Interest in {a} has risen and fallen along with interest in {b}.",
  "Critics of {a} have pointed to cases where attention to it crowded out other work.",
  "Supporters of {a} have pointed to cases where its neglect proved costly.",
  "The study of {a} draws on ideas from {b}, {c} and general engineering practice.",
  "Definitions of {a} usually mention {b}, though the weight given to it varies.",
  "It is often said that {a} is easier to recognize than to define.",
  "Stories about {a} tend to feature {b} as a recurring theme.",
  "Much of the folklore about {a} grew up around {b}.",
  "The modern sense of {a} took shape gradually rather than at one moment.",
  "Different communities have used {a} as a label for overlapping practices.",
  "As a concept, {a} sits close to {b} but is not the same thing.",
  "Discussions of {a} frequently return to the question of scope.",
  "Historians of computing have noted the persistence of {a} as a topic.",
  "The meaning of {a} in a large organization differs from its meaning in a small one.",
  "Within a given project, {a} tends to reflect the habits of the people around it.",
  "Questions about {a} were once settled informally and are now often written down.",
  "Several older essays describe {a} mainly in terms of {b}.",
  "Newer essays describe {a} more often in terms of {c}.",
  "The connection between {a} and quality has been a frequent subject of comment.",
  "Some of the earliest written references to {a} appear in discussions of {b}.",
  "It has been observed that {a} and {b} rarely appear in isolation.",
  "Broadly speaking, {a} is a descriptive term rather than a precise one.",
  "Not every team that speaks of {a} means the same thing by it.",
  "The term {a} is sometimes used loosely to cover {b} as well.",
  "A good deal of the commentary on {a} was written by people who also wrote about {b}.",
  "The place of {a} in the wider culture of programming has shifted more than once.",
  "Many case studies mention {a} only in passing, as part of a story about {b}.",
  "This topic has been described as part craft, part habit and part theory.",
  "Such descriptions tend to say more about attitudes than about methods.",
  "These remarks are typical of the general writing on the subject.",
  "Opinions on these points have varied widely.",
  "The same pattern appears in many unrelated projects.",
  "Little of this was new even when it was first written down.",
];

// Short sentences used to land on the token target, shortest first.
const CLOSERS = [
  "Indeed.",
  "Opinions differ.",
  "Views on this vary.",
  "The record here is mixed.",
  "Accounts of this differ in detail.",
  "This point has been made many times before.",
  "The same theme recurs across many accounts of the subject.",
].sort((x, y) => countTokens(" " + x) - countTokens(" " + y));

function sentence(template: string, terms: string[], rand: () => number): string {
  const pick = () => terms[Math.floor(rand() * terms.length)] ?? "this subject";
  const a = pick();
  let b = pick();
  if (terms.length > 1) for (let i = 0; i < 4 && b === a; i++) b = pick();
  let c = pick();
  if (terms.length > 2) for (let i = 0; i < 4 && (c === a || c === b); i++) c = pick();
  return template.replace("{a}", a).replace("{b}", b).replace("{c}", c);
}

function render(paragraphs: string[][]): string {
  return paragraphs.filter((p) => p.length).map((p) => p.join(" ")).join("\n\n") + "\n";
}

// Prose whose token count lands as close as it can to target: whole sentences
// first, then short closing sentences to close the gap. The result is at most
// one token off for any target of two tokens or more.
export function prose(terms: string[], target: number, rand: () => number): string {
  const paragraphs: string[][] = [[]];
  let size = Math.floor(rand() * 4) + 3;
  let estimate = 0;
  while (estimate < target) {
    const s = sentence(TEMPLATES[Math.floor(rand() * TEMPLATES.length)]!, terms, rand);
    const tokens = countTokens(" " + s);
    if (estimate + tokens > target) break;
    let last = paragraphs[paragraphs.length - 1]!;
    if (last.length >= size) {
      paragraphs.push((last = []));
      size = Math.floor(rand() * 4) + 3;
    }
    last.push(s);
    estimate += tokens;
  }
  let text = render(paragraphs);
  for (let guard = 0; guard < 200; guard++) {
    const gap = target - countTokens(text);
    if (gap <= 0) {
      if (gap === 0) break;
      const last = paragraphs[paragraphs.length - 1]!;
      if (paragraphs.length === 1 && last.length <= 1) break;
      last.pop();
      if (!last.length) paragraphs.pop();
      text = render(paragraphs);
      continue;
    }
    const fits = CLOSERS.filter((s) => countTokens(" " + s) <= gap);
    if (!fits.length) break;
    paragraphs[paragraphs.length - 1]!.push(fits[fits.length - 1]!);
    text = render(paragraphs);
  }
  return text;
}

export type SkillResult = {
  folder: string;
  output: string;
  originalTokens: number;
  placeboTokens: number;
  routingKept: string | null;
};

export function placeboSkill(folder: string, text: string, seed: string): SkillResult {
  const { frontmatter, body } = splitSkill(text);
  const { name, description } = frontmatterFields(frontmatter);
  const routing = routingSection(body);
  if (ROUTER_FOLDERS.includes(folder) && routing === null) {
    throw new Error(folder + ": router SKILL.md has no '" + ROUTING_HEADING + "' section");
  }
  const kept = routing ?? "";
  const originalTokens = countTokens(body);
  const target = Math.max(1, originalTokens - countTokens(kept) - (kept ? 1 : 0));
  const generated = prose(topicTerms(name, description), target, prng(seed, folder));
  const newBody = kept ? generated + "\n" + kept : generated;
  return {
    folder,
    output: stripHooks(frontmatter) + newBody,
    originalTokens,
    placeboTokens: countTokens(newBody),
    routingKept: routing,
  };
}

// Phrases and shapes that mark procedural text. Applied to generated prose only.
export function proceduralMarkers(text: string): string[] {
  const found: string[] = [];
  const rules: [string, RegExp][] = [
    ["backtick or code fence", /`/],
    ["bulleted line", /^\s*[-*+•]\s/m],
    ["numbered line", /^\s*\d+[.)]\s/m],
    ["markdown heading", /^\s*#/m],
    ["path or URL", /[\/\\~]|https?:|\w\.[A-Za-z]{1,5}\b/],
    ["command flag", /(^|\s)--?[a-z]/],
    ["shell or template syntax", /[$<>{}\[\]|=]/],
    ["second person or directive modal", /\b(you|your|must|should|need to|make sure|be sure|please|always|never)\b/i],
    ["step language", /\b(step|first,|then,|next,|finally,)\b/i],
    [
      "tool or command name",
      /\b(Bash|Read|Write|Edit|MultiEdit|Grep|Glob|WebSearch|WebFetch|AskUserQuestion|Skill|Task|Agent|NotebookEdit|TodoWrite|git|gh|npm|npx|bun|bunx|curl|wget|docker|sudo|apt)\b/,
    ],
  ];
  for (const [label, re] of rules) if (re.test(text)) found.push(label);
  const imperativeStarts = new Set(
    ("add allow apply ask avoid call check clear click commit configure create do don't enter ensure execute find " +
      "fix follow generate go import install invoke keep launch let make merge note open pull push read refresh " +
      "remember remove report restore run save say see send set skip start stop take tell try turn update use " +
      "verify write").split(" "),
  );
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    const first = s.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, "") ?? "";
    if (imperativeStarts.has(first)) {
      found.push("imperative sentence: " + s.trim().slice(0, 60));
      break;
    }
  }
  return found;
}
