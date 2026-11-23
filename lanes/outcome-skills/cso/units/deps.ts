// Copyright (c) 2026 Garry Tan. MIT License.
// Deviation (c), dated pre-data (deviations post 2026-11-21-capy-cso-advisories-deviations): a unit whose affected
// package an arm's installed gstack tree holds at or past its fixed version drops from every cell, because that install
// carries the fixed code of the library under audit and the none arm's does not. The gate reads every lockfile and
// installed package manifest it knows in the tree (bun.lock, package-lock.json, yarn.lock, pnpm-lock.yaml and
// node_modules package.json files for npm; Cargo.lock for crates.io; go.sum for Go) and evaluates the advisory's OSV
// ranges at each held version: a version carries the fix when no range affects it and some fixed event sits at or below
// it. A Maven or NuGet lockfile or manifest it can't read fails closed (E_CSO_SCAN) when a unit of that ecosystem is
// asked about. NAMED_DROPS lists the 16 units gstack's pinned lockfiles hold past their fix and the id rule (a) misses;
// they drop by name before the draw, and the gate drops them again on each arm's installed tree.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { csoFail } from "../prereg.ts";

export interface OsvEvent { introduced?: string; fixed?: string; last_affected?: string }
export interface Affected { ecosystem: string; name: string; ranges: OsvEvent[][] }
export interface UnitAffected { unit: string; affected: Affected[] }
export interface Held { ecosystem: "npm" | "crates.io" | "Go"; name: string; version: string; path: string }
export interface DepHit { unit: string; ecosystem: string; name: string; version: string; fixed: string; path: string }
export interface DepContain { schema: "cso-dep-contain.v1"; deviation: "c"; arm: string; held: number; unread: string[]; hits: DepHit[]; dropped: string[] }

/** The 16 candidates gstack's lockfiles at 5afef04 hold at or past the fixed version, with the line behind each. */
export const NAMED_DROPS: ReadonlyArray<{ unit: string; line: string }> = [
  { unit: "honojs__hono-ghsa-5r4p-p66f-jhc7", line: "bun.lock hono@4.13.16, fixed in 4.13.11" },
  { unit: "jshttp__proxy-addr-ghsa-jqcg-44mw-7w3h", line: "bun.lock proxy-addr@2.0.8, fixed in 2.0.8" },
  { unit: "ljharb__qs-ghsa-4mjr-xmp4-gh2g", line: "bun.lock qs@6.16.2, fixed in 6.16.0" },
  { unit: "beaugunderson__ip-address-ghsa-j6r3-76f7-8jcv", line: "bun.lock ip-address@10.7.4, fixed in 10.7.1" },
  { unit: "honojs__hono-ghsa-hxh3-vqpv-xpqv", line: "bun.lock hono@4.13.16, fixed in 4.13.7" },
  { unit: "honojs__hono-ghsa-g6gw-c38x-mqfc", line: "bun.lock hono@4.13.16, fixed in 4.13.5" },
  { unit: "beaugunderson__ip-address-ghsa-2vr4-cq9g-pvrc", line: "bun.lock ip-address@10.7.4, fixed in 10.5.1" },
  { unit: "ai__nanoid-ghsa-xwg4-73v4-xw9w", line: "bun.lock nanoid@3.3.18 and lib/diagram-render/bun.lock nanoid@5.1.16, fixed in 3.3.12 and 5.1.11" },
  { unit: "7rulnik__source-map-js-ghsa-68fv-2mgg-jv7q", line: "lib/diagram-render/bun.lock source-map-js@1.2.2, fixed in 1.2.2" },
  { unit: "ljharb__qs-ghsa-x5fp-wj9c-mxmx", line: "bun.lock qs@6.16.2, fixed in 6.16.0" },
  { unit: "cthackers__adm-zip-ghsa-xcpc-8h2w-3j85", line: "bun.lock adm-zip@0.6.1, fixed in 0.6.0" },
  { unit: "immutable-js__immutable-js-ghsa-v56q-mh7h-f735", line: "lib/diagram-render/bun.lock immutable@4.3.9, fixed in 4.3.9" },
  { unit: "immutable-js__immutable-js-ghsa-xvcm-6775-5m9r", line: "lib/diagram-render/bun.lock immutable@4.3.9, fixed in 4.3.9" },
  { unit: "honojs__node-server-ghsa-9mqv-5hh9-4cgg", line: "bun.lock @hono/node-server@2.1.6, fixed in 2.0.10" },
  { unit: "expressjs__body-parser-ghsa-v422-hmwv-36x6", line: "bun.lock body-parser@2.4.0, fixed in 2.3.0" },
  { unit: "ai__nanoid-ghsa-28wg-ghj8-5hjv", line: "bun.lock nanoid@3.3.18 and lib/diagram-render/bun.lock nanoid@5.1.16, fixed in 3.3.16 and 5.1.16" },
];

/** Compares two versions: a leading v and build metadata are ignored, dotted parts compare numerically when both are
 *  numbers, and a prerelease sorts before its release. "0" is the lowest version, as OSV's introduced "0" means. */
export function cmpVersion(a: string, b: string): number {
  const split = (v: string) => {
    const s = v.trim().replace(/^v/i, "").split("+")[0];
    const i = s.indexOf("-");
    return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
  };
  const parts = (s: string, n: boolean) => s.split(".").map((p) => (n && /^\d+$/.test(p) ? Number(p) : p));
  const cmpParts = (x: (string | number)[], y: (string | number)[], pad: boolean) => {
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i] ?? (pad ? 0 : undefined), q = y[i] ?? (pad ? 0 : undefined);
      if (p === undefined) return -1;
      if (q === undefined) return 1;
      if (p === q) continue;
      if (typeof p === "number" && typeof q === "number") return p < q ? -1 : 1;
      if (typeof p === "number") return -1;
      if (typeof q === "number") return 1;
      return p < q ? -1 : 1;
    }
    return 0;
  };
  const [ma, pa] = split(a), [mb, pb] = split(b);
  const c = cmpParts(parts(ma, true), parts(mb, true), true);
  if (c || pa === pb) return c;
  if (!pa) return 1;
  if (!pb) return -1;
  return cmpParts(parts(pa, true), parts(pb, true), false);
}

/** OSV semantics for one range: walking its events in version order, introduced opens, fixed closes at its version, and
 *  last_affected closes just after its version. */
export function affects(range: readonly OsvEvent[], v: string): boolean {
  const ev = range.map((e) => ({ e, at: e.introduced ?? e.fixed ?? e.last_affected ?? "0" })).sort((x, y) => cmpVersion(x.at, y.at));
  let on = false;
  for (const { e, at } of ev) {
    const c = cmpVersion(at, v);
    if (e.introduced !== undefined && c <= 0) on = true;
    if (e.fixed !== undefined && c <= 0) on = false;
    if (e.last_affected !== undefined && c < 0) on = false;
  }
  return on;
}

/** The fixed version a held version carries, or null: no range affects it and a fixed event sits at or below it. */
export function carriesFix(a: Affected, v: string): string | null {
  if (a.ranges.some((r) => affects(r, v))) return null;
  const fixed = a.ranges.flat().map((e) => e.fixed).filter((f): f is string => f !== undefined && cmpVersion(f, v) <= 0).sort(cmpVersion);
  return fixed.length ? fixed[fixed.length - 1] : null;
}

const UNREAD: Record<string, RegExp> = { Maven: /(^|\/)(pom\.xml|gradle\.lockfile|build\.gradle(\.kts)?)$/, NuGet: /(^|\/)(packages\.lock\.json|packages\.config|[^/]+\.csproj)$/ };

function walk(root: string, out: string[] = [], dir = root): string[] {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name === ".git") continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(root, out, p);
    else if (d.isFile()) out.push(relative(root, p));
  }
  return out;
}

/** Every package version the tree's lockfiles and installed npm manifests hold, plus the paths of lockfiles it can't read. */
export function heldPackages(rootIn: string): { held: Held[]; unread: string[] } {
  const root = resolve(rootIn);
  try {
    statSync(root);
  } catch {
    csoFail("E_CSO_SCAN", root + " does not exist");
  }
  const held: Held[] = [];
  const unread: string[] = [];
  const add = (ecosystem: Held["ecosystem"], name: string, version: string, path: string) => version && /^v?\d/.test(version) && held.push({ ecosystem, name, version, path });
  for (const path of walk(root)) {
    const base = path.split("/").pop()!;
    const text = () => readFileSync(join(root, path), "utf8");
    if (base === "bun.lock") for (const m of text().matchAll(/"((?:@[^"/\s]+\/)?[^"@\s/]+)@(\d[^"\s]*)"/g)) add("npm", m[1], m[2], path);
    else if (base === "package-lock.json") {
      const j = JSON.parse(text()) as { packages?: Record<string, { version?: string; name?: string }> };
      for (const [k, p] of Object.entries(j.packages ?? {})) if (k.includes("node_modules/") && p.version) add("npm", p.name ?? k.slice(k.lastIndexOf("node_modules/") + 13), p.version, path);
    } else if (base === "yarn.lock") {
      for (const m of text().matchAll(/^"?((?:@[^@"\s/]+\/)?[^@"\s,]+)@[^\n]*:\n\s+version:? "?([^"\n]+)"?/gm)) add("npm", m[1], m[2], path);
    } else if (base === "pnpm-lock.yaml") {
      for (const m of text().matchAll(/^\s+'?\/?((?:@[^/@\s']+\/)?[^/@\s:']+)[@/](\d[^:('\s]*)/gm)) add("npm", m[1], m[2], path);
    } else if (base === "package.json" && /(^|\/)node_modules\/(@[^/]+\/)?[^/]+\/package\.json$/.test(path)) {
      try {
        const j = JSON.parse(text()) as { name?: string; version?: string };
        if (j.name && j.version) add("npm", j.name, j.version, path);
      } catch {
        unread.push(path);
      }
    } else if (base === "Cargo.lock") for (const m of text().matchAll(/\[\[package\]\]\s*\nname = "([^"]+)"\s*\nversion = "([^"]+)"/g)) add("crates.io", m[1], m[2], path);
    else if (base === "go.sum") for (const m of text().matchAll(/^(\S+) (v[^\s/]+)(?:\/go\.mod)? /gm)) add("Go", m[1], m[2], path);
    else if (Object.values(UNREAD).some((re) => re.test(path))) unread.push(path);
  }
  return { held, unread };
}

/** The deviation (c) record for one arm's installed tree over the candidate units. */
export function containDeps(o: { arm: string; root: string; units: readonly UnitAffected[] }): DepContain {
  const { held, unread } = heldPackages(o.root);
  for (const [eco, re] of Object.entries(UNREAD)) {
    const blind = unread.filter((p) => re.test(p));
    if (blind.length && o.units.some((u) => u.affected.some((a) => a.ecosystem === eco))) csoFail("E_CSO_SCAN", o.arm + ": the tree holds " + eco + " files the dependency gate can't read (" + blind.slice(0, 3).join(", ") + "); fail closed");
  }
  const byKey = new Map<string, Held[]>();
  for (const h of held) byKey.set(h.ecosystem + " " + h.name.toLowerCase(), [...(byKey.get(h.ecosystem + " " + h.name.toLowerCase()) ?? []), h]);
  const hits: DepHit[] = [];
  for (const u of o.units)
    for (const a of u.affected)
      for (const h of byKey.get(a.ecosystem + " " + a.name.toLowerCase()) ?? []) {
        const fixed = carriesFix(a, h.version);
        if (fixed) hits.push({ unit: u.unit, ecosystem: a.ecosystem, name: a.name, version: h.version, fixed, path: h.path });
      }
  return { schema: "cso-dep-contain.v1", deviation: "c", arm: o.arm, held: held.length, unread, hits, dropped: [...new Set(hits.map((h) => h.unit))].sort() };
}
