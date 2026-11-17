// The scripted checker for the fixture unit: it drives the browser container's MCP server the way the checker agent
// does (navigate, type, click, upload, snapshot, all through MCP) and prints a verdicts block. It runs keyless in a
// sidecar on the trial network. A tool call that fails (no such element) leaves its task not done.
const url = process.argv[2];
const APP = "http://localhost:3000/";
let sid = null;
let n = 0;
async function rpc(method, params, notify = false) {
  const h = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (sid) h["mcp-session-id"] = sid;
  const r = await fetch(url, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", ...(notify ? {} : { id: ++n }), method, params }) });
  sid = r.headers.get("mcp-session-id") ?? sid;
  const t = await r.text();
  if (notify) return null;
  const line = t.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : t);
}
async function tool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  const text = (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  return { ok: !r.error && !r.result?.isError, text };
}
const snap = async () => (await tool("browser_snapshot", {})).text;
const reload = () => tool("browser_navigate", { url: APP });
const steps = async (list) => { for (const [name, args] of list) if (!(await tool(name, args)).ok) return false; return true; };
const line = (s, name) => s.split("\n").find((l) => l.includes(name)) ?? "";
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "day-one-fixture", version: "1" } });
await rpc("notifications/initialized", {}, true);
const v = [];
const say = (id, done, why) => v.push({ id, done, why });
await reload();
const added = await steps([["browser_type", { element: "plant name", target: "#name", text: "Fern" }], ["browser_type", { element: "days", target: "#days", text: "3" }], ["browser_click", { element: "add", target: "#add" }]]);
await reload();
let s = await snap();
say("t1", added && /Fern/.test(s) && /every 3 days/.test(line(s, "Fern")), added ? "added, then reloaded" : "no add control");
say("t2", /due today/i.test(line(s, "Fern")), "Fern line: " + line(s, "Fern").trim().slice(0, 80));
const watered = await steps([["browser_click", { element: "watered", target: "#water-Fern" }]]);
await reload();
s = await snap();
say("t3", watered && /Fern/.test(s) && !/due today/i.test(line(s, "Fern")), watered ? "marked, then reloaded" : "no watered control");
const imported = await steps([["browser_click", { element: "import file", target: "#import-file" }], ["browser_file_upload", { paths: ["/samples/plants.csv"] }], ["browser_click", { element: "import", target: "#import" }]]);
await reload();
s = await snap();
say("t4", imported && ["Cactus", "Basil", "Ivy"].every((p) => s.includes(p)), imported ? "imported, then reloaded" : "no import control");
const removed = await steps([["browser_click", { element: "remove Ivy", target: "#remove-Ivy" }]]);
await reload();
s = await snap();
say("t5", removed && !s.includes("Ivy") && s.includes("Cactus"), removed ? "removed, then reloaded" : "no remove control");
console.log("Tried every task.\n\n```verdicts\n" + JSON.stringify({ tasks: v }) + "\n```");
