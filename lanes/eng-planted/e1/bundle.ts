// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's review bundle (prereg 2026-11-24-geva-587-design-time-state-modeling section 3, What the builder gets): the
// review's final plan.md at /work/plan.md, and under /work/review/ its final reply, gstack's test plan files (G, as
// attempt 3's precut arm hands them on), then every text file the session wrote outside /work/repo, first under /work in
// path order, then under /tmp in path order. The plan and the files share the 12,000-word cap in that order, with the
// cut recorded, as attempt 3's reviewMount caps them.
//
// - /work: every regular file under the session's work dir except repo/, plan.md, gstack's state root (G's test plan
//   files come from it through bundleParts) and the launcher's own copy of /tmp.
// - /tmp: the launcher copies every regular file the session left under /tmp newer than its start mark into
//   <work>/.e1-tmp before the container stops (launch.ts), less the launcher's own marks.
// - A file counts as text when it holds no NUL byte and decodes as UTF-8; others, and files over 4 MB, are counted and
//   left out. A name a part already used gets a numeric prefix, as reviewMount numbers them.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bundleParts } from "../../eng-build/bundle.ts";
import { STATE_ROOT_DIR } from "../../../src/trial/state-root.ts";
import { capParts, type ReviewMount } from "../stages/build.ts";
import { E1, type E1Arm } from "./frozen.ts";

export const TMP_COPY = ".e1-tmp";
export const TMP_MARK_PREFIX = ".e1-";
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const WORK_SKIP = new Set(["repo", "plan.md", STATE_ROOT_DIR, TMP_COPY]);
const utf8 = new TextDecoder("utf-8", { fatal: true });

export interface Written {
  files: Array<{ path: string; text: string }>;
  binary: number;
  large: number;
}

function walk(root: string, rel: string, skipTop: (name: string) => boolean, out: string[]): void {
  for (const name of readdirSync(join(root, rel)).sort()) {
    if (!rel && skipTop(name)) continue;
    const r = rel ? rel + "/" + name : name;
    const st = lstatSync(join(root, r));
    if (st.isDirectory()) walk(root, r, skipTop, out);
    else if (st.isFile()) out.push(r);
  }
}

/** The text files a session wrote outside /work/repo, read from its work dir on the host. */
export function writtenFiles(work: string): Written {
  const found: Array<{ path: string; host: string }> = [];
  const w: string[] = [];
  walk(work, "", (n) => WORK_SKIP.has(n), w);
  found.push(...w.map((r) => ({ path: "/work/" + r, host: join(work, r) })));
  const tmp = join(work, TMP_COPY);
  if (lstatSync(tmp, { throwIfNoEntry: false })?.isDirectory()) {
    const t: string[] = [];
    walk(tmp, "", (n) => n.startsWith(TMP_MARK_PREFIX), t);
    found.push(...t.map((r) => ({ path: "/tmp/" + r, host: join(tmp, r) })));
  }
  const out: Written = { files: [], binary: 0, large: 0 };
  for (const f of found) {
    if (lstatSync(f.host).size > MAX_FILE_BYTES) {
      out.large++;
      continue;
    }
    const b = readFileSync(f.host);
    let text: string | null = null;
    if (!b.includes(0)) {
      try {
        text = utf8.decode(b);
      } catch {
        text = null;
      }
    }
    if (text === null) out.binary++;
    else out.files.push({ path: f.path, text });
  }
  return out;
}

export interface E1Outputs {
  plan: string | null;
  /** The session's transcript in Claude Code's stream-json shape (a Codex session's rollouts converted). */
  transcript: string;
  stateRoot: string | null;
  written: ReadonlyArray<{ path: string; text: string }>;
}

/** What an arm's build mounts, from its review session's outputs. */
export function e1Mount(arm: E1Arm, o: E1Outputs, authoredPlan: string, maxWords: number = E1.bundleWords): ReviewMount {
  const parts = bundleParts(arm === "G" ? "precut" : "plain", { plan: o.plan, transcript: o.transcript, stateRoot: arm === "G" ? o.stateRoot : null, coverage: null });
  const planMissing = o.plan === null;
  const all = [...(planMissing ? [{ name: "plan.md", text: authoredPlan }] : []), ...parts, ...o.written.map((f) => ({ name: f.path.split("/").at(-1)!, text: f.text }))];
  const seen = new Map<string, number>();
  const named = all.map((p, i) => {
    if (i === 0) return p;
    const n = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, n);
    return n === 1 ? p : { name: n + "-" + p.name, text: p.text };
  });
  const c = capParts(named, maxWords);
  return { plan: c.kept[0]?.text ?? "", files: c.kept.slice(1), words: c.words, fullWords: c.fullWords, truncated: c.truncated, planMissing };
}
