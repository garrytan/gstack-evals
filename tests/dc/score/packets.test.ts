// Copyright (c) 2026 Garry Tan. MIT License.
// Label packets: the rendered input of a 2x and a 10x packet, cache identities, oracle lists, the derangement and determinism.
import { describe, expect, test } from "bun:test";
import { STOCK_ROWS } from "../../../lanes/design-constructed/frozen.ts";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { makeKey, makeRow, makeUnit } from "../../../lanes/design-constructed/score/fixtures.ts";
import { cacheKeyOf, promptDigest, promptFor } from "../../../lanes/design-constructed/score/labels.ts";
import { buildCheckPackets, buildLabelPackets, componentIds, derangePartners, itemFile, oracleList, renderPacket } from "../../../lanes/design-constructed/score/packets.ts";

const u = makeUnit("u1x", { tier: "2x", base: "u1", key: makeKey({ tier: "2x", detailKeyed: [0, 2] }) });
const units = new Map([[u.unit.id, u]]);
const rows = [makeRow("u1x", "none", ["Show skeleton rows ZQ1 DT1.", "Cards ZQ3 on phones."])];
const build = (read: "2x" | "10x") => buildLabelPackets({ stage: 1, read, units, rows, calibration: new Set() });
const stock = (id: string, row: number) => "List " + id + "\n" + STOCK_ROWS[row - 1]!.changes.map((c, i) => i + 1 + ". " + c).join("\n");
const SESSION = "1. Show skeleton rows ZQ1 DT1.\n2. Cards ZQ3 on phones.";

describe("rendered input (R2-5)", () => {
  test("the 2x packet: statements, the decoy and the wrong-way facts as items, no details", () => {
    expect(renderPacket(build("2x").packets[0]!)).toBe(
      [
        "KEY ITEMS",
        "[if2927] Two customers asked for a dark theme WW1 on every screen.",
        "[wr9gnq] One note says a map view WW2 of orders could help dispatch.",
        "[3yiad3] Several notes worry about the print layout DC1 of the orders table.",
        "[adxzmu] Drivers open the orders table ZQ3 on phones 360 pixels wide, where its columns run off screen (src/pages/Orders.tsx).",
        "    file: src/pages/Orders.tsx",
        "[wdtycn] The app's DataGrid component ZQ5 already pages long tables, and the orders table should use it (src/components/DataGrid.vue).",
        "    file: src/components/DataGrid.vue",
        "[5haqe5] Staff on the orders table ZQ2 look for the export action first, and it sits below the fold (src/pages/Orders.tsx).",
        "    file: src/pages/Orders.tsx",
        "[nxuxfv] The new orders table ZQ1 sits blank for several seconds while its one slow request loads (src/pages/Orders.tsx).",
        "    file: src/pages/Orders.tsx",
        "[xvwxee] Screen-reader users ZQ4 can't tell the sort state of the SortHeader columns on the orders table (src/components/SortHeader.tsx).",
        "    file: src/components/SortHeader.tsx",
        "",
        "CHANGE LISTS",
        "",
        "List cfaf2s\n" + SESSION,
        "",
        stock("u693rv", 1),
        "",
        stock("dqdd5n", 3),
        "",
        stock("kqdrv4", 2),
      ].join("\n"),
    );
  });
  test("the 10x packet: keyed details beside their items, no decoy or wrong-way items", () => {
    expect(renderPacket(build("10x").packets[0]!)).toBe(
      [
        "KEY ITEMS",
        "[gy8szf] The app's DataGrid component ZQ5 already pages long tables, and the orders table should use it (src/components/DataGrid.vue).",
        "    file: src/components/DataGrid.vue",
        "[ap4ced] Drivers open the orders table ZQ3 on phones 360 pixels wide, where its columns run off screen (src/pages/Orders.tsx).",
        "    file: src/pages/Orders.tsx",
        "    detail: 360 pixels DT3, card rows",
        "[5cgry6] Staff on the orders table ZQ2 look for the export action first, and it sits below the fold (src/pages/Orders.tsx).",
        "    file: src/pages/Orders.tsx",
        "[5dpurx] The new orders table ZQ1 sits blank for several seconds while its one slow request loads (src/pages/Orders.tsx).",
        "    file: src/pages/Orders.tsx",
        "    detail: skeleton rows DT1, first 50 shown",
        "[b6qdww] Screen-reader users ZQ4 can't tell the sort state of the SortHeader columns on the orders table (src/components/SortHeader.tsx).",
        "    file: src/components/SortHeader.tsx",
        "",
        "CHANGE LISTS",
        "",
        stock("gvrnp9", 2),
        "",
        "List gihmuy\n" + SESSION,
        "",
        stock("gu348z", 3),
        "",
        stock("ct7ykx", 1),
      ].join("\n"),
    );
  });
  test("only the 10x prompt carries the detail label, and the two have separate cache identities", () => {
    const [p2, p10] = [build("2x").packets[0]!, build("10x").packets[0]!];
    expect(promptFor(p2)).not.toContain("detail_changes");
    expect(promptFor(p10)).toContain('"detail_changes"');
    expect(promptFor(p10).endsWith(renderPacket(p10) + "\n")).toBe(true);
    expect(promptDigest(p2)).not.toBe(promptDigest(p10));
    expect(cacheKeyOf("astra", "medium", p2)).not.toBe(cacheKeyOf("astra", "medium", p10));
    expect(cacheKeyOf("astra", "medium", p2)).not.toBe(cacheKeyOf("opus", "medium", p2));
  });
  test("the same input builds the same packets, and the check pass mirrors them with the audit prompt and fresh ids", () => {
    expect(build("2x")).toEqual(build("2x"));
    const check = buildCheckPackets({ stage: 1, read: "2x", units, rows, calibration: new Set() });
    expect(check.packets[0]!.prompt).toBe("audit");
    expect(check.packets[0]!.id).not.toBe(build("2x").packets[0]!.id);
    expect(check.metas[0]!.role).toBe("check");
  });
});

describe("packet contents", () => {
  test("a calibration unit's packet carries the oracle list; a 10x oracle change adds its detail and reports a cut", () => {
    const b = buildLabelPackets({ stage: 1, read: "base", units: new Map([["u1", makeUnit("u1")]]), rows: [makeRow("u1", "none", ["x"])], calibration: new Set(["u1"]) });
    expect(Object.values(b.metas[0]!.lists).map((l) => l.source).sort()).toEqual(["none", "oracle", "stock-1", "stock-2", "stock-3"]);
    const key = makeKey({ tier: "2x", detailKeyed: [0, 1] });
    key.items[1]!.detail = Array.from({ length: 25 }, (_, i) => "d" + i).join(" ");
    const o = oracleList(key, "10x");
    expect(o.changes[0]).toBe(key.items[0]!.statement + " Specifically: " + key.items[0]!.detail);
    expect(o.changes[1]!.split(" ").length).toBe(40);
    expect(o.cut).toEqual(["02"]);
    expect(oracleList(key, "2x").changes[0]).toBe(key.items[0]!.statement);
  });
  test("dropped items leave the packet; mentioned and generic items stay for their strata", () => {
    const key = makeKey({ tier: "base", drop: { 4: "audit" }, mentioned: [0], generic: [1] });
    const b = buildLabelPackets({ stage: 1, read: "base", units: new Map([["u1", makeUnit("u1", { key })]]), rows: [makeRow("u1", "none", ["x"])], calibration: new Set() });
    expect(Object.values(b.metas[0]!.items).map((r) => (r as { id: string }).id).sort()).toEqual(["01", "02", "03", "04"]);
  });
  test("stage 1 shuffled packets read base-tier lists only", () => {
    expect(() => buildLabelPackets({ stage: 1, read: "2x", units, rows, calibration: new Set(), partners: new Map([["u1x", "u1x"]]) })).toThrow(DcError);
  });
  test("files and component identifiers come from the statement", () => {
    expect(itemFile("The table (src/pages/Orders.tsx), see e.g. 4.5 and app/x.vue.")).toBe("app/x.vue");
    expect(itemFile("No file here, 4.5:1 contrast.")).toBeNull();
    expect(componentIds("The DataGrid and useOrders with ZQ5 and Table")).toEqual(["DataGrid", "useOrders"]);
  });
  test("the derangement keeps a base app's units together and never maps a unit to itself", () => {
    const pool = ["a1", "a2", "a3", "c1", "c2", "c3"].map((id) => makeUnit(id, { baseApp: "app-" + id[0] }));
    const d = derangePartners(pool)!;
    for (const [k, v] of d) expect([k !== v, v[0]]).toEqual([true, k[0]]);
    expect(derangePartners(pool)).toEqual(d);
  });
  test("a lone unit on its base app takes a partner from another app, and exactly one unit takes it", () => {
    const pool = ["a1", "a2", "a3", "b1", "c1", "c2"].map((id) => makeUnit(id, { baseApp: "app-" + id[0] }));
    const d = derangePartners(pool)!;
    expect(d.get("b1")![0]).not.toBe("b");
    expect([...d.values()].filter((v) => v === "b1").length).toBe(1);
    expect([...d].filter(([k, v]) => k !== "b1" && v !== "b1" && k[0] !== v[0]).length).toBe(0);
    for (const [k, v] of d) expect(k).not.toBe(v);
  });
});
