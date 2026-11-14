// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 0's Node-version print (the Captain's Node ruling): each candidate's declared Node version, read from its tree at
// the pin (package.json's engines.node, .nvmrc and .node-version at the root), whether the pinned Node satisfies it, and
// whether the failing qualification step's stderr shows an engine-mismatch error. These fields are printed and recorded
// only; nothing here changes how a recipe qualifies or drops, and no stderr is ever printed.
import { NODE } from "../stage3/install.ts";

/** Engine-mismatch errors from npm (EBADENGINE), pnpm and yarn, read on a failing step's stderr. */
export const ENGINE_MISMATCH = [/\bEBADENGINE\b/, /\bERR_PNPM_UNSUPPORTED_ENGINE\b/, /The engine "node" is incompatible/, /Unsupported engine/];

export const engineMismatch = (stderr: string): boolean => ENGINE_MISMATCH.some((p) => p.test(stderr));

const PART = "(?:\\d+|[xX*])";
const COMPARATOR = "(?:[<>]=?|=|\\^|~>?)?\\s*v?" + PART + "(?:\\." + PART + "){0,2}(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
const SET = COMPARATOR + "(?:\\s+(?:-\\s+)?" + COMPARATOR + ")*";
/** A semver range. Bun.semver.satisfies answers true on text it can't parse, so a declaration must match this first. */
const RANGE = new RegExp("^" + SET + "(?:\\s*\\|\\|\\s*" + SET + ")*$");
/** nvm's aliases: version-like text that names no range Bun.semver can check. */
const ALIAS = /^(?:lts\/(?:\*|-?\d+|[a-z]+)|node|stable|latest|current|system|iojs)$/i;
/** What a declaration prints as when its text is neither a semver range nor an nvm alias. */
export const NOT_VERSION_LIKE = "not version-like";

export type Fits = "yes" | "no" | "unknown";

/** A candidate's declared Node versions as printed (version-like text cut to 40 characters, null when absent). */
export interface NodeDeclared {
  engines: string | null;
  nvmrc: string | null;
  nodeVersion: string | null;
  /** Whether NODE.version satisfies every declaration: unknown when none is declared or one is not a semver range. */
  pinnedFits: Fits;
}

const dec = new TextDecoder();
const cstr = (b: Uint8Array) => {
  const z = b.indexOf(0);
  return dec.decode(z < 0 ? b : b.subarray(0, z));
};

/** The named root files of a tar (POSIX ustar, pax and GNU long names), as text; bytes that are not a tar hold none. */
export function rootFiles(tar: Uint8Array, names: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  let next: string | null = null;
  for (let off = 0; off + 512 <= tar.length; ) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(cstr(h.subarray(124, 136)).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0) break;
    const body = tar.subarray(off + 512, off + 512 + size);
    const type = String.fromCharCode(h[156]!);
    const prefix = cstr(h.subarray(257, 263)) === "ustar" ? cstr(h.subarray(345, 500)) : "";
    const name = (next ?? (prefix ? prefix + "/" : "") + cstr(h.subarray(0, 100))).replace(/^\.\//, "");
    next = null;
    if (type === "x") next = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(dec.decode(body))?.[1] ?? null;
    else if (type === "L") next = cstr(body);
    else if ((type === "0" || type === "\0") && names.includes(name) && !out.has(name)) out.set(name, dec.decode(body));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

function declaration(raw: unknown): { text: string; fits: Fits } | null {
  const s = typeof raw === "string" ? raw.trim() : raw;
  if (s === undefined || s === null || s === "") return null;
  if (typeof s !== "string" || s.length > 200) return { text: NOT_VERSION_LIKE, fits: "unknown" };
  if (RANGE.test(s)) return { text: s.slice(0, 40), fits: Bun.semver.satisfies(NODE.version, s) ? "yes" : "no" };
  return { text: ALIAS.test(s) ? s : NOT_VERSION_LIKE, fits: "unknown" };
}

/** Reads a candidate's tree for its declared Node versions and whether the pinned Node satisfies them. */
export function nodeDeclared(tar: Uint8Array): NodeDeclared {
  const f = rootFiles(tar, ["package.json", ".nvmrc", ".node-version"]);
  const engines = (() => {
    try {
      return JSON.parse(f.get("package.json") ?? "null")?.engines?.node;
    } catch {
      return undefined;
    }
  })();
  const line = (t: string | undefined) => t?.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
  const [e, n, v] = [engines, line(f.get(".nvmrc")), line(f.get(".node-version"))].map(declaration);
  const fits = [e, n, v].flatMap((d) => (d ? [d.fits] : []));
  return { engines: e?.text ?? null, nvmrc: n?.text ?? null, nodeVersion: v?.text ?? null, pinnedFits: !fits.length ? "unknown" : fits.includes("no") ? "no" : fits.includes("unknown") ? "unknown" : "yes" };
}

/** The node fields printed after a candidate's qualification result; null declarations mean its tree could not be read. */
export const nodeLine = (d: NodeDeclared | null, engineError: boolean) =>
  "node: " +
  (d ? "engines " + (d.engines ?? "none") + ", .nvmrc " + (d.nvmrc ?? "none") + ", .node-version " + (d.nodeVersion ?? "none") + ", pinned " + NODE.version + " fits " + d.pinnedFits : "tree not read, pinned " + NODE.version + " fits unknown") +
  ", node-engine flag " +
  (engineError ? "yes" : "no");
