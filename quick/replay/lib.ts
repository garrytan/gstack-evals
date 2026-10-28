// Shared helpers for the review replay: diff filtering and counting, review-fix detection,
// finding parsing, file matching, /review's specialist dispatch rules and the bootstrap.
const DROP = [/^CHANGELOG\.md$/, /(^|\/)VERSION$/, /(^|\/)bun\.lock$/, /^package\.json$/, /^test\/fixtures\/golden\//, /^test\/size-ledger\//, /skill-md-size-allowlist\.json$/, /^\.agents\//, /^agents-digest\//];

function keepPath(f: string): boolean {
  return !DROP.some(r => r.test(f));
}

export function splitFiles(diff: string): { path: string; text: string }[] {
  const parts = diff.split(/^(?=diff --git )/m).filter(Boolean);
  return parts.map(text => {
    const m = /^diff --git a\/(\S+) b\//.exec(text);
    return { path: m ? m[1]! : '', text };
  });
}

export function filterDiff(diff: string, head: (path: string) => string): string {
  return splitFiles(diff)
    .filter(f => f.path && keepPath(f.path) && !/AUTO-GENERATED/.test(head(f.path)))
    .map(f => f.text)
    .join('');
}
filterDiff.keepPath = keepPath;

export function diffLines(diff: string): number {
  let n = 0;
  for (const l of diff.split('\n')) {
    if ((l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))) n++;
  }
  return n;
}

export function isReviewFix(message: string): boolean {
  const s = message.split('\n')[0]!;
  if (/^Merge /.test(s) || /\bstamp\b/i.test(s) || /^chore: CHANGELOG/i.test(s)) return false;
  return /\b(review|pre-landing|pass [0-9]|red team|specialist|fix-check|outside voice|adversarial|codex|findings|greptile)\b/i.test(s);
}

// Paths /review's defensive framing reviews in summary mode (Security and Red Team only).
export const FIXTURE_RE = /test|fixture|\.spec\./;

export type Finding = {
  severity: string;
  confidence: number | null;
  path: string;
  line: number | null;
  summary: string;
  advisory: boolean;
  cause_path: string | null;
  specialist: string | null;
};

// Reads a reviewer's output: one JSON object per line, or NO FINDINGS. Objects inside code
// fences or spread over several lines are found by brace matching. Matrix records
// (state-machines) carry no summary and are skipped.
export function parseFindings(text: string): { findings: Finding[]; clean: boolean; unparsed: boolean } {
  const findings: Finding[] = [];
  const objs: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { if (depth > 0) inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}' && depth > 0) { depth--; if (depth === 0 && start >= 0) { objs.push(text.slice(start, i + 1)); start = -1; } }
  }
  for (const o of objs) {
    let j: any;
    try { j = JSON.parse(o); } catch { continue; }
    if (!j || typeof j !== 'object' || typeof j.path !== 'string' || typeof j.summary !== 'string') continue;
    const conf = Number(j.confidence);
    findings.push({
      severity: String(j.severity ?? '').toUpperCase(),
      confidence: Number.isFinite(conf) ? conf : null,
      path: j.path,
      line: Number.isFinite(Number(j.line)) ? Number(j.line) : null,
      summary: j.summary,
      advisory: j.advisory === true,
      cause_path: j.cause && typeof j.cause.path === 'string' ? j.cause.path : null,
      specialist: typeof j.specialist === 'string' ? j.specialist : null,
    });
  }
  const clean = findings.length === 0 && /NO FINDINGS/.test(text);
  return { findings, clean, unparsed: findings.length === 0 && !clean };
}

// /review's display rule for specialist and core findings: confidence 5+ reaches the report,
// 3-4 goes to the appendix, 1-2 is suppressed. A finding without a confidence is kept.
export function shown(f: Finding): boolean {
  return f.confidence === null || f.confidence >= 5;
}

function norm(p: string): string {
  return p.trim().replace(/^[ab]\//, '').replace(/^\.\//, '').replace(/:\d+(-\d+)?$/, '');
}

export function sameFile(found: string | null, want: string): boolean {
  if (!found) return false;
  const a = norm(found), b = norm(want);
  return a === b || a.endsWith('/' + b) || b.endsWith('/' + a);
}

export type Scope = { BACKEND: boolean; FRONTEND: boolean; AUTH: boolean; MIGRATIONS: boolean; API: boolean; STATE_MACHINE: 'true' | 'false' | 'unknown' };

// Step 4.5 of gstack's review/SKILL.md (review/sections/review-army.md), with adaptive
// gating off (no local hit-rate history) and no force flags.
export function selectSpecialists(diffLinesN: number, s: Scope): string[] {
  const sm = s.STATE_MACHINE !== 'false';
  if (diffLinesN < 50) return sm ? ['state-machines'] : [];
  const out = ['testing', 'maintainability'];
  if (s.AUTH || (s.BACKEND && diffLinesN > 100)) out.push('security');
  if (s.BACKEND || s.FRONTEND) out.push('performance');
  if (s.MIGRATIONS) out.push('data-migration');
  if (s.API) out.push('api-contract');
  if (s.FRONTEND) out.push('design');
  if (diffLinesN > 100) out.push('simplification');
  if (sm) out.push('state-machines');
  return out;
}

export function redTeamActive(diffLinesN: number, specialistFindings: Finding[]): boolean {
  return diffLinesN > 200 || specialistFindings.some(f => f.severity === 'CRITICAL');
}

// Seeded PRNG so every interval in the report reproduces.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Case-clustered percentile bootstrap of a statistic over per-case values.
export function bootstrap(perCase: number[][], stat: (rows: number[][]) => number, reps = 10000, seed = 20261030): [number, number] {
  const r = rng(seed);
  const vals: number[] = [];
  for (let i = 0; i < reps; i++) {
    const sample = perCase.map(() => perCase[Math.floor(r() * perCase.length)]!);
    const v = stat(sample);
    if (Number.isFinite(v)) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  if (!vals.length) return [NaN, NaN];
  return [vals[Math.floor(0.025 * (vals.length - 1))]!, vals[Math.ceil(0.975 * (vals.length - 1))]!];
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

// Line ranges in the introducing commit's own coordinates, from `git blame --porcelain` of the
// fix's parent: each line the commit introduced, at the line number it had in that commit,
// merged into ranges. Lines blamed to other commits drop out.
export function introducedRanges(porcelain: string, commit: string): [number, number][] {
  const lines = [...porcelain.matchAll(/^([0-9a-f]{40}) (\d+) \d+(?: \d+)?$/gm)].filter(m => m[1] === commit).map(m => Number(m[2])).sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const n of lines) {
    const last = out[out.length - 1];
    if (last && n <= last[1] + 1) last[1] = Math.max(last[1], n);
    else out.push([n, n]);
  }
  return out;
}
