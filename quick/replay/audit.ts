// Draws the hand audit of the judge: 10 judgments, seeded, half each verdict where possible.
// bun quick/replay/audit.ts   writes RESULTS/audit.md with a blank line for each hand verdict.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { rng } from './lib.ts';

const HERE = import.meta.dir;
const RESULTS = process.env.RESULTS ?? path.join(process.env.HOME!, '.capy/work/replay/results');
const { cases } = JSON.parse(fs.readFileSync(path.join(HERE, 'cases.json'), 'utf8'));
const byId = new Map(cases.map((c: any) => [c.id, c]));
const all: any[] = [];
for (const f of fs.readdirSync(path.join(RESULTS, 'judge')).filter(f => !f.endsWith('.failed.json')).sort()) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(RESULTS, 'judge', f), 'utf8')))) all.push({ key: k, ...(v as any) });
const r = rng(20261030);
const pick = (xs: any[], n: number) => xs.map(x => ({ x, o: r() })).sort((a, b) => a.o - b.o).slice(0, n).map(y => y.x);
const yes = all.filter(j => j.names_defect), no = all.filter(j => !j.names_defect);
const ny = Math.min(5, yes.length), nn = Math.min(10 - ny, no.length);
const first = pick(yes, ny);
const sample = [...first, ...pick(no, nn), ...pick(yes.filter(j => !first.includes(j)), 10 - ny - nn)];
const out = ['# Hand audit of the judge', '', 'Seed 20261030. ' + all.length + ' judged findings, ' + yes.length + ' judged to name the defect.', ''];
for (const [i, j] of sample.entries()) {
  const c: any = byId.get(j.case);
  out.push('## ' + (i + 1) + '. ' + j.case + ' (' + j.key + ')', '', 'Defect: ' + c.defect, '', 'Finding: ' + j.path + (j.line ? ':' + j.line : '') + ': ' + j.summary, '', 'Judge: ' + (j.names_defect ? 'names the defect' : 'does not') + '. ' + j.reason, '', 'Hand: ', '');
}
fs.writeFileSync(path.join(RESULTS, 'audit.md'), out.join('\n'));
console.log('audit sample', sample.length, 'of', all.length);
