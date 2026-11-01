# Power and screening simulation (GEVA-87, keyless)

Run with bun 1.4.4, no model calls. Every script uses mulberry32 seeded 20261031. The first draft used a floating-point LCG that cycled every 10,466 draws; the eng review found it, and these numbers replace it (they moved by at most 0.5 points). power8.ts and power-ceil.ts are power.ts with only the grid or the prior changed; power-interim.ts is power.ts up to its mdd function plus the block shown; power-repo.ts adds repository effects.

## Script (power.ts)

```ts
// Keyless power and screening simulation for the real-world outcome lane plan (GEVA-87). No model calls.
// RNG: mulberry32, seed 20261031 (replaces a float LCG that cycled every 10,466 draws; found by the eng review).
// Prior for a valid candidate's true Opus none shipped-clean rate p: 30% near ceiling U(0.9,1), 10% near floor U(0,0.1), 60% U(0.1,0.9).
// Screen: 2 Opus none trials; drop 2/2; a 0/2 task gets a third trial and is dropped at 0/3.
// Main run: fresh k trials per arm per task; gstack rate = clip(p + d), d ~ Normal(delta, sd).
// Test: paired per-task mean difference, two-sided, normal approximation, alpha 0.048 (final look of a 2-look O'Brien-Fleming design).
let a = 20261031 >>> 0;
const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const norm = () => { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const bern = (p, k) => { let s = 0; for (let i = 0; i < k; i++) if (rnd() < p) s++; return s; };
const drawPrior = () => { const u = rnd(); if (u < 0.3) return 0.9 + 0.1 * rnd(); if (u < 0.4) return 0.1 * rnd(); return 0.1 + 0.8 * rnd(); };
// screening
const selected = []; let cands = 0, screenTrials = 0;
while (selected.length < 200000) { cands++; const p = drawPrior(); const a = bern(p, 2); screenTrials += 2; if (a === 2) continue; if (a === 0) { screenTrials++; if (bern(p, 1) === 0) continue; } selected.push(p); }
const yieldRate = selected.length / cands;
const mean = selected.reduce((s, x) => s + x, 0) / selected.length;
const pick = () => selected[Math.floor(rnd() * selected.length)];
const zcrit = 1.977;
function power(n, k, delta, sd, sims) { let hit = 0; for (let s = 0; s < sims; s++) { let sum = 0, sum2 = 0; for (let i = 0; i < n; i++) { const p = pick(); const g = Math.min(1, Math.max(0, p + delta + sd * norm())); const di = bern(g, k) / k - bern(p, k) / k; sum += di; sum2 += di * di; } const m = sum / n; const v = (sum2 - n * m * m) / (n - 1); const z = m / Math.sqrt(v / n); if (Math.abs(z) > zcrit) hit++; } return hit / sims; }
function mdd(n, k, sd) { for (let d = 0.03; d <= 0.25; d += 0.005) { if (power(n, k, d, sd, 1200) >= 0.8) return Math.round(d * 1000) / 10; } return ">25"; }
const out = [];
out.push("screen yield (valid candidates kept): " + (yieldRate * 100).toFixed(1) + "%; screening trials per candidate: " + (screenTrials / cands).toFixed(2) + "; mean true none rate of kept tasks: " + (mean * 100).toFixed(1) + "%");
const pv = selected.slice(0, 50000).map(p => p * (1 - p)); out.push("mean p(1-p) of kept tasks: " + (pv.reduce((s, x) => s + x, 0) / pv.length).toFixed(3));
out.push("| tasks | trials per arm | MDD, sd 0.10 | MDD, sd 0.15 | MDD, sd 0.20 |");
out.push("|---|---|---|---|---|");
for (const n of [90, 120, 150, 180, 210, 240]) for (const k of [3, 4, 6]) out.push("| " + n + " | " + k + " | " + mdd(n, k, 0.10) + " | " + mdd(n, k, 0.15) + " | " + mdd(n, k, 0.20) + " |");
console.log(out.join("\n"));
```

## Output, main grid (prior: 30% near ceiling, 10% near floor)

```
screen yield (valid candidates kept): 33.7%; screening trials per candidate: 2.27; mean true none rate of kept tasks: 50.5%
mean p(1-p) of kept tasks: 0.190
| tasks | trials per arm | MDD, sd 0.10 | MDD, sd 0.15 | MDD, sd 0.20 |
|---|---|---|---|---|
| 90 | 3 | 12 | 12.5 | 13.5 |
| 90 | 4 | 10.5 | 11 | 12.5 |
| 90 | 6 | 8.5 | 9.5 | 10.5 |
| 120 | 3 | 10 | 11 | 11.5 |
| 120 | 4 | 8.5 | 9.5 | 10.5 |
| 120 | 6 | 7.5 | 8 | 9.5 |
| 150 | 3 | 9 | 9.5 | 10.5 |
| 150 | 4 | 8 | 8.5 | 9.5 |
| 150 | 6 | 7 | 7.5 | 8.5 |
| 180 | 3 | 8.5 | 9 | 9.5 |
| 180 | 4 | 7.5 | 8.5 | 8.5 |
| 180 | 6 | 6 | 7 | 7.5 |
| 210 | 3 | 8 | 8 | 9 |
| 210 | 4 | 7 | 7.5 | 8 |
| 210 | 6 | 6 | 6.5 | 7 |
| 240 | 3 | 7.5 | 8 | 8.5 |
| 240 | 4 | 6.5 | 7 | 7.5 |
| 240 | 6 | 5.5 | 6 | 7 |
```

## Output, 8 trials per arm (same prior)

```
screen yield (valid candidates kept): 33.7%; screening trials per candidate: 2.27; mean true none rate of kept tasks: 50.5%
mean p(1-p) of kept tasks: 0.190
| tasks | trials per arm | MDD, sd 0.10 | MDD, sd 0.15 | MDD, sd 0.20 |
|---|---|---|---|---|
| 120 | 8 | 6.5 | 7.5 | 8.5 |
| 150 | 8 | 6 | 7 | 7.5 |
| 180 | 8 | 5.5 | 6 | 7 |
```

## Output, ceiling-heavy prior (50% near ceiling, 10% near floor), 240 tasks at 4 trials

```
screen yield (valid candidates kept): 25.8%; screening trials per candidate: 2.21; mean true none rate of kept tasks: 54.4%
mean p(1-p) of kept tasks: 0.173
| tasks | trials per arm | MDD, sd 0.10 | MDD, sd 0.15 | MDD, sd 0.20 |
|---|---|---|---|---|
| 240 | 4 | 6.5 | 7 | 8.5 |
```

## Interim look and equivalence (power-interim.ts), 150 tasks at 8 trials, interim at 75 tasks, 2,000 simulations per row

```ts
// Interim and equivalence check: 150 tasks x 8 trials; interim at the first 75 tasks (|z| > 2.797); final |z| > 1.977;
// equivalence: no boundary crossed and the 90% interval (normal) of the final difference lies inside +-0.07.
function run(delta, sd, sims) { let stopI = 0, diffF = 0, equiv = 0; for (let s = 0; s < sims; s++) { const d = []; for (let i = 0; i < 150; i++) { const p = pick(); const g = Math.min(1, Math.max(0, p + delta + sd * norm())); d.push(bern(g, 8) / 8 - bern(p, 8) / 8); }
 const z = (a) => { const n = a.length; const m = a.reduce((x, y) => x + y, 0) / n; const v = a.reduce((x, y) => x + (y - m) * (y - m), 0) / (n - 1); return [m, Math.sqrt(v / n)]; };
 const [m1, se1] = z(d.slice(0, 75)); if (Math.abs(m1 / se1) > 2.797) { stopI++; continue; }
 const [m2, se2] = z(d); if (Math.abs(m2 / se2) > 1.977) { diffF++; continue; }
 if (m2 - 1.645 * se2 > -0.07 && m2 + 1.645 * se2 < 0.07) equiv++; }
 return "delta " + delta + " sd " + sd + ": interim stop " + (100 * stopI / sims).toFixed(1) + "%, final difference " + (100 * diffF / sims).toFixed(1) + "%, same within 7 " + (100 * equiv / sims).toFixed(1) + "%"; }
const lines = [];
for (const sd of [0.10, 0.15, 0.20]) for (const dl of [0, 0.07, 0.10, 0.15]) lines.push(run(dl, sd, 2000));
console.log(lines.join(String.fromCharCode(10)));
```

```
delta 0 sd 0.1: interim stop 0.3%, final difference 4.7%, same within 7 93.9%
delta 0.07 sd 0.1: interim stop 36.1%, final difference 56.9%, same within 7 6.0%
delta 0.1 sd 0.1: interim stop 75.8%, final difference 24.1%, same within 7 0.1%
delta 0.15 sd 0.1: interim stop 98.3%, final difference 1.8%, same within 7 0.0%
delta 0 sd 0.15: interim stop 0.6%, final difference 4.0%, same within 7 91.0%
delta 0.07 sd 0.15: interim stop 25.6%, final difference 60.4%, same within 7 8.3%
delta 0.1 sd 0.15: interim stop 61.0%, final difference 38.0%, same within 7 0.5%
delta 0.15 sd 0.15: interim stop 96.5%, final difference 3.5%, same within 7 0.0%
delta 0 sd 0.2: interim stop 0.5%, final difference 5.0%, same within 7 84.3%
delta 0.07 sd 0.2: interim stop 18.6%, final difference 57.5%, same within 7 10.3%
delta 0.1 sd 0.2: interim stop 46.0%, final difference 50.3%, same within 7 1.1%
delta 0.15 sd 0.2: interim stop 90.0%, final difference 10.1%, same within 7 0.0%
```

## Repository-aware check (power-repo.ts), 3 tasks per repository, test on repository means

```ts
// Repo-aware power check (GEVA-87, keyless, mulberry32). Same prior and screen as power.ts. Tasks come 3 per repository;
// the gstack effect is delta + u_repo + e_task, u ~ N(0, sdr), e ~ N(0, sdt). Test: repository-level mean differences, two-sided z 1.977.
let a = 20261031 >>> 0;
const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const norm = () => { let u = 0; while (u === 0) u = rnd(); const v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const bern = (p, k) => { let s = 0; for (let i = 0; i < k; i++) if (rnd() < p) s++; return s; };
const drawPrior = () => { const u = rnd(); if (u < 0.3) return 0.9 + 0.1 * rnd(); if (u < 0.4) return 0.1 * rnd(); return 0.1 + 0.8 * rnd(); };
const pool = []; let c = 0; while (pool.length < 100000) { c++; const p = drawPrior(); const x = bern(p, 2); if (x === 2) continue; if (x === 0 && bern(p, 1) === 0) continue; pool.push(p); }
const pick = () => pool[Math.floor(rnd() * pool.length)];
function power(n, k, delta, sdr, sdt, sims) { const R = n / 3; let hit = 0; for (let s = 0; s < sims; s++) { let sum = 0, sum2 = 0; for (let r = 0; r < R; r++) { const u = sdr * norm(); let m = 0; for (let j = 0; j < 3; j++) { const p = pick(); const g = Math.min(1, Math.max(0, p + delta + u + sdt * norm())); m += bern(g, k) / k - bern(p, k) / k; } m /= 3; sum += m; sum2 += m * m; } const mu = sum / R; const v = (sum2 - R * mu * mu) / (R - 1); if (Math.abs(mu / Math.sqrt(v / R)) > 1.977) hit++; } return hit / sims; }
function mdd(n, k, sdr, sdt) { for (let d = 0.03; d <= 0.25; d += 0.005) if (power(n, k, d, sdr, sdt, 2000) >= 0.8) return (Math.round(d * 1000) / 10).toString(); return ">25"; }
console.log("yield " + (100 * pool.length / c).toFixed(1) + "%");
console.log("| tasks (repos) | trials | sd repo 0, task 0.15 | repo 0.07, task 0.13 | repo 0.10, task 0.10 | repo 0.10, task 0.15 |");
console.log("|---|---|---|---|---|---|");
for (const [n, k] of [[150, 8], [180, 7], [240, 5]]) console.log("| " + n + " (" + n / 3 + ") | " + k + " | " + mdd(n, k, 0, 0.15) + " | " + mdd(n, k, 0.07, 0.13) + " | " + mdd(n, k, 0.10, 0.10) + " | " + mdd(n, k, 0.10, 0.15) + " |");
```

```
yield 33.7%
| tasks (repos) | trials | sd repo 0, task 0.15 | repo 0.07, task 0.13 | repo 0.10, task 0.10 | repo 0.10, task 0.15 |
|---|---|---|---|---|---|
| 150 (50) | 8 | 7 | 7 | 7.5 | 8 |
| 180 (60) | 7 | 6.5 | 7 | 7 | 7.5 |
| 240 (80) | 5 | 6.5 | 6.5 | 7 | 7.5 |
```
