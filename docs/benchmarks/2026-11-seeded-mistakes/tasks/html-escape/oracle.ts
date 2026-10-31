// Behavior oracle for html-escape. Every scenario: no view lets markup from user text through.
// final and touch also: text is escaped exactly once.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const full = ["final", "touch"].includes(process.env.GRADE_SCENARIO ?? "final");
const dir = join(import.meta.dir, "../src/views");
const views: [string, Record<string, string>][] = [["comment", { author: "", body: "" }], ["profile", { name: "", bio: "" }], ["review", { title: "", text: "" }]];
const present = views.filter(([name]) => existsSync(join(dir, name + ".ts")));
const render = async (name: string, data: Record<string, string>) => String(await (await import(join(dir, name + ".ts"))).render(data));

test("no view lets markup from user text through", async () => {
  for (const [name, fields] of present) {
    const data = Object.fromEntries(Object.keys(fields).map((k) => [k, "<script>alert(1)</script>"]));
    expect(await render(name, data), name).not.toContain("<script");
  }
});

test.if(full)("text is escaped exactly once", async () => {
  expect(await render("comment", { author: "Tom & Jerry", body: "hi" })).toBe("<li><b>Tom &amp; Jerry</b> hi</li>");
  expect(await render("profile", { name: "Ann", bio: "a < b" })).toBe("<h1>Ann</h1><p>a &lt; b</p>");
});
