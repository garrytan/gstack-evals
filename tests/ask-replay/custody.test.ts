import { describe, expect, test } from "bun:test";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { custody, gone, keygen, readIdentity, readRecords, seal, sealedStore, sweep, sweepLeftovers, writeSums } from "../../lanes/ask-replay/custody.ts";
import { answerBody, deadPid, FIXTURE_GSTACK } from "../../lanes/ask-replay/fixtures.ts";
import { AskError } from "../../lanes/ask-replay/frozen.ts";
import { runShard, schedule } from "../../lanes/ask-replay/run.ts";
import { generate } from "../../lanes/ask-replay/synthetic/generator.ts";
import type { SampleRecord } from "../../lanes/ask-replay/types.ts";

const scratch = () => ({ shm: mkdtempSync(join("/dev/shm", "ask-test-shm-")), dir: mkdtempSync(join(tmpdir(), "ask-test-custody-")) });
const clean = (s: { shm: string; dir: string }) => (rmSync(s.shm, { recursive: true, force: true }), rmSync(s.dir, { recursive: true, force: true }));

describe("custody on a throwaway age identity", () => {
  test("seal, then open with an async reader: the directory lasts until the reader settles, then it and the identity are proved gone", async () => {
    const s = scratch();
    try {
      const { identity, recipient } = keygen();
      writeFileSync(join(s.shm, "items.jsonl"), "secret line\n");
      const sums = join(s.dir, "SHA256SUMS");
      const sealed = seal(join(s.shm, "items.jsonl"), recipient, { sums });
      expect(gone(join(s.shm, "items.jsonl"))).toBe(true);
      const log = join(s.dir, "CUSTODY.md");
      let opened = "";
      const out = await custody({ files: [sealed.path], sums, log, identity, shm: s.shm, sweep: [s.dir] }, async (d) => {
        opened = d;
        await new Promise((r) => setTimeout(r, 30));
        expect(existsSync(join(d, "..", "identity"))).toBe(false);
        return readFileSync(join(d, "items.jsonl"), "utf8");
      });
      expect(out).toBe("secret line\n");
      expect(gone(opened)).toBe(true);
      const text = readFileSync(log, "utf8");
      expect(text).toContain("identity removed (test ! -e passed)");
      expect(text).toMatch(/close: decrypted directory removed \(test ! -e passed\)/);
    } finally {
      clean(s);
    }
  });
  test("a reader that throws still tears down, and the error comes back", async () => {
    const s = scratch();
    try {
      const { identity, recipient } = keygen();
      writeFileSync(join(s.shm, "items.jsonl"), "x\n");
      const sums = join(s.dir, "SHA256SUMS");
      const sealed = seal(join(s.shm, "items.jsonl"), recipient, { sums });
      let opened = "";
      await expect(custody({ files: [sealed.path], sums, log: join(s.dir, "C.md"), identity, shm: s.shm, sweep: [s.dir] }, async (d) => {
        opened = d;
        throw new Error("reader failed");
      })).rejects.toThrow("reader failed");
      expect(gone(opened)).toBe(true);
    } finally {
      clean(s);
    }
  });
  test("a leftover from an earlier opening is swept and logged; a digest mismatch stops with E_ASK_CUSTODY", async () => {
    const s = scratch();
    try {
      const { identity, recipient } = keygen();
      writeFileSync(join(s.shm, "items.jsonl"), "x\n");
      const sums = join(s.dir, "SHA256SUMS");
      const sealed = seal(join(s.shm, "items.jsonl"), recipient, { sums });
      mkdirSync(join(s.shm, "ask-custody-old"));
      writeFileSync(join(s.shm, "ask-custody-old", "owner.pid"), String(deadPid()));
      writeFileSync(join(s.shm, "ask-custody-old", "plain"), "left");
      writeFileSync(sums, "0".repeat(64) + "  " + "items.jsonl.age\n");
      const log = join(s.dir, "C.md");
      await expect(custody({ files: [sealed.path], sums, log, identity, shm: s.shm, sweep: [s.dir] }, () => 1)).rejects.toThrow(/E_ASK_CUSTODY/);
      expect(existsSync(join(s.shm, "ask-custody-old"))).toBe(false);
      expect(readFileSync(log, "utf8")).toContain("incident: removed a leftover custody directory");
    } finally {
      clean(s);
    }
  });
  test("the leftover sweep removes only directories whose recorded owner is dead: a live owner's or an unreadable one's stays", () => {
    const s = scratch();
    try {
      const log = join(s.dir, "C.md");
      for (const [name, pid] of [["ask-custody-dead", String(deadPid())], ["ask-custody-live", String(process.pid)], ["ask-custody-parent", String(process.ppid)], ["ask-custody-junk", "not a pid"]] as const) {
        mkdirSync(join(s.shm, name));
        writeFileSync(join(s.shm, name, "owner.pid"), pid);
      }
      mkdirSync(join(s.shm, "ask-custody-nopid"));
      expect(sweepLeftovers(s.shm, log)).toBe(1);
      expect(existsSync(join(s.shm, "ask-custody-dead"))).toBe(false);
      for (const name of ["ask-custody-live", "ask-custody-parent", "ask-custody-junk", "ask-custody-nopid"]) expect(existsSync(join(s.shm, name))).toBe(true);
      expect(readFileSync(log, "utf8").match(/incident: removed a leftover custody directory/g)).toHaveLength(1);
    } finally {
      clean(s);
    }
  });
  test("an opening records its owner pid, so a second opening at the same time leaves it alone", async () => {
    const s = scratch();
    try {
      const { identity, recipient } = keygen();
      writeFileSync(join(s.shm, "items.jsonl"), "x\n");
      const sums = join(s.dir, "SHA256SUMS");
      const sealed = seal(join(s.shm, "items.jsonl"), recipient, { sums });
      const log = join(s.dir, "C.md");
      await custody({ files: [sealed.path], sums, log, identity, shm: s.shm, sweep: [s.dir] }, async (d) => {
        expect(readFileSync(join(d, "..", "owner.pid"), "utf8")).toBe(String(process.pid));
        const inner = await custody({ files: [sealed.path], sums, log, identity, shm: s.shm, sweep: [s.dir] }, () => existsSync(join(d, "items.jsonl")));
        expect(inner).toBe(true);
        expect(existsSync(join(d, "items.jsonl"))).toBe(true);
      });
      expect(readFileSync(log, "utf8")).not.toContain("removed a leftover");
    } finally {
      clean(s);
    }
  });
  for (const [sig, code] of [["SIGTERM", 143], ["SIGINT", 130], ["SIGHUP", 129]] as const) test(sig + " during an opening removes the decrypted directory, logs it and exits " + code, async () => {
    const s = scratch();
    try {
      const { identity, recipient } = keygen();
      writeFileSync(join(s.shm, "items.jsonl"), "x\n");
      const sums = join(s.dir, "SHA256SUMS");
      const sealed = seal(join(s.shm, "items.jsonl"), recipient, { sums });
      const log = join(s.dir, "C.md");
      const exits: number[] = [];
      let opened = "";
      await custody({ files: [sealed.path], sums, log, identity, shm: s.shm, sweep: [s.dir], exit: (c) => exits.push(c) }, (d) => {
        opened = d;
        process.emit(sig as never);
        expect(gone(d)).toBe(true);
      });
      expect(exits).toEqual([code]);
      expect(readFileSync(log, "utf8")).toContain("incident: " + sig + " ended the opening; decrypted directory removed (test ! -e passed)");
      expect(gone(opened)).toBe(true);
      expect(process.listenerCount(sig)).toBe(0);
    } finally {
      clean(s);
    }
  });
  test("a shard the deadline ends inside an opening still tears the directory down", async () => {
    const s = scratch();
    try {
      const { identity, recipient } = keygen();
      const items = generate().items.slice(0, 1);
      writeFileSync(join(s.shm, "items.jsonl"), JSON.stringify(items[0]) + "\n");
      const sums = join(s.dir, "SHA256SUMS");
      const sealed = seal(join(s.shm, "items.jsonl"), recipient, { sums });
      let fire = () => {};
      let opened = "";
      await expect(custody({ files: [sealed.path], sums, log: join(s.dir, "C.md"), identity, shm: s.shm, sweep: [s.dir] }, (d) => {
        opened = d;
        const client = { call: async () => (fire(), { status: 200, body: answerBody("opus", '{"action":"SEND","reason":"r"}'), micros: 1 }) };
        return runShard({ items: new Map(items.map((i) => [i.item, i])), samples: schedule(items, "opus", 1, 1), gstack: FIXTURE_GSTACK, client, store: { has: () => false, write: () => {} }, out: join(s.dir, "out"), maxOutputTokens: 4000, sleep: async () => {}, concurrency: 1, deadline: (_ms, f) => ((fire = f), () => {}) });
      })).rejects.toMatchObject({ code: "E_ASK_SHARD_LIMIT" });
      expect(gone(opened)).toBe(true);
    } finally {
      clean(s);
    }
  });
  test("the sweep deletes record-named files written since the opening, unopened", () => {
    const s = scratch();
    try {
      const since = new Date();
      writeFileSync(join(s.dir, "items.jsonl"), "x");
      writeFileSync(join(s.dir, "x.a.opus.1.ask.json"), "x");
      writeFileSync(join(s.dir, "notes.txt"), "x");
      expect(sweep([s.dir], since)).toBe(2);
      expect(existsSync(join(s.dir, "notes.txt"))).toBe(true);
    } finally {
      clean(s);
    }
  });
  test("the identity is refused at once when stdin is empty", () => {
    const s = scratch();
    try {
      writeFileSync(join(s.dir, "empty"), "");
      const fd = openSync(join(s.dir, "empty"), "r");
      try {
        expect(() => readIdentity(fd)).toThrow(AskError);
        expect(() => readIdentity(fd)).toThrow(/E_ASK_IDENTITY/);
      } finally {
        closeSync(fd);
      }
    } finally {
      clean(s);
    }
  });
  test("the sealed reply store encrypts from memory and round-trips under custody", async () => {
    const s = scratch();
    try {
      const { identity, recipient } = keygen();
      const store = sealedStore(join(s.dir, "replies"), recipient);
      store.write("i-1.a.opus.1", { draw: 1 } as unknown as SampleRecord);
      expect(store.has("i-1.a.opus.1")).toBe(true);
      expect(readFileSync(join(s.dir, "replies", "i-1.a.opus.1.ask.json.age"), "utf8")).not.toContain("draw");
      const sums = writeSums(join(s.dir, "replies"));
      const back = await custody({ files: [join(s.dir, "replies", "i-1.a.opus.1.ask.json.age")], sums, log: join(s.dir, "C.md"), identity, shm: s.shm, sweep: [s.dir] }, (d) => readRecords(d));
      expect(back.get("i-1.a.opus.1")!.draw).toBe(1);
    } finally {
      clean(s);
    }
  });
});
