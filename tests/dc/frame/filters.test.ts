// Copyright (c) 2026 Garry Tan. MIT License.
// The entry filters, the README title reading, the frame order and the owner dedupe.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildFrame, ENTRY_FILTERS, firstFailed, frameKey, readmeTitle, titleBarred, topicBarred } from "../../../lanes/design-constructed/frame/filters.ts";
import { node } from "../../../lanes/design-constructed/frame/fixtures.ts";
import { readNode } from "../../../lanes/design-constructed/frame/search.ts";

const repo = (name: string, o: Record<string, unknown> = {}) => readNode(node(name, o), "t");

describe("entry filters", () => {
  test("run in the frozen order and report the first one failed", () => {
    expect(ENTRY_FILTERS.map((f) => f.name)).toEqual(["public", "not a fork", "not archived", "not a template", "stars", "pushed", "licence", "language", "topic words", "readme title"]);
    expect(firstFailed(repo("a/b"))).toBeNull();
    expect(firstFailed(repo("a/b", { isFork: true, stargazerCount: 5 }))).toBe("not a fork");
    expect(firstFailed(repo("a/b", { stargazerCount: 199 }))).toBe("stars");
    expect(firstFailed(repo("a/b", { pushedAt: "2026-05-31T23:59:59Z" }))).toBe("pushed");
    expect(firstFailed(repo("a/b", { licenseInfo: { spdxId: "bsd-3-CLAUSE" } }))).toBeNull();
    expect(firstFailed(repo("a/b", { primaryLanguage: { name: "Svelte" } }))).toBeNull();
  });

  test("topic words split on hyphens; pairs read as consecutive words", () => {
    expect(["nextjs-template", "starter", "boilerplate-vue", "react-uikit", "ui-kit", "vue-component-library"].every(topicBarred)).toBe(true);
    expect(["templates", "kit-ui", "component-libraries", "admin-dashboard"].some(topicBarred)).toBe(false);
  });

  test("the README title is the first heading, else the first non-empty line", () => {
    expect(readmeTitle(null)).toBeNull();
    expect(readmeTitle("<p align=\"center\"><img src=\"x.svg\"></p>\n\n# Orchard Desk\n")).toBe("Orchard Desk");
    expect(readmeTitle("Orchard\n=======\n# Later\n")).toBe("Orchard");
    expect(readmeTitle("~~~\n# not\n~~~\nplain\n")).toBe("~~~");
    expect(readmeTitle("    # indented code\nplain\n")).toBe("# indented code");
    expect(titleBarred("Orchard UI Kit")).toBe(true);
    expect(titleBarred("Orchard UIKit")).toBe(false);
    expect(titleBarred("A component library")).toBe(true);
    expect(titleBarred(null)).toBe(false);
  });
});

describe("frame order and owner dedupe", () => {
  test("the key is sha256 of the seed, a newline and nameWithOwner", () => {
    expect(frameKey("acme/alpha")).toBe(createHash("sha256").update("20261114\nacme/alpha").digest("hex"));
  });

  test("orders hex ascending, numbers positions from 1 and keeps an owner's first", () => {
    const names = ["Acme/one", "acme/two", "solo/desk", "beta/crm"];
    const f = buildFrame(names.map((n) => repo(n)));
    const sorted = [...names].sort((a, b) => (frameKey(a) < frameKey(b) ? -1 : 1));
    const firstAcme = sorted.find((n) => n.toLowerCase().startsWith("acme/"));
    expect(f.frame.map((e) => e.nameWithOwner)).toEqual(sorted.filter((n) => !n.toLowerCase().startsWith("acme/") || n === firstAcme));
    expect(f.frame.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(f.afterFilter.at(-1)).toEqual({ name: "readme title", left: 4 });
    expect(f.outcome.filter((o) => o.left_at === "owner dedupe").length).toBe(1);
  });
});
