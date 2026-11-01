import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import { loadReaderMap, READER_SCOPE, readerOf, readerUsage, type ReaderMap } from "../../../src/trial/review/readers.ts";

const MAP_FILE = join(REPO_ROOT, "src", "trial", "review", "reader-maps", "gstack-1ea86923a861.json");
const loaded = loadReaderMap(MAP_FILE) as { map: ReaderMap; sha256: string };
const map = loaded.map;

describe("reader map and reader names (keyless)", () => {
  // Value: protects=section 3.6 item 3's naming rule: the one checklist a launch prompt names is its reader, two or more are batched, the adversarial marker alone is adversarial-native, anything else is other, and a path only counts whole; fails_when=a prefix or suffix of a checklist path counts, two checklists give one name, or the adversarial line beats a checklist; why_new=R2 build (GEVA-122); seam=readerOf
  test("readerOf names one checklist, batched, adversarial-native and other", () => {
    expect(readerOf("Read the checklist at ~/.claude/skills/gstack/review/specialists/testing.md, then run the diff.", map)).toBe("testing");
    expect(readerOf("Read ~/.claude/gstack-render/review/specialists/api-contract.md first.", map)).toBe("api-contract");
    expect(readerOf("Use review/design-checklist.md", map)).toBe("design");
    expect(readerOf("Run review/specialists/testing.md and review/specialists/security.md together.", map)).toBe("batched");
    expect(readerOf("Run review/specialists/testing.md twice: review/specialists/testing.md.", map)).toBe("testing");
    expect(readerOf("Think like an attacker and a chaos engineer. Your job is to find ways this code will fail in production.", map)).toBe("adversarial-native");
    expect(readerOf("You are a red team reviewer. Read the checklist at ~/.claude/skills/gstack/review/specialists/red-team.md. Think like an attacker and a chaos engineer.", map)).toBe("red-team");
    expect(readerOf("Explore the repository layout.", map)).toBe("other");
    expect(readerOf("Read review/specialists/testing.md.bak", map)).toBe("other");
    expect(readerOf("Read `review/specialists/testing.md`.", map)).toBe("testing");
    expect(readerOf("Read gstack-review/specialists/testing.md", map)).toBe("other");
    expect(readerOf("Read review/specialists/targeted.md", map)).toBe("other");
  });

  // Value: protects=the map pinned to gstack 1ea86923a861: it loads, names the full commit and the ten Review Army checklists, and a malformed map is refused; fails_when=the committed map drifts from /review's names or a map may claim batched, adversarial-native or other for a checklist; why_new=R2 build (GEVA-122); seam=loadReaderMap
  test("the committed map loads and malformed maps are refused", () => {
    expect(loaded.sha256).toBe(createHash("sha256").update(readFileSync(MAP_FILE)).digest("hex"));
    expect(map.gstack).toEqual({ repo: "garrytan/gstack", sha: "1ea86923a86129d1f32828b36acfe6f91f17c8e6" });
    expect(Object.values(map.checklists).sort()).toEqual(["api-contract", "data-migration", "design", "maintainability", "performance", "red-team", "security", "simplification", "state-machines", "testing"]);
    const dir = mkdtempSync(join(tmpdir(), "gse-readers-"));
    const bad = (m: unknown) => {
      const f = join(dir, "m.json");
      writeFileSync(f, JSON.stringify(m));
      return (loadReaderMap(f) as { problem?: string }).problem ?? null;
    };
    expect(bad({ ...map, schema_version: 2 })).toMatch(/schema_version/);
    expect(bad({ ...map, gstack: { repo: "garrytan/gstack", sha: "1ea8692" } })).toMatch(/40-character sha/);
    expect(bad({ ...map, checklists: { "review/specialists/x.md": "batched" } })).toMatch(/batched/);
    expect(bad({ ...map, checklists: { "review/specialists/x.md": "Red Team" } })).toMatch(/not a reader name/);
    expect(bad({ ...map, checklists: { "/abs/x.md": "x" } })).toMatch(/gstack-relative/);
    expect(bad({ ...map, adversarial: [] })).toMatch(/adversarial/);
    expect(READER_SCOPE.test("reader:adversarial-native")).toBe(true);
    expect(["reader:", "reader:Red Team", "reader:red_team", "readers:testing", "reader:-x"].some((s) => READER_SCOPE.test(s))).toBe(false);
  });

  // Value: protects=the map matches gstack's /review at its commit: every checklist exists there, and the adversarial marker is in Step 4.8's Claude subagent prompt; fails_when=a checklist was renamed or the marker reworded at the pinned commit; why_new=R2 build (GEVA-122); seam=the map against a gstack checkout at its commit (GSE_GSTACK_SRC)
  test.skipIf(!process.env.GSE_GSTACK_SRC)("the map's checklists and marker are in gstack at its commit (GSE_GSTACK_SRC)", () => {
    const src = process.env.GSE_GSTACK_SRC!;
    const head = Bun.spawnSync(["git", "-C", src, "rev-parse", "HEAD"]).stdout.toString().trim();
    expect(head).toBe(map.gstack.sha);
    for (const path of Object.keys(map.checklists)) expect(existsSync(join(src, path))).toBe(true);
    const army = readFileSync(join(src, "review", "sections", "review-army.md"), "utf8");
    for (const path of Object.keys(map.checklists)) expect(army).toContain(path);
    for (const marker of map.adversarial) expect(readFileSync(join(src, "review", "sections", "adversarial.md"), "utf8")).toContain(marker);
  });

  // Value: protects=which launches count: a launch the CLI started counts once, one it refused or one from inside a subagent never counts, the Task tool name counts like Agent, and a reader's tokens are unknown when one of its subagents never reported; fails_when=a refused or nested launch adds a reader, or a partial sum reads as exact; why_new=R2 build (GEVA-122); seam=readerUsage
  test("readerUsage counts started main-agent launches only", () => {
    const launch = (id: string, prompt: string, name = "Agent", parent: string | null = null) => ({ type: "assistant", parent_tool_use_id: parent, message: { id: "m", content: [{ type: "tool_use", id, name, input: { prompt } }] } });
    const started = (id: string) => ({ type: "system", subtype: "task_started", tool_use_id: id });
    const note = (id: string, total: number) => ({ type: "system", subtype: "task_notification", tool_use_id: id, usage: { total_tokens: total } });
    const messages = [
      launch("a", "review/specialists/testing.md"), started("a"), note("a", 10),
      launch("b", "review/specialists/testing.md", "Task"), { type: "assistant", parent_tool_use_id: "b", message: { content: [] } }, note("b", 5),
      launch("c", "review/specialists/security.md"),
      launch("d", "review/specialists/performance.md", "Agent", "a"), started("d"), note("d", 99),
      launch("e", "Think like an attacker and a chaos engineer."), started("e"),
    ];
    expect(readerUsage(messages, map)).toEqual([{ reader: "adversarial-native", launches: 1, total_tokens: null }, { reader: "testing", launches: 2, total_tokens: 15 }]);
    expect(readerUsage([], map)).toEqual([]);
  });
});
