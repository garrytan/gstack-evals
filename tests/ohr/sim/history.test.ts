// Copyright (c) 2026 Garry Tan. MIT License.
// Pre-run change 6, the format fix: the simulator reads its own earlier turns as the JSON objects it returned
// (reply, revealed, rules, done), not as prose, while the adviser still sees only the reply.
import { expect, test } from "bun:test";
import type { SimCall, SimRequest } from "../../../src/persona-sim/sim.ts";
import { closingLoop } from "../../../lanes/office-hours-rewrite/run/session.ts";
import { runScript } from "../../../lanes/office-hours-rewrite/sim/audit.ts";
import { simTurn } from "../../../lanes/office-hours-rewrite/sim/founder.ts";
import { fixtureSheet } from "../../../lanes/office-hours-rewrite/sim/seams.ts";

const own = (reply: string, revealed: string[] = []) => ({ reply, revealed, rules: [1], done: false });

const isTurnJson = (text: string): boolean => {
  try {
    const o = JSON.parse(text);
    return !!o && typeof o === "object" && typeof o.reply === "string" && Array.isArray(o.revealed) && Array.isArray(o.rules) && typeof o.done === "boolean";
  } catch {
    return false;
  }
};

/** A model that, like the simulator in the failed audit, answers in prose once any of its own earlier turns reads as prose. */
function followsHistory(): SimCall & { reqs: SimRequest[] } {
  const reqs: SimRequest[] = [];
  return Object.assign(async (req: SimRequest) => {
    reqs.push(req);
    const past = req.messages.filter((m) => m.role === "assistant");
    const reply = "Reply " + (past.length + 1) + ".";
    return { kind: "text" as const, text: past.every((m) => isTurnJson(m.content)) ? JSON.stringify(own(reply)) : reply };
  }, { reqs });
}

test("a turn-3 history carries the founder's own JSON objects, so a model that follows its history answers in JSON", async () => {
  const first = own("I run route sheets for two laundry services.");
  const second = own("Two services pay me forty dollars a month.", ["f1"]);
  const transcript = [
    { role: "assistant" as const, text: "Tell me more about where things stand right now." },
    { role: "person" as const, text: first.reply, own: first },
    { role: "assistant" as const, text: "Has anyone used it or paid for it yet?" },
    { role: "person" as const, text: second.reply, own: second },
    { role: "assistant" as const, text: "What do the people you're building for do today instead?" },
  ];
  const call = followsHistory();
  const t = await simTurn({ kind: "founder", sheet: fixtureSheet("founder"), transcript, call });
  expect(t.kind).toBe("reply");
  expect(call.reqs[0]!.messages.filter((m) => m.role === "assistant").map((m) => JSON.parse(m.content))).toEqual([first, second]);
  expect(call.reqs[0]!.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([transcript[0]!.text, transcript[2]!.text, transcript[4]!.text]);
});

test("a person turn without its own JSON is refused before any call", async () => {
  const call = followsHistory();
  const transcript = [{ role: "assistant" as const, text: "Tell me more." }, { role: "person" as const, text: "Two services pay me." }, { role: "assistant" as const, text: "Who are they?" }];
  await expect(simTurn({ kind: "founder", sheet: fixtureSheet("founder"), transcript, call })).rejects.toThrow("E_USAGE");
  expect(call.reqs.length).toBe(0);
});

test("the audit script keeps each turn's accepted JSON, so a model that follows its history delivers all six turns", async () => {
  const { turns } = await runScript({ brief: "b1", kind: "founder", sheet: fixtureSheet("founder") }, followsHistory());
  expect(turns.map((t) => t.outcome)).toEqual(["reply", "reply", "reply", "reply", "reply", "reply"]);
});

test("the stage session loop hands the simulator its delivered turns with their JSON", async () => {
  const seen: unknown[] = [];
  const loop = closingLoop({
    parse: () => { throw new Error("no closing in this test"); },
    founder: async (transcript) => {
      seen.push(transcript);
      return { kind: "reply", reply: "Reply " + seen.length + ".", revealed: [], rules: [1], done: false, attempts: 1, rejected: [], requests: [] };
    },
  });
  await loop.nextUser(["Tell me more."]);
  await loop.nextUser(["Who pays?"]);
  expect(seen[1]).toEqual([{ role: "assistant", text: "Tell me more." }, { role: "person", text: "Reply 1.", own: own("Reply 1.") }, { role: "assistant", text: "Who pays?" }]);
});
