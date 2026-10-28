// Mines review-replay cases from public garrytan/gstack history.
// A defect case is a review-fix commit F on a merged PR branch whose changed lines
// were introduced by that same PR: the reviewed candidate is F's parent, and the
// defect site is the lines F rewrote. A decoy is a merged PR whose review receipt
// records no blocking finding and whose added lines no later fix on main touched.
// bun quick/replay/mine.ts  (GSTACK_DIR=/workspace/gstack, CACHE=~/.capy/work/replay/cache)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { diffLines, filterDiff, introducedRanges, isReviewFix } from './lib.ts';

const G = process.env.GSTACK_DIR ?? '/workspace/gstack';
const CACHE = process.env.CACHE ?? path.join(process.env.HOME!, '.capy/work/replay/cache');
const OUT = process.env.OUT ?? path.join(process.env.HOME!, '.capy/work/replay/candidates');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

function sh(cmd: string, args: string[], cwd = G): string {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(cmd + ' ' + args.join(' ') + ': ' + (r.stderr || '').slice(0, 300));
  return r.stdout;
}
const git = (...a: string[]) => sh('git', a);
const tryGit = (...a: string[]) => { try { return git(...a); } catch { return null; } };

function cached<T>(name: string, make: () => T): T {
  const f = path.join(CACHE, name);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = make();
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}

type PR = { number: number; title: string; body: string; mergeCommit: { oid: string } | null; headRefOid: string; mergedAt: string };
const prs: PR[] = cached('prs.json', () => JSON.parse(sh('gh', ['pr', 'list', '--repo', 'garrytan/gstack', '--state', 'merged', '--limit', '1000', '--json', 'number,title,body,mergeCommit,headRefOid,mergedAt'])));

function loop(body: string) {
  const m = /REVIEW_LOOP:\s*passes=(\d+)\s+blocking_found=(\d+)/.exec(body);
  return m ? { passes: Number(m[1]), blocking: Number(m[2]) } : null;
}

function prCommits(n: number): { sha: string; message: string; parents: number }[] {
  return cached('commits-' + n + '.json', () => {
    const raw = JSON.parse(sh('gh', ['api', '--paginate', 'repos/garrytan/gstack/pulls/' + n + '/commits', '--jq', '[.[] | {sha, message: .commit.message, parents: (.parents | length)}]']).split('\n').filter(Boolean).join('').replace(/\]\[/g, ','));
    return raw;
  });
}

function ensurePrRef(n: number, head: string) {
  if (tryGit('cat-file', '-e', head + '^{commit}') !== null) return;
  tryGit('fetch', '-q', 'origin', 'pull/' + n + '/head:refs/pr/' + n);
}

function oldRanges(from: string, to: string, file: string): [number, number][] {
  const d = git('diff', '-U0', from, to, '--', file);
  const out: [number, number][] = [];
  for (const l of d.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+/.exec(l);
    if (!m) continue;
    const a = Number(m[1]); const c = m[2] === undefined ? 1 : Number(m[2]);
    out.push(c === 0 ? [Math.max(1, a), a + 1] : [a, a + c - 1]);
  }
  return out;
}

function blameShas(rev: string, file: string, r: [number, number]): string[] {
  const t = tryGit('blame', '-l', '-s', '-L', r[0] + ',' + r[1], rev, '--', file);
  if (t === null) return [];
  return t.split('\n').filter(Boolean).map(l => l.replace(/^\^/, '').slice(0, 40));
}

// An escaped defect's site, moved from the fix parent's line numbers to the reviewed head's:
// the lines the introducing commit added, where it added them.
function headRanges(parent: string, file: string, ranges: [number, number][], commit: string): [number, number][] {
  return introducedRanges(ranges.map(r => tryGit('blame', '--porcelain', '-L', r[0] + ',' + r[1], parent, '--', file) ?? '').join('\n'), commit);
}

const defects: any[] = [];
const decoyPool: any[] = [];
const reviewed = prs.filter(p => (p.body ?? '').includes('Pre-Landing Review') && p.mergeCommit);
console.error('merged PRs ' + prs.length + ', with a review record ' + reviewed.length);

for (const p of reviewed.sort((a, b) => b.number - a.number)) {
  const lp = loop(p.body);
  const squash = p.mergeCommit!.oid;
  const mainBefore = tryGit('rev-parse', squash + '^')?.trim();
  if (!mainBefore) continue;
  const head = p.body.slice(p.body.indexOf('Pre-Landing Review'), p.body.indexOf('Pre-Landing Review') + 600);
  if ((lp && lp.blocking === 0) || (!lp && /No issues found|No blocking finding|0 critical/i.test(head) && !/CRITICAL[^\n]{0,40}fixed|\[CRITICAL|\bP[01]\b|\bHIGH\b/.test(head))) {
    decoyPool.push({ pr: p.number, squash, mainBefore, passes: lp?.passes ?? null, mergedAt: p.mergedAt, title: p.title, receipt: lp ? 'REVIEW_LOOP blocking_found=0' : head.replace(/\s+/g, ' ').slice(19, 160) });
    continue;
  }
  const sec = p.body.slice(p.body.indexOf('Pre-Landing Review'), p.body.indexOf('Pre-Landing Review') + 6000);
  if (lp ? lp.blocking < 1 : !/CRITICAL|blocking|\bHIGH\b|\bP[01]\b/.test(sec)) continue;
  let commits;
  try { commits = prCommits(p.number); } catch (e: any) { console.error('#' + p.number + ' commits: ' + e.message); continue; }
  ensurePrRef(p.number, p.headRefOid);
  const prShas = new Set(commits.map(c => c.sha));
  for (let i = 1; i < commits.length; i++) {
    const F = commits[i]!;
    if (F.parents !== 1 || !isReviewFix(F.message)) continue;
    const P = tryGit('rev-parse', F.sha + '^')?.trim();
    if (!P || !prShas.has(P)) continue;
    const fork = tryGit('merge-base', P, mainBefore)?.trim();
    if (!fork) continue;
    const files = git('diff', '--name-only', P, F.sha).split('\n').filter(Boolean);
    const src = files.filter(f => filterDiff.keepPath(f) && !/\.md$/.test(f) && !/(^|\/)test\//.test(f) && !/\.test\.[jt]s$/.test(f));
    if (src.length < 1 || src.length > 2) continue;
    for (const file of src) {
    const ranges = oldRanges(P, F.sha, file);
    if (!ranges.length || ranges.length > 4) continue;
    const shas = ranges.flatMap(r => blameShas(P, file, r));
    if (!shas.length) continue;
    const inPr = shas.filter(s => prShas.has(s));
    if (inPr.length < Math.ceil(shas.length / 2)) continue;
    const order = commits.map(c => c.sha);
    const introIdx = Math.min(...inPr.map(s => order.indexOf(s)));
    const intro = commits[introIdx]!;
    const between = commits.slice(introIdx, i);
    const fixRange = introIdx > 0 && isReviewFix(intro.message) && between.every(c => c.parents === 1);
    const base = fixRange ? git('rev-parse', intro.sha + '^').trim() : fork;
    const fullDiff = git('diff', base, P);
    const kept = filterDiff(fullDiff, (f: string) => tryGit('show', P + ':' + f)?.slice(0, 400) ?? '');
    if (!kept.includes('diff --git a/' + file + ' ')) continue;
    defects.push({
      pr: p.number, title: p.title, mergedAt: p.mergedAt, passes: lp?.passes ?? null, blocking: lp?.blocking ?? null,
      fix: F.sha, fixSubject: F.message.split('\n')[0], reviewedHead: P, base, scope: fixRange ? 'fix-range' : 'full',
      introducer: intro.sha, file, ranges, diffLines: diffLines(kept), fixLines: diffLines(git('diff', P, F.sha, '--', file)),
      bodyMentionsFile: p.body.includes(path.basename(file)), fixFiles: src.length,
    });
    }
  }
}

// Missed defects: a merged fix PR whose body names an earlier merged PR, where the lines the
// fix rewrote blame to that earlier PR's squash commit. The earlier PR is the case; its own
// review (if any) let the defect through.
const bySquash = new Map(prs.filter(p => p.mergeCommit).map(p => [p.mergeCommit!.oid, p]));
const byNumber = new Map(prs.map(p => [p.number, p]));
const missed: any[] = [];
for (const f of prs) {
  if (!f.mergeCommit || !/\bfix/i.test(f.title)) continue;
  const refs = new Set([...(f.body ?? '').matchAll(/#(\d{2,5})\b/g)].map(x => Number(x[1])).filter(n => n < f.number && byNumber.get(n)?.mergeCommit));
  if (!refs.size) continue;
  const fs2 = f.mergeCommit.oid;
  const parent = tryGit('rev-parse', fs2 + '^')?.trim();
  if (!parent) continue;
  const files = git('diff', '--name-only', parent, fs2).split('\n').filter(x => x && filterDiff.keepPath(x) && !/\.md$/.test(x) && !/(^|\/)test\//.test(x) && !/\.test\.[jt]s$/.test(x));
  if (files.length < 1 || files.length > 3) continue;
  for (const file of files) {
    const ranges = oldRanges(parent, fs2, file);
    if (!ranges.length || ranges.length > 4) continue;
    const shas = ranges.flatMap(r => blameShas(parent, file, r));
    for (const n of refs) {
      const x = byNumber.get(n)!;
      const hits = shas.filter(s => s === x.mergeCommit!.oid).length;
      if (hits < Math.ceil(shas.length / 2)) continue;
      const xBefore = tryGit('rev-parse', x.mergeCommit!.oid + '^')?.trim();
      if (!xBefore) continue;
      const kept = filterDiff(git('diff', xBefore, x.mergeCommit!.oid), (pp: string) => tryGit('show', x.mergeCommit!.oid + ':' + pp)?.slice(0, 400) ?? '');
      if (!kept.includes('diff --git a/' + file + ' ')) continue;
      missed.push({ pr: n, title: x.title, fixPr: f.number, fixTitle: f.title, fix: fs2, reviewedHead: x.mergeCommit!.oid, base: xBefore, file, ranges: headRanges(parent, file, ranges, x.mergeCommit!.oid), diffLines: diffLines(kept), fixLines: diffLines(git('diff', parent, fs2, '--', file)), introducerHasReview: (x.body ?? '').includes('Pre-Landing Review') });
    }
  }
}

// Missed defects, second route: any fix or revert commit on main whose rewritten lines blame
// mostly to one earlier main commit within ESCAPE_WINDOW commits, with or without a reference
// in the body. That earlier commit is the case.
const ESCAPE_WINDOW = 150;
const mainFp = git('log', '--first-parent', '--format=%H %s', 'origin/main').split('\n').filter(Boolean).map(l => ({ sha: l.slice(0, 40), subject: l.slice(41) })).reverse();
const fpPos = new Map(mainFp.map((c, i) => [c.sha, i]));
const seen = new Set(missed.map(m => m.reviewedHead + ' ' + m.file));
for (let i = 1; i < mainFp.length; i++) {
  const f = mainFp[i]!;
  if (!/\b(fix|revert)/i.test(f.subject)) continue;
  const parent = mainFp[i - 1]!.sha;
  const files = git('diff', '--name-only', parent, f.sha).split('\n').filter(x => x && filterDiff.keepPath(x) && !/\.md$/.test(x) && !/(^|\/)test\//.test(x) && !/\.test\.[jt]s$/.test(x));
  if (files.length < 1 || files.length > 4) continue;
  for (const file of files) {
    const ranges = oldRanges(parent, f.sha, file);
    if (!ranges.length || ranges.length > 4) continue;
    const shas = ranges.flatMap(r => blameShas(parent, file, r));
    if (!shas.length) continue;
    const counts = new Map<string, number>();
    for (const s of shas) counts.set(s, (counts.get(s) ?? 0) + 1);
    const [top, hits] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (hits < Math.ceil(shas.length / 2)) continue;
    const j = fpPos.get(top);
    if (j === undefined || j >= i || i - j > ESCAPE_WINDOW || j === 0) continue;
    if (seen.has(top + ' ' + file)) continue;
    const xBefore = mainFp[j - 1]!.sha;
    const kept = filterDiff(git('diff', xBefore, top), (pp: string) => tryGit('show', top + ':' + pp)?.slice(0, 400) ?? '');
    if (!kept.includes('diff --git a/' + file + ' ')) continue;
    const n = diffLines(kept);
    if (n < 30 || n > 800) continue;
    seen.add(top + ' ' + file);
    const x = bySquash.get(top);
    const fp = bySquash.get(f.sha);
    missed.push({ pr: x?.number ?? Number(/\(#(\d+)\)\s*$/.exec(mainFp[j]!.subject)?.[1] ?? 0), title: mainFp[j]!.subject, fixPr: fp?.number ?? Number(/\(#(\d+)\)\s*$/.exec(f.subject)?.[1] ?? 0), fixTitle: f.subject, fix: f.sha, reviewedHead: top, base: xBefore, file, ranges: headRanges(parent, file, ranges, top), diffLines: n, fixLines: diffLines(git('diff', parent, f.sha, '--', file)), distance: i - j, introducerHasReview: (x?.body ?? '').includes('Pre-Landing Review'), route: 'blame' });
  }
}
fs.writeFileSync(path.join(OUT, 'missed-candidates.json'), JSON.stringify(missed, null, 2));
console.log('missed-defect candidates ' + missed.length);

// Decoys: no later fix on main, within the next 40 commits, rewrote a line this PR added.
const mainLog = git('log', '--first-parent', '--format=%H %s', 'origin/main').split('\n').filter(Boolean).map(l => ({ sha: l.slice(0, 40), subject: l.slice(41) })).reverse();
const pos = new Map(mainLog.map((c, i) => [c.sha, i]));
const decoys: any[] = [];
for (const d of decoyPool) {
  const full = git('diff', d.mainBefore, d.squash);
  const kept = filterDiff(full, (f: string) => tryGit('show', d.squash + ':' + f)?.slice(0, 400) ?? '');
  const n = diffLines(kept);
  if (n < 30 || n > 800) continue;
  const i = pos.get(d.squash);
  if (i === undefined) continue;
  const later = mainLog.slice(i + 1, i + 41).filter(c => /\bfix/i.test(c.subject));
  const touched = new Set(git('diff', '--name-only', d.mainBefore, d.squash).split('\n').filter(Boolean));
  let dirty: string | null = null;
  for (const c of later) {
    const cf = git('diff', '--name-only', c.sha + '^', c.sha).split('\n').filter(f => touched.has(f) && filterDiff.keepPath(f));
    for (const f of cf) {
      for (const r of oldRanges(c.sha + '^', c.sha, f)) {
        if (blameShas(c.sha + '^', f, r).includes(d.squash)) { dirty = c.sha.slice(0, 10) + ' ' + f; break; }
      }
      if (dirty) break;
    }
    if (dirty) break;
  }
  const codeLines = diffLines(filterDiff(kept, () => '').split(/^(?=diff --git )/m).filter(t => !/^diff --git a\/\S+\.md /.test(t)).join(''));
  decoys.push({ ...d, diffLines: n, codeLines, laterFixesChecked: later.length, dirty });
}

fs.writeFileSync(path.join(OUT, 'defect-candidates.json'), JSON.stringify(defects, null, 2));
fs.writeFileSync(path.join(OUT, 'decoy-candidates.json'), JSON.stringify(decoys, null, 2));
console.log('defect candidates ' + defects.length + ' from ' + new Set(defects.map(d => d.pr)).size + ' PRs; decoy candidates ' + decoys.length + ' (' + decoys.filter(d => !d.dirty).length + ' clean)');
