// Value: protects=the wiring the lead asked for: authoring's screens labelled through score/judge.ts labeller() and read with score/block.ts parseBlock, keyless.
import { describe, expect, test } from "bun:test";
import type { Caller as JudgeCaller } from "../../../lanes/product-value/judge.ts";
import { labeller } from "../../../lanes/office-hours-rewrite/score/judge.ts";
import { parseBlock } from "../../../lanes/office-hours-rewrite/score/block.ts";
import { runDraft } from "../../../lanes/office-hours-rewrite/author/brief.ts";
import { schedule } from "../../../lanes/office-hours-rewrite/author/draws.ts";
import { FIXTURE_SCREEN, T7, happy, stubCaller } from "../../../lanes/office-hours-rewrite/author/fixtures.ts";

const slot = schedule().find((s) => s.type === "T7")!;
/** A judge that credits every validator block except where deny says no, and never a stock row. */
const judge = (deny: (label: string) => boolean = () => false): JudgeCaller & { labels: string[] } => {
  const labels: string[] = [];
  const call: JudgeCaller = async (o) => {
    labels.push(o.label);
    const stock = o.label.includes(":generic:");
    const yes = !stock && !o.label.includes(":give-away:") && !deny(o.label);
    const ids = stock ? ["b1", "b2", "b3"] : ["b1"];
    return { text: JSON.stringify({ labels: ids.map((block) => ({ block, decision: yes, action: yes })) }), model_id: o.judge, version: "v1", problem: null };
  };
  return Object.assign(call, { labels });
};
const draft = (j: JudgeCaller) => runDraft(slot, "unpaired", { draw: 1, attempt: 1, author: "sol", pilot: false, partner: null }, { call: stubCaller(happy({ d1: T7 })), label: labeller(j), parse: parseBlock, screen: FIXTURE_SCREEN });

describe("authoring through the score area's labeller and parser", () => {
  test("a brief every judge credits passes, and each validator's block goes to the other family's judge", async () => {
    const j = judge();
    const o = await draft(j);
    expect(o.status).toBe("pass");
    expect(j.labels.filter((l) => l.includes(":unanimous:")).map((l) => l.split(":").slice(2, 5).join(" ")).sort()).toEqual(["astra 1 opus", "opus 1 astra", "sol 1 opus"]);
  });
  test("a judge refusing one validator's decision drops the brief as not unanimous", async () => {
    const o = await draft(judge((l) => l.startsWith("d1:unanimous:sol:")));
    expect([o.status, o.reason]).toEqual(["drop", "not unanimous"]);
  });
});
