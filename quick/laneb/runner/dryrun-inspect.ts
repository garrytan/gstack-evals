// Reads the first main-loop request a dry-run arm sent (recorded by the dry run's pass-through shim) and
// prints what reached the model: request bytes, where investigate's description sits, how many skills
// the listing names, and for a told arm whether the body's first 200 characters came with the /investigate line.
//   bun runner/dryrun-inspect.ts <shim log> <arm> <arm tar> <told 0|1>
import { closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { entryBytes, onlyFile, REWRITTEN_DESCRIPTION, tarEntries } from "../arms/variants.ts";
import { splitSkill } from "../arms/placebo/placebo.ts";

const [logPath, arm, tar, told] = Bun.argv.slice(2);
const SHIPPED = "Systematic debugging with root cause investigation. (gstack)";
const REWRITTEN_TAIL = REWRITTEN_DESCRIPTION.slice(52, 140);
const reqs = readFileSync(logPath!, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const first = reqs.find((r) => /\/v1\/messages$/.test(r.path) && (JSON.parse(r.body).tools ?? []).length > 0);
if (!first) {
  console.log(`${arm}: no main-loop request recorded (${reqs.length} requests)`);
  process.exit(1);
}
const body = JSON.parse(first.body);
const text = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => (typeof b?.text === "string" ? b.text : typeof b?.content === "string" ? b.content : "")).join("\n") : "");
const fields: [string, string][] = [
  ["system", text(body.system)],
  ["tools[Skill].description", (body.tools ?? []).find((t: any) => t.name === "Skill")?.description ?? ""],
  ...(body.messages ?? []).flatMap((m: any, i: number) => (Array.isArray(m.content) ? m.content : [m.content]).map((b: any, j: number) => [`messages[${i}].${m.role}[${j}]`, text([b])] as [string, string])),
];
const where = (needle: string) => fields.filter(([, t]) => t.includes(needle)).map(([name, t]) => {
  const at = t.indexOf(needle);
  const reminder = t.lastIndexOf("<system-reminder>", at) >= 0 && t.lastIndexOf("</system-reminder>", at) < t.lastIndexOf("<system-reminder>", at);
  return `${name}${reminder ? " inside <system-reminder>" : ""}, preceded by ${JSON.stringify(t.slice(Math.max(0, at - 90), at))}`;
});
const fd = openSync(tar!, "r");
const listing = tarEntries(fd);
const names = [...new Set(listing.entries.map((e) => /^(?:\.\/)?\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(e.name)?.[1]).filter((n): n is string => !!n)), "plugin-authoring"];
const investigate = listing.entries.some((e) => /^(?:\.\/)?\.claude\/skills\/investigate\/SKILL\.md$/.test(e.name)) ? splitSkill(entryBytes(fd, onlyFile(listing.entries, ".claude/skills/investigate/SKILL.md")).toString("utf8")).body : null;
closeSync(fd);
const container = fields.find(([, t]) => t.includes("plugin-authoring"));
const listed = container ? names.filter((n) => new RegExp("(^|\\n)- " + n.replace(/[-]/g, "\\-") + ":").test(container[1])) : [];
console.log(`${arm}: first request ${first.bytes} bytes, ${body.tools.length} tools, system ${text(body.system).length} chars: ${JSON.stringify(text(body.system).slice(0, 160))}`);
console.log(`${arm}: listing in ${container ? container[0] : "nowhere"}; skills listed ${listed.length} (${listed.length <= 3 ? listed.join(", ") : listed.slice(0, 3).join(", ") + ", ..."})`);
for (const [label, needle] of [["shipped investigate description", SHIPPED], ["rewritten investigate description", REWRITTEN_TAIL]] as const) {
  const hits = where(needle);
  console.log(`${arm}: ${label}: ${hits.length ? hits.join("; ") : "absent"}`);
}
if (told === "1") {
  const all = fields.map(([, t]) => t).join("\n");
  const head = investigate?.slice(0, 200) ?? "";
  console.log(`${arm}: told: /investigate command line ${all.includes("<command-name>/investigate</command-name>") ? "present" : "absent"}; body's first 200 characters ${head && all.includes(head) ? "present" : "absent"}`);
}
