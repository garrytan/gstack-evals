import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_GSTACK } from "../../lanes/ask-replay/fixtures.ts";
import { AskError, FROZEN } from "../../lanes/ask-replay/frozen.ts";
import { buildPrompt, CAPABILITY, components, gstackLines, HARNESS, LEDGER_ADDENDUM, LEDGER_FIELDS, loadGstack, ORDER, replySchema } from "../../lanes/ask-replay/prompt.ts";
import { generate } from "../../lanes/ask-replay/synthetic/generator.ts";
import { ARMS } from "../../lanes/ask-replay/types.ts";

const items = generate().items;
const CLONE = join(homedir(), ".local/share/gstack");
const hasPin = existsSync(CLONE) && spawnSync("git", ["-C", CLONE, "cat-file", "-e", FROZEN.gstack.commit]).status === 0;

describe("arm prompts (section 3)", () => {
  test("components follow the frozen order in every arm, with the arm text absent in a and the ledger only in c and d", () => {
    for (const it of items.slice(0, 10)) for (const arm of ARMS) {
      const names = components(it, arm, FIXTURE_GSTACK).map((c) => c.name);
      expect(names).toEqual(ORDER.filter((n) => (n !== "arm" || arm !== "a") && (n !== "ledger" || arm === "c" || arm === "d")));
    }
  });
  test("the system text is harness, arm text and capability; the user text is rules, conversation, ledger and draft", () => {
    const p = buildPrompt(items[30]!, "c", FIXTURE_GSTACK);
    expect(p.system.startsWith(HARNESS)).toBe(true);
    expect(p.system.endsWith(CAPABILITY)).toBe(true);
    expect(p.user).toContain(LEDGER_FIELDS);
    expect(p.user.trimEnd().endsWith(items[30]!.draft.trimEnd())).toBe(true);
  });
  test("arm a is clean: harness, capability and arm a text hold no gstack line of 40+ characters and no gstack token", () => {
    const texts = [HARNESS, CAPABILITY, buildPrompt(items[0]!, "a", FIXTURE_GSTACK).system];
    for (const t of texts) {
      expect(gstackLines(t, FIXTURE_GSTACK)).toBe(0);
      expect(t).not.toMatch(/gstack/i);
    }
    expect(gstackLines(buildPrompt(items[0]!, "b", FIXTURE_GSTACK).system, FIXTURE_GSTACK)).toBeGreaterThan(0);
  });
  test.skipIf(!hasPin)("arm a is clean against the real pinned gstack files too", () => {
    const g = loadGstack(CLONE);
    expect(gstackLines(HARNESS + "\n" + CAPABILITY + "\n" + LEDGER_ADDENDUM + "\n" + LEDGER_FIELDS, g)).toBe(0);
  });
  test("no prompt holds a label, an item id, a thread code or the labelling reply", () => {
    for (const it of items) for (const arm of ARMS) {
      const p = buildPrompt(it, arm, FIXTURE_GSTACK);
      expect(p.user).not.toMatch(/\b(DECISION|DUPLICATE|PERMISSION_FOR_DEFAULT|OBSERVABLE)\b/);
      expect(p.system + p.user).not.toContain(it.item);
      expect(p.user).not.toMatch(new RegExp("\\b" + it.thread + "\\b"));
      if (it.after_reply && !it.conversation.some((m) => m.text === it.after_reply!.text)) expect(p.user).not.toContain(it.after_reply.text);
    }
  });
  test("arm d is arm a plus exactly arm c's ledger parts", () => {
    for (const it of items.slice(20, 40)) {
      const a = buildPrompt(it, "a", FIXTURE_GSTACK).components;
      const c = buildPrompt(it, "c", FIXTURE_GSTACK).components;
      const d = buildPrompt(it, "d", FIXTURE_GSTACK).components;
      expect(d.filter((x) => x.name !== "arm" && x.name !== "ledger")).toEqual(a);
      expect(d.find((x) => x.name === "arm")!.text).toBe(LEDGER_ADDENDUM);
      expect(d.find((x) => x.name === "ledger")).toEqual(c.find((x) => x.name === "ledger")!);
    }
  });
  test("the reply schema requires every field, with the two ledger fields in c and d", () => {
    expect((replySchema("a") as { required: string[] }).required).toEqual(["action", "reason"]);
    expect((replySchema("d") as { required: string[] }).required).toEqual(["action", "reason", "repeats", "reask_reason"]);
  });
  test("arms b and c refuse without the pinned text", () => {
    expect(() => buildPrompt(items[0]!, "b", null)).toThrow(AskError);
  });
});

describe("gstack pins (E_ASK_PIN)", () => {
  test("git show at the pin is checked against each file's sha256", () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-pin-"));
    try {
      spawnSync("git", ["init", "-q", dir]);
      writeFileSync(join(dir, "f.md"), "pinned text\n");
      const blob = spawnSync("git", ["-C", dir, "hash-object", "-w", "f.md"], { encoding: "utf8" }).stdout.trim();
      const tree = spawnSync("git", ["-C", dir, "mktree"], { input: "100644 blob " + blob + "\tf.md\n", encoding: "utf8" }).stdout.trim();
      const sha = createHash("sha256").update("pinned text\n").digest("hex");
      expect(loadGstack(dir, { commit: tree, files: [{ path: "f.md", sha256: sha }] }).text).toContain("pinned text");
      const wrong = () => loadGstack(dir, { commit: tree, files: [{ path: "f.md", sha256: "0".repeat(64) }] });
      expect(wrong).toThrow(/E_ASK_PIN/);
      expect(() => loadGstack(dir, { commit: tree, files: [{ path: "missing.md", sha256: sha }] })).toThrow(/E_ASK_PIN/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("frozen.json pins gstack v1.99.5.0 at 0326b14 with three files", () => {
    expect(FROZEN.gstack.commit).toMatch(/^0326b14[0-9a-f]{33}$/);
    expect(FROZEN.gstack.files.map((f) => f.path)).toEqual(["capy/skill/gstack/factory.md", "capy/skill/gstack/captain.md", "captain/SKILL.md"]);
  });
  test.skipIf(!hasPin)("the real clone matches every pinned sha256", () => {
    expect(loadGstack(CLONE).commit).toBe(FROZEN.gstack.commit);
  });
});
