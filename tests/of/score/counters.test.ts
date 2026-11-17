// Value: protects=section 8's frozen question, push and order-check rules, which feed the mechanism secondaries.
import { describe, expect, test } from "bun:test";
import { counters, isQuestion, recommends, sentences } from "../../../lanes/office-hours-founder/score/counters.ts";
import { FENCED, transcript } from "../../../lanes/office-hours-founder/score/fixtures.ts";

describe("questions", () => {
  test("a sentence ending in a question mark, after closing marks, is a question", () => {
    expect(sentences("Who pays? Tell me.\nWhat do they use today?")).toEqual(["Who pays?", "Tell me.", "What do they use today?"]);
    expect(isQuestion('**Who pays?**')).toBe(true);
    expect(isQuestion('She asked "who pays?"')).toBe(true);
    expect(isQuestion("Who pays? Tell me.")).toBe(false);
  });
  test("questions inside the first-move block don't count", () => {
    const block = '```first-move\n{"first_move": "Sell what?", "next_action": "Ask who?", "other_moves": [], "doubt": ""}\n```';
    expect(counters(transcript([["Who pays? What do they pay for?"], ["Here it is.\n\n" + block]])).questions).toBe(2);
  });
});

describe("pushes", () => {
  test("a question that shares two content words with the last question of the reply before is a push", () => {
    expect(counters(transcript([["Who has paid you for repairs so far?"], ["Fine. But who exactly has paid for repairs?"]])).pushes).toBe(1);
  });
  test("a new subject is not a push, and one shared word is not enough", () => {
    expect(counters(transcript([["Who has paid you for repairs so far?"], ["What tools do shops use today?"]])).pushes).toBe(0);
    expect(counters(transcript([["Who has paid you so far?"], ["Has anyone paid twice?"]])).pushes).toBe(0);
  });
  test("each reply counts at most once, and compares only with the reply just before", () => {
    expect(counters(transcript([["Who has paid for repairs?"], ["Who paid for repairs first? Who paid for repairs last?"], ["What do shops use today?"], ["Do you sell spare parts?"]])).pushes).toBe(1);
  });
});

describe("the order check's recommendation rule", () => {
  test("a recommending phrase with an action word recommends", () => {
    for (const s of ["I recommend you sell the reorder list to single shops.", "You should start with the five owners who asked.", "My advice is to build only the weekly list.", "Start by offering it by hand."]) expect({ s, r: recommends(s) }).toEqual({ s, r: true });
  });
  test("questions, deferrals and phrases with no action don't", () => {
    for (const s of ["Should you sell to chains?", "Before I recommend what to build, tell me who pays.", "You should know I will ask a few questions.", "It's too early to recommend what to sell.", "That is an interesting plan."]) expect({ s, r: recommends(s) }).toEqual({ s, r: false });
  });
  test("first_recommendation_reply counts the founder turns before the first recommending reply", () => {
    expect(counters(transcript([["Who pays?"], ["What do they use?"], ["I recommend you sell the list to shops."], ["Done.\n\n" + FENCED]])).first_recommendation_reply).toBe(2);
    expect(counters(transcript([["Who pays?"], [FENCED]])).first_recommendation_reply).toBe(1);
    expect(counters(transcript([["Who pays?"], ["Thanks."]])).first_recommendation_reply).toBeNull();
  });
});
