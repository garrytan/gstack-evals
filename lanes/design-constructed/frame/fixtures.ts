// Copyright (c) 2026 Garry Tan. MIT License.
// Invented fixtures for the frame area's dry run and tests: search nodes and replies, a fake gh CLI on a fake clock, and
// small app trees written to a temporary folder. Every name, owner and README here is made up.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GhExec } from "./gh.ts";

/** One invented search node with every field the query asks for; overrides replace fields. */
export function node(nameWithOwner: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  const oid = (o.oid as string | undefined) ?? Bun.hash(nameWithOwner).toString(16).padStart(16, "0").repeat(3).slice(0, 40);
  const n: Record<string, unknown> = {
    nameWithOwner,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    isTemplate: false,
    stargazerCount: 1200,
    pushedAt: "2026-10-02T08:00:00Z",
    licenseInfo: { spdxId: "MIT" },
    primaryLanguage: { name: "TypeScript" },
    repositoryTopics: { nodes: [{ topic: { name: "admin-dashboard" } }] },
    defaultBranchRef: { name: "main", target: { oid } },
    readmeMd: { text: "# Orchard Desk\n\nA made-up help desk for invented teams.\n" },
    readmeLower: null,
    readmeTitle: null,
    readmeBare: null,
  };
  for (const [k, v] of Object.entries(o)) if (k !== "oid") n[k] = v;
  return n;
}

/** A whole GraphQL search page reply. */
export const reply = (nodes: unknown[], cost = 1, remaining = 4990, next: string | null = null, total = nodes.length) => ({
  data: { search: { repositoryCount: total, pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes }, rateLimit: { cost, remaining, resetAt: "2026-11-14T13:00:00Z" } },
});

export interface FakeGh {
  exec: GhExec;
  sleep: (ms: number) => void;
  now: () => number;
  /** Each call's start time on the fake clock and its kind; graphql calls carry their search and cursor. */
  log: { at: number; kind: "graphql" | "rate_limit"; q?: string; first?: number; after?: string | null }[];
}

/** A failure the fake answers for one page of one search, times times in a row (every time when absent). */
export interface FakeFailure {
  q: string;
  /** 1-based page. */
  page: number;
  kind: "502" | "504" | "timeout" | "401" | "graphql-error";
  times?: number;
}

const FAILURE: Record<FakeFailure["kind"], { status: number; stdout: string; stderr: string }> = {
  "502": { status: 1, stdout: "", stderr: "gh: HTTP 502: Bad Gateway (https://api.github.com/graphql)" },
  "504": { status: 1, stdout: "", stderr: "gh: HTTP 504: Gateway Timeout (https://api.github.com/graphql)" },
  timeout: { status: 1, stdout: "", stderr: "Post \"https://api.github.com/graphql\": net/http: request canceled (Client.Timeout exceeded while awaiting headers): timed out" },
  "401": { status: 1, stdout: "", stderr: "gh: HTTP 401: Bad credentials (https://api.github.com/graphql)" },
  "graphql-error": { status: 0, stdout: JSON.stringify({ errors: [{ message: "Something went wrong" }], data: null }), stderr: "" },
};

/**
 * A fake gh: graphql pages through byQ (search string to nodes; missing ones answer an empty page) by its first and
 * after variables, with opaque cursors; rate_limit counts down one point per answered page. Each call takes 400 ms on
 * the fake clock. failures answer a page with an error instead, and spend no point.
 */
export function fakeGh(byQ: Record<string, unknown[]> = {}, o: { failures?: FakeFailure[]; start?: number } = {}): FakeGh {
  let t = o.start ?? Date.parse("2026-11-14T12:00:00Z");
  let remaining = 5000;
  const log: FakeGh["log"] = [];
  const used = new Map<FakeFailure, number>();
  const exec: GhExec = (args, input) => {
    if (args[0] === "api" && args[1] === "rate_limit") {
      log.push({ at: t, kind: "rate_limit" });
      t += 400;
      return { status: 0, stdout: JSON.stringify({ resources: { graphql: { limit: 5000, remaining, used: 5000 - remaining, reset: 1794661200 } } }), stderr: "" };
    }
    if (args[0] === "api" && args[1] === "graphql") {
      const v = JSON.parse(input ?? "{}").variables ?? {};
      const q = v.q as string, first = v.first as number, after = (v.after ?? null) as string | null;
      log.push({ at: t, kind: "graphql", q, first, after });
      t += 400;
      const offset = after === null ? 0 : Number(after.slice("cursor:".length));
      const failure = o.failures?.find((x) => x.q === q && x.page === Math.floor(offset / first) + 1 && (x.times === undefined || (used.get(x) ?? 0) < x.times));
      if (failure) {
        used.set(failure, (used.get(failure) ?? 0) + 1);
        return FAILURE[failure.kind];
      }
      remaining -= 1;
      const all = byQ[q] ?? [];
      const nodes = all.slice(offset, offset + first);
      const next = offset + first < all.length ? "cursor:" + (offset + first) : null;
      return { status: 0, stdout: JSON.stringify(reply(nodes, 1, remaining, next, all.length)), stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "fake gh: unexpected call" };
  };
  return { exec, log, now: () => t, sleep: (ms) => void (t += ms) };
}

/** Writes files (path to text) under a new temporary folder and returns it. */
export function writeTree(files: Record<string, string>, root = mkdtempSync(join(tmpdir(), "dc-frame-"))): string {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

const tenComponents = (folder: string, ext = "tsx") => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [folder + "/Panel" + i + "." + ext, "export const P" + i + " = () => null;\n"]));

/** An invented Next.js app that passes all four file-check tests. */
export const PASSING_APP: Record<string, string> = {
  "package.json": JSON.stringify({ name: "orchard-desk", dependencies: { next: "15.0.0", react: "19.0.0" } }),
  ...tenComponents("src/components"),
  "src/styles/theme.ts": "export const theme = { radius: 4 };\n",
  "src/app/page.tsx": "export default function Home() { return null; }\n",
  "src/app/tickets/page.tsx": "export default function Tickets() { return null; }\n",
  "src/app/tickets/[id]/page.tsx": "export default function Ticket() { return null; }\n",
};

/** PASSING_APP with one test broken, by test number. */
export function failingApp(test: 1 | 2 | 3 | 4): Record<string, string> {
  const t = { ...PASSING_APP };
  if (test === 1) t["package.json"] = JSON.stringify({ name: "orchard-desk", dependencies: { next: "15.0.0", "preact-lite": "1.0.0" } });
  if (test === 2) delete t["src/components/Panel9.tsx"];
  if (test === 3) delete t["src/styles/theme.ts"];
  if (test === 4) delete t["src/app/tickets/[id]/page.tsx"];
  return t;
}

/** Twenty custom-property declarations, or n. */
export const cssVars = (n = 20) => ":root {\n" + Array.from({ length: n }, (_, i) => "  --tone-" + i + ": #10" + (i % 10) + ";").join("\n") + "\n}\n";
