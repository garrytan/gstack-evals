// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals pv classify (prereg section 4, project types): the frozen type rule, applied to the project as it
// stood at plan time from its repository description, README and context/ only, blind to the key and the record after
// the plan. Opus 5.5 and GPT-6 Astra label each unit independently; on a disagreement Gemini 4 Argon labels it and its
// label stands. Every label is written to unit/classify.json and the final type to unit/unit.json before any arm runs.
//   pv classify --units <dir> --item pv-auth-classify [--ids a,b]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decide as panelDecide, panel } from "../../aftermath/panel.ts";
import type { Io } from "../cli.ts";
import { openMeter, pool, type ModelKey } from "../meter.ts";
import type { ProjectType, UnitMeta } from "../types.ts";
import { AuthorError, ask, cut, fence, flag, pinnedHead, put, readJson } from "./run.ts";

/** The type rule, word for word from section 4. */
export const RULE = [
  "- consumer: end users run it (desktop, web or browser apps, games, media, notes, chat, personal productivity, home apps);",
  "- server-side data or enterprise: an organization operates it (databases, data pipelines, self-hosted business software, analytics, observability, identity, queues, search engines);",
  "- mobile: an iOS or Android app;",
  "- other: developer tools, libraries, frameworks, command-line tools and the rest.",
  "",
  "When more than one fits, the first in the order mobile, consumer, server-side data or enterprise, other wins.",
].join("\n");

export const PROMPT = "Give this project one type by the rule below, applied to the project as it is described here.\n\n" + RULE +
  "\n\nOutput one fenced json block holding {\"type\": \"consumer\" | \"server\" | \"mobile\" | \"other\", \"why\": \"one sentence\"} and nothing else. Use \"server\" for server-side data or enterprise.";

export const CLASSIFIERS: readonly ModelKey[] = ["opus", "astra"];
export const THIRD: ModelKey = "gemini";
const TYPES = new Set<ProjectType>(["consumer", "server", "mobile", "other"]);

/** What a classifier may read: the repository description, topics and README at plan time when public, and context/. */
export function material(dir: string): string {
  const parts: string[] = [];
  const rec = join(dir, "raw/record.json");
  if (existsSync(rec)) {
    const r = readJson(rec);
    parts.push(fence("Repository description", r.description || "(none)"));
    if ((r.topics ?? []).length) parts.push(fence("Repository topics", r.topics.join(", ")));
    const readme = join(dir, "raw/readme.md");
    if (existsSync(readme)) parts.push(fence("README at the time of the plan", cut(readFileSync(readme, "utf8"), 3000)));
  }
  const ctx = join(dir, "unit/context");
  for (const f of existsSync(ctx) ? readdirSync(ctx).sort() : []) parts.push(fence("context/" + f, readFileSync(join(ctx, f), "utf8")));
  return parts.join("");
}

export function decide(a: ProjectType | null, b: ProjectType | null, third: ProjectType | null): ProjectType | null {
  return panelDecide(a, b, third);
}

export async function run(argv: string[], io: Io): Promise<number> {
  const units = flag(argv, "--units"), item = flag(argv, "--item");
  if (!units || !item) throw new AuthorError("E_USAGE", "pv classify --units <dir> --item pv-auth-classify [--ids a,b]");
  const head = pinnedHead();
  const ids = (flag(argv, "--ids") ?? "").split(",").filter(Boolean);
  const list = ids.length ? ids : readdirSync(units).filter((d) => existsSync(join(units, d, "unit/unit.json")));
  const logs: unknown[] = [];
  const log = (uid: string, stage: string, data: Record<string, unknown>) => logs.push({ at: new Date().toISOString(), head, uid, stage, ...data });
  const m = await openMeter({ item, runId: item, out: join(process.env.HOME!, ".capy/work/pv/journals", item), cacheDir: join(units, "..", "cache"), maxOutputTokens: 8000 });
  const out: string[] = [];
  try {
    await pool(3, list.map((uid) => async () => {
      const dir = join(units, uid);
      if (existsSync(join(dir, "unit/classify.json"))) return out.push(uid + " already classified");
      const text = PROMPT + material(dir);
      const label = async (model: ModelKey): Promise<ProjectType | null> => {
        try {
          const r = await ask({ log }, m, uid, "classify-" + model, model, text, 2000, model === "gemini" ? "low" : "medium", true);
          return TYPES.has(r?.type) ? r.type : null;
        } catch {
          return null;
        }
      };
      const { a, b, third, decided: type } = await panel(label, [CLASSIFIERS[0]!, CLASSIFIERS[1]!], THIRD);
      put(join(dir, "unit/classify.json"), { [CLASSIFIERS[0]!]: a, [CLASSIFIERS[1]!]: b, [THIRD]: third, type, head });
      if (!type) return out.push(uid + " unclassified");
      const meta: UnitMeta = readJson(join(dir, "unit/unit.json"));
      put(join(dir, "unit/unit.json"), { ...meta, type });
      out.push(uid + " " + type + (third ? " (third classifier)" : ""));
    }));
  } finally {
    const c = await m.close();
    put(join(units, "..", "classify-log-" + Date.now() + ".json"), logs);
    io.out("pv classify: spent " + (c.spent_micros / 1e6).toFixed(4) + " USD on " + item);
  }
  for (const l of out) io.out(l);
  return 0;
}
