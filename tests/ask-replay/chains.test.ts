import { describe, expect, test } from "bun:test";
import { chainStats, clusters, proxyLinks, questions, repeatInWindow, s1Match, sharesSubject } from "../../lanes/ask-replay/chains.ts";
import type { AskItem } from "../../lanes/ask-replay/types.ts";

const ask = (item: string, order: number, label: AskItem["label"], draft: string, earlier: AskItem["earlier_asks"] = []): AskItem => ({ item, thread: "T1", at: "2026-10-20T00:00:00.000Z", order, label, conversation: [], cut: false, rules: [], draft, earlier_asks: earlier, after_reply: null });

describe("S1 and decision chains", () => {
  test("S1 reads questions, or the first sentence of a text with none, and needs two shared content words", () => {
    expect(questions("Status first. Should the cache expire after 14 days?")).toEqual(["Should the cache expire after 14 days?"]);
    expect(questions("No question here. Second.")).toEqual(["No question here."]);
    expect(sharesSubject("Should cache entries expire sooner?", "Do cache entries expire at all?")).toBe(true);
    expect(sharesSubject("Should cache entries expire sooner?", "Is the cache warm?")).toBe(false);
  });
  test("s1Match picks the newest earlier ask the draft repeats", () => {
    const e = [{ at: "a", order: 1, text: "Should cache entries expire after 14 days?", next_owner: null }, { at: "b", order: 4, text: "Do cache entries expire on Sunday?", next_owner: null }];
    expect(s1Match({ draft: "Checking again: should cache entries expire?", earlier_asks: e })?.order).toBe(4);
  });
  test("the proxy linker takes the S1 match with the highest Jaccard, ties to the newest", () => {
    const earlier = [{ at: "a", order: 1, text: "Should cache entries expire weekly?", next_owner: null }, { at: "b", order: 2, text: "Should cache entries expire weekly?", next_owner: null }, { at: "c", order: 3, text: "Unrelated status.", next_owner: null }];
    expect(proxyLinks([ask("x", 5, "DUPLICATE", "Should cache entries expire weekly?", earlier)])).toEqual([{ item: "x", to: 2 }]);
    expect(proxyLinks([ask("y", 5, "DECISION", "Should cache entries expire weekly?", earlier)])).toEqual([]);
  });
  test("links union into chains within a thread; unlinked items are their own clusters", () => {
    const items = [ask("a", 1, "DECISION", "q"), ask("b", 3, "DUPLICATE", "q"), ask("c", 5, "DUPLICATE", "q"), ask("d", 7, "DECISION", "q")];
    const cl = clusters(items, [{ item: "b", to: 1 }, { item: "c", to: 3 }]);
    expect(new Set([cl.get("a"), cl.get("b"), cl.get("c")]).size).toBe(1);
    expect(cl.get("a")).toBe("chain T1:1");
    expect(cl.get("d")).not.toBe(cl.get("a"));
    expect(chainStats(items, cl)).toEqual({ clusters: 2, chains: 1, in_chains: 3, largest_share: { T1: 0.75 } });
  });
  test("a repeat lies outside the window when its ask is older than the first kept message of a cut conversation", () => {
    const it = { ...ask("x", 9, "DUPLICATE", "q", [{ at: "2026-10-01T00:00:00.000Z", order: 2, text: "q", next_owner: null }]), cut: true, conversation: [{ at: "2026-10-05T00:00:00.000Z", from: "agent" as const, text: "later" }] };
    expect(repeatInWindow(it, 2)).toBe(false);
    expect(repeatInWindow({ ...it, cut: false }, 2)).toBe(true);
    expect(repeatInWindow(it, 99)).toBeNull();
  });
});
