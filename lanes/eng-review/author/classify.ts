// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals er classify (prereg 2026-11-08-geva-405, section 4, project types): the frozen type rule, applied to the
// repository's description, README and topics, blind to the key. Opus 5.5 and GPT-6.1 Sol label each unit
// independently, at high effort through the metered client; on a split Gemini 4 Argon labels it and its label stands.
// The labels go to <unit>/classify.json and the type to <unit>/unit.json before any arm runs.
//   er classify --work <custody dir> --item <ledger item> [--ids a,b] [--record <dir>] [--ledger <path>]
// Build-time choices where the prereg is silent (lanes/eng-review/README.md, authoring side):
// - The README is the first README file at the root of repo/, the tree at base, cut at 3,000 words. GitHub keeps no
//   history of a repository's description and topics, so they are read at authoring, the nearest record to base.
// - A unit with no label from the decision stays unclassified and keeps its provisional type out of every set.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ask, cut, fence, pinnedHead } from "../../product-value/author/run.ts";
import { need, parseArgs } from "../../product-value/io.ts";
import { openMeter, pool, type ModelKey } from "../../product-value/meter.ts";
import type { Io } from "../cli.ts";
import { PROJECT_TYPES, type ProjectType, type UnitMeta } from "../types.ts";
import { custody, EFFORT, put, readJson, type Material } from "./run.ts";

/** The type rule, word for word from section 4. */
export const RULE = "**mobile** (an iOS or Android app, not a library or SDK); **consumer** (end users run it: desktop, web or browser apps, games, media, notes, chat, personal productivity, home apps); **server-side data or enterprise** (an organization operates it: databases, data pipelines, self-hosted business software, analytics, observability, identity, queues, search engines); **developer tools** (libraries, frameworks, command-line tools, build tools and the rest). The first match in that order wins.";

export const PROMPT = "Give this software project one type by the rule below, applied to the project as described here.\n\n" + RULE + "\n\nOutput one fenced json block holding {\"type\": \"mobile\" | \"consumer\" | \"server\" | \"devtools\", \"why\": \"one sentence\"} and nothing else. Use \"server\" for server-side data or enterprise and \"devtools\" for developer tools.";

export const CLASSIFIERS: readonly ModelKey[] = ["opus", "sol"];
export const THIRD: ModelKey = "gemini";

/** What a classifier may read: the description and topics, and the README at base. */
export function material(unit: string, scratch: string): string {
  const about = existsSync(join(scratch, "material.json")) ? (readJson(join(scratch, "material.json")) as Material).about : { description: "", topics: [] };
  const readme = existsSync(join(unit, "repo")) ? readdirSync(join(unit, "repo")).sort().find((f) => /^readme(\.(md|markdown|rst|txt|adoc))?$/i.test(f)) : undefined;
  return fence("Repository description", about.description || "(none)") + fence("Repository topics", about.topics.join(", ") || "(none)") + fence("README", readme ? cut(readFileSync(join(unit, "repo", readme), "utf8"), 3000) : "(none)");
}

/** Agreement stands; a split takes the third label. */
export const decide = (a: ProjectType | null, b: ProjectType | null, third: ProjectType | null): ProjectType | null => (a && a === b ? a : third);

export const label = (r: any): ProjectType | null => (PROJECT_TYPES.includes(r?.type) ? (r.type as ProjectType) : null);

const USAGE = "er classify --work <custody dir> --item <ledger item> [--ids a,b] [--record <dir>] [--ledger <path>]";

export async function run(argv: string[], io: Io, o: { fetch?: typeof fetch; env?: Record<string, string | undefined>; custodyRoot?: string; journals?: string; head?: string } = {}): Promise<number> {
  const a = parseArgs(argv, { work: "one", item: "one", ids: "one", record: "one", ledger: "one" }, USAGE);
  need(a, ["work", "item"], USAGE);
  const work = custody(a.one.work!, o.custodyRoot);
  const head = o.head ?? pinnedHead();
  const units = join(work, "units");
  const ids = a.one.ids ? a.one.ids.split(",").filter(Boolean) : existsSync(units) ? readdirSync(units).filter((d) => existsSync(join(units, d, "unit.json"))).sort() : [];
  const logs: unknown[] = [];
  const log = (uid: string, stage: string, data: Record<string, unknown>) => logs.push({ at: new Date().toISOString(), head, uid, stage, ...data });
  const m = await openMeter({ item: a.one.item!, runId: a.one.item!, out: join(o.journals ?? join(process.env.HOME ?? "/tmp", ".capy/work/er/journals"), a.one.item!), cacheDir: join(work, "cache"), maxOutputTokens: 8000, record: a.one.record, ledger: a.one.ledger, env: o.env, fetch: o.fetch });
  const out: string[] = [];
  try {
    await pool(3, ids.map((uid) => async () => {
      const unit = join(units, uid);
      if (existsSync(join(unit, "classify.json"))) return out.push(uid + " already classified");
      const text = PROMPT + material(unit, join(work, "scratch", uid));
      const one = async (model: ModelKey) => {
        try {
          return label(await ask({ log }, m, uid, "classify-" + model, model, text, 2000, EFFORT, true));
        } catch {
          return null;
        }
      };
      const [x, y] = await Promise.all(CLASSIFIERS.map(one));
      const third = x && x === y ? null : await one(THIRD);
      const type = decide(x, y, third);
      put(join(unit, "classify.json"), { opus: x, sol: y, gemini: third, type, head });
      if (!type) return out.push(uid + " unclassified");
      put(join(unit, "unit.json"), { ...(readJson(join(unit, "unit.json")) as UnitMeta), type });
      out.push(uid + " " + type + (third ? " (settled by the third classifier)" : ""));
    }));
  } finally {
    const c = await m.close();
    put(join(work, "classify-log-" + Date.now() + ".json"), logs);
    io.out("er classify: spent " + (c.spent_micros / 1e6).toFixed(4) + " USD on " + a.one.item);
  }
  for (const l of out) io.out(l);
  return 0;
}
