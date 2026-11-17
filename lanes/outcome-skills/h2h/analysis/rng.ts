// Copyright (c) 2026 Garry Tan. MIT License.
// numpy's default_rng(seed) in TypeScript, so the bundle's power.py runs here draw for draw. SeedSequence(seed) mixes the
// seed into PCG64's 128-bit state and increment; PCG64 (XSL-RR 128/64) steps and outputs; next_double keeps the top 53
// bits; Generator.multinomial draws its cells by sequential binomials, by inversion when n p <= 30 and by BTPE otherwise,
// as numpy 2.5's numpy/random/src/distributions/distributions.c does. The 128-bit state is eight 16-bit limbs held in
// Numbers, so every product and carry stays exact.

const INIT_A = 0x43b0d7e5, MULT_A = 0x931e8875, INIT_B = 0x8b51f9dd, MULT_B = 0x58f38ded, MIX_L = 0xca01f9dd, MIX_R = 0x4973f715;
/** PCG_DEFAULT_MULTIPLIER_128, 0x2360ED051FC65DA44385DF649FCCF645, as 16-bit limbs from the low end. */
const MULT = [0xf645, 0x9fcc, 0xdf64, 0x4385, 0x5da4, 0x1fc6, 0xed05, 0x2360];

const u32 = (x: number) => x >>> 0;
const hashmix = (value: number, hc: { v: number }): number => {
  let x = u32(value ^ hc.v);
  hc.v = u32(Math.imul(hc.v, MULT_A));
  x = u32(Math.imul(x, hc.v));
  return u32(x ^ (x >>> 16));
};
const mix = (x: number, y: number): number => {
  const r = u32(Math.imul(MIX_L, x) - Math.imul(MIX_R, y));
  return u32(r ^ (r >>> 16));
};

/** SeedSequence(seed).generate_state(4, uint64) as eight 32-bit words, the low half of each 64-bit word first. */
export function seedState(seed: number): number[] {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("seed must be a non-negative safe integer");
  const entropy: number[] = [];
  for (let s = seed; ; s = Math.floor(s / 2 ** 32)) {
    entropy.push(s % 2 ** 32);
    if (s < 2 ** 32) break;
  }
  const hc = { v: INIT_A };
  const pool = [0, 1, 2, 3].map((i) => hashmix(i < entropy.length ? entropy[i]! : 0, hc));
  for (let s = 0; s < 4; s++) for (let d = 0; d < 4; d++) if (s !== d) pool[d] = mix(pool[d]!, hashmix(pool[s]!, hc));
  for (let s = 4; s < entropy.length; s++) for (let d = 0; d < 4; d++) pool[d] = mix(pool[d]!, hashmix(entropy[s]!, hc));
  let hb = INIT_B;
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    let x = u32(pool[i % 4]! ^ hb);
    hb = u32(Math.imul(hb, MULT_B));
    x = u32(Math.imul(x, hb));
    out.push(u32(x ^ (x >>> 16)));
  }
  return out;
}

/** A 128-bit value from its high and low 64-bit words, each given as (low 32, high 32), as 16-bit limbs from the low end. */
const limbs = (hiLo32: number, hiHi32: number, loLo32: number, loHi32: number): number[] =>
  [loLo32, loHi32, hiLo32, hiHi32].flatMap((w) => [w & 0xffff, w >>> 16]);

export class Pcg64 {
  private s: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  private inc: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

  constructor(seed: number) {
    const w = seedState(seed);
    const initstate = limbs(w[0]!, w[1]!, w[2]!, w[3]!);
    const initseq = limbs(w[4]!, w[5]!, w[6]!, w[7]!);
    let carry = 1;
    for (let i = 0; i < 8; i++) {
      const v = initseq[i]! * 2 + carry;
      this.inc[i] = v & 0xffff;
      carry = v >>> 16;
    }
    this.step();
    this.add(initstate);
    this.step();
  }

  private add(x: ArrayLike<number>): void {
    let carry = 0;
    for (let i = 0; i < 8; i++) {
      const v = this.s[i]! + x[i]! + carry;
      this.s[i] = v & 0xffff;
      carry = v >>> 16;
    }
  }

  private step(): void {
    const a = this.s, r = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 8; i++) {
      const ai = a[i]!;
      if (!ai) continue;
      for (let j = 0; j + i < 8; j++) r[i + j] += ai * MULT[j]!;
    }
    let carry = 0;
    for (let k = 0; k < 8; k++) {
      const v = r[k]! + carry;
      const lo = v % 65536;
      carry = (v - lo) / 65536;
      a[k] = lo;
    }
    this.add(this.inc);
  }

  /** next_uint64 as [high 32, low 32]. */
  next64(): [number, number] {
    this.step();
    const s = this.s;
    let hi = u32(((s[7]! << 16) | s[6]!) ^ ((s[3]! << 16) | s[2]!));
    let lo = u32(((s[5]! << 16) | s[4]!) ^ ((s[1]! << 16) | s[0]!));
    const rot = s[7]! >>> 10;
    if (rot >= 32) [hi, lo] = [lo, hi];
    const r = rot % 32;
    if (r) [hi, lo] = [u32((hi >>> r) | (lo << (32 - r))), u32((lo >>> r) | (hi << (32 - r)))];
    return [hi, lo];
  }

  nextDouble(): number {
    const [hi, lo] = this.next64();
    return (hi * 2 ** 21 + (lo >>> 11)) / 9007199254740992;
  }
}

/** numpy's Generator for the two draws power.py makes: binomial (random_binomial) and multinomial (random_multinomial). */
export class NumpyGenerator {
  private cache: { n: number; p: number; f: number[] } = { n: -1, p: NaN, f: [] };
  constructor(readonly bits: Pcg64) {}

  binomial(p: number, n: number): number {
    if (n === 0 || p === 0) return 0;
    if (p <= 0.5) return p * n <= 30 ? this.inversion(n, p) : this.btpe(n, p);
    const q = 1 - p;
    return q * n <= 30 ? n - this.inversion(n, q) : n - this.btpe(n, q);
  }

  private inversion(n: number, p: number): number {
    if (this.cache.n !== n || this.cache.p !== p) {
      const q = 1 - p, np = n * p;
      this.cache = { n, p, f: [q, Math.exp(n * Math.log1p(-p)), Math.trunc(Math.min(n, np + 10 * Math.sqrt(np * q + 1)))] };
    }
    const [q, qn, bound] = this.cache.f as [number, number, number];
    let x = 0, px = qn, u = this.bits.nextDouble();
    while (u > px) {
      x++;
      if (x > bound) {
        x = 0;
        px = qn;
        u = this.bits.nextDouble();
      } else {
        u -= px;
        px = ((n - x + 1) * p * px) / (x * q);
      }
    }
    return x;
  }

  private btpe(n: number, p: number): number {
    if (this.cache.n !== n || this.cache.p !== p) {
      const r = Math.min(p, 1 - p), q = 1 - r, fm = n * r + r, m = Math.floor(fm);
      const p1 = Math.floor(2.195 * Math.sqrt(n * r * q) - 4.6 * q) + 0.5, xm = m + 0.5, xl = xm - p1, xr = xm + p1;
      const c = 0.134 + 20.5 / (15.3 + m);
      let a = (fm - xl) / (fm - xl * r);
      const laml = a * (1 + a / 2);
      a = (xr - fm) / (xr * q);
      const lamr = a * (1 + a / 2);
      const p2 = p1 * (1 + 2 * c), p3 = p2 + c / laml, p4 = p3 + c / lamr;
      this.cache = { n, p, f: [r, q, m, p1, xm, xl, xr, c, laml, lamr, p2, p3, p4] };
    }
    const [r, q, m, p1, xm, xl, xr, c, laml, lamr, p2, p3, p4] = this.cache.f as [number, number, number, number, number, number, number, number, number, number, number, number, number];
    const err = (t: number, t2: number) => (13860 - (462 - (132 - (99 - 140 / t2) / t2) / t2) / t2) / t / 166320;
    const done = (y: number) => (p > 0.5 ? n - y : y);
    for (;;) {
      const nrq = n * r * q;
      const u = this.bits.nextDouble() * p4;
      let v = this.bits.nextDouble();
      let y: number;
      if (u <= p1) return done(Math.floor(xm - p1 * v + u));
      if (u <= p2) {
        const x = xl + (u - p1) / c;
        v = v * c + 1 - Math.abs(m - x + 0.5) / p1;
        if (v > 1) continue;
        y = Math.floor(x);
      } else if (u <= p3) {
        y = Math.floor(xl + Math.log(v) / laml);
        if (y < 0 || v === 0) continue;
        v = v * (u - p2) * laml;
      } else {
        y = Math.floor(xr - Math.log(v) / lamr);
        if (y > n || v === 0) continue;
        v = v * (u - p3) * lamr;
      }
      const k = Math.abs(y - m);
      if (!(k > 20 && k < nrq / 2 - 1)) {
        const s = r / q, a = s * (n + 1);
        let f = 1;
        if (m < y) for (let i = m + 1; i <= y; i++) f *= a / i - s;
        else if (m > y) for (let i = y + 1; i <= m; i++) f /= a / i - s;
        if (v > f) continue;
        return done(y);
      }
      const rho = (k / nrq) * ((k * (k / 3 + 0.625) + 0.16666666666666666) / nrq + 0.5);
      const t = (-k * k) / (2 * nrq);
      const A = Math.log(v);
      if (A < t - rho) return done(y);
      if (A > t + rho) continue;
      const x1 = y + 1, f1 = m + 1, z = n + 1 - m, w = n - y + 1;
      const bound = xm * Math.log(f1 / x1) + (n - m + 0.5) * Math.log(z / w) + (y - m) * Math.log((w * r) / (x1 * q)) + err(f1, f1 * f1) + err(z, z * z) - err(x1, x1 * x1) - err(w, w * w);
      if (A > bound) continue;
      return done(y);
    }
  }

  /** Generator.multinomial(n, pvals) for one draw. */
  multinomial(n: number, pvals: readonly number[]): number[] {
    const out = new Array<number>(pvals.length).fill(0);
    let remaining = 1, dn = n;
    for (let j = 0; j < pvals.length - 1; j++) {
      out[j] = this.binomial(pvals[j]! / remaining, dn);
      dn -= out[j]!;
      if (dn <= 0) break;
      remaining -= pvals[j]!;
    }
    if (dn > 0) out[pvals.length - 1] = dn;
    return out;
  }
}

/** numpy.random.default_rng(seed). */
export const defaultRng = (seed: number): NumpyGenerator => new NumpyGenerator(new Pcg64(seed));
