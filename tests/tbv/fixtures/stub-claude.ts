#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// A stand-in for Claude Code's request loop in the tbv shape and splice tests: it sends what the real CLI sends at
// session start (a system prompt, a session system message with the environment and the skill listing, tools), renders a
// slash command as a skill invocation, runs Bash and Read tool calls, renders Read in cat -n form and loops until end_turn.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Block = Record<string, any>;
const argv = process.argv.slice(2);
if (argv.includes("--version")) {
  console.log("2.1.312 (Claude Code)");
  process.exit(0);
}
const home = process.env.HOME ?? "";
const cwd = process.cwd();
const model = argv[argv.indexOf("--model") + 1] ?? "";
const maxTurns = Number(argv[argv.indexOf("--max-turns") + 1] ?? "10");
const start = { home: readdirSync(home).sort(), cwd: readdirSync(cwd).sort() };
const line = (await Bun.stdin.text()).split("\n").find(Boolean) ?? "{}";
const prompt = String(JSON.parse(line).message?.content ?? "");
const skillsDir = join(home, ".claude/skills");
const skills = existsSync(skillsDir)
  ? readdirSync(skillsDir).sort().flatMap((n) => {
      const p = join(skillsDir, n, "SKILL.md");
      const m = existsSync(p) ? /^description: (.*)$/m.exec(readFileSync(p, "utf8")) : null;
      return m ? ["- " + n + ": " + m[1]] : [];
    })
  : [];
const env = [
  "# Environment",
  " - Primary working directory: " + cwd,
  "",
  "You are powered by the model named Opus 5.5. The exact model ID is " + model + ".",
  "",
  "Memory lives at `" + home + "/.claude/projects/" + cwd.replace(/\//g, "-") + "/memory/`.",
  ...(skills.length ? ["", "The following skills are available for use with the Skill tool:", "", ...skills] : []),
  "",
  "Today's date is " + new Date().toISOString().slice(0, 10) + ".",
].join("\n");
const system = [
  { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.312." + Math.random().toString(16).slice(2, 5) + "; cc_entrypoint=sdk-cli;" },
  { type: "text", text: "You are a stand-in agent for tests.", cache_control: { type: "ephemeral" } },
];
const tools = [
  { name: "Bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" }, description: { type: "string" } }, required: ["command"] } },
  { name: "Read", description: "Read a file. Output uses cat -n format.", input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } },
];
const reminder = { type: "text", text: "<system-reminder>\nEnd git commit messages with: Co-Authored-By: Claude Opus 5.5\n</system-reminder>\n" };
const cmd = /^\/([a-z-]+)(?: ([\s\S]*))?$/.exec(prompt);
const skillMd = cmd ? join(skillsDir, cmd[1]!, "SKILL.md") : "";
const first: Block[] =
  cmd && existsSync(skillMd)
    ? [
        reminder,
        { type: "text", text: "<command-message>" + cmd[1] + "</command-message>\n<command-name>/" + cmd[1] + "</command-name>\n<command-args>" + (cmd[2] ?? "") + "</command-args>\n" },
        { type: "text", text: "Base directory for this skill: " + join(skillsDir, cmd[1]!) + "\n\n" + readFileSync(skillMd, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "") },
      ]
    : [reminder, { type: "text", text: prompt }];
const messages: Array<{ role: string; content: Block[] }> = [
  { role: "user", content: first },
  { role: "system", content: [{ type: "text", text: env, cache_control: { type: "ephemeral" } }] },
];
const expand = (p: string) => p.replace(/^~(?=\/)/, home);
const runTool = (u: Block): string => {
  if (u.name === "Bash") {
    const r = spawnSync("bash", ["-c", String(u.input.command)], { cwd, env: process.env, encoding: "utf8" });
    return (r.stdout ?? "") + (r.stderr ?? "");
  }
  return readFileSync(expand(String(u.input.file_path)), "utf8").split("\n").map((l, i) => i + 1 + "\t" + l).join("\n");
};
const parseSse = (text: string): Block[] => {
  const blocks: Block[] = [];
  const json: string[] = [];
  for (const chunk of text.split("\n\n")) {
    const data = chunk.split("\n").find((l) => l.startsWith("data: "));
    if (!data) continue;
    const e = JSON.parse(data.slice(6));
    if (e.type === "content_block_start") (blocks[e.index] = { ...e.content_block }), (json[e.index] = "");
    if (e.type === "content_block_delta" && e.delta.type === "text_delta") blocks[e.index]!.text += e.delta.text;
    if (e.type === "content_block_delta" && e.delta.type === "input_json_delta") json[e.index] += e.delta.partial_json;
    if (e.type === "content_block_stop" && blocks[e.index]!.type === "tool_use") blocks[e.index]!.input = JSON.parse(json[e.index] || "{}");
  }
  return blocks;
};
for (let i = 0; i < maxTurns; i++) {
  const res = await fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages?beta=true", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "" },
    body: JSON.stringify({ model, messages, system, tools, max_tokens: 64000, stream: true, metadata: { tbv_stub: { key: process.env.ANTHROPIC_API_KEY, names: Object.keys(process.env).sort(), bundled: process.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS, start } } }),
  });
  const content = parseSse(await res.text());
  messages.push({ role: "assistant", content });
  const uses = content.filter((b) => b.type === "tool_use");
  if (!uses.length) break;
  messages.push({ role: "user", content: uses.map((u) => ({ tool_use_id: u.id, type: "tool_result", content: runTool(u), is_error: false })) });
  messages.push({ role: "system", content: [{ type: "text", text: "<total_tokens>1000 tokens left</total_tokens>" }] });
}
console.log(JSON.stringify({ type: "result", subtype: "success" }));
