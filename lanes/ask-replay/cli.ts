// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ask-replay: the ask replay eval's commands (prereg 2026-11-15-geva-539). Every command prints counts,
// rates and digests, never item text. build and run work on custody material and refuse paths off /dev/shm where the
// plan keeps plaintext there; run reads the age identity from stdin.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CODES, docAnchor, isReasonCode, type ReasonCode } from "../../src/errors/codes.ts";
import { chatPrice } from "../../src/runner/pricing/prices.ts";
import { buildFiles, readItems, toJsonl } from "./build.ts";
import { chainStats, clusters, proxyLinks, repeatInWindow, type Link } from "./chains.ts";
import { custody, readIdentity, readRecords, sealedStore, writeSums } from "./custody.ts";
import { auditDraw, drawCounts, mintSeed, pilotDraw } from "./draws.ts";
import { checkCodebook, labelJob, labelReadout, labelSamples } from "./label.ts";
import { AskError, fail, FROZEN, placeholders, seed } from "./frozen.ts";
import { corpusTexts, scanPublic, syntheticCheck } from "./privacy.ts";
import { buildPrompt, gstackLines, loadGstack, type GstackText } from "./prompt.ts";
import { finalRecords, openProxyMeter, runShard, schedule, upstreamRedraw, type LabelJob } from "./run.ts";
import { absentSamples, isNeedless, readout, s1Report } from "./score.ts";
import { halfWidth, mdd } from "./stats.ts";
import { generate } from "./synthetic/generator.ts";
import { ARMS, LABELS, outcomeOf, type Arm, type AskItem, type LabelKind, type ModelKey, type Sample } from "./types.ts";
import { seededRandom } from "../../src/runner/stats/paired.ts";

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Run = (argv: string[], io: Io) => Promise<number> | number;

const SYNTH_DIR = join(import.meta.dir, "synthetic");

/** --name value flags and bare switches. */
function flags(argv: string[], known: string[], switches: string[] = []): Record<string, string> & { _: string[] } {
  const out: Record<string, string> & { _: string[] } = { _: [] } as never;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) (out._ as string[]).push(a);
    else if (switches.includes(a.slice(2))) out[a.slice(2)] = "1";
    else if (known.includes(a.slice(2)) && argv[i + 1] !== undefined) out[a.slice(2)] = argv[++i]!;
    else fail("E_USAGE", "unknown or incomplete option " + JSON.stringify(a));
  }
  return out;
}

const need = (f: Record<string, string>, name: string) => f[name] ?? fail("E_USAGE", "--" + name + " is required");
const json = (io: Io, v: unknown) => io.out(JSON.stringify(v, null, 2));
const onShm = (p: string) => {
  const dir = realpathSync(existsSync(p) ? p : dirname(resolve(p)));
  if (!dir.startsWith("/dev/shm")) fail("E_USAGE", "custody output must sit on /dev/shm, not " + dir);
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const readLinks = (file?: string): Link[] | null => (file ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Link) : null);

function gstackFrom(f: Record<string, string>): GstackText {
  return loadGstack(f.gstack ?? join(process.env.HOME ?? "", ".local/share/gstack"));
}

/** The I1 smoke's 20 synthetic items: a seeded draw per class (frozen.json smoke.per_class). */
export function smokeItems(items: readonly AskItem[]): AskItem[] {
  const rng = seededRandom(FROZEN.smoke.seed);
  return LABELS.flatMap((l) => {
    const pool = items.filter((i) => i.label === l).map((i) => ({ i, r: rng() }));
    return pool.sort((a, b) => a.r - b.r).slice(0, FROZEN.smoke.per_class[l] ?? 0).map((x) => x.i);
  });
}

export const SUBCOMMANDS: Record<string, { summary: string; run: Run }> = {
  build: {
    summary: "custody builder: pages, the audit CSV and the rules history into items JSONL on /dev/shm; prints counts only",
    run: (argv, io) => {
      const f = flags(argv, ["pages", "audit", "rules", "owner", "out", "map"], ["variant"]);
      const out = need(f, "out");
      onShm(out);
      const b = buildFiles({ pages: need(f, "pages"), audit: need(f, "audit"), rules: need(f, "rules"), owner: f.owner?.split(",").map((s) => s.trim()).filter(Boolean), variant: f.variant === "1" });
      const jsonl = toJsonl(b.items);
      writeFileSync(out, jsonl, { mode: 0o600 });
      const map = f.map ?? out + ".threads.json";
      onShm(map);
      writeFileSync(map, JSON.stringify(b.map) + "\n", { mode: 0o600 });
      json(io, { ...b.counts, bundle_sha256: sha(jsonl), variant: f.variant === "1" });
      return 0;
    },
  },
  synth: {
    summary: "the public synthetic set: check items.jsonl and items.sha256 against the generator, or --write them",
    run: (argv, io) => {
      const f = flags(argv, [], ["write"]);
      const g = generate();
      const line = g.sha256 + "  items.jsonl\n";
      if (f.write) {
        writeFileSync(join(SYNTH_DIR, "items.jsonl"), g.jsonl);
        writeFileSync(join(SYNTH_DIR, "items.sha256"), line);
      }
      const same = existsSync(join(SYNTH_DIR, "items.jsonl")) && readFileSync(join(SYNTH_DIR, "items.jsonl"), "utf8") === g.jsonl && readFileSync(join(SYNTH_DIR, "items.sha256"), "utf8") === line && FROZEN.synthetic.sha256 === g.sha256;
      json(io, { ...g.counts, sha256: g.sha256, matches_committed: same });
      if (!same) io.err("E_ASK_INPUT ask-replay synth: the committed set, its sha256 file or frozen.json synthetic.sha256 differs from the generator");
      return same ? 0 : 1;
    },
  },
  dryrun: { summary: "the keyless dry run: every frozen rule on the synthetic set with a stub model, one PASS or FAIL line per check", run: async (argv, io) => (await import("./dryrun.ts")).run(argv, io) },
  "smoke-plan": {
    summary: "the I1 synthetic smoke's samples and estimated input tokens per model and arm, from the frozen prompts",
    run: (argv, io) => {
      const f = flags(argv, ["gstack"]);
      const gstack = gstackFrom(f);
      const items = smokeItems(generate().items);
      const out: Record<string, unknown> = {};
      for (const m of Object.keys(FROZEN.models) as ModelKey[]) {
        const arms = FROZEN.models[m].arms;
        const per: Record<string, { samples: number; input_tokens: number; est_micros: number }> = {};
        for (const a of arms) {
          const tokens = items.reduce((s, it) => {
            const p = buildPrompt(it, a, gstack);
            return s + Math.ceil((p.system.length + p.user.length) / 4);
          }, 0);
          const price = chatPrice(FROZEN.models[m].price_row)!;
          per[a] = { samples: items.length * FROZEN.smoke.replicates, input_tokens: tokens, est_micros: Math.round(tokens * price.input + items.length * 1500 * price.output) };
        }
        out[m] = per;
      }
      json(io, { items: items.length, per_class: Object.fromEntries(LABELS.map((l) => [l, items.filter((i) => i.label === l).length])), models: out, note: "estimate: characters/4 input at list input price, 1,500 output tokens per sample at list output price, no cache discount" });
      return 0;
    },
  },
  draw: {
    summary: "the pilot's or the label audit's seeded draw from the real items: drawn items to /dev/shm, the seed to a log you name, counts out",
    run: (argv, io) => {
      const f = flags(argv, ["kind", "items", "out", "seed-log", "seed"]);
      const kind = need(f, "kind");
      if (kind !== "pilot" && kind !== "audit") fail("E_USAGE", "--kind is pilot or audit");
      const out = need(f, "out");
      onShm(out);
      const log = need(f, "seed-log");
      const bundle = readFileSync(need(f, "items"), "utf8");
      const items = readItems(need(f, "items"));
      const minted = f.seed === undefined;
      const s = minted ? mintSeed() : Number(f.seed);
      if (!Number.isInteger(s) || s < 0) fail("E_USAGE", "--seed is a whole number of 0 or more");
      const drawn = kind === "pilot" ? pilotDraw(items, s) : auditDraw(items, s);
      const jsonl = toJsonl(drawn);
      writeFileSync(out, jsonl, { mode: 0o600 });
      appendFileSync(log, "- " + new Date().toISOString() + " ask-replay draw " + kind + ": seed " + s + " (" + (minted ? "minted from random bytes" : "given") + "), " + drawn.length + " of " + items.length + " items, bundle sha256 " + sha(bundle) + ", drawn set sha256 " + sha(jsonl) + "\n");
      json(io, { kind, ...drawCounts(drawn), drawn_sha256: sha(jsonl), seed_recorded_to: log });
      return 0;
    },
  },
  arms: {
    summary: "per arm on an items file: input tokens (characters/4) and arm (a)'s cleanliness counts; numbers only",
    run: (argv, io) => {
      const f = flags(argv, ["items", "gstack"]);
      const items = readItems(need(f, "items"));
      const gstack = gstackFrom(f);
      const tokens = Object.fromEntries(ARMS.map((a) => {
        const per = items.map((it) => {
          const p = buildPrompt(it, a, gstack);
          return Math.ceil((p.system.length + p.user.length) / 4);
        });
        return [a, { mean: Math.round(per.reduce((s, x) => s + x, 0) / Math.max(1, per.length)), max: Math.max(0, ...per) }];
      }));
      const armA = items.map((it) => {
        const p = buildPrompt(it, "a", gstack);
        return p.system + "\n" + p.user;
      });
      json(io, { items: items.length, input_tokens: tokens, arm_a: { items_with_gstack_lines: armA.filter((t) => gstackLines(t, gstack) > 0).length, gstack_lines: armA.reduce((s, t) => s + gstackLines(t, gstack), 0), items_with_gstack_token: armA.filter((t) => /gstack/i.test(t)).length } });
      return 0;
    },
  },
  score: {
    summary: "the frozen readout (sections 8 and 9) from items and decrypted replies, with the decision rows; numbers only",
    run: (argv, io) => {
      const f = flags(argv, ["items", "replies", "links", "labels", "draws"], ["keyless"]);
      const items = readItems(need(f, "items"));
      const records = finalRecords(readRecords(need(f, "replies")));
      const samples = records.map((r) => r.sample);
      const absent = absentSamples(items, samples, FROZEN.frontier_models);
      if (absent.total) {
        json(io, { incomplete: true, absent: absent.total, absent_by_model_arm: absent.by });
        fail("E_ASK_INCOMPLETE", "the replies lack " + absent.total + " scheduled Opus or Sol samples, so the run is incomplete and score prints no decision rows");
      }
      const untested = absentSamples(items, samples, (Object.keys(FROZEN.models) as ModelKey[]).filter((m) => FROZEN.models[m].arms.length && !FROZEN.frontier_models.includes(m))).by;
      const lab = f.labels ? labelReadout(items, finalRecords(readRecords(f.labels))) : null;
      const links = lab?.links ?? readLinks(f.links) ?? proxyLinks(items);
      const outcomes = records.map(outcomeOf);
      const opts = { links, seed: seed("bootstrap_seed", f.keyless === "1"), draws: f.draws ? Number(f.draws) : FROZEN.stats.bootstrap_draws, answerJudged: lab?.answer_judged, untested };
      const view = (its: AskItem[]) => {
        const ids = new Set(its.map((i) => i.item));
        return readout(its, outcomes.filter((x) => ids.has(x.item)), opts);
      };
      const r = view(lab?.primary ?? items);
      const views = (lab?.views ?? []).map((v) => {
        const d = view(v.items).decision;
        return { name: v.name, items: v.items.length, row: d.row, cut_candidate: d.cut_candidate, flips: d.row !== r.decision.row || d.cut_candidate !== r.decision.cut_candidate };
      });
      json(io, { links: lab?.links ? "Opus links" : f.links ? "custody links" : "proxy links", labels: lab?.summary ?? null, ...r, label_views: views, label_sensitive: views.some((v) => v.flips) });
      return 0;
    },
  },
  s1: {
    summary: "S1, the free automatic filter, on the original drafts: catches per class",
    run: (argv, io) => {
      const f = flags(argv, ["items"]);
      json(io, s1Report(readItems(need(f, "items")), []));
      return 0;
    },
  },
  "chains-proxy": {
    summary: "the free proxy linker: planned chain count, the largest chain's share per thread, repeats outside the window",
    run: (argv, io) => {
      const f = flags(argv, ["items"]);
      const items = readItems(need(f, "items"));
      const links = proxyLinks(items);
      const byId = new Map(items.map((i) => [i.item, i]));
      const inWindow = links.map((l) => repeatInWindow(byId.get(l.item)!, l.to));
      const needless = items.filter((i) => isNeedless(i.label));
      json(io, { duplicates: items.filter((i) => i.label === "DUPLICATE").length, linked: links.length, all: chainStats(items, clusters(items, links)), needless: chainStats(needless, clusters(needless, links.filter((l) => needless.some((i) => i.item === l.item)))), repeat_outside_window: inWindow.filter((x) => x === false).length, repeat_inside_window: inWindow.filter((x) => x === true).length });
      return 0;
    },
  },
  mdd: {
    summary: "planned detectable differences (2.8 * spread / sqrt(effective clusters)); --items uses the proxy chain count",
    run: (argv, io) => {
      const f = flags(argv, ["items", "spread", "clusters", "must-spread"]);
      const s = FROZEN.stats;
      const spread = f.spread ? Number(f.spread) : s.planned_spread.needless;
      const mustSpread = f["must-spread"] ? Number(f["must-spread"]) : s.planned_spread.must_ask;
      let clustersN = f.clusters ? Number(f.clusters) : s.planned_items.needless;
      let dupClusters = s.planned_items.duplicates;
      let must = s.planned_items.must_ask;
      if (f.items) {
        const items = readItems(f.items);
        const links = proxyLinks(items);
        const cl = clusters(items, links);
        clustersN = new Set(items.filter((i) => isNeedless(i.label)).map((i) => cl.get(i.item))).size;
        dupClusters = new Set(items.filter((i) => i.label === "DUPLICATE").map((i) => cl.get(i.item))).size;
        must = new Set(items.filter((i) => i.label === "DECISION").map((i) => cl.get(i.item))).size;
      }
      const needlessMdd = mdd(spread, clustersN);
      json(io, { spread, needless_clusters: clustersN, needless_mdd_points: Math.round(needlessMdd * 1000) / 10, duplicate_clusters: dupClusters, duplicates_mdd_points: Math.round(mdd(spread, dupClusters) * 1000) / 10, must_ask_clusters: must, must_ask_half_width_points: Math.round(halfWidth(mustSpread, must) * 1000) / 10, captain_hears_it: needlessMdd > s.captain_hears_needless_mdd_above });
      return 0;
    },
  },
  scan: {
    summary: "the lane's public-text scan of repo files: codes in prose, dollar figures outside Agent notes, denied names, custody overlap",
    run: (argv, io) => {
      const f = flags(argv, ["deny", "corpus"]);
      const deny = f.deny ? readFileSync(f.deny, "utf8").split("\n") : [];
      const corpus = f.corpus ? corpusTexts(f.corpus) : [];
      if (!f._.length) fail("E_USAGE", "name one or more files to scan");
      let hits = 0;
      const per = f._.map((file, i) => {
        const s = scanPublic(readFileSync(file, "utf8"), { deny, corpus });
        hits += s.codes + s.dollars + s.names + s.ngram_hits + (s.max_jaccard > FROZEN.privacy.jaccard_fail_above ? 1 : 0);
        return { file: i + 1, ...s };
      });
      json(io, { files: per.length, per_file: per, hits });
      if (hits) io.err("E_ASK_PRIVACY ask-replay scan: " + hits + " hits; read the per-file counts");
      return hits ? 1 : 0;
    },
  },
  "synth-check": {
    summary: "the synthetic set against a custody corpus: 6-gram hits and the largest content-word Jaccard (fails above 0.5)",
    run: (argv, io) => {
      const f = flags(argv, ["corpus"]);
      const r = syntheticCheck(generate().items, corpusTexts(need(f, "corpus")));
      json(io, r);
      if (!r.pass) io.err("E_ASK_PRIVACY ask-replay synth-check: the synthetic set overlaps custody text");
      return r.pass ? 0 : 1;
    },
  },
  run: {
    summary: "a paid shard under custody: identity on stdin, sealed bundle in, sealed replies out (never run without the go)",
    run: async (argv, io) => {
      const f = flags(argv, ["bundle", "sums", "log", "spend-item", "model", "out", "recipient", "k", "gstack", "record", "ledger", "amount-micros"], ["redraw-upstream", "pilot"]);
      refuseUnfrozen();
      const model = need(f, "model") as ModelKey;
      if (!FROZEN.models[model]?.arms.length) fail("E_USAGE", "--model is one of " + (Object.keys(FROZEN.models) as ModelKey[]).filter((m) => FROZEN.models[m].arms.length).join(", "));
      const pilot = f.pilot === "1";
      const item = runSpendItem(need(f, "spend-item"), model, pilot);
      if (pilot && (f.k || !FROZEN.pilot.models.includes(model))) fail("E_USAGE", "--pilot runs the frozen pilot arms on " + FROZEN.pilot.models.join(" or ") + " and takes no --k");
      const k: number | Partial<Record<Arm, number>> = pilot ? (FROZEN.pilot.arms as Partial<Record<Arm, number>>) : f.k ? Number(f.k) : FROZEN.replicates.k;
      return paidShard(f, io, { name: "run", model, item, gstack: gstackFrom(f), samples: (items) => schedule(items, model, k, seed("order_seed", false)) });
    },
  },
  label: {
    summary: "a labeller shard under custody (I3 audit, I4 contingency, I5 link): identity on stdin, sealed bundle in, sealed labels out (never run without the go)",
    run: async (argv, io) => {
      const f = flags(argv, ["kind", "bundle", "sums", "log", "model", "out", "recipient", "record", "ledger", "amount-micros"], ["redraw-upstream"]);
      refuseUnfrozen();
      const kind = need(f, "kind") as LabelKind;
      const spec = FROZEN.labelling.kinds[kind] ?? fail("E_USAGE", "--kind is one of " + Object.keys(FROZEN.labelling.kinds).join(", "));
      const model = need(f, "model") as ModelKey;
      if (!spec.models.includes(model)) fail("E_USAGE", "--kind " + kind + " runs on " + spec.models.join(" or "));
      checkCodebook();
      return paidShard(f, io, { name: "label", model, item: FROZEN.spend_items[spec.spend_item]!, gstack: null, samples: (items) => labelSamples(items, kind, model), job: labelJob });
    },
  },
};

/** The spend item a run shard meters, refused before any lease opens unless the prereg's table pairs it with the model: the smoke (I1) on any model, the pilot (I2, I2r) under --pilot, else the model's own main-run item. */
export function runSpendItem(id: string, model: ModelKey, pilot: boolean): string {
  const frozen = pilot ? ["I2", "I2r"] : ["I1", ({ opus: "I6", sol: "I7", particle: "I8" } as Record<string, string>)[model]!];
  if (!frozen.includes(id)) fail("E_USAGE", "--spend-item " + id + " is not frozen for " + (pilot ? "the pilot" : model) + "; use " + frozen.join(" or "));
  return FROZEN.spend_items[id]!;
}

function refuseUnfrozen(): void {
  const left = placeholders().filter((p) => p.startsWith("stats.") || p.startsWith("synthetic."));
  if (left.length) fail("E_ASK_UNFROZEN", "frozen.json still holds " + left.join(", "));
}

/** One paid shard under custody, for run and label: the sealed bundle opens on /dev/shm, one lease meters the spend item, and each reply is sealed as it lands. */
async function paidShard(f: Record<string, string>, io: Io, o: { name: string; model: ModelKey; item: string; gstack: GstackText | null; samples: (items: AskItem[]) => Sample[]; job?: LabelJob }): Promise<number> {
  const identity = readIdentity();
  const out = resolve(need(f, "out"));
  mkdirSync(out, { recursive: true });
  const result = await custody({ files: [need(f, "bundle")], sums: need(f, "sums"), log: need(f, "log"), identity }, async (dir) => {
    const items = readItems(join(dir, "items.jsonl"));
    const meter = await openProxyMeter({ item: o.item, runId: o.item, out, model: o.model, maxOutputTokens: FROZEN.output_cap.tokens, record: f.record, ledger: f.ledger, amountMicros: f["amount-micros"] ? Number(f["amount-micros"]) : undefined, warn: (c, m) => io.err(c + " " + m) });
    const warn = (c: ReasonCode, m: string) => io.err(c + " " + m.replace(/i-[0-9a-f]{24}/g, "<item>"));
    const shard = { items: new Map(items.map((i) => [i.item, i])), samples: o.samples(items), gstack: o.gstack, client: meter.client, store: sealedStore(join(out, "replies"), need(f, "recipient")), out, maxOutputTokens: FROZEN.output_cap.tokens, warn, job: o.job };
    try {
      return f["redraw-upstream"] ? { redraw: await upstreamRedraw(shard) } : { shard: await runShard(shard) };
    } finally {
      const spend = await meter.close();
      writeSums(join(out, "replies"));
      io.err("ask-replay " + o.name + ": lease closed at " + spend.spent_micros + " micros spent, " + spend.unknown_micros + " unknown");
    }
  });
  json(io, result);
  const shard = "shard" in result ? result.shard : undefined;
  if (shard?.stopped === "cap") {
    io.err(lines("E_ASK_CAP", "the spend cap stopped the shard with " + shard.left + " samples left; the run is incomplete"));
    return CODES.E_ASK_CAP.exit ?? 2;
  }
  return 0;
}

const lines = (code: ReasonCode, message: string) => [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].flatMap((t) => t.split(/\r\n|\r|\n/)).map((l) => code + " " + l).join("\n");

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(["gstack-evals ask-replay <command>", "", ...Object.entries(SUBCOMMANDS).map(([k, v]) => "  " + k.padEnd(13) + v.summary)].join("\n"));
    return sub ? 0 : 2;
  }
  const entry = SUBCOMMANDS[sub];
  if (!entry) {
    io.err(lines("E_USAGE", "gstack-evals ask-replay: no command " + JSON.stringify(sub) + "; run gstack-evals ask-replay --help"));
    return 2;
  }
  try {
    return await entry.run(rest, io);
  } catch (e) {
    const code = e instanceof AskError ? e.code : typeof (e as { code?: unknown }).code === "string" && isReasonCode((e as { code: string }).code) ? ((e as { code: ReasonCode }).code) : null;
    if (!code) throw e;
    io.err(lines(code, (e as Error).message.replace(new RegExp("^" + code + " "), "")));
    return CODES[code].exit ?? 2;
  }
}
