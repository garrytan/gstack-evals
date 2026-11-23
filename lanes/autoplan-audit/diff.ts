// Copyright (c) 2026 Garry Tan. MIT License.
// Section 5.5's mechanical diff. Words are lower case alphanumeric runs; content words have at least 4 characters and
// are not on the frozen stopword list. T is the change text's content words absent from restore.md, or all its content
// words when that leaves fewer than 4. A paragraph is a blank-line separated block, and each table row is its own
// paragraph; a paragraph's overlap is the share of T it holds; the score is the best paragraph's. HIT at 0.60 or more.
export const HIT_AT = 0.6;

export const STOPWORDS: ReadonlySet<string> = new Set(
  (
    "about above after again against also among another anything around away back because been before being below between both but cannot could does doing done down during each either else even ever every first from further gets give given goes going have having here hers herself himself however into itself just keep keeps kept know last least less like made make makes many might more most much must need needs neither never next none only onto other others otherwise ours over same says should since some still such take than that their theirs them themselves then there these they thing things this those though through thus together under until upon used uses using very want wants well were what whatever when where whether which while whom whose will with within without would your yours yourself " +
    "plan plans section sections change changes changed apply applied applies should shall must add adds added make sure item items note notes also each fix fixes fixed accept accepted rule rules part parts state states stated text line lines read reads reading point points case cases name names named"
  ).split(" "),
);

export const words = (t: string): string[] => t.toLowerCase().match(/[a-z0-9]+/g) ?? [];
export const contentWords = (t: string): string[] => words(t).filter((w) => w.length >= 4 && !STOPWORDS.has(w));

export function tSet(change: string, restore: string): Set<string> {
  const before = new Set(words(restore));
  const all = new Set(contentWords(change));
  const fresh = new Set([...all].filter((w) => !before.has(w)));
  return fresh.size < 4 ? all : fresh;
}

export function paragraphs(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const rows = lines.filter((l) => l.trim().startsWith("|"));
    const rest = lines.filter((l) => !l.trim().startsWith("|")).join("\n").trim();
    out.push(...rows);
    if (rest) out.push(rest);
  }
  return out.filter((p) => p.trim());
}

export const overlap = (t: ReadonlySet<string>, paragraph: string): number => {
  if (!t.size) return 0;
  const w = new Set(words(paragraph));
  let k = 0;
  for (const x of t) if (w.has(x)) k++;
  return k / t.size;
};

export function diffScore(change: string, restore: string, built: string): { score: number; hit: boolean; t: number } {
  const t = tSet(change, restore);
  let best = 0;
  for (const p of paragraphs(built)) best = Math.max(best, overlap(t, p));
  return { score: best, hit: best >= HIT_AT, t: t.size };
}

/** Section 6's ablation: the built text with every paragraph of overlap 0.20 or more removed; null when none qualifies. */
export function ablate(change: string, restore: string, built: string): string | null {
  const t = tSet(change, restore);
  const blocks = built.split(/(\n\s*\n)/);
  let removed = 0;
  const kept = blocks.map((b) => {
    if (/^\n\s*\n$/.test(b)) return b;
    const lines = b.split("\n");
    const keep = lines.filter((l) => {
      if (!l.trim().startsWith("|")) return true;
      if (overlap(t, l) >= 0.2) {
        removed++;
        return false;
      }
      return true;
    });
    const prose = keep.filter((l) => !l.trim().startsWith("|")).join("\n").trim();
    if (prose && overlap(t, prose) >= 0.2) {
      removed++;
      return keep.filter((l) => l.trim().startsWith("|")).join("\n");
    }
    return keep.join("\n");
  });
  return removed ? kept.join("") : null;
}
