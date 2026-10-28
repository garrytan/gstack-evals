// Pre-run checks with the keys: one short metered call per model, the OpenRouter key's
// limit, DeepSeek's endpoint list and the OpenRouter programming ranking (meta.as_of).
// bun quick/replay/smoke.ts   env: LEDGER, RESULTS, PREREG_SHA
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Ledger, MODELS, meteredCall } from './llm.ts';

const RESULTS = process.env.RESULTS ?? path.join(process.env.HOME!, '.capy/work/replay/results');
const LEDGER = process.env.LEDGER ?? path.join(process.env.HOME!, '.capy/drive/captain-gstack-evals/ledger/replay-quick.jsonl');
fs.mkdirSync(path.join(RESULTS, 'smoke'), { recursive: true });
const ledger = new Ledger(LEDGER, 'replay-quick', 60);
const or = (p: string): Promise<{ status: number; json: any }> => fetch((process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai') + p, { headers: { authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY } }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

const manifest: any = { prereg_sha: process.env.PREREG_SHA ?? null, at: new Date().toISOString() };
const key = await or('/api/v1/key');
manifest.openrouter_key = { status: key.status, limit: key.json?.data?.limit ?? null, limit_remaining: key.json?.data?.limit_remaining ?? null };
const ep = await or('/api/v1/models/' + MODELS.deepseek!.model + '/endpoints');
manifest.deepseek_endpoints = (ep.json?.data?.endpoints ?? []).filter((e: any) => /deepseek/i.test(e.provider_name)).map((e: any) => ({ provider: e.provider_name, tag: e.tag, pricing: e.pricing }));
const end = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
const rk = await or('/api/v1/datasets/rankings-daily?category=programming&start_date=' + start + '&end_date=' + end);
const totals = new Map<string, number>();
for (const row of rk.json?.data ?? []) totals.set(row.model_permaslug, (totals.get(row.model_permaslug) ?? 0) + Number(row.total_tokens ?? 0));
manifest.ranking = { status: rk.status, meta: rk.json?.meta ?? null, window: [start, end], top: [...totals.entries()].filter(([k]) => k !== 'other').sort((a, b) => b[1] - a[1]).slice(0, 12) };
fs.writeFileSync(path.join(RESULTS, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ key: manifest.openrouter_key, endpoints: manifest.deepseek_endpoints.length, ranking_as_of: manifest.ranking.meta?.as_of, top: manifest.ranking.top.slice(0, 5) }));

for (const m of ['deepseek', 'haiku', 'opus', 'judge']) {
  const spec = { ...MODELS[m]!, maxTokens: 2000 };
  try {
    const r = await meteredCall(ledger, 'smoke/' + m, spec, m === 'judge' ? 'Return {"verdicts":[]} as JSON.' : 'Reply with the two words NO FINDINGS and nothing else.', m === 'judge' ? { schema: { type: 'object', additionalProperties: false, required: ['verdicts'], properties: { verdicts: { type: 'array', items: { type: 'string' } } } } } : {});
    fs.writeFileSync(path.join(RESULTS, 'smoke', m + '.json'), JSON.stringify({ model: spec.model, effort: spec.effort, ...r }, null, 2));
    console.log(m, 'ok', r.model_served, r.provider_served, JSON.stringify(r.text).slice(0, 60), 'usd', r.usd.toFixed(6));
  } catch (e: any) {
    console.log(m, 'FAIL', String(e.message).slice(0, 300));
  }
}
console.log('ledger committed', ledger.committed().toFixed(6));
