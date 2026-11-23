import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { parseCodexArms } from "../../../src/trial/review/codex.ts";
import { TOLD_SHA256 } from "../../../src/trial/review/told.ts";
import { ARM_SETTINGS, GSTACK, MODEL } from "../../../lanes/codex-hooks/pins.ts";
import { ARMS, armRef, CODEX_BIN, codexArmsText, CONTRACT_ARMS, INSTALL, ITEM_NAMES, ITEMS, itemUnits, PASSES, PREFIX, PREFIX_SHA256, suiteUnits, TOLD_PREFIX } from "../../../lanes/codex-hooks/c/pins.ts";

describe("part C's frozen values (preregistration sections 5.1, 5.2, 9 and 11)", () => {
  // Value: protects=the prefix every gstack arm's prompt carries is section 5.2's text byte for byte, and the template after it is stacks round 1's; fails_when=a word of the prefix or the template changes; why_new=GEVA-562 part C; seam=lanes/codex-hooks/c/pins.ts PREFIX, src/trial/review/told.ts; no_claim=how the model reads it
  test("the prefix and the told template are the frozen texts", () => {
    expect(createHash("sha256").update(PREFIX).digest("hex")).toBe("cf473585a0c5d3df0f032d18c469845709d28978a7ed6d9c39de8609c987aa65");
    expect(PREFIX_SHA256).toBe("cf473585a0c5d3df0f032d18c469845709d28978a7ed6d9c39de8609c987aa65");
    expect(PREFIX.endsWith("If a stop hook blocks your reply, end your next reply again with the complete fenced json block.")).toBe(true);
    expect(TOLD_PREFIX).toBe("$review " + PREFIX);
    expect(TOLD_SHA256).toBe("16862a34212cd2eddbcedbc5654b26cb92b0dad50e3d501686770e6bc3d088ad");
  });

  // Value: protects=the four arms are section 5.2's table as review-units' codex-arms entries: c-on and c-high with gstack at the pin, hooks trusted and contracts on, c-off the same with skill_contracts off, c-none bare at low effort, all on the sleep-tool setting, and review-units' own parser takes each item's file; fails_when=an arm drifts from the table or the file fails review-units' check; why_new=GEVA-562 part C; seam=ARMS, codexArmsText, parseCodexArms; no_claim=the install runs, which the end-to-end check covers
  test("the arms are section 5.2's table, and review-units takes each item's codex-arms file", () => {
    expect(ARMS["c-on"]).toEqual({ effort: "low", hook_trust: true, settings: { ...ARM_SETTINGS }, gstack_config: {}, switches: ["skill_routing", "skill_contracts", "destructive_guard"], install: INSTALL, told_prefix: TOLD_PREFIX });
    expect(ARMS["c-off"]).toEqual({ ...ARMS["c-on"], gstack_config: { skill_contracts: "off" } });
    expect(ARMS["c-high"]).toEqual({ ...ARMS["c-on"], effort: "high" });
    expect(ARMS["c-none"]).toEqual({ effort: "low", hook_trust: false, settings: { "features.sleep_tool": false }, gstack_config: {}, switches: [], install: null, told_prefix: null });
    expect(INSTALL).toBe("PATH=/opt/codex-0.170.0/bin:$PATH ./setup --host codex --no-browser -q");
    expect(CODEX_BIN).toBe("/opt/codex-0.170.0/bin/codex");
    expect(CONTRACT_ARMS).toEqual(["c-on", "c-high"]);
    expect(armRef("c-on")).toBe("c-on=garrytan/gstack@" + GSTACK.sha);
    expect(armRef("c-none")).toBe("c-none=none");
    for (const item of ITEM_NAMES) {
      const parsed = parseCodexArms(codexArmsText(ITEMS[item].arms), ITEMS[item].arms);
      expect(parsed.bin).toBe(CODEX_BIN);
      expect(Object.keys(parsed.arms)).toEqual([...ITEMS[item].arms]);
    }
    expect(MODEL).toBe("gpt-6.1-sol");
  });

  // Value: protects=the suite is stacks-r1 at its frozen sha256 with 33 units, the pilot is the first six units of seed 20261119's order at one pass, and each item's sessions are its units times passes times arms (18, 6, 198 and 66) with section 11's caps and section 5.7's allowances; fails_when=the suite, the seed, the draw or an item's count drifts; why_new=GEVA-562 part C; seam=suiteUnits, itemUnits, ITEMS; no_claim=the units build, which the pilot covers
  test("the suite, the pilot draw and the items' sessions, caps and allowances", () => {
    const ids = suiteUnits();
    expect(ids).toHaveLength(33);
    expect(itemUnits("c-pilot", ids)).toEqual(["garrytan/gstack#3526@808dead70e32", "garrytan/gstack#3431@8f4cbb8db01c", "garrytan/gbrain#7901@40461c875975", "garrytan/gstack#3583@f5bcdf71a765", "garrytan/gbrain#7794@2d801d54cee4", "garrytan/gstack#3516@ee73419c3295"]);
    expect(itemUnits("h-pilot", ids)).toEqual(itemUnits("c-pilot", ids));
    expect(new Set(itemUnits("c-main", ids))).toEqual(new Set(ids));
    for (const item of ITEM_NAMES) expect(itemUnits(item, ids).length * PASSES[ITEMS[item].phase] * ITEMS[item].arms.length).toBe(ITEMS[item].sessions);
    expect(ITEM_NAMES.map((i) => [ITEMS[i].sessions, ITEMS[i].central_usd, ITEMS[i].cap_usd, ITEMS[i].allowance_usd])).toEqual([[18, 21, 60, 8], [6, 18, 85, 15], [198, 234, 345, 8], [66, 201, 330, 15]]);
  });
});
