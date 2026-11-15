// Copyright (c) 2026 Garry Tan. MIT License.
// The public synthetic set (prereg section 12): 60 items in 3 made-up coordinating threads about 4 made-up projects,
// with a made-up owner and standing rules written from scratch. A seeded template generator writes raw transcripts, an
// audit CSV's rows and a rules table, then runs them through build.ts, so the set has exactly the custody items' shape
// and no model sees real asks while writing it. Class mix: 35 DECISION, 20 DUPLICATE (10 repeating an open ask, 10 an
// answered one), 3 PERMISSION_FOR_DEFAULT, 2 OBSERVABLE. Item ids come from the seeded generator, so the set and its
// sha256 reproduce. No real names, issue keys, thread codes or dollar figures.
import { createHash } from "node:crypto";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { buildFrom, toJsonl, type AuditRow, type BuildCounts, type TranscriptItem } from "../build.ts";
import { FROZEN } from "../frozen.ts";
import type { AskItem } from "../types.ts";

export const OWNER = "Rowan Tesh";
const FIRST = "Rowan";

interface Topic {
  ask: string;
  a: string;
  b: string;
  why: string;
}

/** Four made-up projects, each with its decision topics, components, checks and permission cases. */
const PROJECTS: Record<string, { about: string; topics: Topic[]; parts: string[]; checks: string[]; fixes: string[] }> = {
  Quillberry: {
    about: "the recipe-sharing app",
    parts: ["photo upload", "ingredient parser", "search ranking", "offline mode", "comment threads"],
    checks: ["Did last night's Quillberry build finish green?", "Is the Quillberry staging site loading again after this morning's restart?"],
    fixes: ["the broken photo crop on small phones", "the duplicate ingredient rows"],
    topics: [
      { ask: "should the free plan keep its cap of 50 saved recipes or rise to 200", a: "keep the cap at 50", b: "raise it to 200", why: "nine in ten free accounts save fewer than 30" },
      { ask: "should recipe photos be stored at full size or squeezed to 1600 pixels on upload", a: "squeeze them to 1600 pixels", b: "store them at full size", why: "nobody zooms past that and storage triples otherwise" },
      { ask: "should guest cooks be able to comment without an account", a: "require an account to comment", b: "let guests comment", why: "the spam filter only works on signed-in users" },
      { ask: "should the meal planner ship this sprint or wait for the grocery list", a: "ship the planner on its own now", b: "wait and ship both together", why: "the planner is done and the list needs two more weeks" },
      { ask: "should search rank by rating or by how recently a recipe was cooked", a: "rank by recent cooks", b: "rank by rating", why: "ratings cluster at four stars and stop telling recipes apart" },
      { ask: "should we drop the old tablet layout or keep fixing it", a: "drop the tablet layout", b: "keep fixing it", why: "under two percent of sessions use it" },
      { ask: "should unit conversion default to metric or follow the phone's region", a: "follow the phone's region", b: "default to metric", why: "the region setting is right for almost everyone" },
      { ask: "should the weekly digest email go out on Sunday or Thursday", a: "send it on Thursday", b: "send it on Sunday", why: "people plan weekend cooking midweek" },
    ],
  },
  Tidemark: {
    about: "the tide and weather alert service for small harbors",
    parts: ["alert scheduler", "buoy feed reader", "SMS sender", "harbor map", "forecast cache"],
    checks: ["Did the Tidemark buoy feed import run cleanly overnight?"],
    fixes: ["the alert that fired twice at high tide"],
    topics: [
      { ask: "should storm alerts go out at a fixed six hours ahead or scale with wind speed", a: "scale the lead time with wind speed", b: "keep a fixed six hours", why: "fast storms need earlier warning than slow ones" },
      { ask: "should we add a second buoy feed as a fallback or keep just the one", a: "add the second feed", b: "keep one feed", why: "the main feed went dark three times last month" },
      { ask: "should harbor masters see all boats or only the ones that opted in", a: "show only opted-in boats", b: "show every boat", why: "the opt-in keeps us clear of the privacy complaint we had" },
      { ask: "should the forecast cache refresh every ten minutes or every hour", a: "refresh every ten minutes", b: "refresh every hour", why: "tide tables shift enough within an hour to matter at the bar" },
      { ask: "should we support a second language now or after the summer", a: "wait until after the summer", b: "add it now", why: "the translator we lined up starts in September" },
      { ask: "should quiet hours silence every alert or everything except storm alerts", a: "keep storm alerts on during quiet hours", b: "silence every alert", why: "a storm warning at night is the one alert people want" },
      { ask: "should the harbor map use the paid tile source or the free one", a: "stay on the free tiles", b: "move to the paid tiles", why: "the free tiles cover every harbor we serve" },
    ],
  },
  Brassfern: {
    about: "the invoicing tool for freelance woodworkers",
    parts: ["invoice editor", "payment reminders", "tax summary", "client list", "PDF export"],
    checks: ["Is the Brassfern PDF export still failing on the test invoice, or did the redeploy fix it?"],
    fixes: ["the rounding error on invoice totals", "the reminder that ignored the client's time zone"],
    topics: [
      { ask: "should payment reminders go out at 7 days late or 14", a: "send them at 7 days late", b: "wait until 14 days", why: "most late invoices get paid within a week of a nudge" },
      { ask: "should the tax summary group by quarter or by month", a: "group by quarter", b: "group by month", why: "that matches how most of our users file" },
      { ask: "should invoices allow partial payments or stay all-or-nothing", a: "allow partial payments", b: "keep them all-or-nothing", why: "deposits on big commissions are the top request" },
      { ask: "should we keep the free tier at five clients or make it unlimited", a: "keep five clients", b: "make it unlimited", why: "the fifth client is where people start to pay" },
      { ask: "should the PDF export use the new layout for everyone or let people pick", a: "move everyone to the new layout", b: "let people pick", why: "two layouts doubles the export tests" },
      { ask: "should late fees be off by default or on at a flat amount", a: "leave late fees off by default", b: "turn them on at a flat amount", why: "woodworkers told us fees hurt repeat clients" },
      { ask: "should the client list import from spreadsheets this month or wait for the contacts sync", a: "ship spreadsheet import now", b: "wait for the contacts sync", why: "import is small and unblocks the shop owners in the beta" },
      { ask: "should we email receipts from our domain or the user's own address", a: "send from our domain", b: "send from the user's address", why: "mail from user addresses lands in spam without their DNS set up" },
      { ask: "should currency follow the client or the woodworker", a: "follow the woodworker's currency", b: "follow the client's currency", why: "their bank account is in one currency" },
      { ask: "should the mobile invoice editor ship read-only first or wait for full editing", a: "ship it read-only first", b: "wait for full editing", why: "checking invoices on the go is most of the mobile use" },
    ],
  },
  Mossgate: {
    about: "the internal build cache service",
    parts: ["cache eviction", "artifact store", "hit-rate dashboard", "upload client", "garbage collector"],
    checks: ["Did the Mossgate garbage collector finish its weekend run?"],
    fixes: ["the cache key that ignored the compiler version", "the dashboard panel that showed yesterday's hit rate"],
    topics: [
      { ask: "should the cache evict least recently used artifacts or the largest ones first", a: "evict least recently used first", b: "evict the largest first", why: "big artifacts are often the ones every build needs" },
      { ask: "should cache entries expire after 14 days or 30", a: "expire them after 14 days", b: "keep them 30 days", why: "the hit rate barely moves past two weeks" },
      { ask: "should we shard the artifact store by team or by hash", a: "shard by hash", b: "shard by team", why: "team shards were badly uneven in the trial" },
      { ask: "should cache misses fail the build or fall back to a clean build", a: "fall back to a clean build", b: "fail the build", why: "a miss should cost time, never a red build" },
      { ask: "should the upload client compress artifacts or send them raw", a: "compress them", b: "send them raw", why: "uploads are network-bound and compress about four to one" },
      { ask: "should the dashboard show hit rate per team or one number for everyone", a: "show it per team", b: "show one number", why: "the teams with low hit rates need to see it to fix it" },
      { ask: "should we let laptops read from the cache or keep it for CI only", a: "keep it for CI only for now", b: "open it to laptops", why: "laptop reads would need auth we haven't built" },
      { ask: "should the garbage collector run nightly or only on weekends", a: "run it nightly", b: "run it only on weekends", why: "nightly runs are small and never overlap the morning rush" },
      { ask: "should we pin the cache key to the compiler patch version or the minor version", a: "pin to the patch version", b: "pin to the minor version", why: "patch releases changed output twice this year" },
    ],
  },
};

const MINOR: Topic[] = [
  { ask: "should the release note be one line or a short paragraph", a: "keep it to one line", b: "write a short paragraph", why: "the changelog page shows only the first line" },
  { ask: "should the beta testers hear about it before the public post", a: "tell the testers first", b: "post to everyone at once", why: "they found most of the bugs" },
  { ask: "should the old setting stay hidden for a week before we delete it", a: "hide it for a week first", b: "delete it now", why: "that gives anyone relying on it time to say so" },
];

interface ThreadPlan {
  name: string;
  projects: string[];
  dec: number;
  dupOpen: number;
  dupAnswered: number;
  perm: number;
  obs: number;
  start: string;
}

const THREADS: ThreadPlan[] = [
  { name: "harbor-and-recipes", projects: ["Quillberry", "Tidemark"], dec: 12, dupOpen: 3, dupAnswered: 4, perm: 1, obs: 0, start: "2026-10-06T15:00:00.000Z" },
  { name: "invoices-and-alerts", projects: ["Brassfern", "Tidemark"], dec: 12, dupOpen: 3, dupAnswered: 3, perm: 1, obs: 1, start: "2026-10-07T16:30:00.000Z" },
  { name: "cache-and-recipes", projects: ["Mossgate", "Quillberry"], dec: 11, dupOpen: 4, dupAnswered: 3, perm: 1, obs: 1, start: "2026-10-08T14:10:00.000Z" },
];

/** The standing rules, written for this set: rule text, the owner's words, date text, scope, recorded at, status. */
export const RULES_MD = [
  "| Rule | Rule text | Owner's words | Date | Scope | Recorded | Status |",
  "|---|---|---|---|---|---|---|",
  '| R1 | Keep working through repairs and reruns without asking whether to continue. | "Just keep going." | 2026-09-28 | every thread | 2026-09-28 | live |',
  '| R2 | Merge a pull request once every required check passes; do not ask first. | "Green means merge." | 2026-10-01 | every repo | 2026-10-01 | live |',
  '| R3 | Rerun a failed test once on your own before you report it. | "One rerun is free." | undated | every repo | unknown | live |',
  '| R4 | Archive a thread once its work has merged, without asking. | "Tidy up after yourself." | said 2026-10-09, restated 2026-10-12 | every thread | 2026-10-12 | live |',
  '| R5 | Ask the owner only for product decisions, spend above a cap, or access only the owner has. | "Bring me decisions, not chores." | 2026-10-03 | every thread | 2026-10-03 | live |',
  '| R6 | Put each decision on its own lettered line with your recommendation first. | "Make it easy to say yes." | 2026-10-05 | every thread | 2026-10-05 | live |',
  '| R7 | Check CI, staging and dashboards yourself before asking about them. | "You can see that, I cannot." | 2026-10-14 | every thread | 2026-10-14 | live |',
  '| R8 | Send one morning digest that lists every ask still waiting. | "One list, once a day." | unknown | every thread | unknown | live |',
  '| R9 | Do not send an ask again once the owner has answered it; act on the answer. | "I said it once." | 2026-10-16 | every thread | 2026-10-16 | live |',
  '| R10 | Keep each project under its monthly cloud budget, and say so before going over. | "Warn me first." | 2026-10-20 | every project | 2026-10-20 | live |',
  '| R11 | Write release notes in plain words for people who use the product. | "No jargon." | 2026-10-22 | every project | 2026-10-22 | live |',
  '| R12 | When two options cost the same, pick the smaller change. | "Smaller wins ties." | undated | every project | unknown | live |',
].join("\n");

export interface Raw {
  threads: Map<string, TranscriptItem[]>;
  audit: AuditRow[];
}

/** The raw transcripts and audit rows the set is built from. */
export function rawSet(seed = FROZEN.synthetic.seed): Raw {
  const rng = seededRandom(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rng() * 256).toString(16).padStart(2, "0")).join("");
  const shuffle = <T>(xs: T[]): T[] => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [xs[i], xs[j]] = [xs[j]!, xs[i]!];
    }
    return xs;
  };
  const threads = new Map<string, TranscriptItem[]>();
  const audit: AuditRow[] = [];
  let minorNext = 0;
  for (const plan of THREADS) {
    const items: TranscriptItem[] = [];
    let t = Date.parse(plan.start);
    const step = (lo: number, hi: number) => (t += Math.round((lo + rng() * (hi - lo)) * 60000));
    const say = (text: string, kind: "agent" | "owner", cls: string | null, tool = false) => {
      const id = "m-" + hex(8);
      items.push(kind === "owner" ? { id, source: "user", authorName: OWNER, text, createdAt: new Date(t).toISOString() } : tool ? { id, source: "tool", tool: "message_user", text, createdAt: new Date(t).toISOString() } : { id, source: "assistant", text, createdAt: new Date(t).toISOString() });
      if (cls) audit.push({ thread: plan.name, event: id, at: new Date(t).toISOString(), latency_min: "", class: cls, reply_kind: "synthetic", note: "synthetic" });
    };
    const topics = shuffle(plan.projects.flatMap((p) => PROJECTS[p]!.topics.map((topic) => ({ project: p, topic })))).slice(0, plan.dec);
    const units: string[][] = [
      ...Array.from({ length: plan.dupOpen }, () => ["DEC", "DUPO"]),
      ...Array.from({ length: plan.dec - plan.dupOpen }, () => ["DEC"]),
      ...Array.from({ length: plan.dupAnswered }, () => ["DUPA"]),
      ...Array.from({ length: plan.perm }, () => ["PERM"]),
      ...Array.from({ length: plan.obs }, () => ["OBS"]),
    ];
    shuffle(units);
    const order: string[][] = [];
    const waiting: string[][] = [];
    let decided = 0;
    for (const u of units) {
      if (u[0] === "DUPA" && decided === 0) {
        waiting.push(u);
        continue;
      }
      order.push(u);
      if (u[0] === "DEC") {
        decided++;
        order.push(...waiting.splice(0));
      }
    }
    order.push(...waiting);
    const asked: Array<{ project: string; topic: Topic; answered: boolean }> = [];
    let nextTopic = 0;
    let checks = 0;
    let fixes = 0;
    const status = (project: string) => {
      const p = PROJECTS[project]!;
      const part = pick(p.parts);
      const next = pick(p.parts.filter((x) => x !== part));
      const text = pick([
        project + " update: the " + part + " change merged and its checks are green. Next I am on the " + next + ".",
        project + ": the " + part + " work is in review; I will start on the " + next + " once it lands.",
        "Progress on " + project + " (" + p.about + "): " + part + " is done on the branch, " + next + " is underway.",
      ]);
      step(30, 240);
      say(text, "agent", rng() < 0.5 ? "NOT_ASK" : null);
    };
    const ownerAnswer = (topic: Topic | null, text?: string) => {
      step(20, 420);
      say(text ?? pick(["Go with your pick.", "Go ahead.", "Yes, " + topic!.a + ".", "Let's " + topic!.b + " instead; I want to see how that does first.", "Fine by me, " + topic!.a + "."]), "owner", null);
      for (const x of asked) x.answered = true;
    };
    for (const unit of order) {
      for (const [k, kind] of unit.entries()) {
        const project = plan.projects[Math.floor(rng() * plan.projects.length)]!;
        if (rng() < 0.6) status(project);
        step(5, 90);
        const tool = rng() < 0.3;
        if (kind === "DEC") {
          const { project: pj, topic } = topics[nextTopic++]!;
          const multi = rng() < 0.2 ? MINOR[minorNext++ % MINOR.length]! : null;
          const text = multi
            ? [FIRST + ":", "", "A. " + pj + ", " + topic.ask + "? I recommend we " + topic.a + ": " + topic.why + ".", "B. Same release, " + multi.ask + "? I recommend we " + multi.a + ": " + multi.why + ".", "", "Answer A and B one at a time if you want different calls."].join("\n")
            : pick([
                pj + " needs one call from you: " + topic.ask + "? My pick is to " + topic.a + ", since " + topic.why + ". Should I go ahead with that, or would you rather I " + topic.b + "?",
                "TL;DR: one decision on " + pj + ".\n\n" + topic.ask[0]!.toUpperCase() + topic.ask.slice(1) + "? I recommend we " + topic.a + ": " + topic.why + ". The other way is to " + topic.b + ".",
                FIRST + ":\n\nA. " + pj + ", " + topic.ask + "? I recommend we " + topic.a + "; " + topic.why + ".",
              ]);
          say(text, "agent", "DECISION", tool);
          asked.push({ project: pj, topic, answered: false });
          if (unit[k + 1] !== "DUPO") ownerAnswer(topic);
        } else if (kind === "DUPO") {
          const last = asked.at(-1)!;
          step(60, 300);
          say(pick(["Still need your call on " + last.project + ": " + last.topic.ask + "? I recommend we " + last.topic.a + ".", "Sending this again in case it got buried. " + last.project + ": " + last.topic.ask + "? My pick is to " + last.topic.a + "."]), "agent", "DUPLICATE", tool);
          ownerAnswer(last.topic);
        } else if (kind === "DUPA") {
          const done = asked.filter((x) => x.answered);
          const x = pick(done);
          say(pick(["Checking again on " + x.project + ": " + x.topic.ask + "? I still lean toward the plan to " + x.topic.a + ".", "One more time on " + x.project + ", " + x.topic.ask + "? I would " + x.topic.a + "."]), "agent", "DUPLICATE", tool);
          ownerAnswer(null, pick(["I answered this already. Go with what I said then.", "We settled that earlier this week; nothing has changed.", "Same answer as before."]));
        } else if (kind === "PERM") {
          const p = PROJECTS[project]!;
          const fix = p.fixes[fixes++ % p.fixes.length]!;
          say(pick(["The " + project + " fix for " + fix + " passed every required check. Okay to merge it?", "The " + project + " pull request for " + fix + " merged. May I archive this thread's finished branch now?", "The " + project + " test for " + fix + " failed once on an unrelated network step. Can I rerun it?"]), "agent", "PERMISSION_FOR_DEFAULT", tool);
          ownerAnswer(null, "You do not need to ask me that; the standing rules cover it.");
        } else {
          const owner = plan.projects.find((x) => PROJECTS[x]!.checks.length) ?? project;
          say(PROJECTS[owner]!.checks[checks++ % PROJECTS[owner]!.checks.length]!, "agent", "OBSERVABLE", tool);
          ownerAnswer(null, "You can check that yourself; it is on the dashboard.");
        }
        step(240, 1500);
      }
    }
    threads.set(plan.name, items);
  }
  return { threads, audit };
}

/** The synthetic set: the raw set through build.ts, with seeded item ids. */
export function generate(seed = FROZEN.synthetic.seed): { items: AskItem[]; counts: BuildCounts; jsonl: string; sha256: string } {
  const raw = rawSet(seed);
  const rng = seededRandom(seed ^ 0x5eed);
  const newId = () => "i-" + Array.from({ length: 12 }, () => Math.floor(rng() * 256).toString(16).padStart(2, "0")).join("");
  const { items, counts } = buildFrom({ threads: raw.threads, audit: raw.audit, rules: RULES_MD, owner: [OWNER], prefix: "S", newId });
  const jsonl = toJsonl(items);
  return { items, counts, jsonl, sha256: createHash("sha256").update(jsonl).digest("hex") };
}
