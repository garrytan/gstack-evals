// Copyright (c) 2026 Garry Tan. MIT License.
// The Node and timing side of match.ts, in plain JavaScript so it runs under Node and Bun alike. It applies gstack's quote
// transform (passed in from the vendored checker) and compiles each pattern with flag i, as gstack does.
//   node node-probe.mjs sides <in.json>: {regex, before?, quotes, cmds, time, out} writes {version, regex, before, timeMs} to out.
//   node node-probe.mjs time <in.json>: {pattern, quotes, cmd} prints "start <epoch ms>", then "ms <elapsed>" once the test returns.
import { readFileSync, writeFileSync, writeSync } from "node:fs";

const [mode, file] = process.argv.slice(2);
if ((mode !== "sides" && mode !== "time") || !file) {
  process.stderr.write("E_USAGE node-probe.mjs sides|time <in.json>\n");
  process.exit(2);
}
const x = JSON.parse(readFileSync(file, "utf8"));
const quotes = new RegExp(x.quotes.source, x.quotes.flags);
const bare = (c) => c.replace(quotes, '""');
const version = typeof Bun === "undefined" ? "node " + process.version : "bun " + Bun.version;
if (mode === "sides") {
  const re = new RegExp(x.regex, "i");
  const be = x.before === undefined ? null : new RegExp(x.before, "i");
  const timeMs = x.time.map((c) => { const b = bare(c); const t = performance.now(); re.test(b); return performance.now() - t; });
  writeFileSync(x.out, JSON.stringify({ version, regex: x.cmds.map((c) => re.test(bare(c))), before: be ? x.cmds.map((c) => be.test(bare(c))) : undefined, timeMs }));
} else {
  const re = new RegExp(x.pattern, "i");
  const b = bare(x.cmd);
  writeSync(1, "start " + Date.now() + "\n");
  const t = performance.now();
  re.test(b);
  writeSync(1, "ms " + (performance.now() - t) + "\n");
}
